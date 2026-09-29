import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import CardPaymentsClient from './CardPaymentsClient';

export const dynamic = 'force-dynamic';

// Access (orders.view) is enforced by the protected layout (adminRoutePermissions)
// and by the API; orders.manage only unlocks "Renvoyer la confirmation".
export default async function CardPaymentsPage({ searchParams }: { searchParams: { q?: string } }) {
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
      <CardPaymentsClient initialQuery={typeof searchParams.q === 'string' ? searchParams.q.slice(0, 60) : ''} canResend={canResend} />
    </div>
  );
}
