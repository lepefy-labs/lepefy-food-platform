import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { PaymentMethodType } from '@lepefy/types';

export const runtime = 'nodejs';

const VALID_METHODS: PaymentMethodType[] = ['satispay', 'bank_transfer', 'cash', 'paypal', 'other', 'card'];

// 'card' est un simple on/off (montant saisi par le client à chaque paiement,
// cf. api/card/quick-pay) — jamais de value/extra à renseigner, même
// traitement que 'cash'.
function hasNoValueFields(method: PaymentMethodType): boolean {
  return method === 'cash' || method === 'card';
}

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
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  try {
    const body   = await req.json() as Record<string, unknown>;

    const supabase = createServiceClient();

    const updatePayload: Record<string, unknown> = {};

    const method = 'method' in body && VALID_METHODS.includes(body.method as PaymentMethodType)
      ? (body.method as PaymentMethodType)
      : undefined;

    if (method !== undefined) updatePayload.method = method;
    if ('label'      in body) updatePayload.label      = body.label ? String(body.label).trim() : null;
    if ('value'      in body) updatePayload.value      = hasNoValueFields((method ?? body.method) as PaymentMethodType) ? null : (body.value ? String(body.value).trim() : null);
    if ('extra'      in body) updatePayload.extra      = hasNoValueFields((method ?? body.method) as PaymentMethodType) ? null : cleanExtra(body.extra);
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
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

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
