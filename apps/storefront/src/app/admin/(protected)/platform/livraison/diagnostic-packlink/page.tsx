import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getTenant } from '@/lib/tenant/getTenant';
import { PacklinkWorkspace } from './PacklinkWorkspace';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminPacklinkDiagnosticPage() {
  if (await requirePlatformOwner()) redirect('/admin');
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');

  return (
    <div>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        Expéditions visibles avec la clé Packlink PRO du tenant, puis inspection d&apos;une expédition via les endpoints shipment, tracking et labels. Lecture seule.
      </p>
      <PacklinkWorkspace shippingProvider={tenant.shipping_provider} />
    </div>
  );
}
