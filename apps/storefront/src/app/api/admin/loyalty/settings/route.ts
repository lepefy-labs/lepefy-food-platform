import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { LOYALTY_FEATURE_KEY, loyaltyModule, loyaltyPatchSchema, getLoyaltySettings } from '@/lib/loyalty/loyaltyConfig';
import {
  isModuleRegistered, updateModuleConfig, ModuleConfigValidationError,
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
    if (!(await isModuleRegistered(db, LOYALTY_FEATURE_KEY))) {
      return NextResponse.json({ error: 'La migration 130 doit être appliquée.' }, { status: 409 });
    }
    // The settings row is the only source of truth (legacy columns: migration 131).
    await updateModuleConfig(db, loyaltyModule, tenant.id, parsed.data);
    return NextResponse.json(await getLoyaltySettings(db, tenant.id));
  } catch (error) {
    if (error instanceof ModuleConfigValidationError) {
      return NextResponse.json({ error: 'Configuration fidélité invalide.', issues: error.issues }, { status: 400 });
    }
    console.error('[loyalty settings] update failed', tenant.id, error);
    return NextResponse.json({ error: 'Enregistrement du programme fidélité impossible.' }, { status: 500 });
  }
}

// Refresh tenant-scoped cached pages after a program change.
export const PATCH = withStorefrontInvalidation(['tenant'], handlePATCH);
