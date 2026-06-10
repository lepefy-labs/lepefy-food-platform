import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import type { OrderStatus } from '@lepefy/types';

interface PatchBody {
  status:           OrderStatus;
  tracking_carrier: string | null;
  tracking_code:    string | null;
  notes:            string | null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body: PatchBody = await req.json();
    const { status, tracking_carrier, tracking_code, notes } = body;

    const validStatuses: OrderStatus[] = ['preparing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Statut invalide.' }, { status: 400 });
    }

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant     = await getTenant(tenantSlug);
    const supabase   = createServiceClient();

    // Fetch current order to verify it belongs to this tenant
    const { data: existing } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
    }

    const update: Record<string, unknown> = {
      status,
      tracking_carrier,
      tracking_code,
      notes,
    };

    // Set shipped_at automatically when status changes to 'shipped'
    if (status === 'shipped' && existing.status !== 'shipped') {
      update.shipped_at = new Date().toISOString();
    }
    // Clear shipped_at if status moves away from shipped
    if (status !== 'shipped' && existing.status === 'shipped') {
      update.shipped_at = null;
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

    console.info('[admin/orders PATCH] updated — order_id:', params.id, '— status:', status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[admin/orders PATCH] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
}
