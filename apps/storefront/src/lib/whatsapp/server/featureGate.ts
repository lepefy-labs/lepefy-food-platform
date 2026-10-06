import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import type { Tenant } from '@lepefy/types';
import { canAdmin, getCurrentAdminAccessContext, requirePermission, type AdminAccessContext } from '@/lib/auth/adminRbac';
import { getAdminId } from '@/lib/auth/getAdminId';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { getTenant } from '@/lib/tenant/getTenant';
import { WHATSAPP_FEATURE_FLAG } from '@/lib/whatsapp/config';

/**
 * Garde unique du module WhatsApp (flag de release `whatsapp_business`).
 * Fail-closed : flag absent, éteint ou illisible = module inexistant (404).
 * Masquer l'entrée de menu n'est pas le contrôle de sécurité : chaque page
 * appelle requireWhatsAppPage() et chaque API requireWhatsAppApi().
 * Le tenant est celui du déploiement, jamais une valeur envoyée par le client.
 */

export function isWhatsAppEnabled(tenantId: string): Promise<boolean> {
  return isFeatureEnabled(tenantId, WHATSAPP_FEATURE_FLAG);
}

async function currentTenant(): Promise<Tenant> {
  return getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? '');
}

export interface WhatsAppPageContext {
  tenant: Tenant;
  access: AdminAccessContext;
  can: (permission: string) => boolean;
}

export async function requireWhatsAppPage(permission: string): Promise<WhatsAppPageContext> {
  const tenant = await currentTenant();
  if (!(await isWhatsAppEnabled(tenant.id))) notFound();
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access) redirect('/admin/login');
  if (!access.isPlatformOwner && access.tenantId !== tenant.id) redirect('/admin/login?error=unauthorized');
  if (!canAdmin(access, permission)) redirect('/admin');
  return { tenant, access, can: (candidate: string) => canAdmin(access, candidate) };
}

export type WhatsAppApiContext =
  | { ok: true; tenant: Tenant; actorId: string | null }
  | { ok: false; response: NextResponse };

/**
 * API /api/admin/whatsapp/** : 404 si le flag est éteint, puis la capability de
 * la carte centrale (adminApiPermissions.ts). `platformOnly` ajoute le contrôle
 * propriétaire de plateforme (identité du numéro, envoi de test).
 */
export async function requireWhatsAppApi(options: { platformOnly?: boolean; extraPermission?: string } = {}): Promise<WhatsAppApiContext> {
  const tenant = await currentTenant();
  if (!(await isWhatsAppEnabled(tenant.id))) {
    return { ok: false, response: NextResponse.json({ error: 'Module indisponible.' }, { status: 404 }) };
  }
  const denied = await requireAdmin(tenant.id);
  if (denied) return { ok: false, response: denied };
  if (options.extraPermission) {
    const extraDenied = await requirePermission(tenant.id, options.extraPermission);
    if (extraDenied) return { ok: false, response: extraDenied };
  }
  if (options.platformOnly) {
    const platformDenied = await requirePlatformOwner();
    if (platformDenied) return { ok: false, response: platformDenied };
  }
  return { ok: true, tenant, actorId: await getAdminId() };
}
