import { notFound } from 'next/navigation';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStudioPage } from '@/lib/studio/server/access';
import { getStudioAsset } from '@/lib/studio/server/assets';
import { availableDestinations } from '@/lib/studio/server/publish';
import { isUuid } from '@/lib/studio/rules';
import StudioAssetClient from './StudioAssetClient';

export const dynamic = 'force-dynamic';

export default async function StudioAssetPage({ params, searchParams = {} }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const { tenant, access } = await requireStudioPage();
  if (!isUuid(params.id)) notFound();
  const asset = await getStudioAsset(createServiceClient(), tenant.id, params.id, access);
  if (!asset) notFound();
  const pourRaw = Array.isArray(searchParams.pour) ? searchParams.pour[0] : searchParams.pour;
  const pour = pourRaw && /^product:[0-9a-f-]{36}$/i.test(pourRaw) ? { destination: 'product', targetId: pourRaw.slice(8) } : null;
  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={asset.title}
        breadcrumb={[{ label: 'Studio images', href: '/admin/studio' }, { label: asset.title }]}
        compact
      />
      <StudioAssetClient initialAsset={asset} destinations={availableDestinations(access, tenant)} pour={pour} />
    </div>
  );
}
