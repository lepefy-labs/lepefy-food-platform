import Link from 'next/link';
import {
  IconArrowLeft,
  IconBuildingStore,
  IconCalendarEvent,
  IconCreditCard,
  IconId,
  IconTruck,
} from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { PaymentMethodsSection } from '../PaymentMethodsSection';
import type { TenantPaymentMethod, PaymentModule } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Même défaut que la colonne `enabled_modules` (migration 066) — tant que
// la migration n'a pas encore été appliquée sur l'environnement, la colonne
// est absente de `select('*')` et vaut `undefined` sur chaque ligne.
const DEFAULT_ENABLED_MODULES: PaymentModule[] = ['shop', 'card', 'event', 'rental'];

const moduleLegend = [
  { label: 'Boutique', detail: 'Commandes du shop', icon: IconBuildingStore },
  { label: 'Carte', detail: 'Paiement depuis /card', icon: IconId },
  { label: 'Événements', detail: 'Prestations événementielles', icon: IconCalendarEvent },
  { label: 'Location', detail: 'Réservations de matériel', icon: IconTruck },
];

export default async function ParametresPaiementsPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: paymentMethods } = await supabase
    .from('tenant_payment_methods')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true });

  const normalizedMethods = ((paymentMethods ?? []) as TenantPaymentMethod[]).map((m) => ({
    ...m,
    enabled_modules: m.enabled_modules ?? DEFAULT_ENABLED_MODULES,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <Link
        href="/admin/parametres"
        className="mb-5 inline-flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <IconArrowLeft size={17} stroke={1.6} />
        Paramètres généraux
      </Link>

      <div className="mb-6">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]">
          <IconCreditCard size={21} stroke={1.7} />
        </div>
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-gray-400">Configuration</p>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">Moyens de paiement</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
          Définissez les moyens proposés aux clients et choisissez précisément dans quels modules chacun doit apparaître.
        </p>
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-800 dark:bg-gray-900/60">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Portée des moyens de paiement</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {moduleLegend.map(({ label, detail, icon: Icon }) => (
            <div key={label} className="flex items-start gap-2.5 rounded-lg bg-white p-3 dark:bg-gray-900">
              <Icon size={17} className="mt-0.5 shrink-0 text-gray-400" stroke={1.6} />
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}</p>
                <p className="mt-0.5 text-xs leading-4 text-gray-400">{detail}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-gray-400">
          La modification ici change uniquement la disponibilité configurée des moyens de paiement. Les parcours de paiement et leur logique restent inchangés.
        </p>
      </div>

      <PaymentMethodsSection initialMethods={normalizedMethods} />
    </div>
  );
}
