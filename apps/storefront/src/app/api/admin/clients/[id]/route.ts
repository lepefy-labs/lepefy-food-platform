import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getCustomerDetail } from '@/lib/admin/crm';
import { normalizeCustomerEmail, normalizeCustomerPhone } from '@/lib/customers/normalizeCustomerIdentity';

const schema = z.object({ fullName: z.string().trim().max(160).nullable().optional(), email: z.string().trim().email().max(254).nullable().optional(), phone: z.string().trim().max(40).nullable().optional() });
async function tenant() { return getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'); }

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const currentTenant = await tenant(); const denied = await requireAdmin(currentTenant.id); if (denied) return denied;
  const detail = await getCustomerDetail(currentTenant.id, params.id);
  return detail ? NextResponse.json(detail) : NextResponse.json({ error: 'Client introuvable.' }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const currentTenant = await tenant(); const denied = await requireAdmin(currentTenant.id); if (denied) return denied;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });
  const patch = {
    ...(parsed.data.fullName !== undefined ? { full_name: parsed.data.fullName || null } : {}),
    ...(parsed.data.email !== undefined ? { email: normalizeCustomerEmail(parsed.data.email), normalized_email: normalizeCustomerEmail(parsed.data.email) } : {}),
    ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null, normalized_phone: normalizeCustomerPhone(parsed.data.phone) } : {}),
  };
  const { error } = await createServiceClient().from('customers').update(patch).eq('tenant_id', currentTenant.id).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === '23505' ? 409 : 500 });
  return NextResponse.json({ updated: true });
}
