import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient } from '@/lib/supabase/server';
import { ProductDetail } from '@/components/product/ProductDetail';
import type { ProductWithCategory } from '@lepefy/types';

interface ProductPageProps { params: { slug: string } }

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createClient();
  const { data } = await supabase.from('products').select('name, description')
    .eq('slug', params.slug).eq('tenant_id', tenant.id).single();
  if (!data) return {};
  return { title: data.name, description: data.description ?? undefined };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createClient();

  const { data: product } = await supabase
    .from('products')
    .select(`
      id, name, slug, price, compare_at_price, image_url,
      weight_grams, stock, storage_type,
      description, descriptions,
      category:categories(name)
    `)
    .eq('slug', params.slug).eq('tenant_id', tenant.id).eq('active', true).single();

  if (!product) notFound();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <ProductDetail product={product as unknown as ProductWithCategory} />
    </div>
  );
}
