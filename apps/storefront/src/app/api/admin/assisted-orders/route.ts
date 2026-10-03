import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import type { CheckoutSessionStatus } from '@lepefy/types';
import { MANUAL_PAYMENT_METHOD_LABELS } from '@lepefy/types';
import {
  cleanOptionalText, computePreorderTotals, draftExpiryFromNow, isManualPaymentMethod, payLinkExpiryFromNow, preorderReference,
} from '@/lib/orders/assisted/assistedOrderPolicy';
import { issuePayLinkFields, payUrlFor, type AssistedSessionRow } from '@/lib/orders/assisted/assistedOrderServer';
import { parseAssistedContent, parseRequestKey, sessionContentColumns } from '@/lib/orders/assisted/assistedOrderRequest';
import { recordAssistedOrderEvent } from '@/lib/orders/assisted/assistedOrderEvents';
import { loadPreorderQueue } from '@/lib/orders/assisted/loadPreorderQueue';
import { parsePreorderView } from '@/lib/orders/assisted/preorderQueue';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const PAGE_SIZE = 30;

/**
 * Work queue des précommandes (checkout_sessions assistées uniquement) :
 * `view` (to_treat par défaut, waiting, completed, cancelled, all), `q`, `page`.
 * Classement, compteurs et pagination : lib/orders/assisted/loadPreorderQueue.ts.
 */
export async function GET(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const now = new Date();
  const params = req.nextUrl.searchParams;
  const view = parsePreorderView(params.get('view') ?? params.get('status'));
  const q = (params.get('q') ?? '').trim().replace(/[^a-zA-Z0-9À-ÿ@._+\- ]/g, '').slice(0, 60);
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);

  // Expiration paresseuse des liens échus avant lecture (aucun cron requis).
  await supabase.from('checkout_sessions').update({ status: 'expired', updated_at: now.toISOString() })
    .eq('tenant_id', tenant.id).eq('origin', 'assisted').eq('status', 'open').lte('expires_at', now.toISOString());

  try {
    const result = await loadPreorderQueue(supabase, tenant.id, { view, q, page, pageSize: PAGE_SIZE, now });
    return NextResponse.json({ ...result, view, q });
  } catch (error) {
    console.error('[admin/assisted-orders] list failed:', error);
    return NextResponse.json({ error: 'Impossible de charger les précommandes.' }, { status: 500 });
  }
}

/**
 * Création d'une précommande : `draft` (brouillon), `to_pay` (lien de paiement)
 * ou `to_verify` (paiement externe déclaré, à vérifier). Aucune commande n'est
 * créée ici. Idempotent via `requestKey` (double clic / retry réseau).
 */
export async function POST(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body)) return NextResponse.json({ error: 'Corps invalide.' }, { status: 400 });

  const mode = body.mode;
  if (mode !== 'draft' && mode !== 'to_pay' && mode !== 'to_verify') {
    return NextResponse.json({ error: 'Parcours invalide.' }, { status: 400 });
  }
  const requestKey = parseRequestKey(body.requestKey);
  if (!requestKey) return NextResponse.json({ error: 'Clé de requête manquante.' }, { status: 400 });

  const declared = (body.declaredPayment && typeof body.declaredPayment === 'object' ? body.declaredPayment : {}) as Record<string, unknown>;
  if (mode === 'to_verify' && !isManualPaymentMethod(declared.method)) {
    return NextResponse.json({ error: 'Indiquez le moyen de paiement déclaré par le client.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const admin = await getCurrentAdminAccessContext(tenant.id);

  const existing = await supabase.from('checkout_sessions').select('id, status')
    .eq('tenant_id', tenant.id).eq('request_key', requestKey).maybeSingle();
  if (existing.data) {
    return NextResponse.json({ id: existing.data.id, status: existing.data.status, reference: preorderReference(existing.data.id), replayed: true });
  }

  const parsed = await parseAssistedContent(supabase, tenant, body, { allowPendingShipping: mode === 'draft' });
  if (parsed.ok === false) return NextResponse.json(parsed.body, { status: parsed.status });

  const now = new Date();
  const id = crypto.randomUUID();
  const link = mode === 'to_pay' ? issuePayLinkFields(id, 0) : null;
  if (mode === 'to_pay' && !link) {
    return NextResponse.json({ error: 'Lien de paiement indisponible : configuration serveur manquante.' }, { status: 500 });
  }
  const declaredMethod = mode === 'to_verify' && isManualPaymentMethod(declared.method) ? declared.method : null;

  const row = {
    id,
    tenant_id: tenant.id,
    ...sessionContentColumns(parsed.content),
    origin: 'assisted',
    created_by_admin_id: admin?.userId ?? null,
    request_key: requestKey,
    notify_customer: true,
    status: mode === 'draft' ? 'draft' : mode === 'to_pay' ? 'open' : 'awaiting_verification',
    payment_method: declaredMethod ? 'external_link' : 'stripe',
    external_payment_type: declaredMethod,
    external_payment_label: declaredMethod ? MANUAL_PAYMENT_METHOD_LABELS[declaredMethod] : null,
    declared_payment_at: declaredMethod ? now.toISOString() : null,
    declared_payment_reference: declaredMethod ? cleanOptionalText(declared.reference, 120) : null,
    expires_at: mode === 'draft' ? draftExpiryFromNow(now) : payLinkExpiryFromNow(now),
    last_activity_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...(link?.fields ?? {}),
  };

  const { error: insertError } = await supabase.from('checkout_sessions').insert(row);
  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') {
      const winner = await supabase.from('checkout_sessions').select('id, status')
        .eq('tenant_id', tenant.id).eq('request_key', requestKey).maybeSingle();
      if (winner.data) {
        return NextResponse.json({ id: winner.data.id, status: winner.data.status, reference: preorderReference(winner.data.id), replayed: true });
      }
    }
    console.error('[admin/assisted-orders] insert failed:', insertError);
    return NextResponse.json({ error: 'Impossible d\'enregistrer la précommande.' }, { status: 500 });
  }

  await recordAssistedOrderEvent(supabase, {
    tenantId: tenant.id, checkoutSessionId: id, eventType: 'created', actorType: 'admin', actorAdminId: admin?.userId ?? null,
    detail: { mode, sales_channel: parsed.content.salesChannel, total: parsed.content.cart.total },
  });
  if (link) {
    await recordAssistedOrderEvent(supabase, {
      tenantId: tenant.id, checkoutSessionId: id, eventType: 'link_issued', actorType: 'admin', actorAdminId: admin?.userId ?? null,
      detail: { version: 1, expires_at: row.expires_at },
    });
  }
  if (declaredMethod) {
    await recordAssistedOrderEvent(supabase, {
      tenantId: tenant.id, checkoutSessionId: id, eventType: 'payment_declared', actorType: 'admin', actorAdminId: admin?.userId ?? null,
      detail: { method: declaredMethod },
    });
  }

  revalidatePath('/admin');
  return NextResponse.json({
    id,
    status: row.status,
    reference: preorderReference(id),
    total: parsed.content.cart.total,
    payUrl: link ? payUrlFor(tenant, link.token) : null,
  }, { status: 201 });
}
