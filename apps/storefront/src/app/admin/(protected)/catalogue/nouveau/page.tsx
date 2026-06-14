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

  const emptyProduct = {
    id:                 '',
    name:               '',
    slug:               '',
    description:        null,
    price:              0,
    weight_grams:       null,
    stock:              0,
    active:             false,
    featured:           false,
    storage_type:       'dry',
    image_url:          null,
    warehouse_location: null,
    category_id:        categories?.[0]?.id ?? '',
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
        tenantId={tenant.id}
        tenantCurrency={tenant.currency}
        aiEnabled={tenant.ai_image_generation}
        isNew={true}
      />
    </div>
  );
}
