import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import ProspectsClient from './ProspectsClient';
export const dynamic = 'force-dynamic';
export default async function ProspectsPage() {
  if (await requirePlatformOwner()) redirect('/admin');
  return <ProspectsClient />;
}
