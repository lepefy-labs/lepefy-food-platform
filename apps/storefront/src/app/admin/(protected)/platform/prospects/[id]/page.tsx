import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import ProspectDetail from '../ProspectDetail';
export const dynamic = 'force-dynamic';
export default async function ProspectPage({params}:{params:{id:string}}) {
  if (await requirePlatformOwner()) redirect('/admin');
  return <ProspectDetail id={params.id} />;
}
