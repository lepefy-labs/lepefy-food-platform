import { getTenant } from '@/lib/tenant/getTenant';
import { toPublicTenant } from '@/lib/tenant/publicTenant';
import { createClient } from '@/lib/supabase/server';
import { getShopCategories } from '@/lib/catalog/catalogCache';
import { getActivePromotions } from '@/lib/catalog/promotions';
import CartPurchaseClient from './CartPurchaseClient';

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  // Nombre de promotions actives du tenant, pour le rappel discret du panier.
  // Une lecture en échec n'affiche simplement aucun rappel.
  const categories = await getShopCategories(tenant.id).catch(() => []);
  const promotions = await getActivePromotions(createClient(), tenant.id, categories.map((category) => category.id))
    .catch(() => []);
  return <CartPurchaseClient tenant={toPublicTenant(tenant)} promoCount={promotions.length} />;
}
