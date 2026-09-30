import { notFound, redirect } from 'next/navigation';
import AdminPageHeader from '../../../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { getPurchaseDetail, listActiveSupplierOptions } from '@/lib/gestion/queries';
import { Breadcrumb, CARD_CLS } from '../../../_components/ui';
import { PurchaseForm } from '../../PurchaseForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function EditPurchasePage({ params }: { params: { id: string } }) {
  const { tenant } = await requireBusinessManagementPage('purchases.manage');
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const purchase = await getPurchaseDetail(tenant.id, params.id);
  if (!purchase) notFound();
  // Modifiable seulement avant toute réception (même règle que la RPC).
  if (!['draft', 'ordered'].includes(purchase.status) || purchase.receipts.length > 0) redirect(`/admin/gestion/achats/${purchase.id}`);
  const suppliers = await listActiveSupplierOptions(tenant.id);
  const withCurrent = suppliers.some((supplier) => supplier.id === purchase.supplier_id)
    ? suppliers
    : [...suppliers, { id: purchase.supplier_id, code: '', name: purchase.supplier_name, currency: purchase.currency }];

  return (
    <div className="mx-auto w-full max-w-4xl pb-10">
      <Breadcrumb items={[
        { label: 'Gestion', href: '/admin/gestion' }, { label: 'Achats', href: '/admin/gestion/achats' },
        { label: purchase.reference, href: `/admin/gestion/achats/${purchase.id}` }, { label: 'Modifier' },
      ]} />
      <AdminPageHeader title={`Modifier ${purchase.reference}`} />
      <div className={`${CARD_CLS} p-4 sm:p-6`}>
        <PurchaseForm
          suppliers={withCurrent}
          currency={purchase.currency}
          purchaseId={purchase.id}
          purchaseStatus={purchase.status as 'draft' | 'ordered'}
          initial={{
            supplier_id: purchase.supplier_id,
            supplier_reference: purchase.supplier_reference ?? '',
            order_date: purchase.order_date,
            expected_date: purchase.expected_date ?? '',
            additional_costs: purchase.additional_costs ? String(purchase.additional_costs) : '',
            notes: purchase.notes ?? '',
            items: purchase.items.map((item) => ({
              product_id: item.product_id, product_name: item.product_name, description: item.description,
              ordered_quantity: String(item.ordered_quantity), unit_cost: String(item.unit_cost),
            })),
          }}
        />
      </div>
    </div>
  );
}
