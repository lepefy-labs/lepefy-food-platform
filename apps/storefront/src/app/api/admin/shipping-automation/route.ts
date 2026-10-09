import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  readShippingAutomationSettings, shippingAutomationModule, shippingAutomationPatchSchema, SHIPPING_AUTOMATION_FEATURE_KEY,
} from '@/lib/shipping/shipmentDraft/settings';
import { isModuleRegistered, updateModuleConfig, ModuleConfigValidationError } from '@/lib/tenantConfig/moduleConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };
const UNAVAILABLE = { error: 'La migration 151 doit être appliquée avant d’enregistrer ce réglage.' };

/**
 * GET/PATCH « Création des expéditions » (shipping.view / shipping.manage).
 * Aucun effet rétroactif : seules les commandes créées ou mises en préparation
 * après l'activation sont mises en file.
 */
export async function GET() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  return NextResponse.json(await readShippingAutomationSettings(createServiceClient(), tenant.id), { headers });
}

export async function PATCH(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const parsed = shippingAutomationPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Réglage invalide.' }, { status: 400, headers });

  const db = createServiceClient();
  try {
    if (!(await isModuleRegistered(db, SHIPPING_AUTOMATION_FEATURE_KEY))) return NextResponse.json(UNAVAILABLE, { status: 409, headers });
    await updateModuleConfig(db, shippingAutomationModule, tenant.id, { enabled: parsed.data.enabled, config: parsed.data.config });
    console.info(`[shipping/draft] settings updated — tenant_id: ${tenant.id}`);
    return NextResponse.json(await readShippingAutomationSettings(db, tenant.id), { headers });
  } catch (error) {
    if (error instanceof ModuleConfigValidationError) return NextResponse.json({ error: 'Réglage invalide.' }, { status: 400, headers });
    console.error(`[shipping/draft] settings update failed — tenant_id: ${tenant.id}`);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500, headers });
  }
}
