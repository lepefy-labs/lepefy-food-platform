import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { getShippingProvider } from '@/lib/shipping/providers/registry';
import { readShippingAutomationSettings } from '@/lib/shipping/shipmentDraft/settings';
import AdminBlockAccent from '../../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { LivraisonTabs } from '../LivraisonTabs';
import { ShipmentCreationSection } from './ShipmentCreationSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminShipmentCreationPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const [access, settings] = await Promise.all([
    getCurrentAdminAccessContext(tenant.id),
    readShippingAutomationSettings(createServiceClient(), tenant.id),
  ]);
  // UI hint only: PATCH /api/admin/shipping-automation re-checks shipping.manage.
  const canManage = Boolean(access && canAdmin(access, 'shipping.manage'));
  const adapter = getShippingProvider(tenant.shipping_provider);
  const provider = adapter?.capabilities.createDraft ? { key: adapter.key, displayName: adapter.displayName } : null;

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Livraison"
        description="Création des brouillons d’expédition chez le transporteur à partir des commandes."
      />
      <LivraisonTabs active="expeditions" />
      <AdminBlockAccent tone="info">
        <ShipmentCreationSection initial={settings} provider={provider} canManage={canManage} />
      </AdminBlockAccent>
    </div>
  );
}
