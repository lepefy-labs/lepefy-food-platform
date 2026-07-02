import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { OrderStatus, PaymentStatus } from '@lepefy/types';

interface PatchBody {
  status?:           OrderStatus;
  tracking_carrier?: string | null;
  tracking_code?:    string | null;
  notes?:            string | null;
  payment_status?:   PaymentStatus;
}

interface ExistingOrder {
  id:        string;
  status:    string;
  email:     string;
  full_name: string | null;
}

function generateTrackingToken(orderId: string, email: string): string {
  return crypto
    .createHmac('sha256', process.env.TRACKING_SECRET!)
    .update(orderId + email)
    .digest('hex');
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const body: PatchBody = await req.json();
    const { status, tracking_carrier, tracking_code, notes, payment_status } = body;

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant     = await getTenant(tenantSlug);
    const supabase   = createServiceClient();

    const { data: existingRaw, error: fetchError } = await supabase
      .from('orders')
      .select('id, status, email, full_name')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .single();

    if (fetchError || !existingRaw) {
      return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
    }

    const existing = existingRaw as unknown as ExistingOrder;

    // ── Build update payload ──────────────────────────────────────────────
    const update: Record<string, unknown> = {};

    if (status !== undefined) {
      const validStatuses: OrderStatus[] = [
        'new', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled',
      ];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Statut invalide.' }, { status: 400 });
      }
      update.status = status;

      if (status === 'shipped' && existing.status !== 'shipped') {
        update.shipped_at = new Date().toISOString();
      }
      if (status !== 'shipped' && existing.status === 'shipped') {
        update.shipped_at = null;
      }
    }

    if (tracking_carrier !== undefined) update.tracking_carrier = tracking_carrier;
    if (tracking_code    !== undefined) update.tracking_code    = tracking_code;
    if (notes            !== undefined) update.notes            = notes;

    if (payment_status !== undefined) {
      const validPaymentStatuses: PaymentStatus[] = ['pending', 'paid', 'failed', 'refunded'];
      if (!validPaymentStatuses.includes(payment_status)) {
        return NextResponse.json({ error: 'Statut de paiement invalide.' }, { status: 400 });
      }
      update.payment_status = payment_status;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Aucun champ à mettre à jour.' }, { status: 400 });
    }

    // ── Persist ───────────────────────────────────────────────────────────
    const { error: updateError } = await supabase
      .from('orders')
      .update(update)
      .eq('id', params.id)
      .eq('tenant_id', tenant.id);

    if (updateError) {
      console.error('[admin/orders PATCH] update error:', updateError,
        '— order_id:', params.id);
      return NextResponse.json({ error: 'Erreur lors de la mise à jour.' }, { status: 500 });
    }

    console.info('[admin/orders PATCH] updated — order_id:', params.id,
      '— fields:', Object.keys(update).join(', '));

    // ── Notify n8n when transitioning to shipped ──────────────────────────
    const transitioningToShipped =
      status === 'shipped' && existing.status !== 'shipped';

    if (transitioningToShipped && process.env.N8N_WEBHOOK_URL && process.env.TRACKING_SECRET) {
      try {
        // Token is deterministic — recompute from orderId + email, no DB column needed
        const trackingToken     = generateTrackingToken(params.id, existing.email);
        const storefrontUrl     = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
        const orderTrackingLink = `${storefrontUrl}/orders/${params.id}?token=${trackingToken}`;

        const n8nPayload = {
          orderId:          params.id,
          email:            existing.email,
          fullName:         existing.full_name ?? '',
          trackingCode:     tracking_code    ?? null,
          trackingCarrier:  tracking_carrier ?? null,
          orderTrackingLink,
        };

        console.info('[admin/orders PATCH] notifying n8n order-shipped — order_id:', params.id);

        const n8nRes = await fetch(
          `${process.env.N8N_WEBHOOK_URL}/webhook/order-shipped`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(n8nPayload),
          },
        );

        console.info('[admin/orders PATCH] n8n response:', n8nRes.status,
          '— order_id:', params.id);
      } catch (n8nErr) {
        console.error('[admin/orders PATCH] n8n notification failed:', n8nErr,
          '— order_id:', params.id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[admin/orders PATCH] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
}
