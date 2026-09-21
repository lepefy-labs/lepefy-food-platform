import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import QuantityGroupsClient from './QuantityGroupsClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminQuantityGroupsPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: products } = await supabase
    .from('products')
    .select('id, name, active')
    .eq('tenant_id', tenant.id)
    .order('name');

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/admin/catalogue" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-flex items-center gap-1">
        ← Catalogue
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-950">Règles de quantité combinée</h1>
        <p className="mt-1 text-sm text-gray-500">
          Un groupe (ex. « Boissons ») impose une quantité minimale sur le total de ses produits membres,
          quel que soit le mix choisi par le client. Pour une règle sur un seul produit (ex. « Ndolé : minimum 4 »),
          utilisez plutôt la section « Règles de vente » de la fiche produit.
        </p>
      </div>
      <QuantityGroupsClient products={products ?? []} />
    </div>
  );
}
