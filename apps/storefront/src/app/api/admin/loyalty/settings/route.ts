import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { LOYALTY_FEATURE_KEY, loyaltyModule, loyaltyPatchSchema, getLoyaltySettings } from '@/lib/loyalty/loyaltyConfig';
import {
  isModuleRegistered, mergeModuleConfig, updateModuleConfig, ModuleConfigValidationError,
} from '@/lib/tenantConfig/moduleConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handlePATCH(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const parsed = loyaltyPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides : les taux doivent être positifs (4 décimales au plus).' }, { status: 400 });
  }

  const db = createServiceClient();
  try {
    if (await isModuleRegistered(db, LOYALTY_FEATURE_KEY)) {
      // Migration 130 applied: the settings row is the source of truth and a
      // trigger mirrors it to the legacy tenants columns in the same transaction.
      await updateModuleConfig(db, loyaltyModule, tenant.id, parsed.data);
    } else {
      // Before migration 130: validate identically, then write the legacy columns.
      const current = await getLoyaltySettings(db, tenant.id, tenant);
      const next = mergeModuleConfig(loyaltyModule, {
        enabled: current.enabled,
        config: { purchase_points_rate: current.purchasePointsRate, points_to_currency_rate: current.pointsToCurrencyRate },
      }, parsed.data);
      const { error } = await db.from('tenants').update({
        loyalty_enabled: next.enabled,
        purchase_points_rate: next.config.purchase_points_rate,
        points_to_currency_rate: next.config.points_to_currency_rate,
      }).eq('id', tenant.id);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json(await getLoyaltySettings(db, tenant.id, tenant));
  } catch (error) {
    if (error instanceof ModuleConfigValidationError) {
      return NextResponse.json({ error: 'Configuration fidélité invalide.', issues: error.issues }, { status: 400 });
    }
    console.error('[loyalty settings] update failed', tenant.id, error);
    return NextResponse.json({ error: 'Enregistrement du programme fidélité impossible.' }, { status: 500 });
  }
}

// Legacy columns are part of the cached tenant row: refresh it after a write.
export const PATCH = withStorefrontInvalidation(['tenant'], handlePATCH);
