import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { ErrorState } from '../../../_components/ui/States';
import { loadPlatformStudio } from '@/lib/studio/server/platform';
import StudioImagesPlatformClient from './StudioImagesPlatformClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// platform/layout.tsx restricts this page to platform_owner; the API
// re-checks with requirePlatformOwner().
export default async function PlatformStudioImagesPage() {
  const tenants = await loadPlatformStudio().catch((error) => {
    console.error('[platform/studio-images] load failed', (error as { code?: string })?.code ?? '');
    return null;
  });
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <AdminPageHeader
        title="Studio images"
        description="Activer le Studio par boutique, régler ses quotas mensuels et suivre la consommation du mois."
        meta={tenants ? `${tenants.filter((tenant) => tenant.enabled).length} boutique(s) activée(s) sur ${tenants.length}` : undefined}
      />
      {tenants ? <StudioImagesPlatformClient initialTenants={tenants} /> : <ErrorState title="Studio images indisponible." description="Vérifiez que la migration 183 est appliquée, puis réessayez." />}
    </div>
  );
}
