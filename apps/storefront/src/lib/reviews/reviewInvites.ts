import crypto from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { canUseReviews } from '@/lib/entitlements/tenantEntitlements';
import { getReviewSettings } from './reviewSettings';

interface EligibleOrder {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  email: string;
  full_name: string | null;
  status: string;
  payment_status: string;
  updated_at: string;
}

export function hashReviewToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createReviewToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export async function ensureReviewInviteForOrder(tenantId: string, orderId: string): Promise<void> {
  if (!(await canUseReviews(tenantId))) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const { data: order, error } = await service
    .from('orders')
    .select('id, tenant_id, customer_id, email, full_name, status, payment_status, updated_at')
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .maybeSingle() as { data: EligibleOrder | null; error: { message: string } | null };
  if (error) throw new Error(`Unable to resolve review order: ${error.message}`);
  if (!order || order.status !== 'delivered' || order.payment_status !== 'paid' || !order.email) return;

  const settings = await getReviewSettings(tenantId);
  const base = new Date(order.updated_at || Date.now()).getTime();
  const eligibleAt = new Date(base + settings.requestDelayHours * 60 * 60 * 1000);
  const reminderAt = new Date(eligibleAt.getTime() + settings.reminderAfterDays * 24 * 60 * 60 * 1000);
  const expiresAt = new Date(eligibleAt.getTime() + settings.inviteExpiryDays * 24 * 60 * 60 * 1000);
  const { error: upsertError } = await service.from('review_invites').upsert({
    tenant_id: tenantId,
    order_id: order.id,
    customer_id: order.customer_id,
    email: order.email.trim().toLowerCase(),
    full_name: order.full_name,
    review_type: 'service',
    eligible_at: eligibleAt.toISOString(),
    reminder_at: reminderAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,order_id,review_type', ignoreDuplicates: true });
  if (upsertError) throw new Error(`Unable to schedule review invite: ${upsertError.message}`);
}
