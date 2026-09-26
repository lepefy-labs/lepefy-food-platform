import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import {
  REFERRAL_FEATURE_KEY, referralModule, referralPatchSchema, getReferralSettings,
} from '@/lib/loyalty/referralConfig';
import {
  isModuleRegistered, readModuleConfig, updateModuleConfig, ModuleConfigValidationError,
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
    if (!(await isModuleRegistered(db, REFERRAL_FEATURE_KEY))) {
      return NextResponse.json({ error: 'La migration 132 doit être appliquée.' }, { status: 409 });
    }
    // The settings row is the only source of truth (legacy columns: migration 133).
    // A never-configured tenant runs on the defaults with the program available,
    // so its first save creates an enabled row; otherwise activation is kept.
    const current = await readModuleConfig(db, referralModule, tenant.id);
    await updateModuleConfig(db, referralModule, tenant.id, current.status === 'missing' ? { enabled: true, config } : { config });
    return NextResponse.json(await getReferralSettings(db, tenant.id));
  } catch (error) {
    if (error instanceof ModuleConfigValidationError) {
      return NextResponse.json({ error: 'Configuration de parrainage invalide.', issues: error.issues }, { status: 400 });
    }
    console.error('[referral settings] update failed', tenant.id, error);
    return NextResponse.json({ error: 'Enregistrement du parrainage impossible.' }, { status: 500 });
  }
}

// Refresh tenant-scoped cached pages after a program change.
export const PATCH = withStorefrontInvalidation(['tenant'], handlePATCH);
