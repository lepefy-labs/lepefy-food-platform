import { NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { loadPlatformSubscriptions } from '@/lib/billing/platformSubscriptions';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** Platform console: every tenant's subscription lifecycle (platform_owner only). */
export async function GET() {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  try {
    return NextResponse.json(await loadPlatformSubscriptions(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[platform/subscriptions] list failed:', error);
    return NextResponse.json({ error: 'Abonnements indisponibles.' }, { status: 500 });
  }
}
