import { Suspense } from 'react';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import CatalogueTable from './CatalogueTable';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: {
    category?: string;
    sort?:     string;
  };
}

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  price: number;
  stock: number;
  active: boolean;
  image_url: string | null;
  storage_type: string | null;
  warehouse_location: string | null;
  description_source: 'ai' | 'human' | null;
  categories: { name: string; slug: string } | null;
}

export default async function AdminCataloguePage({ searchParams }: PageProps) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);
  const supabase = createServiceClient();

  let categoryId: string | undefined;
  if (searchParams.category) {
    const { data: cat } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', searchParams.category)
      .eq('tenant_id', tenant.id)
      .single();
    categoryId = cat?.id;
  }

  type SortConfig = { column: string; ascending: boolean };
  const sortMap: Record<string, SortConfig> = {
    name_asc:   { column: 'name',  ascending: true  },
    name_desc:  { column: 'name',  ascending: false },
    price_asc:  { column: 'price', ascending: true  },
    price_desc: { column: 'price', ascending: false },
    stock_asc:  { column: 'stock', ascending: true  },
    stock_desc: { column: 'stock', ascending: false },
  };
  const sortConfig = sortMap[searchParams.sort ?? '']
    ?? { column: 'position', ascending: true };

  let query = supabase
    .from('products')
    .select(`
      id, name, slug, price, stock, active,
      image_url, storage_type, warehouse_location, description_source,
      categories(name, slug)
    `)
    .eq('tenant_id', tenant.id)
    .order(sortConfig.column, { ascending: sortConfig.ascending });

  if (categoryId) {
    query = query.eq('category_id', categoryId);
  }

  const { data: products } = await query;
  const list = (products ?? []) as unknown as ProductRow[];

  const searchMode: 'client' | 'server' =
    list.length <= (tenant.catalogue_search_threshold ?? 500)
      ? 'client'
      : 'server';

  return (
    <Suspense fallback={<div className="h-96 animate-pulse bg-gray-50 rounded-xl" />}>
      <CatalogueTable
        products={list}
        currentSort={searchParams.sort}
        currentCategory={searchParams.category}
        tenantCurrency={tenant.currency}
        searchMode={searchMode}
      />
    </Suspense>
  );
}
