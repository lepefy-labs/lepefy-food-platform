import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { loadPlatformSubscriptions } from '@/lib/billing/platformSubscriptions';
import AbonnementsClient from './AbonnementsClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// platform/layout.tsx already restricts this page to platform_owner; the API
// routes re-check with requirePlatformOwner().
export default async function PlatformSubscriptionsPage() {
  const data = await loadPlatformSubscriptions().catch((error) => {
    console.error('[platform/abonnements] load failed', error);
    return null;
  });

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <AdminPageHeader
        title="Abonnements"
        description="Échéances, paiements, suspension automatique ou manuelle et modules de chaque tenant."
        meta={data ? `${data.rows.length} tenant${data.rows.length !== 1 ? 's' : ''}` : undefined}
      />
      {!data ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Abonnements indisponibles. Réessayez.</p>
      ) : (
        <AbonnementsClient initialRows={data.rows} schemaReady={data.schemaReady} />
      )}
    </div>
  );
}
