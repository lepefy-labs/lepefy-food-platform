import Link from 'next/link';
import { IconAlertTriangle, IconBuildingWarehouse, IconCash, IconPackageImport, IconShoppingCartPlus } from '@tabler/icons-react';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { getDashboard } from '@/lib/gestion/queries';
import { formatDate, formatMoney } from '@/lib/gestion/format';
import {
  GESTION_VIEW_PERMISSIONS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES,
  PAYMENT_STATE_LABELS, PAYMENT_STATE_TONES, PURCHASE_STATUS_LABELS, PURCHASE_STATUS_TONES, purchasePaymentState,
} from '@/lib/gestion/domain';
import { Badge, CARD_CLS, EmptyState, Panel, SECONDARY_LINK_CLS, Stat } from './_components/ui';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function GestionDashboardPage() {
  const { tenant, can } = await requireBusinessManagementPage([...GESTION_VIEW_PERMISSIONS]);
  const data = await getDashboard(tenant.id, tenant.currency);
  const money = (value: number) => formatMoney(value, data.currency);
  const anomalies = [
    data.overdueReceipts > 0 && { text: `${data.overdueReceipts} achat(s) en retard de livraison (date prévue dépassée).`, href: '/admin/gestion/achats?status=to_receive' },
    data.staleUnverifiedPayments > 0 && { text: `${data.staleUnverifiedPayments} paiement(s) enregistré(s) depuis plus de 7 jours sans vérification.`, href: '/admin/gestion/tresorerie?status=recorded' },
    data.unallocatedPayments > 0 && { text: `${money(data.unallocatedPayments)} payés mais non affectés à un achat.`, href: '/admin/gestion/tresorerie' },
  ].filter((item): item is { text: string; href: string } => Boolean(item));

  const quickActions = [
    can('suppliers.manage') && { href: '/admin/gestion/fournisseurs/nouveau', label: 'Nouveau fournisseur', icon: IconBuildingWarehouse },
    can('purchases.manage') && { href: '/admin/gestion/achats/nouveau', label: 'Nouvel achat', icon: IconShoppingCartPlus },
    can('treasury.manage') && { href: '/admin/gestion/tresorerie/nouveau', label: 'Enregistrer un paiement', icon: IconCash },
    can('inventory.manage') && { href: '/admin/gestion/achats?status=to_receive', label: 'Enregistrer une réception', icon: IconPackageImport },
  ].filter((item): item is { href: string; label: string; icon: typeof IconCash } => Boolean(item));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-10">
      <AdminPageHeader title="Gestion" description="Fournisseurs, achats, réceptions, dettes et trésorerie de la boutique." />

      {quickActions.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {quickActions.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={SECONDARY_LINK_CLS}><Icon size={18} aria-hidden="true" />{label}</Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Dette fournisseurs" value={money(data.openDebt)} hint={`${data.purchasesWithBalance} achat(s) avec reste à payer`} tone={data.openDebt > 0 ? 'warn' : 'neutral'} href={can('purchases.view') ? '/admin/gestion/achats?status=unpaid' : undefined} />
        <Stat label="Achats ouverts" value={String(data.openPurchases)} hint="Brouillons, commandés, reçus en partie" href={can('purchases.view') ? '/admin/gestion/achats?status=open' : undefined} />
        <Stat label="Réceptions en attente" value={String(data.toReceive)} hint="Commandés, pas encore tout reçu" tone={data.toReceive > 0 ? 'info' : 'neutral'} href={can('purchases.view') ? '/admin/gestion/achats?status=to_receive' : undefined} />
        <Stat label="Paiements à vérifier" value={String(data.paymentsToVerifyCount)} hint={money(data.paymentsToVerifyAmount)} tone={data.paymentsToVerifyCount > 0 ? 'warn' : 'neutral'} href={can('treasury.view') ? '/admin/gestion/tresorerie?status=recorded' : undefined} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Payé vérifié (30 jours)" value={money(data.paidVerified30d)} tone="success" />
        <div className={`${CARD_CLS} px-4 py-3.5`}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Points d&apos;attention</p>
          {anomalies.length === 0 ? (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Aucune anomalie détectée.</p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {anomalies.map((anomaly) => (
                <li key={anomaly.text}>
                  <Link href={anomaly.href} className="flex items-start gap-2 text-sm text-amber-800 hover:underline dark:text-amber-200">
                    <IconAlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{anomaly.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {can('purchases.view') && (
          <Panel title="Derniers achats" actions={<Link href="/admin/gestion/achats" className="text-sm font-medium text-[var(--admin-primary-fg)] hover:underline">Tout voir</Link>}>
            {data.recentPurchases.length === 0 ? (
              <EmptyState title="Aucun achat enregistré" description="Créez un achat pour suivre la marchandise commandée et ce qui reste à payer." />
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.recentPurchases.map((purchase) => {
                  const state = purchasePaymentState(purchase);
                  return (
                    <li key={purchase.id}>
                      <Link href={`/admin/gestion/achats/${purchase.id}`} className="flex flex-col gap-1 py-3 hover:bg-gray-50 sm:-mx-2 sm:px-2 dark:hover:bg-white/5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">{purchase.reference}</span>
                          <span className="text-sm font-semibold tabular-nums">{formatMoney(purchase.total, purchase.currency)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <span>{purchase.supplier_name} • {formatDate(purchase.order_date)}</span>
                          <Badge tone={PURCHASE_STATUS_TONES[purchase.status]}>{PURCHASE_STATUS_LABELS[purchase.status]}</Badge>
                          <Badge tone={PAYMENT_STATE_TONES[state]}>{PAYMENT_STATE_LABELS[state]}</Badge>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}
        {can('treasury.view') && (
          <Panel title="Derniers paiements" actions={<Link href="/admin/gestion/tresorerie" className="text-sm font-medium text-[var(--admin-primary-fg)] hover:underline">Trésorerie</Link>}>
            {data.recentPayments.length === 0 ? (
              <EmptyState title="Aucun paiement fournisseur" description="Les paiements enregistrés apparaîtront ici, avec leur statut de vérification." />
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.recentPayments.map((payment) => (
                  <li key={payment.id}>
                    <Link href={`/admin/gestion/tresorerie/${payment.id}`} className="flex flex-col gap-1 py-3 hover:bg-gray-50 sm:-mx-2 sm:px-2 dark:hover:bg-white/5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{payment.supplier_name}</span>
                        <span className="text-sm font-semibold tabular-nums">{formatMoney(payment.amount, payment.currency)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                        <span>{formatDate(payment.payment_date)} • {PAYMENT_METHOD_LABELS[payment.method]}{payment.beneficiary_type === 'third_party' ? ` • Tiers : ${payment.beneficiary_name}` : ''}</span>
                        <Badge tone={PAYMENT_STATUS_TONES[payment.status]}>{PAYMENT_STATUS_LABELS[payment.status]}</Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
