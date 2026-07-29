import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { buildSheetHtml } from '@/lib/labels/buildSheetHtml';
import type { LabelJobInput } from '@lepefy/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as LabelJobInput;

  if (!tenant.label_logo_url) {
    return NextResponse.json({ error: 'Logo etichetta non caricato per questo tenant.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: product, error } = await supabase
    .from('products')
    .select(`*, producer:producers(*), importer:importers(*), category:categories(id, name, label_background_image_url, label_background_color)`)
    .eq('id', body.productId)
    .eq('tenant_id', tenant.id)
    .single();

  if (error || !product) {
    return NextResponse.json({ error: 'Prodotto non trovato.' }, { status: 404 });
  }

  const durabilityLabel = product.durability_type === 'use_by'
    ? 'Da consumarsi entro'
    : 'Da consumarsi preferibilmente entro';

  try {
    const { html, layout } = buildSheetHtml({
      product: product as never,
      tenant: {
        primary_color: tenant.primary_color, secondary_color: tenant.secondary_color,
        label_logo_url: tenant.label_logo_url, legal_name: tenant.legal_name,
        legal_address: tenant.legal_address, legal_email: tenant.legal_email, legal_website: tenant.legal_website,
      },
      templateKey: body.templateKey,
      palette: body.palette,
      naturalBadge: body.naturalBadge,
      originStyle: body.originStyle,
      sections: body.sections,
      settings: {
        sheet_width_mm: body.sheetWidthMm, sheet_height_mm: body.sheetHeightMm,
        label_width_mm: body.labelWidthMm, label_height_mm: body.labelHeightMm,
        margin_mm: 5, gutter_mm: 2, crop_marks: true,
      },
      lotNumber: body.lotNumber, productionDate: body.productionDate,
      durabilityDate: body.durabilityDate, durabilityLabel, quantity: body.quantity,
    });

    return NextResponse.json({ html, layout });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore di impaginazione';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
