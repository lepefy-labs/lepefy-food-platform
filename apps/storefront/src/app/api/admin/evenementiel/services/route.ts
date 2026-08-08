import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { ServiceOfferingType, ServiceCtaType } from '@lepefy/types';

const VALID_TYPES: ServiceOfferingType[] = ['traiteur', 'location_materiel', 'autre'];
const VALID_CTA_TYPES: ServiceCtaType[] = ['devis', 'reservation'];

export async function GET() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('service_offerings')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;

  const title    = String(body.title ?? '').trim();
  const slugValue = String(body.slug ?? '').trim();
  const type     = VALID_TYPES.includes(body.type as ServiceOfferingType) ? body.type as ServiceOfferingType : null;
  const ctaType  = VALID_CTA_TYPES.includes(body.cta_type as ServiceCtaType) ? body.cta_type as ServiceCtaType : null;

  if (!title || !slugValue || !type || !ctaType) {
    return NextResponse.json({ error: 'Titre, slug, type et mode d\'action valides requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: last } = await supabase
    .from('service_offerings')
    .select('sort_order')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('service_offerings')
    .insert({
      tenant_id:        tenant.id,
      slug:             slugValue,
      type,
      title,
      description:      body.description ? String(body.description).trim() : null,
      cta_type:         ctaType,
      cover_image_url:  body.cover_image_url ? String(body.cover_image_url) : null,
      active:           body.active === undefined ? true : Boolean(body.active),
      sort_order:       nextSortOrder,
    })
    .select('*')
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Un service avec ce slug existe déjà.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
