import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

const PATCHABLE_FIELDS = [
  'template_key', 'palette', 'natural_badge', 'included_sections', 'lot_number', 'production_date', 'durability_date',
  'quantity', 'sheet_width_mm', 'sheet_height_mm', 'label_width_mm', 'label_height_mm',
];

// PATCH /api/admin/labels/jobs/[id] — autosave des champs du brouillon (seulement si status='draft')
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createServiceClient();

  const payload: Record<string, unknown> = {};
  for (const key of PATCHABLE_FIELDS) if (key in body) payload[key] = body[key];

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('label_print_jobs')
    .update(payload)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('status', 'draft') // un job déjà généré est immutable
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Brouillon introuvable ou déjà généré.' }, { status: 404 });

  return NextResponse.json({ success: true });
}

// DELETE /api/admin/labels/jobs/[id] — abandonne un brouillon
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('label_print_jobs')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('status', 'draft'); // on ne supprime jamais l'historique généré, seulement les brouillons

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
