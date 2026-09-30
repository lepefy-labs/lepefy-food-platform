import Link from 'next/link';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { listActiveSupplierOptions } from '@/lib/gestion/queries';
import { Breadcrumb, CARD_CLS, EmptyState, PRIMARY_LINK_CLS } from '../../_components/ui';
import { PurchaseForm } from '../PurchaseForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function NewPurchasePage({ searchParams }: { searchParams: { supplier?: string } }) {
  const { tenant, can } = await requireBusinessManagementPage('purchases.manage');
  const suppliers = await listActiveSupplierOptions(tenant.id);
  const preselected = suppliers.some((supplier) => supplier.id === searchParams.supplier) ? searchParams.supplier : '';

  return (
    <div className="mx-auto w-full max-w-4xl pb-10">
      <Breadcrumb items={[{ label: 'Gestion', href: '/admin/gestion' }, { label: 'Achats', href: '/admin/gestion/achats' }, { label: 'Nouveau' }]} />
      <AdminPageHeader title="Nouvel achat" description="Une référence ACH est attribuée automatiquement. Aucun produit n'est créé dans le catalogue." />
      {suppliers.length === 0 ? (
        <EmptyState
          title="Aucun fournisseur actif"
          description="Créez d'abord le fournisseur auprès duquel vous achetez."
          action={can('suppliers.manage') ? <Link href="/admin/gestion/fournisseurs/nouveau" className={PRIMARY_LINK_CLS}>Nouveau fournisseur</Link> : undefined}
        />
      ) : (
        <div className={`${CARD_CLS} p-4 sm:p-6`}>
          <PurchaseForm suppliers={suppliers} currency={tenant.currency} initial={{ supplier_id: preselected }} />
        </div>
      )}
    </div>
  );
}
