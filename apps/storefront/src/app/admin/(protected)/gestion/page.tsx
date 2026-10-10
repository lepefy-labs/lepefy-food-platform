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
import Badge from '@/app/admin/_components/ui/Badge';
import { Panel, cardClasses } from '@/app/admin/_components/ui/Panel';
import { EmptyState } from '@/app/admin/_components/ui/States';
import { buttonClasses } from '@/app/admin/_components/ui/Button';
import AdminStatCard from '@/app/admin/_components/ui/AdminStatCard';
import { DueList } from './_components/DueList';
import ExportExcelButton from './_components/ExportExcelButton';
import type { GestionExportType } from '@/lib/gestion/exportData';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function GestionDashboardPage() {
  const { tenant, can } = await requireBusinessManagementPage([...GESTION_VIEW_PERMISSIONS]);
  const data = await getDashboard(tenant.id, tenant.currency);
  const money = (value: number) => formatMoney(value, data.currency);
  const exportPermissions: Record<Exclude<GestionExportType, 'full'>, string> = {
    suppliers: 'suppliers.view', purchases: 'purchases.view', treasury: 'treasury.view', stock: 'inventory.view',
  };
  const allowedExports: GestionExportType[] = [
    ...(GESTION_VIEW_PERMISSIONS.every((permission) => can(permission)) ? ['full' as const] : []),
    ...Object.entries(exportPermissions).filter(([, permission]) => can(permission)).map(([type]) => type as GestionExportType),
  ];
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

      <div className="flex flex-wrap justify-end"><ExportExcelButton allowed={allowedExports} /></div>

      {quickActions.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {quickActions.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={buttonClasses({ variant: 'secondary' })}><Icon size={18} aria-hidden="true" />{label}</Link>
          ))}
        </div>
      )}

      <section aria-label="Échéances" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminStatCard title="À payer" value={money(data.dues.toPay)} description={`${data.dues.toPayCount} achat(s) engagé(s)`} tone={data.dues.toPay > 0 ? 'warning' : 'neutral'} href={can('purchases.view') ? '/admin/gestion/achats?pay=unpaid' : undefined} />
        <AdminStatCard title="À payer sous 7 jours" value={money(data.dues.dueSoon)} description={`${data.dues.dueSoonCount} échéance(s)`} tone={data.dues.dueSoonCount > 0 ? 'warning' : 'neutral'} href={can('purchases.view') ? '/admin/gestion/achats?pay=due_soon' : undefined} />
        <AdminStatCard title="En retard" value={money(data.dues.overdue)} description={`${data.dues.overdueCount} échéance(s) dépassée(s)`} tone={data.dues.overdueCount > 0 ? 'danger' : 'neutral'} href={can('purchases.view') ? '/admin/gestion/achats?pay=overdue' : undefined} />
        <AdminStatCard title="Paiements à vérifier" value={String(data.paymentsToVerifyCount)} description={money(data.paymentsToVerifyAmount)} tone={data.paymentsToVerifyCount > 0 ? 'warning' : 'neutral'} href={can('treasury.view') ? '/admin/gestion/tresorerie?status=recorded' : undefined} />
      </section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard title="Achats ouverts" value={String(data.openPurchases)} description="Brouillons, commandés, reçus en partie" href={can('purchases.view') ? '/admin/gestion/achats?status=open' : undefined} />
        <AdminStatCard title="Réceptions en attente" value={String(data.toReceive)} description="Commandés, pas encore tout reçu" tone={data.toReceive > 0 ? 'info' : 'neutral'} href={can('purchases.view') ? '/admin/gestion/achats?status=to_receive' : undefined} />
        <AdminStatCard title="Payé vérifié (30 jours)" value={money(data.paidVerified30d)} tone="success" />
        <div className={`${cardClasses} px-4 py-3.5`}>
          <p className="text-xs font-medium uppercase tracking-wide text-a-text-3">Points d&apos;attention</p>
          {anomalies.length === 0 ? (
            <p className="mt-1 text-sm text-a-text-2">Aucune anomalie détectée.</p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {anomalies.map((anomaly) => (
                <li key={anomaly.text}>
                  <Link href={anomaly.href} className="flex items-start gap-2 text-sm text-tone-warning-fg hover:underline">
                    <IconAlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{anomaly.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(can('purchases.view') || can('treasury.view')) && (
        <Panel id="echeances" title="Échéances fournisseurs" description={data.dues.noDueCount > 0 ? `${data.dues.noDueCount} achat(s) à payer sans échéance.` : 'Achats engagés avec un reste à payer, par urgence.'}
          actions={can('purchases.view') ? <Link href="/admin/gestion/achats?pay=unpaid" className="text-sm font-medium text-a-brand-fg hover:underline">Tout voir</Link> : undefined}>
          <DueList items={data.dues.items} today={data.dues.today} />
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {can('purchases.view') && (
          <Panel title="Derniers achats" actions={<Link href="/admin/gestion/achats" className="text-sm font-medium text-a-brand-fg hover:underline">Tout voir</Link>}>
            {data.recentPurchases.length === 0 ? (
              <EmptyState title="Aucun achat enregistré" description="Créez un achat pour suivre la marchandise commandée et ce qui reste à payer." />
            ) : (
              <ul className="divide-y divide-a-border">
                {data.recentPurchases.map((purchase) => {
                  const state = purchasePaymentState(purchase);
                  return (
                    <li key={purchase.id}>
                      <Link href={`/admin/gestion/achats/${purchase.id}`} className="flex flex-col gap-1 py-3 hover:bg-a-surface-2 sm:-mx-2 sm:px-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm font-medium text-a-text">{purchase.reference}</span>
                          <span className="text-sm font-semibold tabular-nums">{formatMoney(purchase.total, purchase.currency)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-a-text-3">
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
          <Panel title="Derniers paiements" actions={<Link href="/admin/gestion/tresorerie" className="text-sm font-medium text-a-brand-fg hover:underline">Trésorerie</Link>}>
            {data.recentPayments.length === 0 ? (
              <EmptyState title="Aucun paiement fournisseur" description="Les paiements enregistrés apparaîtront ici, avec leur statut de vérification." />
            ) : (
              <ul className="divide-y divide-a-border">
                {data.recentPayments.map((payment) => (
                  <li key={payment.id}>
                    <Link href={`/admin/gestion/tresorerie/${payment.id}`} className="flex flex-col gap-1 py-3 hover:bg-a-surface-2 sm:-mx-2 sm:px-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-a-text">{payment.supplier_name}</span>
                        <span className="text-sm font-semibold tabular-nums">{formatMoney(payment.amount, payment.currency)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-a-text-3">
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
