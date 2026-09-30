import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { listTenantFeatureFlags, setFeatureFlag } from '@/lib/featureFlags/featureFlags';
import { FEATURE_FLAG_KEY_PATTERN } from '@/lib/featureFlags/featureFlagRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const SETTINGS_PAGE = '/admin/parametres/fonctionnalites';

const patchSchema = z.object({
  flagKey: z.string().regex(FEATURE_FLAG_KEY_PATTERN),
  enabled: z.boolean(),
});

async function currentTenantId(): Promise<string> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? '');
  return tenant.id;
}

export async function GET() {
  const tenantId = await currentTenantId();
  const denied = await requireAdmin(tenantId);
  if (denied) return denied;

  try {
    return NextResponse.json({ flags: await listTenantFeatureFlags(tenantId) });
  } catch (error) {
    console.error('[feature flags] read failed', tenantId, error);
    return NextResponse.json({ error: 'Lecture des fonctionnalités impossible (migration 138 appliquée ?).' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const tenantId = await currentTenantId();
  const denied = await requireAdmin(tenantId);
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });

  try {
    // Seuls les flags déclarés dans le code ou déjà présents pour ce tenant.
    const known = await listTenantFeatureFlags(tenantId);
    if (!known.some((flag) => flag.key === parsed.data.flagKey)) {
      return NextResponse.json({ error: 'Fonctionnalité inconnue.' }, { status: 404 });
    }
    await setFeatureFlag(tenantId, parsed.data.flagKey, parsed.data.enabled);
    revalidatePath(SETTINGS_PAGE);
    return NextResponse.json({ flags: await listTenantFeatureFlags(tenantId) });
  } catch (error) {
    console.error('[feature flags] update failed', tenantId, parsed.data.flagKey, error);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }
}
