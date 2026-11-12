import 'server-only';
import { notFound } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { canAdmin, getCurrentAdminAccessContext, requirePermission, type AdminAccessContext } from '@/lib/auth/adminRbac';
import type { Tenant } from '@lepefy/types';
import { STUDIO_FLAG, STUDIO_PERMISSION } from '../domain';
import { STUDIO_ERRORS, studioErrorCode } from '../rules';

/**
 * Guards of the Studio. The tenant always comes from the deployment
 * (getTenant), never from the browser; capability, tenant match and release
 * flag are checked on every call. Publishing also requires the permission of
 * the destination (checked in publish.ts). Hiding the menu is UX only.
 */

export function isStudioEnabled(tenantId: string): Promise<boolean> {
  return isFeatureEnabled(tenantId, STUDIO_FLAG);
}

export type StudioApiAccess =
  | { ok: true; tenant: Tenant; access: AdminAccessContext; adminId: string }
  | { ok: false; response: NextResponse };

export async function studioApi(): Promise<StudioApiAccess> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, STUDIO_PERMISSION);
  if (denied) return { ok: false, response: denied };
  if (!(await isStudioEnabled(tenant.id))) return { ok: false, response: NextResponse.json({ error: 'Introuvable.' }, { status: 404 }) };
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access) return { ok: false, response: NextResponse.json({ error: 'Accès refusé.' }, { status: 403 }) };
  return { ok: true, tenant, access, adminId: access.userId };
}

/** Pages: 404 when the module is off or the capability is missing. */
export async function requireStudioPage(): Promise<{ tenant: Tenant; access: AdminAccessContext }> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access || !canAdmin(access, STUDIO_PERMISSION) || !(await isStudioEnabled(tenant.id))) notFound();
  return { tenant, access };
}

export function studioErrorResponse(error: unknown, fallback = 'L’opération n’a pas abouti. Réessayez.'): NextResponse {
  const code = studioErrorCode(error);
  if (code) {
    const known = STUDIO_ERRORS[code]!;
    return NextResponse.json({ error: known.message, code }, { status: known.status });
  }
  const pgCode = (error as { code?: string } | null)?.code;
  if (pgCode === '42883' || pgCode === '42P01' || pgCode === 'PGRST202') {
    return NextResponse.json({ error: 'Le Studio images n’est pas encore installé (migration 183).' }, { status: 503 });
  }
  console.error('[studio] unexpected error:', pgCode ?? (error instanceof Error ? error.message.slice(0, 160) : 'unknown'));
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** Request body as an object, or null (invalid JSON, wrong type, too large). */
export async function readJson(request: Request, maxBytes = 16_000): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
