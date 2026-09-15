import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id); if (denied) return denied;
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access) return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  const parsed = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Note invalide.' }, { status: 400 });
  const { data, error } = await createServiceClient().from('customer_notes').insert({ tenant_id: tenant.id, customer_id: params.id, author_admin_id: access.userId, body: parsed.data.body }).select('*').single();
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json(data, { status: 201 });
}
