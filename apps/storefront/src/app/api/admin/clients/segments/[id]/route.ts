import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { validateSegmentDefinition } from '@/lib/admin/crm';

async function context() { const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'); return { tenant, denied: await requireAdmin(tenant.id) }; }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { tenant, denied } = await context(); if (denied) return denied;
  const parsed = z.object({ name: z.string().trim().min(1).max(100).optional(), description: z.string().trim().max(500).nullable().optional(), definition: z.unknown().optional(), active: z.boolean().optional() }).safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Segment invalide.' }, { status: 400 });
  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if (parsed.data.definition !== undefined) patch.definition_json = validateSegmentDefinition(parsed.data.definition);
  delete patch.definition;
  const { data, error } = await createServiceClient().from('customer_segments').update(patch).eq('tenant_id', tenant.id).eq('id', params.id).eq('kind', 'custom').select('*').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return data ? NextResponse.json(data) : NextResponse.json({ error: 'Les segments système ne sont pas modifiables.' }, { status: 409 });
}
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { tenant, denied } = await context(); if (denied) return denied;
  const { data, error } = await createServiceClient().from('customer_segments').delete().eq('tenant_id', tenant.id).eq('id', params.id).eq('kind', 'custom').select('id').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return data ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: 'Les segments système ne sont pas supprimables.' }, { status: 409 });
}
