import { Suspense } from 'react';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import CardPaymentsClient from './CardPaymentsClient';

export const dynamic = 'force-dynamic';

// Access (orders.view) is enforced by the protected layout (adminRoutePermissions)
// and by the API; orders.manage only unlocks "Renvoyer la confirmation".
// Filters (period, dates, status, search, page) live in the query string.
export default async function CardPaymentsPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const access = await getCurrentAdminAccessContext(tenant.id);
  const canResend = access ? canAdmin(access, 'orders.manage') : false;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <AdminPageHeader
        title="Paiements carte"
        description="Paiements à montant libre effectués depuis la carte digitale (/card). La référence CP-… est celle affichée au client et dans son email."
      />
      <Suspense fallback={<p className="p-6 text-sm text-gray-500">Chargement…</p>}>
        <CardPaymentsClient canResend={canResend} />
      </Suspense>
    </div>
  );
}
