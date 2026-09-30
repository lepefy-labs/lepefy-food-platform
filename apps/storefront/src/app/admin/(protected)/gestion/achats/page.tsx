import Link from 'next/link';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { listActiveSupplierOptions, listPurchases, type PurchaseFilters } from '@/lib/gestion/queries';
import { formatDate, formatMoney } from '@/lib/gestion/format';
import {
  PAYMENT_STATE_LABELS, PAYMENT_STATE_TONES, PURCHASE_STATUS_LABELS, PURCHASE_STATUS_TONES,
  purchasePaymentState, receivedPercent,
} from '@/lib/gestion/domain';
import { Badge, Breadcrumb, CARD_CLS, EmptyState, INPUT_CLS, PRIMARY_LINK_CLS } from '../_components/ui';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'Ouverts' },
  { value: 'to_receive', label: 'À réceptionner' },
  { value: 'unpaid', label: 'Reste à payer' },
  { value: 'draft', label: 'Brouillons' },
  { value: 'received', label: 'Reçus' },
  { value: 'cancelled', label: 'Annulés' },
  { value: 'all', label: 'Tous' },
];

export default async function PurchasesPage({ searchParams }: { searchParams: { status?: string; q?: string; supplier?: string } }) {
  const { tenant, can } = await requireBusinessManagementPage('purchases.view');
  const status = FILTERS.some((filter) => filter.value === searchParams.status) ? searchParams.status! : 'open';
  const q = (searchParams.q ?? '').slice(0, 80);
  const supplierId = /^[0-9a-f-]{36}$/i.test(searchParams.supplier ?? '') ? searchParams.supplier : undefined;
  const [purchases, suppliers] = await Promise.all([
    listPurchases(tenant.id, { status: status === 'all' ? undefined : status as PurchaseFilters['status'], q, supplierId }),
    listActiveSupplierOptions(tenant.id),
  ]);
  const baseQuery = { ...(q ? { q } : {}), ...(supplierId ? { supplier: supplierId } : {}) };

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <Breadcrumb items={[{ label: 'Gestion', href: '/admin/gestion' }, { label: 'Achats & réceptions' }]} />
      <AdminPageHeader
        title="Achats & réceptions"
        description="Commandé, reçu et payé sont suivis séparément. Ouvrez un achat pour enregistrer une réception ou un paiement."
        actions={can('purchases.manage') ? <Link href="/admin/gestion/achats/nouveau" className={PRIMARY_LINK_CLS}><IconPlus size={18} aria-hidden="true" />Nouvel achat</Link> : undefined}
      />

      <form className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto]" role="search">
        <label className="relative">
          <span className="sr-only">Rechercher un achat</span>
          <IconSearch size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input name="q" defaultValue={q} placeholder="Référence ACH ou référence fournisseur" className={`${INPUT_CLS} pl-10`} />
        </label>
        <label>
          <span className="sr-only">Fournisseur</span>
          <select name="supplier" defaultValue={supplierId ?? ''} className={INPUT_CLS}>
            <option value="">Tous les fournisseurs</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </label>
        <input type="hidden" name="status" value={status} />
        <button type="submit" className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">Filtrer</button>
      </form>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Filtrer par état">
        {FILTERS.map((filter) => (
          <Link key={filter.value} href={{ query: { ...baseQuery, status: filter.value } }} aria-current={status === filter.value ? 'page' : undefined}
            className={`inline-flex min-h-10 shrink-0 items-center rounded-full px-3 text-sm ${status === filter.value ? 'bg-[var(--admin-primary-soft)] font-semibold text-[var(--admin-primary-fg)]' : 'border border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}>
            {filter.label}
          </Link>
        ))}
      </div>

      {purchases.length === 0 ? (
        <EmptyState
          title="Aucun achat dans cette vue"
          description={status === 'to_receive' ? 'Aucune marchandise en attente de réception.' : 'Modifiez les filtres ou créez un nouvel achat.'}
          action={can('purchases.manage') ? <Link href="/admin/gestion/achats/nouveau" className={PRIMARY_LINK_CLS}>Nouvel achat</Link> : undefined}
        />
      ) : (
        <ul className={`${CARD_CLS} divide-y divide-gray-100 dark:divide-gray-800`}>
          {purchases.map((purchase) => {
            const state = purchasePaymentState(purchase);
            const received = receivedPercent(purchase.ordered_quantity, purchase.received_quantity);
            return (
              <li key={purchase.id}>
                <Link href={`/admin/gestion/achats/${purchase.id}`} className="grid gap-2 px-4 py-3.5 hover:bg-gray-50 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center dark:hover:bg-white/5">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium text-gray-950 dark:text-gray-100">{purchase.reference}</p>
                    <p className="truncate text-sm text-gray-600 dark:text-gray-300">{purchase.supplier_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(purchase.order_date)}{purchase.expected_date ? ` • prévu ${formatDate(purchase.expected_date)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={PURCHASE_STATUS_TONES[purchase.status]}>{PURCHASE_STATUS_LABELS[purchase.status]}</Badge>
                    {purchase.status !== 'draft' && purchase.status !== 'cancelled' && <span className="text-xs text-gray-500 dark:text-gray-400">Reçu {received} %</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                    <Badge tone={PAYMENT_STATE_TONES[state]}>{PAYMENT_STATE_LABELS[state]}</Badge>
                    <span className="text-sm font-semibold tabular-nums text-gray-950 dark:text-gray-100">{formatMoney(purchase.total, purchase.currency)}</span>
                    {purchase.outstanding > 0 && purchase.status !== 'cancelled' && (
                      <span className="w-full text-right text-xs text-amber-700 sm:w-auto dark:text-amber-300">reste {formatMoney(purchase.outstanding, purchase.currency)}</span>
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
