import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { ServiceInquiryStatus } from '@lepefy/types';

const VALID_STATUSES: ServiceInquiryStatus[] = [
  'nouveau',
  'a_contacter',
  'contacte',
  'devis_envoye',
  'accepte',
  'refuse',
  'clos',
];

const MAX_INTERNAL_NOTES_LENGTH = 20000;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { status?: ServiceInquiryStatus; internal_notes?: string | null };
  const patch: Record<string, string | null> = {};

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Statut invalide.' }, { status: 400 });
    }
    patch.status = body.status;
  }

  if (body.internal_notes !== undefined) {
    if (body.internal_notes !== null && typeof body.internal_notes !== 'string') {
      return NextResponse.json({ error: 'Note interne invalide.' }, { status: 400 });
    }
    const note = body.internal_notes?.trim() || null;
    if (note && note.length > MAX_INTERNAL_NOTES_LENGTH) {
      return NextResponse.json({ error: 'La note interne est trop longue.' }, { status: 400 });
    }
    patch.internal_notes = note;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucune modification valide.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  if (body.status) {
    const { data: current } = await supabase
      .from('service_inquiries')
      .select('contacted_at, quote_sent_at, accepted_at, closed_at')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (!current) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });

    const now = new Date().toISOString();
    if (body.status === 'contacte' && !current.contacted_at) patch.contacted_at = now;
    if (body.status === 'devis_envoye' && !current.quote_sent_at) patch.quote_sent_at = now;
    if (body.status === 'accepte' && !current.accepted_at) patch.accepted_at = now;
    if (body.status === 'clos' && !current.closed_at) patch.closed_at = now;
  }

  const { data, error } = await supabase
    .from('service_inquiries')
    .update(patch)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select('*, service_offerings(title, slug)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
