import type { Metadata } from 'next';
import { getDisplayTenant } from '@/lib/tenant/getTenant';
import { buildPwaIconPath, getAppIconRevision } from '@/lib/tenant/appIcon';
import { AppInstallClient } from './AppInstallClient';

// ISR : même contenu pour tous ; l'appareil (iPhone, Android, navigateur
// intégré…) et la source (?src=) sont lus côté client.
export const revalidate = 3600; // = SHOP_DISPLAY_TTL_SECONDS (lib/cache/storefrontCache.ts) : littéral exigé par Next

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getDisplayTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return {
    title: "Installer l'application",
    description: `Ajoutez ${tenant.name} à l'écran d'accueil de votre téléphone : la boutique en un geste, sans passer par un store.`,
  };
}

export default async function AppInstallPage() {
  const tenant = await getDisplayTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const iconUrl = buildPwaIconPath(192, 'any', getAppIconRevision(tenant.app_icon_url));
  return <AppInstallClient tenantName={tenant.name} iconUrl={iconUrl} />;
}
