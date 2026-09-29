import { timingSafeEqual } from 'node:crypto';

export function shippingSyncAuthorized(header: string | null, expected = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''): boolean {
  const supplied = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Dedicated n8n scheduler bearer, with the legacy service-role bearer still
 * accepted for the GitHub workflow_dispatch fallback during the cutover.
 * Never send the service-role key to n8n.
 */
export function schedulerBearerAuthorized(
  authorization: string | null,
  schedulerToken: string | undefined,
  legacyServiceRole: string | undefined,
): boolean {
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!supplied || supplied.includes(' ') || supplied.includes('\n')) return false;
  const expected = schedulerToken?.trim() ?? '';
  if (expected) {
    const actualBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)) return true;
  }
  // Legacy compatibility for the GitHub scheduler and its manual recovery
  // action. Remove only after n8n has been verified in production.
  return shippingSyncAuthorized(authorization, legacyServiceRole ?? '');
}

export function shippingSyncSchedulerAuthorized(
  authorization: string | null,
  schedulerToken: string | undefined = process.env.SHIPPING_SYNC_SCHEDULER_TOKEN,
  legacyServiceRole: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY,
): boolean {
  return schedulerBearerAuthorized(authorization, schedulerToken, legacyServiceRole);
}
