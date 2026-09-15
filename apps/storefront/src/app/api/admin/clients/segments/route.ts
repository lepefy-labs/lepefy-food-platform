import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { SYSTEM_SEGMENTS, getCustomers, validateSegmentDefinition, applyCustomSegment } from '@/lib/admin/crm';

async function context() { const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'); return { tenant, denied: await requireAdmin(tenant.id) }; }

export async function GET() {
  const { tenant, denied } = await context(); if (denied) return denied;
  const db = createServiceClient();
  const { data, error } = await db.from('customer_segments').select('*').eq('tenant_id', tenant.id).eq('active', true).eq('kind', 'custom').order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const system = await Promise.all(SYSTEM_SEGMENTS.map(async (segment) => ({ ...segment, kind: 'system', count: (await getCustomers(tenant.id, { segment: segment.key, pageSize: 1 })).count })));
  const custom = await Promise.all((data ?? []).map(async (segment) => ({ ...segment, count: (await applyCustomSegment(tenant.id, validateSegmentDefinition(segment.definition_json), 1)).count })));
  return NextResponse.json({ segments: [...system, ...custom] });
}

export async function POST(req: NextRequest) {
  const { tenant, denied } = await context(); if (denied) return denied;
  const parsed = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).nullable().optional(), definition: z.unknown() }).safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Segment invalide.' }, { status: 400 });
  try {
    const definition = validateSegmentDefinition(parsed.data.definition);
    const { data, error } = await createServiceClient().from('customer_segments').insert({ tenant_id: tenant.id, name: parsed.data.name, description: parsed.data.description ?? null, kind: 'custom', definition_json: definition }).select('*').single();
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json(data, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Définition invalide.' }, { status: 400 }); }
}
