import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import ProspectsClient from './ProspectsClient';
export const dynamic = 'force-dynamic';
export default async function ProspectsPage() {
  if (await requirePlatformOwner()) redirect('/admin');
  // ProspectsClient reads its filters from the URL (useSearchParams).
  return <Suspense fallback={<p className="text-sm text-gray-500">Chargement…</p>}><ProspectsClient /></Suspense>;
}
