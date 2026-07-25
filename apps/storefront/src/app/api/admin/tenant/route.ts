import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

const EDITABLE_TENANT_FIELDS = [
  'tagline',
  'whatsapp_number',
  'click_collect_address',
  'click_collect_hours',
  'click_collect_hours_it',
  'legal_name',
  'legal_address',
  'legal_email',
] as const;

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const body   = await req.json() as Record<string, unknown>;

  const updatePayload = EDITABLE_TENANT_FIELDS.reduce<Record<string, unknown>>((acc, field) => {
    if (field in body) {
      const raw = body[field];
      acc[field] = typeof raw === 'string' ? raw.trim() || null : null;
    }
    return acc;
  }, {});

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('tenants')
    .update(updatePayload)
    .eq('id', tenant.id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
