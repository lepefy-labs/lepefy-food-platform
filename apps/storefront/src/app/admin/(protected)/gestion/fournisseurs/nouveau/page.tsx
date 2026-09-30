import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { Breadcrumb, CARD_CLS } from '../../_components/ui';
import { SupplierForm } from '../SupplierForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function NewSupplierPage() {
  const { tenant } = await requireBusinessManagementPage('suppliers.manage');
  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <Breadcrumb items={[{ label: 'Gestion', href: '/admin/gestion' }, { label: 'Fournisseurs', href: '/admin/gestion/fournisseurs' }, { label: 'Nouveau' }]} />
      <AdminPageHeader title="Nouveau fournisseur" description="Un code FOU-000000 est attribué automatiquement." />
      <div className={`${CARD_CLS} p-4 sm:p-6`}>
        <SupplierForm defaultCurrency={tenant.currency} />
      </div>
    </div>
  );
}
