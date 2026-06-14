import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import ProductEditClient from './ProductEditClient';

export const dynamic = 'force-dynamic';

export default async function AdminProductEditPage({
  params,
}: {
  params: { id: string };
}) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: product } = await supabase
    .from('products')
    .select(`
      id, name, slug, description, price, weight_grams, stock,
      active, featured, storage_type, image_url,
      warehouse_location, category_id
    `)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .single();

  if (!product) notFound();

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, slug')
    .eq('tenant_id', tenant.id)
    .order('name');

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        href="/admin/catalogue"
        className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-flex items-center gap-1"
      >
        ← Catalogue
      </Link>
      <ProductEditClient
        product={product}
        categories={categories ?? []}
        tenantId={tenant.id}
        tenantCurrency={tenant.currency}
        aiEnabled={tenant.ai_image_generation ?? false}
      />
    </div>
  );
}
