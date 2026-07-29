import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { ConnexionClient } from './ConnexionClient';

// Doit lire la session à chaque requête — jamais statique/ISR comme les
// pages produit. getSessionCustomer() passe par cookies(), ce qui rend la
// page dynamique de toute façon ; le marqueur explicite protège contre une
// optimisation statique future si la lecture de session devenait
// conditionnelle.
export const dynamic = 'force-dynamic';

export default async function ConnexionPage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  return <ConnexionClient initialCustomer={customer} />;
}
