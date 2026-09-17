import { createServiceClient } from '@/lib/supabase/server';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { canUseReviews } from '@/lib/entitlements/tenantEntitlements';
import { deterministicReviewFlags, reviewerDisplayName } from './reviewModeration';
import { getReviewSettings } from './reviewSettings';
import { hashReviewToken } from './reviewInvites';

export interface ReviewSubmissionInput {
  tenantId: string;
  orderId?: string | null;
  token?: string | null;
  rating: number;
  body?: string | null;
}

interface ResolvedEligibility {
  orderId: string;
  customerId: string | null;
  email: string;
  fullName: string | null;
  inviteId: string | null;
}

async function resolveEligibility(tenantId: string, orderId?: string | null, token?: string | null): Promise<ResolvedEligibility | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  if (token) {
    const tokenHash = hashReviewToken(token);
    const { data: tokenRow } = await db.from('review_invite_tokens')
      .select('invite_id, expires_at, consumed_at')
      .eq('tenant_id', tenantId).eq('token_hash', tokenHash).maybeSingle();
    if (!tokenRow || tokenRow.consumed_at || new Date(tokenRow.expires_at).getTime() <= Date.now()) return null;
    const { data: invite } = await db.from('review_invites')
      .select('id, order_id, customer_id, email, full_name, expires_at, completed_at')
      .eq('id', tokenRow.invite_id).eq('tenant_id', tenantId).maybeSingle();
    if (!invite || invite.completed_at || new Date(invite.expires_at).getTime() <= Date.now()) return null;
    return { orderId: invite.order_id, customerId: invite.customer_id, email: invite.email, fullName: invite.full_name, inviteId: invite.id };
  }

  if (!orderId) return null;
  const customer = await getSessionCustomer(tenantId);
  if (!customer) return null;
  const { data: order } = await db.from('orders')
    .select('id, customer_id, email, full_name, status, payment_status')
    .eq('id', orderId).eq('tenant_id', tenantId).eq('customer_id', customer.id).maybeSingle();
  if (!order || order.status !== 'delivered' || order.payment_status !== 'paid') return null;
  return { orderId: order.id, customerId: customer.id, email: order.email, fullName: order.full_name ?? customer.full_name, inviteId: null };
}

export async function submitVerifiedReview(input: ReviewSubmissionInput): Promise<{ id: string; status: string }> {
  if (!(await canUseReviews(input.tenantId))) throw new Error('reviews_disabled');
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new Error('review_rating_invalid');
  const body = input.body?.trim() || null;
  if (body && body.length > 2000) throw new Error('review_body_too_long');
  const eligibility = await resolveEligibility(input.tenantId, input.orderId, input.token);
  if (!eligibility) throw new Error('review_not_authorized');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const settings = await getReviewSettings(input.tenantId);
  const flags = deterministicReviewFlags(body, settings.blacklistTerms);
  const { data: review, error } = await db.from('reviews').insert({
    tenant_id: input.tenantId,
    order_id: eligibility.orderId,
    customer_id: eligibility.customerId,
    review_type: 'service',
    rating: input.rating,
    body,
    reviewer_display_name: reviewerDisplayName(eligibility.fullName, eligibility.email),
    verified_purchase: true,
    status: 'pending_moderation',
    moderation_flags: flags,
  }).select('id, status').single();
  if (error) {
    if (error.code === '23505') throw new Error('review_already_exists');
    throw new Error(`review_insert_failed:${error.message}`);
  }

  const completedAt = new Date().toISOString();
  const { data: completedInvites } = await db.from('review_invites')
    .update({ completed_at: completedAt, processing_started_at: null, updated_at: completedAt })
    .eq('tenant_id', input.tenantId)
    .eq('order_id', eligibility.orderId)
    .eq('review_type', 'service')
    .select('id');
  const completedInviteIds = (completedInvites ?? []).map((invite: { id: string }) => invite.id);
  if (completedInviteIds.length > 0) {
    await db.from('review_invite_tokens').update({ consumed_at: completedAt })
      .eq('tenant_id', input.tenantId).in('invite_id', completedInviteIds).is('consumed_at', null);
  }
  if (eligibility.customerId) {
    await db.from('customer_events').upsert({
      tenant_id: input.tenantId,
      customer_id: eligibility.customerId,
      event_type: 'review_submitted',
      source: 'reviews',
      entity_type: 'review',
      entity_id: review.id,
      event_key: `review_submitted:${review.id}`,
      metadata: { rating: input.rating },
      occurred_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,event_key', ignoreDuplicates: true });
  }
  return review;
}

export async function resolveReviewFormContext(tenantId: string, orderId?: string | null, token?: string | null) {
  if (!(await canUseReviews(tenantId))) return null;
  const eligibility = await resolveEligibility(tenantId, orderId, token);
  if (!eligibility) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data: existing } = await db.from('reviews').select('id, status, rating').eq('tenant_id', tenantId).eq('order_id', eligibility.orderId).eq('review_type', 'service').maybeSingle();
  return { orderId: eligibility.orderId, token: token ?? null, existing };
}
