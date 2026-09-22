import { timingSafeEqual } from 'node:crypto';
import { shippingSyncAuthorized } from '@/lib/shipping/shippingSyncAuth';

/**
 * Dedicated bearer auth for n8n shipping campaign ticks. During the safe
 * migration, the existing service-role bearer remains valid for the GitHub
 * workflow_dispatch fallback. Never send the service-role key to n8n.
 * All credentials are server-only environment variables.
 */
export function shippingCampaignSchedulerAuthorized(
  authorization: string | null,
  schedulerToken: string | undefined = process.env.SHIPPING_CAMPAIGN_SCHEDULER_TOKEN,
  legacyServiceRole: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY,
): boolean {
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!supplied || supplied.includes(' ') || supplied.includes('\n')) return false;
  const expected = schedulerToken?.trim() ?? '';
  if (expected) {
    const actualBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)) return true;
  }
  // Legacy compatibility for the current GitHub scheduler and its manual
  // recovery action. Remove only after n8n has been verified in production.
  return shippingSyncAuthorized(authorization, legacyServiceRole ?? '');
}
