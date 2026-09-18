import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { canUseReviews } from '@/lib/entitlements/tenantEntitlements';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { createReviewToken, hashReviewToken } from '@/lib/reviews/reviewInvites';
import { reviewDispatchAuthorized } from '@/lib/reviews/reviewDispatchAuth';

export async function POST(req: NextRequest) {
  if (!reviewDispatchAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as { inviteId?: string } | null;
  if (!body?.inviteId) return NextResponse.json({ error: 'inviteId required' }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data: claimed, error: claimError } = await db.rpc('claim_review_invite_delivery', { p_invite_id: body.inviteId });
  if (claimError) return NextResponse.json({ error: 'claim_failed' }, { status: 500 });
  const claim = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!claim) return NextResponse.json({ ok: true, skipped: true }, { status: 202 });

  const { data: invite } = await db.from('review_invites')
    .select('id, tenant_id, order_id, customer_id, email, full_name, expires_at')
    .eq('id', body.inviteId).eq('tenant_id', claim.tenant_id).maybeSingle();
  if (!invite) return NextResponse.json({ error: 'invite_not_found' }, { status: 404 });

  const clearProcessing = async (lastError: string, complete = false) => {
    await db.from('review_invites').update({
      processing_started_at: null,
      last_error: lastError.slice(0, 500),
      ...(complete ? { completed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', invite.id).eq('tenant_id', invite.tenant_id);
  };

  if (!(await canUseReviews(invite.tenant_id))) {
    await clearProcessing('reviews_disabled', true);
    return NextResponse.json({ ok: true, skipped: 'disabled' }, { status: 202 });
  }

  const { data: order } = await db.from('orders').select('id, status, payment_status')
    .eq('id', invite.order_id).eq('tenant_id', invite.tenant_id).maybeSingle();
  if (!order || order.status !== 'delivered' || order.payment_status !== 'paid') {
    await clearProcessing('order_no_longer_eligible', true);
    return NextResponse.json({ ok: true, skipped: 'ineligible' }, { status: 202 });
  }

  const { data: existingReview, error: reviewLookupError } = await db.from('reviews')
    .select('id')
    .eq('tenant_id', invite.tenant_id)
    .eq('order_id', invite.order_id)
    .eq('review_type', 'service')
    .maybeSingle();
  if (reviewLookupError) {
    await clearProcessing('review_lookup_failed');
    return NextResponse.json({ error: 'review_lookup_failed' }, { status: 503 });
  }
  if (existingReview) {
    await clearProcessing('review_already_submitted', true);
    return NextResponse.json({ ok: true, skipped: 'review_exists' }, { status: 202 });
  }

  const tenant = await getTenantNotificationContext(invite.tenant_id);
  if (!tenant?.storefrontUrl) {
    await clearProcessing('tenant_storefront_unavailable');
    return NextResponse.json({ error: 'tenant_storefront_unavailable' }, { status: 503 });
  }

  const rawToken = createReviewToken();
  const tokenHash = hashReviewToken(rawToken);
  const { data: tokenRow, error: tokenError } = await db.from('review_invite_tokens').insert({
    invite_id: invite.id,
    tenant_id: invite.tenant_id,
    token_hash: tokenHash,
    purpose: claim.delivery_kind,
    expires_at: invite.expires_at,
  }).select('id').single();
  if (tokenError || !tokenRow) {
    await clearProcessing('token_creation_failed');
    return NextResponse.json({ error: 'token_creation_failed' }, { status: 500 });
  }

  const reviewUrl = `${tenant.storefrontUrl.replace(/\/$/, '')}/avis/donner?token=${encodeURIComponent(rawToken)}`;
  const accepted = await notifyN8n('/webhook/review-invite', {
    ...tenant,
    kind: claim.delivery_kind,
    orderId: invite.order_id,
    orderNumber: `#${String(invite.order_id).slice(0, 8).toUpperCase()}`,
    email: invite.email,
    fullName: invite.full_name ?? '',
    reviewUrl,
    expiresAt: invite.expires_at,
    verifiedPurchase: true,
  });

  if (!accepted) {
    await db.from('review_invite_tokens').delete().eq('id', tokenRow.id).eq('tenant_id', invite.tenant_id);
    await clearProcessing('n8n_not_accepted');
    return NextResponse.json({ error: 'delivery_not_accepted' }, { status: 503 });
  }

  const now = new Date().toISOString();
  const patch = claim.delivery_kind === 'initial'
    ? { sent_at: now, processing_started_at: null, last_error: null, updated_at: now }
    : { reminder_sent_at: now, processing_started_at: null, last_error: null, updated_at: now };
  const { error: finalizeError } = await db.from('review_invites').update(patch).eq('id', invite.id).eq('tenant_id', invite.tenant_id);
  if (finalizeError) return NextResponse.json({ error: 'finalize_failed' }, { status: 500 });
  return NextResponse.json({ ok: true, kind: claim.delivery_kind });
}
