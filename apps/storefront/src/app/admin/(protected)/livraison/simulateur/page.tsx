import { getTenant } from '@/lib/tenant/getTenant';
import { LivraisonTabs } from '../LivraisonTabs';
import { ShippingSimulator } from './ShippingSimulator';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminShippingSimulatorPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <div className="max-w-4xl">
      <LivraisonTabs active="simulator" />

      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1">
        Simulateur de frais de livraison
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Vérifiez vous-même, sans demander à un développeur, ce que verrait un client pour un poids
        et une destination donnés — et pourquoi.
      </p>

      <ShippingSimulator
        shippingProvider={tenant.shipping_provider}
        currency={tenant.currency}
      />
    </div>
  );
}
