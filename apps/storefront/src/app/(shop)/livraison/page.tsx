import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { loadPublicTariffGrid } from '@/lib/shipping/tariff/publicGrid';
import { ShippingGridClient } from './ShippingGridClient';

// La grille dépend de la version tarifaire active (activable sans redéploiement).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return {
    title: `Frais de livraison | ${tenant.name}`,
    description: `Tarifs de livraison de ${tenant.name}, calculés sur le poids des produits.`,
  };
}

export default async function LivraisonPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const grid = await loadPublicTariffGrid(createServiceClient(), tenant);
  // Page masquée tant que le tenant ne l'active pas, ou sans tarification active.
  if (grid.length === 0) notFound();

  return (
    <ShippingGridClient
      grid={grid}
      locales={tenant.locales?.length ? tenant.locales : ['fr']}
      currency={tenant.currency ?? 'EUR'}
      clickCollectEnabled={Boolean(tenant.click_collect_enabled)}
    />
  );
}
