import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { safeSlideHref, slideIssues, VALID_VARIANTS } from '@/lib/home/heroSlideRules';
import type { HeroSlideBackgroundVariant } from '@lepefy/types';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const runtime = 'nodejs';

const text = (value: unknown) => (value ? String(value).trim() : '');

export async function GET() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const { data, error } = await createServiceClient()
    .from('tenant_hero_slides')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true });

  if (error) {
    console.error('[hero-slides] list failed', error.message);
    return NextResponse.json({ error: 'Chargement des slides impossible.' }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

async function handlePOST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });

  // CTA links end up as hrefs on the public home page: validated here, not only in the form.
  const issues = slideIssues({
    badge_text: text(body.badge_text), title: text(body.title), subtitle: text(body.subtitle),
    cta_primary_label: text(body.cta_primary_label), cta_primary_url: text(body.cta_primary_url),
    cta_secondary_label: text(body.cta_secondary_label), cta_secondary_url: text(body.cta_secondary_url),
  });
  if (issues.length) return NextResponse.json({ error: issues[0], issues }, { status: 400 });

  const backgroundVariant = VALID_VARIANTS.includes(body.background_variant as HeroSlideBackgroundVariant)
    ? body.background_variant as HeroSlideBackgroundVariant
    : 'primary';

  const supabase = createServiceClient();

  // Position par défaut = dernière position du tenant + 1.
  const { data: lastSlide } = await supabase
    .from('tenant_hero_slides')
    .select('position')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (lastSlide?.position ?? -1) + 1;

  const image = safeSlideHref(body.image_url);
  const { data, error } = await supabase
    .from('tenant_hero_slides')
    .insert({
      tenant_id:            tenant.id,
      position:             nextPosition,
      badge_text:           text(body.badge_text) || null,
      title:                text(body.title),
      subtitle:             text(body.subtitle) || null,
      cta_primary_label:    text(body.cta_primary_label) || null,
      cta_primary_url:      safeSlideHref(body.cta_primary_url),
      cta_secondary_label:  text(body.cta_secondary_label) || null,
      cta_secondary_url:    safeSlideHref(body.cta_secondary_url),
      ...(image ? { image_url: image } : {}),
      background_variant:   backgroundVariant,
      active:                body.active === undefined ? true : Boolean(body.active),
    })
    .select('*')
    .single();

  if (error) {
    console.error('[hero-slides] create failed', error.message);
    return NextResponse.json({ error: 'Création de la slide impossible.' }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

// /accueil is ISR (300 s): every write refreshes it immediately.
export const POST = withStorefrontInvalidation(['catalog'], handlePOST);
