import { supportTenants } from '@/lib/support/server/platformService';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import ManualTicketForm from './ManualTicketForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Platform-owner access: app/admin/(protected)/platform/layout.tsx + supportPlatformApi.
export default async function PlatformAssistanceNewPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const tenants = await supportTenants().catch(() => []);
  const preselected = typeof searchParams.tenant === 'string' ? searchParams.tenant : null;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <AdminPageHeader
        title="Saisir une demande reçue ailleurs"
        description="WhatsApp, téléphone, e-mail : gardez l’historique au même endroit. Le message est enregistré comme transmis par Lepefy, jamais comme écrit par la boutique."
        breadcrumb={[{ label: 'Assistance tenants', href: '/admin/platform/assistance' }, { label: 'Nouvelle demande' }]}
      />
      <ManualTicketForm tenants={tenants} preselectedTenant={tenants.some((tenant) => tenant.id === preselected) ? preselected : null} />
    </div>
  );
}
