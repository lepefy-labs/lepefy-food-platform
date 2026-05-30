import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient } from '@/lib/supabase/server';
import { CategoryFilter } from '@/components/catalog/CategoryFilter';
import { ProductGrid } from '@/components/catalog/ProductGrid';
import type { Category, ProductWithCategory } from '@lepefy/types';

export async function generateMetadata(): Promise<Metadata> {
  const slug = process.env.TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  return { title: 'Catalogue', description: `Découvrez les produits de ${tenant.name}` };
}

interface ProductsPageProps {
  searchParams: { category?: string };
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const tenantSlug = process.env.TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createClient();

  const { data: categories } = await supabase
    .from('categories').select('*').eq('tenant_id', tenant.id).order('position');

  let query = supabase
    .from('products').select('*, category:categories(*)')
    .eq('tenant_id', tenant.id).eq('active', true).order('position');

  if (searchParams.category) {
    const activeCategory = (categories ?? []).find((c: Category) => c.slug === searchParams.category);
    if (activeCategory) query = query.eq('category_id', activeCategory.id);
  }

  const { data: products } = await query;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Catalogue</h1>
      <CategoryFilter categories={(categories ?? []) as Category[]} activeSlug={searchParams.category} />
      <ProductGrid products={(products ?? []) as ProductWithCategory[]} />
    </div>
  );
}
