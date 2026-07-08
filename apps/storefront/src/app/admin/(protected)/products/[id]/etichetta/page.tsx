import { notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import LabelGeneratorClient from './LabelGeneratorClient';

export const dynamic = 'force-dynamic';

export default async function LabelGeneratorPage({ params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: product } = await supabase
    .from('products')
    .select(`*, producer:producers(*), importer:importers(*), category:categories(id, name, label_background_image_url, label_background_color)`)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .single();

  if (!product) notFound();

  const { data: settings } = await supabase
    .from('label_settings')
    .select('*')
    .eq('tenant_id', tenant.id)
    .single();

  return (
    <LabelGeneratorClient
      product={product}
      tenantId={tenant.id}
      tenantHasLogo={!!tenant.label_logo_url}
      settings={settings ?? {
        sheet_width_mm: 210, sheet_height_mm: 297,
        label_width_mm: 100, label_height_mm: 75,
        margin_mm: 5, gutter_mm: 2, crop_marks: true,
      }}
    />
  );
}
