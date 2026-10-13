import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { ModuleConfigValidationError, updateModuleConfig } from '@/lib/tenantConfig/moduleConfig';
import { digitalCardModule, readDigitalCardSettings } from '@/lib/card/digitalCardSettings';
import { normalizeHeroPosition, type DigitalCardConfig } from '@/lib/card/cardHero';
import { openingHoursSchema } from '@/lib/card/openingHours';
import { removeOldHeroVariants } from '@/lib/card/cardHeroStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  hero_image_position: z.string().trim().max(40).nullable().optional(),
  /** Revenir à la photo par défaut (asset du tenant ou dégradé). */
  reset_hero: z.literal(true).optional(),
  opening_hours: openingHoursSchema.nullable().optional(),
}).strict();

async function currentTenantId(): Promise<string> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return tenant.id;
}

/** GET/PATCH réglages de la carte digitale (tenant_settings.view / manage). */
export async function GET() {
  const tenantId = await currentTenantId();
  const denied = await requireAdmin(tenantId);
  if (denied) return denied;
  const state = await readDigitalCardSettings(createServiceClient(), tenantId);
  return NextResponse.json({ config: state.config, status: state.status }, { headers: { 'Cache-Control': 'no-store' } });
}

async function handlePATCH(req: NextRequest) {
  const tenantId = await currentTenantId();
  const denied = await requireAdmin(tenantId);
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Réglages invalides.', issues: parsed.error.issues.map((issue) => issue.message) }, { status: 400 });
  }
  const patch: Partial<DigitalCardConfig> = {};
  if (parsed.data.hero_image_position !== undefined) {
    const position = parsed.data.hero_image_position === null ? null : normalizeHeroPosition(parsed.data.hero_image_position);
    if (parsed.data.hero_image_position !== null && !position) return NextResponse.json({ error: 'Cadrage invalide.' }, { status: 400 });
    patch.hero_image_position = position;
  }
  if (parsed.data.reset_hero) {
    patch.hero_image_base = null;
    patch.hero_image_widths = null;
    patch.hero_image_url = null;
  }
  if (parsed.data.opening_hours !== undefined) patch.opening_hours = parsed.data.opening_hours;

  const db = createServiceClient();
  try {
    const state = await updateModuleConfig(db, digitalCardModule, tenantId, { config: patch });
    if (parsed.data.reset_hero) await removeOldHeroVariants(db, tenantId, null);
    return NextResponse.json({ config: state.config });
  } catch (error) {
    if (error instanceof ModuleConfigValidationError) {
      return NextResponse.json({ error: 'Réglages invalides.', issues: error.issues }, { status: 400 });
    }
    console.error('[card settings] update failed', tenantId, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }
}

// /card lit ces réglages (ISR) : la modification doit y être visible tout de suite.
export const PATCH = withStorefrontInvalidation(['tenant'], handlePATCH);
