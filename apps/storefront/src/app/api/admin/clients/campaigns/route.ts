import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';

async function context() { const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'); return { tenant, denied: await requireAdmin(tenant.id) }; }
export async function GET() {
  const { tenant, denied } = await context(); if (denied) return denied;
  const { data, error } = await createServiceClient().from('marketing_campaigns').select('*, customer_segments(name), marketing_campaign_recipients(status,conversion_revenue)').eq('tenant_id', tenant.id).order('created_at', { ascending: false });
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ campaigns: data ?? [] });
}
export async function POST(req: NextRequest) {
  const { tenant, denied } = await context(); if (denied) return denied;
  const access = await getCurrentAdminAccessContext(tenant.id); if (!access) return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  const parsed = z.object({ name: z.string().trim().min(1).max(120), channel: z.enum(['email','sms','whatsapp','push']), segmentId: z.string().uuid().nullable().optional(), subject: z.string().trim().max(180).nullable().optional(), content: z.string().max(20000) }).safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Campagne invalide.' }, { status: 400 });
  if (parsed.data.channel !== 'email') return NextResponse.json({ error: 'Seul le canal e-mail est configuré actuellement.' }, { status: 400 });
  const { data, error } = await createServiceClient().from('marketing_campaigns').insert({ tenant_id: tenant.id, name: parsed.data.name, channel: parsed.data.channel, segment_id: parsed.data.segmentId ?? null, subject: parsed.data.subject ?? null, content: parsed.data.content, created_by: access.userId }).select('*').single();
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json(data, { status: 201 });
}
