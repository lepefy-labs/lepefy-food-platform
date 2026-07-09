import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { buildSheetHtml } from '@/lib/labels/buildSheetHtml';
import { htmlToPdf } from '@/lib/labels/gotenberg';
import type { LabelPrintJob } from '@lepefy/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await req.json() as { jobId: string };
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);

  if (!tenant.label_logo_url) {
    return NextResponse.json({ error: 'Logo etichetta non caricato per questo tenant.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: job } = await supabase
    .from('label_print_jobs')
    .select('*')
    .eq('id', body.jobId)
    .eq('tenant_id', tenant.id)
    .eq('status', 'draft')
    .single() as { data: LabelPrintJob | null };

  if (!job) {
    return NextResponse.json({ error: 'Bozza non trovata o già generata.' }, { status: 404 });
  }
  if (!job.lot_number || !job.durability_date || !job.quantity || job.quantity < 1) {
    return NextResponse.json({ error: 'Lotto, data e quantità sono obbligatori prima di generare.' }, { status: 400 });
  }

  const { data: product, error } = await supabase
    .from('products')
    .select(`*, producer:producers(*), importer:importers(*), category:categories(id, name, label_background_image_url, label_background_color)`)
    .eq('id', job.product_id)
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
      sections: job.included_sections,
      settings: {
        sheet_width_mm: job.sheet_width_mm, sheet_height_mm: job.sheet_height_mm,
        label_width_mm: job.label_width_mm, label_height_mm: job.label_height_mm,
        margin_mm: 5, gutter_mm: 2, crop_marks: true,
      },
      lotNumber: job.lot_number, productionDate: job.production_date,
      durabilityDate: job.durability_date, durabilityLabel, quantity: job.quantity,
    });

    const pdfBuffer = await htmlToPdf(html);
    const fileName = `${product.slug}-${job.lot_number}-${Date.now()}.pdf`;
    const path = `labels/${fileName}`;

    const { error: upErr } = await supabase.storage
      .from('assets')
      .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (upErr) throw new Error(`Storage upload: ${upErr.message}`);

    const pdfUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/${path}`;

    // Le job est immuable une fois généré : UPDATE du brouillon existant, jamais un nouvel INSERT.
    await supabase
      .from('label_print_jobs')
      .update({
        status: 'generated', pdf_url: pdfUrl,
        labels_per_sheet: layout.perSheet, sheets_generated: layout.sheets,
      })
      .eq('id', job.id);

    return NextResponse.json({ pdfUrl, layout });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore di generazione';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
