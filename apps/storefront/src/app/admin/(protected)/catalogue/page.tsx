import { Suspense } from 'react';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import CatalogueTable from './CatalogueTable';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  searchParams: {
    category?: string;
    sort?: string;
  };
}

export default async function AdminCataloguePage({ searchParams }: PageProps) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, slug, catalog_scope')
    .eq('tenant_id', tenant.id)
    .order('position');

  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-gray-50" />}>
      <CatalogueTable
        tenantCurrency={tenant.currency}
        categories={categories ?? []}
        initialCategory={searchParams.category}
        initialSort={searchParams.sort}
      />
    </Suspense>
  );
}
