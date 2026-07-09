import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { buildSheetHtml } from '@/lib/labels/buildSheetHtml';
import { htmlToPdf } from '@/lib/labels/gotenberg';
import type { LabelJobInput } from '@lepefy/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await req.json() as LabelJobInput;
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);

  if (!tenant.label_logo_url) {
    return NextResponse.json({ error: 'Logo etichetta non caricato per questo tenant.' }, { status: 400 });
  }
  if (!body.lotNumber || !body.durabilityDate || !body.quantity || body.quantity < 1) {
    return NextResponse.json({ error: 'Lotto, data e quantità sono obbligatori.' }, { status: 400 });
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
      sections: body.sections,
      settings: {
        sheet_width_mm: body.sheetWidthMm, sheet_height_mm: body.sheetHeightMm,
        label_width_mm: body.labelWidthMm, label_height_mm: body.labelHeightMm,
        margin_mm: 5, gutter_mm: 2, crop_marks: true,
      },
      lotNumber: body.lotNumber, productionDate: body.productionDate,
      durabilityDate: body.durabilityDate, durabilityLabel, quantity: body.quantity,
    });

    const pdfBuffer = await htmlToPdf(html);
    const fileName = `${product.slug}-${body.lotNumber}-${Date.now()}.pdf`;
    const path = `labels/${fileName}`;

    const { error: upErr } = await supabase.storage
      .from('assets')
      .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (upErr) throw new Error(`Storage upload: ${upErr.message}`);

    const pdfUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/${path}`;

    await supabase.from('label_print_jobs').insert({
      tenant_id: tenant.id, product_id: product.id, template_key: body.templateKey ?? 'default',
      included_sections: body.sections, lot_number: body.lotNumber,
      production_date: body.productionDate, durability_date: body.durabilityDate,
      quantity: body.quantity, sheet_width_mm: body.sheetWidthMm, sheet_height_mm: body.sheetHeightMm,
      label_width_mm: body.labelWidthMm, label_height_mm: body.labelHeightMm,
      labels_per_sheet: layout.perSheet, sheets_generated: layout.sheets, pdf_url: pdfUrl,
    });

    return NextResponse.json({ pdfUrl, layout });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore di generazione';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
