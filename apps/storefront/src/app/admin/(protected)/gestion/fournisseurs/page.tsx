import Link from 'next/link';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { listSuppliers } from '@/lib/gestion/queries';
import { formatDate, formatMoney } from '@/lib/gestion/format';
import { Badge, Breadcrumb, CARD_CLS, EmptyState, INPUT_CLS, PRIMARY_LINK_CLS } from '../_components/ui';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const STATUS_FILTERS = [
  { value: 'active', label: 'Actifs' },
  { value: 'inactive', label: 'Inactifs' },
  { value: 'all', label: 'Tous' },
] as const;

export default async function SuppliersPage({ searchParams }: { searchParams: { q?: string; status?: string } }) {
  const { tenant, can } = await requireBusinessManagementPage('suppliers.view');
  const status = STATUS_FILTERS.some((filter) => filter.value === searchParams.status) ? searchParams.status as 'active' | 'inactive' | 'all' : 'active';
  const q = (searchParams.q ?? '').slice(0, 80);
  const suppliers = await listSuppliers(tenant.id, { q, status });
  const totalOutstanding = suppliers.reduce((sum, supplier) => sum + supplier.balance.outstanding, 0);

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <Breadcrumb items={[{ label: 'Gestion', href: '/admin/gestion' }, { label: 'Fournisseurs' }]} />
      <AdminPageHeader
        title="Fournisseurs"
        description="Le solde est calculé à partir des achats et des paiements vérifiés, jamais saisi à la main."
        meta={`${suppliers.length} fournisseur(s) • reste à payer ${formatMoney(totalOutstanding, tenant.currency)}`}
        actions={can('suppliers.manage') ? <Link href="/admin/gestion/fournisseurs/nouveau" className={PRIMARY_LINK_CLS}><IconPlus size={18} aria-hidden="true" />Nouveau fournisseur</Link> : undefined}
      />

      <form className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center" role="search">
        <label className="relative flex-1">
          <span className="sr-only">Rechercher un fournisseur</span>
          <IconSearch size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input name="q" defaultValue={q} placeholder="Nom, code, contact ou email" className={`${INPUT_CLS} pl-10`} />
        </label>
        <input type="hidden" name="status" value={status} />
        <button type="submit" className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">Rechercher</button>
      </form>
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Filtrer par statut">
        {STATUS_FILTERS.map((filter) => (
          <Link key={filter.value} href={{ query: { ...(q ? { q } : {}), status: filter.value } }}
            aria-current={status === filter.value ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center rounded-full px-3 text-sm ${status === filter.value ? 'bg-[var(--admin-primary-soft)] font-semibold text-[var(--admin-primary-fg)]' : 'border border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}>
            {filter.label}
          </Link>
        ))}
      </div>

      {suppliers.length === 0 ? (
        <EmptyState
          title={q ? 'Aucun fournisseur ne correspond à la recherche' : 'Aucun fournisseur'}
          description={q ? 'Essayez un autre nom ou code.' : 'Ajoutez vos fournisseurs pour suivre achats, dettes et paiements.'}
          action={!q && can('suppliers.manage') ? <Link href="/admin/gestion/fournisseurs/nouveau" className={PRIMARY_LINK_CLS}>Nouveau fournisseur</Link> : undefined}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {suppliers.map((supplier) => (
            <li key={supplier.id}>
              <Link href={`/admin/gestion/fournisseurs/${supplier.id}`} className={`${CARD_CLS} block h-full px-4 py-3.5 transition hover:border-[var(--admin-primary)]`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-950 dark:text-gray-100">{supplier.name}</p>
                    <p className="font-mono text-xs text-gray-500 dark:text-gray-400">{supplier.code}{supplier.contact_name ? ` • ${supplier.contact_name}` : ''}</p>
                  </div>
                  {!supplier.active && <Badge tone="neutral">Inactif</Badge>}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">Reste à payer</dt>
                    <dd className={`font-semibold tabular-nums ${supplier.balance.outstanding > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}`}>
                      {formatMoney(supplier.balance.outstanding, supplier.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">Achats</dt>
                    <dd className="tabular-nums text-gray-900 dark:text-gray-100">{supplier.balance.purchase_count}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">Dernier achat</dt>
                    <dd className="text-gray-900 dark:text-gray-100">{formatDate(supplier.balance.last_purchase_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">Dernier paiement</dt>
                    <dd className="text-gray-900 dark:text-gray-100">{formatDate(supplier.balance.last_payment_date)}</dd>
                  </div>
                </dl>
                {supplier.balance.paid_unverified > 0 && (
                  <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{formatMoney(supplier.balance.paid_unverified, supplier.currency)} enregistrés, à vérifier</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
