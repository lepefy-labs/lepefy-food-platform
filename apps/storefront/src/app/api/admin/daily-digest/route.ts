import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { dailyDigestModule, dailyDigestPatchSchema, DAILY_DIGEST_FEATURE_KEY } from '@/lib/notifications/dailyDigestConfig';
import {
  isModuleRegistered, readModuleConfig, updateModuleConfig, ModuleConfigValidationError,
} from '@/lib/tenantConfig/moduleConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UNAVAILABLE = { error: 'La migration 129 doit être appliquée avant d’utiliser ce rapport.' };

async function currentTenantId(): Promise<string> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return tenant.id;
}

export async function GET() {
  const tenantId = await currentTenantId();
  const denied = await requireAdmin(tenantId);
  if (denied) return denied;

  const db = createServiceClient();
  try {
    if (!(await isModuleRegistered(db, DAILY_DIGEST_FEATURE_KEY))) return NextResponse.json(UNAVAILABLE, { status: 409 });
    return NextResponse.json(await readModuleConfig(db, dailyDigestModule, tenantId));
  } catch (error) {
    console.error('[daily digest settings] read failed', tenantId, error);
    return NextResponse.json({ error: 'Lecture de la configuration impossible.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const tenantId = await currentTenantId();
  const denied = await requireAdmin(tenantId);
  if (denied) return denied;

  const parsed = dailyDigestPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides : vérifiez le fuseau horaire et les seuils (1 à 336 h, suivi transporteur 24 à 336 h).' }, { status: 400 });
  }

  const db = createServiceClient();
  try {
    if (!(await isModuleRegistered(db, DAILY_DIGEST_FEATURE_KEY))) return NextResponse.json(UNAVAILABLE, { status: 409 });
    return NextResponse.json(await updateModuleConfig(db, dailyDigestModule, tenantId, parsed.data));
  } catch (error) {
    if (error instanceof ModuleConfigValidationError) {
      return NextResponse.json({ error: 'Configuration invalide.', issues: error.issues }, { status: 400 });
    }
    console.error('[daily digest settings] update failed', tenantId, error);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }
}
