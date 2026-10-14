import { notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { canAdmin,getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { isUuid,loadCampaign } from '@/lib/catalog/campaigns';
import CampaignEditor from '../CampaignEditor';

export const dynamic = 'force-dynamic';
export default async function CampaignDetailPage({ params,searchParams }:{ params:{ id:string };searchParams:Record<string,string|undefined> }) {
  if (!isUuid(params.id)) notFound();
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const [data,access] = await Promise.all([
    loadCampaign(createServiceClient(),tenant.id,params.id),getCurrentAdminAccessContext(tenant.id),
  ]);
  if (!data) notFound();
  return <CampaignEditor initial={data} canManage={Boolean(access && canAdmin(access,'catalog.manage'))}
    currency={tenant.currency} initialStep={Number(searchParams.step) || undefined} />;
}
