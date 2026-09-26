import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import {
  REFERRAL_FEATURE_KEY, referralModule, referralPatchSchema, getReferralSettings,
} from '@/lib/loyalty/referralConfig';
import {
  isModuleRegistered, mergeModuleConfig, updateModuleConfig, ModuleConfigValidationError,
} from '@/lib/tenantConfig/moduleConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handlePATCH(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const parsed = referralPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres de parrainage invalides (profondeur 1 à 5, période 1 à 3650 jours, montants positifs).' }, { status: 400 });
  }
  const config = parsed.data.config;
  if (config.availability_mode === 'SPENDING_THRESHOLD' && !(config.unlock_spending_threshold != null && config.unlock_spending_threshold > 0)) {
    return NextResponse.json({ error: 'Le seuil de dépenses doit être supérieur à 0 en mode « seuil de dépenses ».' }, { status: 400 });
  }

  const db = createServiceClient();
  try {
    if (await isModuleRegistered(db, REFERRAL_FEATURE_KEY)) {
      // Migration 132 applied: the settings row is the source of truth; a
      // trigger mirrors it to the legacy tenants columns in the same transaction.
      await updateModuleConfig(db, referralModule, tenant.id, { config });
    } else {
      // Before migration 132: validate identically, then write the legacy columns.
      const current = await getReferralSettings(db, tenant.id);
      if (!current) throw new Error('referral_settings_unavailable');
      const next = mergeModuleConfig(referralModule, {
        enabled: true,
        config: {
          max_depth: current.referral_max_depth,
          signup_bonus_points: current.referral_signup_bonus_points,
          availability_mode: current.referral_availability_mode,
          unlock_spending_threshold: current.referral_unlock_spending_threshold,
          fraud_max_conversions: current.referral_fraud_max_conversions,
          fraud_period_days: current.referral_fraud_period_days,
          fraud_action: current.referral_fraud_action,
        },
      }, { config }).config;
      const { error } = await db.from('tenants').update({
        referral_max_depth: next.max_depth,
        referral_availability_mode: next.availability_mode,
        referral_unlock_spending_threshold: next.unlock_spending_threshold,
        referral_fraud_max_conversions: next.fraud_max_conversions,
        referral_fraud_period_days: next.fraud_period_days,
        referral_fraud_action: next.fraud_action,
      }).eq('id', tenant.id);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json(await getReferralSettings(db, tenant.id));
  } catch (error) {
    if (error instanceof ModuleConfigValidationError) {
      return NextResponse.json({ error: 'Configuration de parrainage invalide.', issues: error.issues }, { status: 400 });
    }
    console.error('[referral settings] update failed', tenant.id, error);
    return NextResponse.json({ error: 'Enregistrement du parrainage impossible.' }, { status: 500 });
  }
}

// Legacy columns are part of the cached tenant row: refresh it after a write.
export const PATCH = withStorefrontInvalidation(['tenant'], handlePATCH);
