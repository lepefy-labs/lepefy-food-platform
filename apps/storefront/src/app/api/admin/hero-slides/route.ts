import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { HeroSlideBackgroundVariant } from '@lepefy/types';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const runtime = 'nodejs';

const VALID_VARIANTS: HeroSlideBackgroundVariant[] = ['primary', 'secondary', 'accent'];

export async function GET() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('tenant_hero_slides')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;

  const title = String(body.title ?? '').trim();
  if (!title) {
    return NextResponse.json({ error: 'Le titre est obligatoire.' }, { status: 400 });
  }

  const ctaSecondaryLabel = body.cta_secondary_label ? String(body.cta_secondary_label).trim() : '';
  const ctaSecondaryUrl   = body.cta_secondary_url ? String(body.cta_secondary_url).trim() : '';
  if (Boolean(ctaSecondaryLabel) !== Boolean(ctaSecondaryUrl)) {
    return NextResponse.json(
      { error: 'Le libellé et le lien du CTA secondaire doivent être renseignés ensemble.' },
      { status: 400 },
    );
  }

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

  const { data, error } = await supabase
    .from('tenant_hero_slides')
    .insert({
      tenant_id:            tenant.id,
      position:             nextPosition,
      badge_text:           body.badge_text ? String(body.badge_text).trim() : null,
      title,
      subtitle:             body.subtitle ? String(body.subtitle).trim() : null,
      cta_primary_label:    body.cta_primary_label ? String(body.cta_primary_label).trim() : null,
      cta_primary_url:      body.cta_primary_url ? String(body.cta_primary_url).trim() : null,
      cta_secondary_label:  ctaSecondaryLabel || null,
      cta_secondary_url:    ctaSecondaryUrl || null,
      background_variant:   backgroundVariant,
      active:                body.active === undefined ? true : Boolean(body.active),
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
