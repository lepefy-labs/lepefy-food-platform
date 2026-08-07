import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { ShippingSimulator } from './ShippingSimulator';

export const dynamic = 'force-dynamic';

const TAB_CLS =
  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
const TAB_ACTIVE   = 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]';
const TAB_INACTIVE = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800';

export default async function AdminShippingSimulatorPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-1 mb-4">
        <Link href="/admin/livraison" className={`${TAB_CLS} ${TAB_INACTIVE}`}>
          Règles par pays
        </Link>
        <span className={`${TAB_CLS} ${TAB_ACTIVE}`}>
          Simulateur
        </span>
      </div>

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
