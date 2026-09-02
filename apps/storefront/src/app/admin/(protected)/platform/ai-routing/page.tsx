import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { redirect } from 'next/navigation';
import AiRoutingClient from './AiRoutingClient';

export const dynamic = 'force-dynamic';
export default async function AiRoutingPage() {
  if (await requirePlatformOwner()) redirect('/admin');
  return <AiRoutingClient />;
}
