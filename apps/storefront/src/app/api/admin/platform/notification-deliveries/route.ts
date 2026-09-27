import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'processing', 'accepted', 'failed', 'dead'] as const;

/**
 * Latest notification deliveries of the deployment tenant, platform owner only:
 * transport, provider message ids and raw errors are support data and are
 * never exposed to tenants. Payloads are never returned.
 */
export async function GET(req: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const params = req.nextUrl.searchParams;
  const status = params.get('status');
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = params.get('from');
  const to = params.get('to');
  const limit = Math.min(Math.max(Number(params.get('limit')) || 100, 1), 500);
  const load = (columns: string) => {
    let query = createServiceClient().from('notification_deliveries').select(columns)
      .eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(limit);
    if (status && (STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);
    // Calendar days in Europe/Rome would need a timezone-aware bound; UTC days are close enough for support.
    if (from && day.test(from)) query = query.gte('created_at', `${from}T00:00:00Z`);
    if (to && day.test(to)) query = query.lt('created_at', new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString());
    return query;
  };
  const base = 'id, notification_type, subject, recipients, status, attempts, max_attempts, next_attempt_at, last_error, created_at, accepted_at, retryable:payload';
  let { data, error } = await load(`${base}, transport, provider_message_id`);
  // Migration 137 not applied yet: same history without transport metadata.
  if (error?.code === '42703') ({ data, error } = await load(base));
  if (error) {
    // Migration 136 not applied yet: the history is simply unavailable.
    if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ available: false, deliveries: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { retryable: unknown }>;
  const deliveries = rows.map(({ retryable, ...row }) => ({ ...row, retryable: retryable != null }));
  return NextResponse.json({ available: true, deliveries });
}
