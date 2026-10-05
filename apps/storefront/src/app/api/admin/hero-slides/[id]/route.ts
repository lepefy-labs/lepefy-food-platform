import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { safeSlideHref, slideIssues, VALID_VARIANTS, type SlideFields } from '@/lib/home/heroSlideRules';
import type { HeroSlideBackgroundVariant } from '@lepefy/types';

export const runtime = 'nodejs';

const TEXT_FIELDS: (keyof SlideFields)[] = [
  'badge_text', 'title', 'subtitle', 'cta_primary_label', 'cta_primary_url', 'cta_secondary_label', 'cta_secondary_url',
];
const text = (value: unknown) => (value ? String(value).trim() : '');

async function handlePATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: current, error: readError } = await supabase
    .from('tenant_hero_slides')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: 'Slide indisponible.' }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Slide introuvable.' }, { status: 404 });

  // Partial update validated on the merged result (a label without link is refused either way).
  const touchesText = TEXT_FIELDS.some((key) => key in body);
  if (touchesText) {
    const merged = Object.fromEntries(TEXT_FIELDS.map((key) => [key, key in body ? text(body[key]) : text(current[key])])) as unknown as SlideFields;
    const issues = slideIssues(merged);
    if (issues.length) return NextResponse.json({ error: issues[0], issues }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = {};
  if ('title'               in body) updatePayload.title               = text(body.title);
  if ('badge_text'          in body) updatePayload.badge_text          = text(body.badge_text) || null;
  if ('subtitle'            in body) updatePayload.subtitle            = text(body.subtitle) || null;
  if ('cta_primary_label'   in body) updatePayload.cta_primary_label   = text(body.cta_primary_label) || null;
  if ('cta_primary_url'     in body) updatePayload.cta_primary_url     = safeSlideHref(body.cta_primary_url);
  if ('cta_secondary_label' in body) updatePayload.cta_secondary_label = text(body.cta_secondary_label) || null;
  if ('cta_secondary_url'   in body) updatePayload.cta_secondary_url   = safeSlideHref(body.cta_secondary_url);
  if ('image_url'           in body) updatePayload.image_url           = safeSlideHref(body.image_url);
  if ('background_variant'  in body && VALID_VARIANTS.includes(body.background_variant as HeroSlideBackgroundVariant)) {
    updatePayload.background_variant = body.background_variant;
  }
  if ('active' in body) updatePayload.active = Boolean(body.active);

  const { data, error } = await supabase
    .from('tenant_hero_slides')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .single();

  if (error) {
    console.error('[hero-slides] update failed', error.message);
    return NextResponse.json({ error: 'Enregistrement de la slide impossible.' }, { status: 500 });
  }

  return NextResponse.json(data);
}

async function handleDELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const { error } = await createServiceClient()
    .from('tenant_hero_slides')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    console.error('[hero-slides] delete failed', error.message);
    return NextResponse.json({ error: 'Suppression de la slide impossible.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export const PATCH = withStorefrontInvalidation(['catalog'], handlePATCH);
export const DELETE = withStorefrontInvalidation(['catalog'], handleDELETE);
