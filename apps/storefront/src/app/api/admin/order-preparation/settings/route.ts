import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  ORDER_PREPARATION_FEATURE_KEY, orderPreparationModule, orderPreparationPatchSchema, readOrderPreparationSettings,
} from '@/lib/orders/preparation/settings';
import { isModuleRegistered, updateModuleConfig, ModuleConfigValidationError } from '@/lib/tenantConfig/moduleConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UNAVAILABLE = { error: 'La migration 160 doit être appliquée avant d’enregistrer ces préférences.' };

async function currentTenantId(): Promise<string> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return tenant.id;
}

/**
 * GET/PATCH « Préparation et emballage » (tenant_settings.view / manage, adminApiPermissions).
 * Audited by the tenant_feature_settings trigger (admin.module_settings.changed).
 * Orders already in preparation keep their snapshot: nothing is rewritten here.
 */
export async function GET() {
  const tenantId = await currentTenantId();
  const denied = await requireAdmin(tenantId);
  if (denied) return denied;
  return NextResponse.json(await readOrderPreparationSettings(createServiceClient(), tenantId), { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(req: NextRequest) {
  const tenantId = await currentTenantId();
  const denied = await requireAdmin(tenantId);
  if (denied) return denied;

  const parsed = orderPreparationPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Préférences invalides.' }, { status: 400 });

  const db = createServiceClient();
  try {
    if (!(await isModuleRegistered(db, ORDER_PREPARATION_FEATURE_KEY))) return NextResponse.json(UNAVAILABLE, { status: 409 });
    const state = await updateModuleConfig(db, orderPreparationModule, tenantId, { enabled: true, config: parsed.data.config });
    return NextResponse.json({ config: state.config, available: true, status: state.status });
  } catch (error) {
    if (error instanceof ModuleConfigValidationError) {
      return NextResponse.json({ error: 'Préférences invalides.', issues: error.issues }, { status: 400 });
    }
    console.error('[order-preparation settings] update failed', tenantId, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }
}
