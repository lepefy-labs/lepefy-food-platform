import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { ServiceOfferingType, ServiceCtaType } from '@lepefy/types';

const VALID_TYPES: ServiceOfferingType[] = ['traiteur', 'location_materiel', 'autre'];
const VALID_CTA_TYPES: ServiceCtaType[] = ['devis', 'reservation'];

const EDITABLE_FIELDS = [
  'title', 'slug', 'type', 'description', 'cta_type', 'cover_image_url', 'active', 'sort_order',
] as const;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data: offering } = await supabase
    .from('service_offerings')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!offering) return NextResponse.json({ error: 'Service introuvable.' }, { status: 404 });

  const { data: rentalItems } = await supabase
    .from('rental_items')
    .select('*')
    .eq('service_offering_id', offering.id)
    .order('sort_order', { ascending: true });

  return NextResponse.json({ offering, rentalItems: rentalItems ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body  = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    if (field === 'type' && !VALID_TYPES.includes(body.type as ServiceOfferingType)) continue;
    if (field === 'cta_type' && !VALID_CTA_TYPES.includes(body.cta_type as ServiceCtaType)) continue;
    patch[field] = body[field];
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucun champ valide à mettre à jour.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('service_offerings')
    .update(patch)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Un service avec ce slug existe déjà.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { count } = await supabase
    .from('rental_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('service_offering_id', params.id);
  const { count: inquiryCount } = await supabase
    .from('service_inquiries')
    .select('id', { count: 'exact', head: true })
    .eq('service_offering_id', params.id);

  if ((count && count > 0) || (inquiryCount && inquiryCount > 0)) {
    return NextResponse.json(
      { error: 'Impossible de supprimer un service ayant des réservations ou demandes — désactivez-le plutôt.' },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from('service_offerings')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
