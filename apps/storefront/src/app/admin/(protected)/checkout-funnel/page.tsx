import Link from 'next/link';
import { IconArrowLeft, IconArrowUpRight, IconCheck, IconClock, IconRefresh, IconShoppingCart, IconWallet, IconX } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface FunnelRow {
  checkout_started: number;
  checkout_completed: number;
  checkout_open: number;
  checkout_awaiting_verification: number;
  checkout_expired: number;
  checkout_cancelled: number;
  checkout_resumed: number;
  checkout_recovered: number;
}

function percent(part: number, total: number) {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

export default async function CheckoutFunnelPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('checkout_funnel_30d')
    .select('*')
    .eq('tenant_id', tenant.id)
    .maybeSingle() as { data: FunnelRow | null };

  const funnel: FunnelRow = data ?? {
    checkout_started: 0,
    checkout_completed: 0,
    checkout_open: 0,
    checkout_awaiting_verification: 0,
    checkout_expired: 0,
    checkout_cancelled: 0,
    checkout_resumed: 0,
    checkout_recovered: 0,
  };

  const conversion = percent(funnel.checkout_completed, funnel.checkout_started);
  const recoveryConversion = percent(funnel.checkout_recovered, funnel.checkout_resumed);

  const cards = [
    { label: 'Checkout démarrés', value: funnel.checkout_started, helper: '30 derniers jours', icon: IconShoppingCart },
    { label: 'Convertis', value: funnel.checkout_completed, helper: `Conversion ${conversion}`, icon: IconCheck },
    { label: 'À finaliser', value: funnel.checkout_open, helper: 'Checkout encore récupérables', icon: IconClock },
    { label: 'À vérifier', value: funnel.checkout_awaiting_verification, helper: 'Paiements externes · action admin', icon: IconWallet },
    { label: 'Repris', value: funnel.checkout_resumed, helper: `Recovery ${recoveryConversion}`, icon: IconRefresh },
    { label: 'Expirés', value: funnel.checkout_expired, helper: 'Abandonnés après 24 h', icon: IconX },
    { label: 'Récupérés', value: funnel.checkout_recovered, helper: 'Repris puis convertis', icon: IconArrowUpRight },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <Link href="/admin" className="mb-3 inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:hover:text-white">
        <IconArrowLeft size={16} /> Commandes
      </Link>
      <AdminPageHeader
        title="Funnel checkout"
        description="Mesurez la conversion, les abandons, les paiements externes à vérifier et la récupération des achats non finalisés."
        meta="30 jours"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, helper, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
                <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white sm:text-3xl">{value}</p>
                <p className="mt-1 text-xs text-gray-400">{helper}</p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]">
                <Icon size={18} />
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="font-bold text-gray-950 dark:text-white">Lecture du funnel</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3"><span className="text-gray-500">Conversion checkout → commande</span><strong>{conversion}</strong></div>
            <div className="flex items-center justify-between gap-3"><span className="text-gray-500">Recovery après reprise</span><strong>{recoveryConversion}</strong></div>
            <div className="flex items-center justify-between gap-3"><span className="text-gray-500">Paiements externes à vérifier</span><strong>{funnel.checkout_awaiting_verification}</strong></div>
            <div className="flex items-center justify-between gap-3"><span className="text-gray-500">Annulations explicites</span><strong>{funnel.checkout_cancelled}</strong></div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="font-bold text-gray-950 dark:text-white">Interprétation</h2>
          <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
            Un checkout « à finaliser » n&apos;est pas une commande et expire après 24 h. Un paiement externe « à vérifier » est différent : le client a été envoyé vers PayPal, Revolut ou un autre prestataire et la demande reste ouverte jusqu&apos;à une décision explicite de l&apos;admin. Aucun stock n&apos;est réservé dans les deux cas.
          </p>
        </section>
      </div>
    </div>
  );
}