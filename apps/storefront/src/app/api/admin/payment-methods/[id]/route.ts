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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(slug);
    const body   = await req.json() as Record<string, unknown>;

    const supabase = createServiceClient();

    const updatePayload: Record<string, unknown> = {};

    const method = 'method' in body && VALID_METHODS.includes(body.method as PaymentMethodType)
      ? (body.method as PaymentMethodType)
      : undefined;

    if (method !== undefined) updatePayload.method = method;
    if ('label'      in body) updatePayload.label      = body.label ? String(body.label).trim() : null;
    if ('value'      in body) updatePayload.value      = (method ?? body.method) === 'cash' ? null : (body.value ? String(body.value).trim() : null);
    if ('extra'      in body) updatePayload.extra      = (method ?? body.method) === 'bank_transfer' ? cleanExtra(body.extra) : null;
    if ('sort_order' in body) updatePayload.sort_order = parseInt(String(body.sort_order), 10) || 0;
    if ('active'     in body) updatePayload.active     = Boolean(body.active);

    const { error } = await supabase
      .from('tenant_payment_methods')
      .update(updatePayload)
      .eq('id', params.id)
      .eq('tenant_id', tenant.id);

    if (error) {
      // DEBUG TEMPORAIRE — voir note de retrait en fin de réponse.
      console.error('[payment-methods][PATCH] supabase error:', error);
      return NextResponse.json({
        error: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    // DEBUG TEMPORAIRE — voir note de retrait en fin de réponse.
    console.error('[payment-methods][PATCH] error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, raw: err }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('tenant_payment_methods')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
