import Link from 'next/link';
import type { Metadata } from 'next';
import { getDisplayTenant } from '@/lib/tenant/getTenant';
import { catalogMetadata } from '@/lib/catalog/catalogMetadata';

// Copie statique du catalogue `/` pour les robots d'aperçu de lien
// (facebookexternalhit, WhatsApp) : next.config.mjs réécrit `/` vers cette page
// pour leur seul user agent. Ils ne lisent que le <head> ; servie depuis le cache
// CDN, elle n'invoque aucune Vercel Function, alors que `/` est dynamique.
// Les clients ne passent jamais par ici.
export const revalidate = 3600; // = SHOP_DISPLAY_TTL_SECONDS (lib/cache/storefrontCache.ts) : littéral exigé par Next

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getDisplayTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return {
    ...catalogMetadata(tenant.name),
    alternates: { canonical: '/' },
    robots: { index: false, follow: true },
  };
}

export default async function CatalogPreviewPage() {
  const tenant = await getDisplayTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Catalogue {tenant.name}</h1>
      <p className="mt-3">Découvrez les produits de {tenant.name}.</p>
      <Link href="/" prefetch={false} className="mt-6 inline-block font-semibold underline">
        Voir le catalogue
      </Link>
    </main>
  );
}
