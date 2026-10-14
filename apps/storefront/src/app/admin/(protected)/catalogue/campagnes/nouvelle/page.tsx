import { redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { canAdmin,getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import CampaignEditor from '../CampaignEditor';

export default async function NewCampaignPage({ searchParams }:{ searchParams:Record<string,string|undefined> }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access || !canAdmin(access,'catalog.manage')) redirect('/admin/catalogue/campagnes');
  const ids = (searchParams.products ?? '').split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0,100);
  return <CampaignEditor initial={null} canManage currency={tenant.currency} preselectedIds={ids} />;
}
