import Link from 'next/link';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { listActiveSupplierOptions, listPurchases } from '@/lib/gestion/queries';
import { cardClasses } from '@/app/admin/_components/ui/Panel';
import { EmptyState } from '@/app/admin/_components/ui/States';
import { Breadcrumb } from '@/app/admin/_components/ui/AdminPageHeader';
import { buttonClasses } from '@/app/admin/_components/ui/Button';
import { PaymentForm } from '../PaymentForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function NewPaymentPage({ searchParams }: { searchParams: { supplier?: string; purchase?: string } }) {
  const { tenant, can } = await requireBusinessManagementPage('treasury.manage');
  const [suppliers, purchases] = await Promise.all([
    listActiveSupplierOptions(tenant.id),
    listPurchases(tenant.id, { limit: 500 }),
  ]);
  // Achats encore affectables (hors annulés), chargés côté serveur : pas besoin de purchases.view.
  const open = purchases
    .filter((purchase) => purchase.status !== 'cancelled' && purchase.allocatable > 0)
    .map((purchase) => ({
      id: purchase.id, reference: purchase.reference, supplier_id: purchase.supplier_id, order_date: purchase.order_date,
      currency: purchase.currency, total: purchase.total, allocatable: purchase.allocatable,
    }));

  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <Breadcrumb items={[{ label: 'Gestion', href: '/admin/gestion' }, { label: 'Trésorerie', href: '/admin/gestion/tresorerie' }, { label: 'Nouveau paiement' }]} />
      <AdminPageHeader title="Enregistrer un paiement fournisseur" description="Une référence PAY est attribuée automatiquement. Ajoutez le justificatif après l'enregistrement." />
      {suppliers.length === 0 ? (
        <EmptyState title="Aucun fournisseur actif" action={can('suppliers.manage') ? <Link href="/admin/gestion/fournisseurs/nouveau" className={buttonClasses({ variant: 'primary' })}>Nouveau fournisseur</Link> : undefined} />
      ) : (
        <div className={`${cardClasses} p-4 sm:p-6`}>
          <PaymentForm suppliers={suppliers} purchases={open} initialSupplierId={searchParams.supplier} initialPurchaseId={searchParams.purchase} />
        </div>
      )}
    </div>
  );
}
