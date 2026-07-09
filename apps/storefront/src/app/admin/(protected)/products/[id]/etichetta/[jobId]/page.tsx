import { notFound, redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import type { LabelPrintJob } from '@lepefy/types';
import LabelJobEditorClient from './LabelJobEditorClient';

export const dynamic = 'force-dynamic';

export default async function LabelJobEditorPage({ params }: { params: { id: string; jobId: string } }) {
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

  const { data: job } = await supabase
    .from('label_print_jobs')
    .select('*')
    .eq('id', params.jobId)
    .eq('tenant_id', tenant.id)
    .eq('product_id', params.id)
    .single();

  if (!job) notFound();

  if (job.status !== 'draft') {
    redirect(`/admin/products/${params.id}/etichetta?msg=already_generated`);
  }

  return (
    <LabelJobEditorClient
      job={job as LabelPrintJob}
      product={product}
      tenantId={tenant.id}
      tenantHasLogo={!!tenant.label_logo_url}
      tenantLabelLogoUrl={tenant.label_logo_url}
    />
  );
}
