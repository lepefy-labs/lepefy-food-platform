import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { FEEDBACK_CATEGORIES, FEEDBACK_PRIORITIES, FEEDBACK_REACTIONS, FEEDBACK_STATUSES } from '@/lib/feedback/contracts';

export const dynamic = 'force-dynamic';

function allowed(value: string | null, values: readonly string[]) {
  return value && values.includes(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const pageSize = 25;
  const from = (page - 1) * pageSize;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;

  let query = service
    .from('tester_feedback_entries')
    .select('id, tenant_id, campaign_id, message, reaction, category, status, priority, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);
  const tenantId = params.get('tenant');
  const campaignId = params.get('campaign');
  if (tenantId) query = query.eq('tenant_id', tenantId);
  if (campaignId) query = query.eq('campaign_id', campaignId);
  const status = allowed(params.get('status'), FEEDBACK_STATUSES);
  const priority = allowed(params.get('priority'), FEEDBACK_PRIORITIES);
  const reaction = allowed(params.get('reaction'), FEEDBACK_REACTIONS);
  const category = allowed(params.get('category'), FEEDBACK_CATEGORIES);
  if (status) query = query.eq('status', status);
  if (priority) query = query.eq('priority', priority);
  if (reaction) query = query.eq('reaction', reaction);
  if (category) query = query.eq('category', category);

  const [entriesResult, totalResult, newResult, blockingResult, activeCampaignsResult] = await Promise.all([
    query,
    service.from('tester_feedback_entries').select('id', { count: 'exact', head: true }),
    service.from('tester_feedback_entries').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    service.from('tester_feedback_entries').select('id', { count: 'exact', head: true }).eq('priority', 'blocking'),
    service.from('tester_feedback_campaigns').select('tenant_id', { count: 'exact' }).eq('active', true),
  ]);
  if (entriesResult.error) return NextResponse.json({ error: 'Feedback indisponibles.' }, { status: 503 });

  const entries = entriesResult.data ?? [];
  const tenantIds = [...new Set(entries.map((item: { tenant_id: string }) => item.tenant_id))];
  const campaignIds = [...new Set(entries.map((item: { campaign_id: string }) => item.campaign_id))];
  const [tenantsResult, campaignsResult] = await Promise.all([
    tenantIds.length ? service.from('tenants').select('id, name').in('id', tenantIds) : Promise.resolve({ data: [] }),
    campaignIds.length ? service.from('tester_feedback_campaigns').select('id, name, version_label').in('id', campaignIds) : Promise.resolve({ data: [] }),
  ]);
  const tenants = new Map((tenantsResult.data ?? []).map((item: { id: string; name: string }) => [item.id, item.name]));
  const campaigns = new Map((campaignsResult.data ?? []).map((item: { id: string; name: string; version_label: string | null }) => [item.id, item]));

  return NextResponse.json({
    entries: entries.map((entry: { tenant_id: string; campaign_id: string }) => ({
      ...entry,
      tenant_name: tenants.get(entry.tenant_id) ?? 'Tenant',
      campaign: campaigns.get(entry.campaign_id) ?? null,
    })),
    pagination: { page, pageSize, total: entriesResult.count ?? 0 },
    kpis: {
      total: totalResult.count ?? 0,
      new: newResult.count ?? 0,
      blocking: blockingResult.count ?? 0,
      activeCampaigns: activeCampaignsResult.count ?? 0,
      activeTenants: new Set((activeCampaignsResult.data ?? []).map((item: { tenant_id: string }) => item.tenant_id)).size,
    },
  });
}
