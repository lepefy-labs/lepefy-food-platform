import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import ItemClient from './ItemClient';

export const dynamic = 'force-dynamic';

export default async function ExternalCatalogItemPage({ params }: { params: { sourceId: string; itemId: string } }) {
  if (await requirePlatformOwner()) redirect('/admin');
  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <ItemClient sourceId={params.sourceId} itemId={params.itemId} />
    </div>
  );
}
