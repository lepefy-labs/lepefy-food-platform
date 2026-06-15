import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient } from '@/lib/supabase/server';
import { CatalogClient } from '@/components/catalog/CatalogClient';
import type { Category, ProductWithCategory } from '@lepefy/types';

export async function generateMetadata(): Promise<Metadata> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  return { title: 'Catalogue', description: `Découvrez les produits de ${tenant.name}` };
}

interface ProductsPageProps {
  searchParams: { category?: string; q?: string };
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createClient();

  const { data: categoriesRaw } = await supabase
    .from('categories')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('position');
  const categories: Category[] = categoriesRaw ?? [];

  let dbQuery = supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('position');

  const searchQuery = searchParams.q?.trim() ?? '';

  if (searchQuery) {
    // Ricerca full-text case-insensitive sul nome
    dbQuery = dbQuery.ilike('name', `%${searchQuery}%`);
  } else if (searchParams.category) {
    const activeCategory = categories.find(c => c.slug === searchParams.category);
    if (activeCategory) dbQuery = dbQuery.eq('category_id', activeCategory.id);
  }

  const { data: productsRaw } = await dbQuery;
  const products: ProductWithCategory[] = productsRaw ?? [];

  return (
    <CatalogClient
      categories={categories}
      products={products}
      activeSlug={searchQuery ? undefined : searchParams.category}
      initialQuery={searchQuery}
    />
  );
}
