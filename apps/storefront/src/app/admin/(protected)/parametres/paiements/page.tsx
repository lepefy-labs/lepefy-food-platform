import Link from 'next/link';
import { IconBuildingStore, IconCalendarEvent, IconCreditCard, IconId, IconTruck } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { PaymentMethodsSection } from '../PaymentMethodsSection';
import type { TenantPaymentMethod, PaymentModule } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

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
  const { data: paymentMethods } = await supabase.from('tenant_payment_methods').select('*').eq('tenant_id', tenant.id).order('sort_order', { ascending: true });
  const normalizedMethods = ((paymentMethods ?? []) as TenantPaymentMethod[]).map((m) => ({ ...m, enabled_modules: m.enabled_modules ?? DEFAULT_ENABLED_MODULES }));

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <AdminPageHeader
        title="Paramètres"
        description="Configurez la disponibilité des moyens de paiement utilisés par les services du tenant."
        meta="Paiements"
        actions={<div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] ring-1 ring-[#D9D3FF]"><IconCreditCard size={22} stroke={1.7} /></div>}
      />

      <div className="mb-5 inline-flex gap-1 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface-subtle)] p-1.5" role="tablist" aria-label="Paramètres">
        <Link href="/admin/parametres" className="min-h-10 rounded-xl px-3.5 py-2 text-sm font-medium text-gray-500 transition hover:bg-white hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100">Général</Link>
        <span className="min-h-10 rounded-xl bg-[var(--admin-primary-soft)] px-3.5 py-2 text-sm font-medium text-[var(--admin-primary-fg)] ring-1 ring-[#D9D3FF]">Paiements</span>
      </div>

      <section className="mb-5 overflow-hidden rounded-2xl border border-[#E8E4FF] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <header className="border-b border-[#E8E4FF] bg-[var(--admin-primary-soft)] px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-sm font-semibold text-[var(--admin-primary-fg)] dark:text-violet-200">Portée des moyens de paiement</h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Choisissez dans quels services chaque méthode doit être proposée.</p>
        </header>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {moduleLegend.map(({ label, detail, icon: Icon }) => (
            <div key={label} className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-[var(--admin-surface-subtle)] p-3 dark:border-gray-800 dark:bg-gray-950/30">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--admin-primary-fg)] shadow-sm dark:bg-gray-800"><Icon size={17} stroke={1.6} /></div>
              <div><p className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</p><p className="mt-0.5 text-xs leading-4 text-gray-500">{detail}</p></div>
            </div>
          ))}
        </div>
        <footer className="border-t border-[#E8E4FF] bg-[#FCFBFF] px-4 py-3 text-xs leading-5 text-gray-500 dark:border-gray-800 dark:bg-gray-900/80">
          Cette configuration agit uniquement sur la disponibilité des moyens de paiement. Aucun checkout, webhook ou flux transactionnel n&apos;est modifié ici.
        </footer>
      </section>

      <PaymentMethodsSection initialMethods={normalizedMethods} />
    </div>
  );
}
