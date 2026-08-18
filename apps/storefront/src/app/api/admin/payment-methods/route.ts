import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { PaymentMethodType, PaymentModule } from '@lepefy/types';

export const runtime = 'nodejs';

const VALID_METHODS: PaymentMethodType[] = ['satispay', 'bank_transfer', 'cash', 'paypal', 'other', 'card'];
const VALID_MODULES: PaymentModule[] = ['shop', 'card', 'event', 'rental'];

// Même vérification que le constraint DB
// (enabled_modules <@ {...} and array_length(...) > 0) — non vide, valeurs
// toutes dans l'ensemble autorisé.
function isValidEnabledModules(value: unknown): value is PaymentModule[] {
  return Array.isArray(value) && value.length > 0
    && value.every((m) => VALID_MODULES.includes(m as PaymentModule));
}

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

export async function POST(req: NextRequest) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  try {
    const body     = await req.json();
    const supabase = createServiceClient();

    const method = VALID_METHODS.includes(body.method) ? body.method : 'other';

    // Rétro-compatibilité : absent → on ne le précise pas dans l'insert, le
    // DEFAULT de la colonne (tous les 4 modules) s'applique. Présent mais
    // invalide → 400, même contrainte que le constraint DB.
    if ('enabled_modules' in body && !isValidEnabledModules(body.enabled_modules)) {
      return NextResponse.json(
        { error: 'enabled_modules doit être un tableau non vide parmi shop, card, event, rental.' },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('tenant_payment_methods')
      .insert({
        tenant_id:  tenant.id,
        method,
        label:      body.label ? String(body.label).trim() : null,
        value:      hasNoValueFields(method) ? null : (body.value ? String(body.value).trim() : null),
        extra:      hasNoValueFields(method) ? null : cleanExtra(body.extra),
        sort_order: parseInt(body.sort_order, 10) || 0,
        active:     Boolean(body.active),
        ...('enabled_modules' in body ? { enabled_modules: body.enabled_modules } : {}),
      })
      .select('*')
      .single();

    if (error) {
      // DEBUG TEMPORAIRE — voir note de retrait en fin de réponse.
      console.error('[payment-methods][POST] supabase error:', error);
      return NextResponse.json({
        error: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    // DEBUG TEMPORAIRE — voir note de retrait en fin de réponse.
    console.error('[payment-methods][POST] error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, raw: err }, { status: 500 });
  }
}
