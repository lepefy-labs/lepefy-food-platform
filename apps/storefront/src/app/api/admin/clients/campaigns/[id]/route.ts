import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'); const denied = await requireAdmin(tenant.id); if (denied) return denied;
  const db = createServiceClient();
  const [campaign, recipients, events] = await Promise.all([
    db.from('marketing_campaigns').select('*,customer_segments(name)').eq('tenant_id', tenant.id).eq('id', params.id).maybeSingle(),
    db.from('marketing_campaign_recipients').select('*').eq('tenant_id', tenant.id).eq('campaign_id', params.id).order('created_at', { ascending: false }),
    db.from('marketing_campaign_events').select('*').eq('tenant_id', tenant.id).eq('campaign_id', params.id).order('occurred_at', { ascending: false }).limit(200),
  ]);
  if (!campaign.data) return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  return NextResponse.json({ campaign: campaign.data, recipients: recipients.data ?? [], events: events.data ?? [] });
}
