import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import SourceClient from './SourceClient';

export const dynamic = 'force-dynamic';

export default async function ExternalCatalogSourcePage({ params }: { params: { sourceId: string } }) {
  if (await requirePlatformOwner()) redirect('/admin');
  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <SourceClient sourceId={params.sourceId} />
    </div>
  );
}
