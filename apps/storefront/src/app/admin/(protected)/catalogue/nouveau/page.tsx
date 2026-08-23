import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import ProductEditClient from '../[id]/ProductEditClient';
import ProductEditWorkspace from '../[id]/ProductEditWorkspace';

// Surface admin — reste dynamique (cf. audit Prompt 4, classification
// "/admin/**"). Explicite depuis que getTenant() n'utilise plus cookies() :
// cette page perdait son seul déclencheur dynamique implicite (elle-même
// n'utilise que createServiceClient(), sans cookies()).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

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
    barcode_value:                null,
  };

  return (
    <div className="max-w-6xl mx-auto">
      <Link
        href="/admin/catalogue"
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-flex items-center gap-1"
      >
        ← Catalogue
      </Link>
      <ProductEditWorkspace
        isNew={true}
        productName="Nouveau produit"
        categoryName={categories?.[0]?.name ?? null}
        active={false}
        stock={0}
        hasImage={false}
        descriptionSource={null}
      >
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
      </ProductEditWorkspace>
    </div>
  );
}
