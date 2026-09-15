import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'); const denied = await requireAdmin(tenant.id); if (denied) return denied;
  const access = await getCurrentAdminAccessContext(tenant.id); if (!access) return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  const parsed = z.object({ name: z.string().trim().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Tag invalide.' }, { status: 400 });
  const db = createServiceClient();
  let { data: tag } = await db.from('customer_tags').select('id').eq('tenant_id', tenant.id).ilike('name', parsed.data.name).maybeSingle();
  if (!tag) {
    const inserted = await db.from('customer_tags').insert({ tenant_id: tenant.id, name: parsed.data.name, color: parsed.data.color ?? null }).select('id').single();
    if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 });
    tag = inserted.data;
  }
  const { error } = await db.from('customer_tag_assignments').upsert({ tenant_id: tenant.id, customer_id: params.id, tag_id: tag.id, created_by: access.userId }, { onConflict: 'customer_id,tag_id', ignoreDuplicates: true });
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ tagId: tag.id }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'); const denied = await requireAdmin(tenant.id); if (denied) return denied;
  const tagId = req.nextUrl.searchParams.get('tagId'); if (!tagId) return NextResponse.json({ error: 'Tag requis.' }, { status: 400 });
  const { error } = await createServiceClient().from('customer_tag_assignments').delete().eq('tenant_id', tenant.id).eq('customer_id', params.id).eq('tag_id', tagId);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ deleted: true });
}
