import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { HeroSlideBackgroundVariant } from '@lepefy/types';

export const runtime = 'nodejs';

const VALID_VARIANTS: HeroSlideBackgroundVariant[] = ['primary', 'secondary', 'accent'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;

  if ('title' in body && !String(body.title ?? '').trim()) {
    return NextResponse.json({ error: 'Le titre est obligatoire.' }, { status: 400 });
  }

  const hasSecondaryLabel = 'cta_secondary_label' in body;
  const hasSecondaryUrl   = 'cta_secondary_url' in body;
  if (hasSecondaryLabel || hasSecondaryUrl) {
    const label = String(body.cta_secondary_label ?? '').trim();
    const url   = String(body.cta_secondary_url ?? '').trim();
    if (Boolean(label) !== Boolean(url)) {
      return NextResponse.json(
        { error: 'Le libellé et le lien du CTA secondaire doivent être renseignés ensemble.' },
        { status: 400 },
      );
    }
  }

  const supabase = createServiceClient();
  const updatePayload: Record<string, unknown> = {};

  if ('title'               in body) updatePayload.title               = String(body.title).trim();
  if ('badge_text'          in body) updatePayload.badge_text          = body.badge_text ? String(body.badge_text).trim() : null;
  if ('subtitle'            in body) updatePayload.subtitle            = body.subtitle ? String(body.subtitle).trim() : null;
  if ('cta_primary_label'   in body) updatePayload.cta_primary_label   = body.cta_primary_label ? String(body.cta_primary_label).trim() : null;
  if ('cta_primary_url'     in body) updatePayload.cta_primary_url     = body.cta_primary_url ? String(body.cta_primary_url).trim() : null;
  if ('cta_secondary_label' in body) updatePayload.cta_secondary_label = body.cta_secondary_label ? String(body.cta_secondary_label).trim() : null;
  if ('cta_secondary_url'   in body) updatePayload.cta_secondary_url   = body.cta_secondary_url ? String(body.cta_secondary_url).trim() : null;
  if ('background_variant'  in body && VALID_VARIANTS.includes(body.background_variant as HeroSlideBackgroundVariant)) {
    updatePayload.background_variant = body.background_variant;
  }
  if ('active'   in body) updatePayload.active   = Boolean(body.active);
  if ('position' in body) updatePayload.position = parseInt(String(body.position), 10) || 0;

  const { error } = await supabase
    .from('tenant_hero_slides')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('tenant_hero_slides')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
