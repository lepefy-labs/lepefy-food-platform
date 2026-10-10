import Link from 'next/link';
import { IconPaperclip, IconPlus } from '@tabler/icons-react';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { getDueSummary, listActiveSupplierOptions, listPayments } from '@/lib/gestion/queries';
import { formatDate, formatMoney } from '@/lib/gestion/format';
import {
  BENEFICIARY_TYPES, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES,
  type BeneficiaryType, type PaymentMethod, type PaymentStatus,
} from '@/lib/gestion/domain';
import Badge from '@/app/admin/_components/ui/Badge';
import { Panel, cardClasses } from '@/app/admin/_components/ui/Panel';
import { EmptyState } from '@/app/admin/_components/ui/States';
import { Breadcrumb } from '@/app/admin/_components/ui/AdminPageHeader';
import { controlClasses, labelClasses } from '@/app/admin/_components/ui/Form';
import { buttonClasses } from '@/app/admin/_components/ui/Button';
import AdminStatCard from '@/app/admin/_components/ui/AdminStatCard';
import { SimpleAction } from '../_components/actions';
import { DueList } from '../_components/DueList';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const isoDate = (value?: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);
function pick<T extends string>(values: readonly T[], value?: string): T | undefined {
  return (values as readonly string[]).includes(value ?? '') ? value as T : undefined;
}

export default async function TreasuryPage({ searchParams }: {
  searchParams: { from?: string; to?: string; supplier?: string; method?: string; status?: string; beneficiary?: string };
}) {
  const { tenant, can } = await requireBusinessManagementPage('treasury.view');
  const filters = {
    from: isoDate(searchParams.from),
    to: isoDate(searchParams.to),
    supplierId: /^[0-9a-f-]{36}$/i.test(searchParams.supplier ?? '') ? searchParams.supplier : undefined,
    method: pick<PaymentMethod>(PAYMENT_METHODS, searchParams.method),
    status: pick<PaymentStatus>(PAYMENT_STATUSES, searchParams.status),
    beneficiaryType: pick<BeneficiaryType>(BENEFICIARY_TYPES, searchParams.beneficiary),
  };
  const [payments, suppliers, dues] = await Promise.all([
    listPayments(tenant.id, { ...filters, limit: 500 }), listActiveSupplierOptions(tenant.id), getDueSummary(tenant.id, 5),
  ]);
  const sum = (status: PaymentStatus) => payments.filter((payment) => payment.status === status).reduce((total, payment) => total + payment.amount, 0);
  const voided = payments.filter((payment) => payment.status === 'voided');
  const money = (value: number) => formatMoney(value, tenant.currency);
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <Breadcrumb items={[{ label: 'Gestion', href: '/admin/gestion' }, { label: 'Trésorerie' }]} />
      <AdminPageHeader
        title="Trésorerie"
        description="Registre des paiements aux fournisseurs (sorties d'argent). Les encaissements clients restent dans Paiements carte."
        actions={can('treasury.manage') ? <Link href="/admin/gestion/tresorerie/nouveau" className={buttonClasses({ variant: 'primary' })}><IconPlus size={18} aria-hidden="true" />Enregistrer un paiement</Link> : undefined}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AdminStatCard title="Payé vérifié" value={money(sum('verified'))} tone="success" description={filtered ? 'Selon les filtres' : 'Tous les paiements'} />
        <AdminStatCard title="Enregistré à vérifier" value={money(sum('recorded'))} tone={sum('recorded') > 0 ? 'warning' : 'neutral'} description="Ne réduit pas encore la dette" />
        <AdminStatCard title="Paiements annulés" value={String(voided.length)} description={money(voided.reduce((total, payment) => total + payment.amount, 0))} />
      </div>

      <div className="mb-4">
        <Panel id="echeances" title="Échéances ouvertes"
          description={`À payer ${money(dues.toPay)} • sous 7 jours ${money(dues.dueSoon)} • en retard ${money(dues.overdue)}. Date d'échéance de l'achat, distincte de la date de paiement ci-dessous.`}
          actions={can('purchases.view') ? <Link href="/admin/gestion/achats?pay=unpaid" className="text-sm font-medium text-a-brand-fg hover:underline">Tous les achats à payer</Link> : undefined}>
          <DueList items={dues.items} today={dues.today} />
        </Panel>
      </div>

      <h2 className="mb-2 text-base font-semibold text-a-text">Paiements enregistrés</h2>
      <form className={`${cardClasses} mb-4 grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6`} aria-label="Filtres">
        <label className="block"><span className={labelClasses}>Du</span><input type="date" name="from" defaultValue={filters.from} className={controlClasses} /></label>
        <label className="block"><span className={labelClasses}>Au</span><input type="date" name="to" defaultValue={filters.to} className={controlClasses} /></label>
        <label className="block"><span className={labelClasses}>Fournisseur</span>
          <select name="supplier" defaultValue={filters.supplierId ?? ''} className={controlClasses}>
            <option value="">Tous</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </label>
        <label className="block"><span className={labelClasses}>Mode</span>
          <select name="method" defaultValue={filters.method ?? ''} className={controlClasses}>
            <option value="">Tous</option>
            {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>)}
          </select>
        </label>
        <label className="block"><span className={labelClasses}>Statut</span>
          <select name="status" defaultValue={filters.status ?? ''} className={controlClasses}>
            <option value="">Tous</option>
            {PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{PAYMENT_STATUS_LABELS[status]}</option>)}
          </select>
        </label>
        <label className="block"><span className={labelClasses}>Bénéficiaire</span>
          <select name="beneficiary" defaultValue={filters.beneficiaryType ?? ''} className={controlClasses}>
            <option value="">Tous</option>
            <option value="supplier">Fournisseur</option>
            <option value="third_party">Tiers</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-3 lg:col-span-6">
          <button type="submit" className="min-h-11 rounded-lg bg-a-brand px-4 text-sm font-medium text-a-on-brand">Appliquer</button>
          {filtered && <Link href="/admin/gestion/tresorerie" className="inline-flex min-h-11 items-center px-3 text-sm text-a-text-2 hover:text-a-text">Réinitialiser</Link>}
        </div>
      </form>

      {payments.length === 0 ? (
        <EmptyState title={filtered ? 'Aucun paiement pour ces filtres' : 'Aucun paiement fournisseur'} description="Les paiements enregistrés apparaissent ici avec leur statut de vérification." />
      ) : (
        <ul className={`${cardClasses} divide-y divide-a-border`}>
          {payments.map((payment) => {
            const active = payment.allocations.filter((allocation) => !allocation.reversed_at);
            return (
              <li key={payment.id} className="grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center">
                <Link href={`/admin/gestion/tresorerie/${payment.id}`} className="min-w-0 hover:underline">
                  <p className="text-sm font-medium text-a-text">{formatDate(payment.payment_date)} • {payment.supplier_name}</p>
                  <p className="text-xs text-a-text-3">
                    <span className="font-mono">{payment.reference}</span> • {PAYMENT_METHOD_LABELS[payment.method]}
                    {payment.beneficiary_type === 'third_party' ? ` • Tiers : ${payment.beneficiary_name}` : ''}
                    {payment.created_by ? ` • par ${payment.created_by}` : ''}
                  </p>
                </Link>
                <div className="min-w-0 text-xs text-a-text-2">
                  {active.length ? active.map((allocation) => `${allocation.purchase_reference} (${formatMoney(allocation.amount, payment.currency)})`).join(', ') : 'Non affecté'}
                  {payment.document_count > 0 && <span className="ml-1 inline-flex items-center gap-0.5 text-a-text-3"><IconPaperclip size={12} aria-hidden="true" />{payment.document_count}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Badge tone={PAYMENT_STATUS_TONES[payment.status]}>{PAYMENT_STATUS_LABELS[payment.status]}</Badge>
                  <span className={`text-sm font-semibold tabular-nums ${payment.status === 'voided' ? 'text-a-text-3 line-through' : 'text-a-text'}`}>{formatMoney(payment.amount, payment.currency)}</span>
                  {payment.status === 'recorded' && can('supplier_payments.verify') && (
                    <SimpleAction url={`/api/admin/gestion/payments/${payment.id}/verify`} label="Vérifier" variant="outline"
                      confirmText={`Confirmez que ${formatMoney(payment.amount, payment.currency)} ont bien été payés.`} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
