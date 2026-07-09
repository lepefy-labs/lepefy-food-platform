import { notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import type { LabelPrintJob } from '@lepefy/types';
import LabelJobsListClient from './LabelJobsListClient';

export const dynamic = 'force-dynamic';

export default async function LabelJobsPage({ params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: product } = await supabase
    .from('products')
    .select('id, name, slug')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .single();

  if (!product) notFound();

  const { data: jobs } = await supabase
    .from('label_print_jobs')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('product_id', product.id)
    .order('updated_at', { ascending: false });

  return (
    <LabelJobsListClient
      productId={product.id}
      productName={product.name}
      jobs={(jobs ?? []) as LabelPrintJob[]}
    />
  );
}
