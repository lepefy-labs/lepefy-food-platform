import Link from 'next/link';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { PAYMENT_FILTERS, listActiveSupplierOptions, listPurchases, type PaymentFilter, type PurchaseFilters } from '@/lib/gestion/queries';
import { formatDate, formatMoney } from '@/lib/gestion/format';
import {
  PAYMENT_STATE_LABELS, PAYMENT_STATE_TONES, PURCHASE_STATUS_LABELS, PURCHASE_STATUS_TONES,
  DUE_STATE_TONES, dueInfo, dueLabel, gestionToday, purchasePaymentState,
} from '@/lib/gestion/domain';
import Badge from '@/app/admin/_components/ui/Badge';
import { cardClasses } from '@/app/admin/_components/ui/Panel';
import { EmptyState } from '@/app/admin/_components/ui/States';
import { Breadcrumb } from '@/app/admin/_components/ui/AdminPageHeader';
import { controlClasses } from '@/app/admin/_components/ui/Form';
import { buttonClasses } from '@/app/admin/_components/ui/Button';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'Ouverts' },
  { value: 'to_receive', label: 'À réceptionner' },
  { value: 'draft', label: 'Brouillons' },
  { value: 'received', label: 'Reçus' },
  { value: 'cancelled', label: 'Annulés' },
  { value: 'all', label: 'Tous' },
];

// Paiement / échéance : filtres calculés côté serveur (vue des soldes, tenant-scoped).
const PAY_FILTERS: { value: PaymentFilter | ''; label: string }[] = [
  { value: '', label: 'Tous' },
  { value: 'unpaid', label: 'À payer' },
  { value: 'due_soon', label: 'À échéance bientôt' },
  { value: 'overdue', label: 'En retard' },
  { value: 'paid', label: 'Payés' },
  { value: 'no_due', label: 'Sans échéance' },
];

const chipClass = (active: boolean) => `inline-flex min-h-10 shrink-0 items-center rounded-full px-3 text-sm ${active ? 'bg-a-brand-soft font-semibold text-a-brand-fg' : 'border border-a-border bg-a-surface text-a-text-2'}`;

export default async function PurchasesPage({ searchParams }: { searchParams: { status?: string; pay?: string; q?: string; supplier?: string } }) {
  const { tenant, can } = await requireBusinessManagementPage('purchases.view');
  const pay = (PAYMENT_FILTERS as readonly string[]).includes(searchParams.pay ?? '') ? searchParams.pay as PaymentFilter : undefined;
  // Avec un filtre de paiement, tous les états de marchandise par défaut : un achat
  // reçu mais impayé (ou en retard) doit rester visible sans choix explicite.
  const explicitStatus = FILTERS.some((filter) => filter.value === searchParams.status) ? searchParams.status! : undefined;
  const status = explicitStatus ?? (pay ? 'all' : 'open');
  const today = gestionToday();
  const q = (searchParams.q ?? '').slice(0, 80);
  const supplierId = /^[0-9a-f-]{36}$/i.test(searchParams.supplier ?? '') ? searchParams.supplier : undefined;
  const [purchases, suppliers] = await Promise.all([
    listPurchases(tenant.id, { status: status === 'all' ? undefined : status as PurchaseFilters['status'], pay, q, supplierId }),
    listActiveSupplierOptions(tenant.id),
  ]);
  const baseQuery = { ...(q ? { q } : {}), ...(supplierId ? { supplier: supplierId } : {}) };

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <Breadcrumb items={[{ label: 'Gestion', href: '/admin/gestion' }, { label: 'Achats & réceptions' }]} />
      <AdminPageHeader
        title="Achats & réceptions"
        description="Commandé, reçu et payé sont suivis séparément. Ouvrez un achat pour enregistrer une réception ou un paiement."
        actions={can('purchases.manage') ? <Link href="/admin/gestion/achats/nouveau" className={buttonClasses({ variant: 'primary' })}><IconPlus size={18} aria-hidden="true" />Nouvel achat</Link> : undefined}
      />

      <form className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto]" role="search">
        <label className="relative">
          <span className="sr-only">Rechercher un achat</span>
          <IconSearch size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
          <input name="q" defaultValue={q} placeholder="Référence ACH ou référence fournisseur" className={`${controlClasses} pl-10`} />
        </label>
        <label>
          <span className="sr-only">Fournisseur</span>
          <select name="supplier" defaultValue={supplierId ?? ''} className={controlClasses}>
            <option value="">Tous les fournisseurs</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </label>
        <input type="hidden" name="status" value={status} />
        {pay && <input type="hidden" name="pay" value={pay} />}
        <button type="submit" className="min-h-11 rounded-lg border border-a-border-strong bg-a-surface px-4 text-sm font-medium">Filtrer</button>
      </form>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-a-text-3">Marchandise</p>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Filtrer par état de la marchandise">
        {FILTERS.map((filter) => (
          <Link key={filter.value} href={{ query: { ...baseQuery, ...(pay ? { pay } : {}), status: filter.value } }} aria-current={status === filter.value ? 'page' : undefined} className={chipClass(status === filter.value)}>
            {filter.label}
          </Link>
        ))}
      </div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-a-text-3">Paiement</p>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Filtrer par paiement et échéance">
        {PAY_FILTERS.map((filter) => (
          <Link key={filter.value || 'all'} href={{ query: { ...baseQuery, ...(explicitStatus ? { status: explicitStatus } : {}), ...(filter.value ? { pay: filter.value } : {}) } }} aria-current={(pay ?? '') === filter.value ? 'page' : undefined} className={chipClass((pay ?? '') === filter.value)}>
            {filter.label}
          </Link>
        ))}
      </div>

      {purchases.length === 0 ? (
        <EmptyState
          title="Aucun achat dans cette vue"
          description={status === 'to_receive' ? 'Aucune marchandise en attente de réception.' : 'Modifiez les filtres ou créez un nouvel achat.'}
          action={can('purchases.manage') ? <Link href="/admin/gestion/achats/nouveau" className={buttonClasses({ variant: 'primary' })}>Nouvel achat</Link> : undefined}
        />
      ) : (
        <ul className={`${cardClasses} divide-y divide-a-border`}>
          {purchases.map((purchase) => {
            const state = purchasePaymentState(purchase);
            const due = dueInfo(purchase, today);
            return (
              <li key={purchase.id}>
                <Link href={`/admin/gestion/achats/${purchase.id}`} className="grid gap-2 px-4 py-3.5 hover:bg-a-surface-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium text-a-text">{purchase.reference}</p>
                    <p className="truncate text-sm text-a-text-2">{purchase.supplier_name}</p>
                    <p className="text-xs text-a-text-3">
                      {formatDate(purchase.order_date)}{purchase.expected_date ? ` • prévu ${formatDate(purchase.expected_date)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={PURCHASE_STATUS_TONES[purchase.status]}>{PURCHASE_STATUS_LABELS[purchase.status]}</Badge>
                    {purchase.payment_due_date && purchase.status !== 'cancelled' && <span className="text-xs text-a-text-3">Échéance {formatDate(purchase.payment_due_date)}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                    <Badge tone={PAYMENT_STATE_TONES[state]}>{PAYMENT_STATE_LABELS[state]}</Badge>
                    {['overdue', 'today', 'due_soon'].includes(due.state) && <Badge tone={DUE_STATE_TONES[due.state]}>{dueLabel(due)}</Badge>}
                    <span className="text-sm font-semibold tabular-nums text-a-text">{formatMoney(purchase.total, purchase.currency)}</span>
                    {purchase.outstanding > 0 && purchase.status !== 'cancelled' && (
                      <span className="w-full text-right text-xs text-tone-warning-fg sm:w-auto">reste {formatMoney(purchase.outstanding, purchase.currency)}</span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
