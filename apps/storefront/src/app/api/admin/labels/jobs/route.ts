import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { DEFAULT_LABEL_PALETTE } from '@/lib/labels/palettes';
import type { LabelPrintJob } from '@lepefy/types';

export const runtime = 'nodejs';

const DEFAULT_SECTIONS = {
  image: true, nutrition: true, allergens: true, usage: true, conservation: true, origin: true, barcode: true,
};

// GET /api/admin/labels/jobs?productId=xxx — liste des brouillons + historique pour un produit
export async function GET(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const productId = req.nextUrl.searchParams.get('productId');
  if (!productId) return NextResponse.json({ error: 'productId manquant' }, { status: 400 });

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('label_print_jobs')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('product_id', productId)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data as LabelPrintJob[] });
}

// POST /api/admin/labels/jobs — crée un nouveau brouillon vide (ou dupliqué d'un job existant)
export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { productId: string; duplicateFromId?: string };
  if (!body.productId) return NextResponse.json({ error: 'productId manquant' }, { status: 400 });

  const supabase = createServiceClient();

  let seed: Record<string, unknown> = {
    template_key: 'default',
    palette: DEFAULT_LABEL_PALETTE,
    natural_badge: false,
    origin_style: 'pill',
    included_sections: DEFAULT_SECTIONS,
    sheet_width_mm: 210, sheet_height_mm: 297, label_width_mm: 100, label_height_mm: 75,
  };

  if (body.duplicateFromId) {
    const { data: source } = await supabase
      .from('label_print_jobs')
      .select('template_key, palette, natural_badge, origin_style, included_sections, sheet_width_mm, sheet_height_mm, label_width_mm, label_height_mm, lot_number, production_date, durability_date, quantity')
      .eq('id', body.duplicateFromId)
      .eq('tenant_id', tenant.id)
      .single();

    if (source) {
      seed = { ...seed, ...source, duplicated_from_id: body.duplicateFromId };
      // Lot et dates ne sont PAS reportés automatiquement : ils changent quasi certainement à chaque réimpression réelle
      seed.lot_number = null;
      seed.production_date = null;
      seed.durability_date = null;
    }
  }

  const { data, error } = await supabase
    .from('label_print_jobs')
    .insert({ tenant_id: tenant.id, product_id: body.productId, status: 'draft', ...seed })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
