import Link from 'next/link';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { listSuppliers } from '@/lib/gestion/queries';
import { formatDate, formatMoney } from '@/lib/gestion/format';
import Badge from '@/app/admin/_components/ui/Badge';
import { cardClasses } from '@/app/admin/_components/ui/Panel';
import { EmptyState } from '@/app/admin/_components/ui/States';
import { Breadcrumb } from '@/app/admin/_components/ui/AdminPageHeader';
import { controlClasses } from '@/app/admin/_components/ui/Form';
import { buttonClasses } from '@/app/admin/_components/ui/Button';

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
        actions={can('suppliers.manage') ? <Link href="/admin/gestion/fournisseurs/nouveau" className={buttonClasses({ variant: 'primary' })}><IconPlus size={18} aria-hidden="true" />Nouveau fournisseur</Link> : undefined}
      />

      <form className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center" role="search">
        <label className="relative flex-1">
          <span className="sr-only">Rechercher un fournisseur</span>
          <IconSearch size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
          <input name="q" defaultValue={q} placeholder="Nom, code, contact ou email" className={`${controlClasses} pl-10`} />
        </label>
        <input type="hidden" name="status" value={status} />
        <button type="submit" className="min-h-11 rounded-lg border border-a-border-strong bg-a-surface px-4 text-sm font-medium">Rechercher</button>
      </form>
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Filtrer par statut">
        {STATUS_FILTERS.map((filter) => (
          <Link key={filter.value} href={{ query: { ...(q ? { q } : {}), status: filter.value } }}
            aria-current={status === filter.value ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center rounded-full px-3 text-sm ${status === filter.value ? 'bg-a-brand-soft font-semibold text-a-brand-fg' : 'border border-a-border bg-a-surface text-a-text-2'}`}>
            {filter.label}
          </Link>
        ))}
      </div>

      {suppliers.length === 0 ? (
        <EmptyState
          title={q ? 'Aucun fournisseur ne correspond à la recherche' : 'Aucun fournisseur'}
          description={q ? 'Essayez un autre nom ou code.' : 'Ajoutez vos fournisseurs pour suivre achats, dettes et paiements.'}
          action={!q && can('suppliers.manage') ? <Link href="/admin/gestion/fournisseurs/nouveau" className={buttonClasses({ variant: 'primary' })}>Nouveau fournisseur</Link> : undefined}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {suppliers.map((supplier) => (
            <li key={supplier.id}>
              <Link href={`/admin/gestion/fournisseurs/${supplier.id}`} className={`${cardClasses} block h-full px-4 py-3.5 transition hover:border-a-brand`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-a-text">{supplier.name}</p>
                    <p className="font-mono text-xs text-a-text-3">{supplier.code}{supplier.contact_name ? ` • ${supplier.contact_name}` : ''}</p>
                  </div>
                  {!supplier.active && <Badge tone="neutral">Inactif</Badge>}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-a-text-3">Reste à payer</dt>
                    <dd className={`font-semibold tabular-nums ${supplier.balance.outstanding > 0 ? 'text-tone-warning-fg' : 'text-a-text'}`}>
                      {formatMoney(supplier.balance.outstanding, supplier.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-a-text-3">Achats</dt>
                    <dd className="tabular-nums text-a-text">{supplier.balance.purchase_count}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-a-text-3">Dernier achat</dt>
                    <dd className="text-a-text">{formatDate(supplier.balance.last_purchase_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-a-text-3">Dernier paiement</dt>
                    <dd className="text-a-text">{formatDate(supplier.balance.last_payment_date)}</dd>
                  </div>
                </dl>
                {supplier.balance.paid_unverified > 0 && (
                  <p className="mt-2 text-xs text-tone-warning-fg">{formatMoney(supplier.balance.paid_unverified, supplier.currency)} enregistrés, à vérifier</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
