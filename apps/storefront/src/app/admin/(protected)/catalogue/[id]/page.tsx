import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import ProductEditClient from './ProductEditClient';

export const dynamic = 'force-dynamic';

export default async function AdminProductEditPage({
  params,
  searchParams,
}: {
  params:       { id: string };
  searchParams: { from_category?: string };
}) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: product } = await supabase
    .from('products')
    .select(`
      id, name, name_alt, slug, description, price, weight_grams, stock,
      active, featured, storage_type, image_url,
      warehouse_location, category_id,
      producer_id, importer_id, ingredients_text, allergens_text,
      gluten_free_certified, usage_instructions, conservation_instructions,
      conservation_after_opening, country_of_origin, durability_type,
      quid_ingredient, quid_percentage, alcohol_pct, net_quantity_display,
      packaging_material, recycling_note, nutrition_basis, nutrition,
      label_background_image_url, label_background_color
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

  const { data: producers } = await supabase
    .from('producers')
    .select('id, tenant_id, name, legal_address, vat_number, health_stamp, country, active')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('name');

  const { data: importers } = await supabase
    .from('importers')
    .select('id, tenant_id, name, legal_address, vat_number, email, active')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('name');

  const backHref = searchParams.from_category
    ? `/admin/catalogue?category=${searchParams.from_category}`
    : '/admin/catalogue';

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        href={backHref}
        className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-flex items-center gap-1"
      >
        ← Catalogue
      </Link>
      <ProductEditClient
        product={product}
        categories={categories ?? []}
        producers={producers ?? []}
        importers={importers ?? []}
        tenantId={tenant.id}
        tenantCurrency={tenant.currency}
        aiEnabled={tenant.ai_image_generation ?? false}
        fromCategory={searchParams.from_category}
      />
    </div>
  );
}
