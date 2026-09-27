import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { LivraisonTabs } from '../LivraisonTabs';
import { PacklinkWorkspace } from './PacklinkWorkspace';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminPacklinkDiagnosticPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Diagnostic Packlink"
        description="Consultez les expéditions visibles avec la clé Packlink PRO du tenant, puis inspectez une expédition via les endpoints shipment, tracking et labels."
        meta="Lecture seule"
      />

      <LivraisonTabs active="packlink-diagnostic" />

      <PacklinkWorkspace shippingProvider={tenant.shipping_provider} />
    </div>
  );
}
