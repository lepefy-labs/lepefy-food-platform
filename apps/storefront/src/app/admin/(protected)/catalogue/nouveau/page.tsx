import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import ProductEditClient from '../[id]/ProductEditClient';

export default async function AdminNouveauProduitPage() {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, slug')
    .eq('tenant_id', tenant.id)
    .order('position');

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

  const emptyProduct = {
    id:                          '',
    name:                        '',
    name_alt:                    null,
    slug:                        '',
    description:                 null,
    descriptions:                null,
    description_source:          null,
    price:                       0,
    weight_grams:                null,
    stock:                       0,
    active:                      false,
    featured:                    false,
    storage_type:                'dry',
    image_url:                   null,
    warehouse_location:          null,
    category_id:                 categories?.[0]?.id ?? '',
    producer_id:                 null,
    importer_id:                 null,
    ingredients_text:            null,
    allergens_text:              null,
    gluten_free_certified:       false,
    usage_instructions:          null,
    conservation_instructions:   null,
    conservation_after_opening:  null,
    country_of_origin:           null,
    durability_type:             null,
    quid_ingredient:              null,
    quid_percentage:              null,
    alcohol_pct:                  null,
    net_quantity_display:         null,
    packaging_material:           null,
    recycling_note:               null,
    nutrition_basis:              '100g' as const,
    nutrition:                    null,
    label_background_image_url:   null,
    label_background_color:       null,
  };

  return (
    <div>
      <Link
        href="/admin/catalogue"
        className="text-sm text-gray-500 hover:text-gray-700 mb-6
                   inline-flex items-center gap-1"
      >
        ← Catalogue
      </Link>
      <ProductEditClient
        product={emptyProduct}
        categories={categories ?? []}
        producers={producers ?? []}
        importers={importers ?? []}
        tenantId={tenant.id}
        tenantCurrency={tenant.currency}
        aiEnabled={tenant.ai_image_generation}
        tenantLocales={tenant.locales ?? ['fr']}
        aiDescriptionsEnabled={tenant.ai_description_generation ?? false}
        isNew={true}
      />
    </div>
  );
}
