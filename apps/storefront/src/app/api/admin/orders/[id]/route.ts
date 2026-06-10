import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import type { OrderStatus, PaymentStatus } from '@lepefy/types';

interface PatchBody {
  status?:           OrderStatus;
  tracking_carrier?: string | null;
  tracking_code?:    string | null;
  notes?:            string | null;
  payment_status?:   PaymentStatus;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body: PatchBody = await req.json();
    const { status, tracking_carrier, tracking_code, notes, payment_status } = body;

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant     = await getTenant(tenantSlug);
    const supabase   = createServiceClient();

    // Verify the order belongs to this tenant
    const { data: existing } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
    }

    const update: Record<string, unknown> = {};

    if (status !== undefined) {
      const validStatuses: OrderStatus[] = [
        'new', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled',
      ];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Statut invalide.' }, { status: 400 });
      }
      update.status = status;

      // shipped_at: set when transitioning to shipped, clear when leaving shipped
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

    const { error } = await supabase
      .from('orders')
      .update(update)
      .eq('id', params.id)
      .eq('tenant_id', tenant.id);

    if (error) {
      console.error('[admin/orders PATCH] update error:', error, '— order_id:', params.id);
      return NextResponse.json({ error: 'Erreur lors de la mise à jour.' }, { status: 500 });
    }

    console.info('[admin/orders PATCH] updated — order_id:', params.id, '— fields:', Object.keys(update).join(', '));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[admin/orders PATCH] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
}
