import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { LivraisonTabs } from '../LivraisonTabs';
import { PacklinkDiagnostic } from './PacklinkDiagnostic';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminPacklinkDiagnosticPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Diagnostic Packlink"
        description="Interrogez une expédition Packlink PRO réelle et inspectez les données renvoyées par les endpoints shipment, tracking et labels."
        meta="Lecture seule"
      />

      <LivraisonTabs active="packlink-diagnostic" />

      <PacklinkDiagnostic shippingProvider={tenant.shipping_provider} />
    </div>
  );
}
