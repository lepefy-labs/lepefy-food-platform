import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { PaymentMethodType } from '@lepefy/types';

export const runtime = 'nodejs';

const VALID_METHODS: PaymentMethodType[] = ['satispay', 'bank_transfer', 'cash', 'paypal', 'other'];

function cleanExtra(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
    .map(([k, v]) => [k, String(v).trim()] as const);
  return entries.length ? Object.fromEntries(entries) : null;
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);
  const body     = await req.json();
  const supabase = createServiceClient();

  const method = VALID_METHODS.includes(body.method) ? body.method : 'other';

  const { data, error } = await supabase
    .from('tenant_payment_methods')
    .insert({
      tenant_id:  tenant.id,
      method,
      label:      body.label ? String(body.label).trim() : null,
      value:      method === 'cash' ? null : (body.value ? String(body.value).trim() : null),
      extra:      method === 'bank_transfer' ? cleanExtra(body.extra) : null,
      sort_order: parseInt(body.sort_order, 10) || 0,
      active:     Boolean(body.active),
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
