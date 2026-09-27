import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'processing', 'accepted', 'failed', 'dead'] as const;

/** Latest notification deliveries of the tenant (payloads are never exposed). */
export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get('status');
  let query = createServiceClient().from('notification_deliveries')
    .select('id, notification_type, subject, recipients, status, attempts, max_attempts, next_attempt_at, last_error, created_at, accepted_at, retryable:payload')
    .eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(50);
  if (status && (STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) {
    // Migration 136 not applied yet: the history is simply unavailable.
    if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ available: false, deliveries: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const deliveries = (data ?? []).map(({ retryable, ...row }) => ({ ...row, retryable: retryable != null }));
  return NextResponse.json({ available: true, deliveries });
}
