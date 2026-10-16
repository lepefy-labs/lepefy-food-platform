import { NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getCurrentAdminAccessContext, type AdminAccessContext } from '@/lib/auth/adminRbac';
import { resolvePlatformTenantId } from '@/lib/notifications/platformTenant';

/** Platform owner + target tenant + actor for the catch-up API routes. */
export async function requireBackfillApi(requestedTenant: unknown): Promise<
  { ok: true; tenantId: string; actor: AdminAccessContext } | { ok: false; response: NextResponse }
> {
  const denied = await requirePlatformOwner();
  if (denied) return { ok: false, response: denied };
  const tenantId = await resolvePlatformTenantId(typeof requestedTenant === 'string' ? requestedTenant : null);
  if (!tenantId) return { ok: false, response: NextResponse.json({ error: 'Boutique introuvable.' }, { status: 404 }) };
  const actor = await getCurrentAdminAccessContext(tenantId);
  if (!actor?.isPlatformOwner) return { ok: false, response: NextResponse.json({ error: 'Accès réservé au propriétaire de la plateforme.' }, { status: 403 }) };
  return { ok: true, tenantId, actor };
}
