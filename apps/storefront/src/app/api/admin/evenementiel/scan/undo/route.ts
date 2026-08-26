import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';

const CASHIER_UNDO_WINDOW_MS = 5 * 60 * 1000;

interface VoidRpcRow {
  success: boolean;
  reason: string;
  quantity_remaining: number | null;
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id, ['tenant_admin', 'tenant_cashier']);
  if (denied) return denied;

  if (!tenant.events_enabled) {
    return NextResponse.json({ error: 'Module événementiel non activé.' }, { status: 400 });
  }

  const body = await req.json() as { redemption_id?: string; event_id?: string; reason?: string };
  const redemptionId = body.redemption_id?.trim() ?? '';
  const eventId = body.event_id?.trim() ?? '';
  const reason = body.reason?.trim() ?? '';

  if (!redemptionId || !eventId) {
    return NextResponse.json({ error: 'redemption_id et event_id requis.' }, { status: 400 });
  }

  const adminId = await getAdminId();
  if (!adminId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: admin } = await supabase
    .from('admin_users')
    .select('role, tenant_id, active')
    .eq('id', adminId)
    .eq('active', true)
    .maybeSingle();

  if (!admin) return NextResponse.json({ error: 'Non autorisé.' }, { status: 403 });

  const { data: redemption } = await supabase
    .from('event_reservation_item_redemptions')
    .select('id, redeemed_by, redeemed_at, voided_at, event_reservation_items(reservation_id, event_reservations(tenant_id, event_id))')
    .eq('id', redemptionId)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reservation = (redemption as any)?.event_reservation_items?.event_reservations;
  if (!redemption || reservation?.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Redemption introuvable pour cette boutique.' }, { status: 404 });
  }
  if (reservation?.event_id !== eventId) {
    return NextResponse.json({ error: 'Cette opération appartient à un autre événement.' }, { status: 409 });
  }
  if (redemption.voided_at) {
    return NextResponse.json({ error: 'Cette validation a déjà été annulée.' }, { status: 409 });
  }

  const ageMs = Math.max(0, Date.now() - new Date(redemption.redeemed_at).getTime());
  const elevated = admin.role === 'tenant_admin' || admin.role === 'platform_owner';

  if (admin.role === 'tenant_cashier') {
    if (redemption.redeemed_by !== adminId || ageMs > CASHIER_UNDO_WINDOW_MS) {
      return NextResponse.json(
        { error: 'Un caissier peut annuler uniquement sa propre dernière validation pendant 5 minutes.' },
        { status: 403 },
      );
    }
  } else if (!elevated) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 403 });
  }

  const requiresReason = elevated && (redemption.redeemed_by !== adminId || ageMs > CASHIER_UNDO_WINDOW_MS);
  if (requiresReason && !reason) {
    return NextResponse.json({ error: 'Un motif est requis pour cette annulation.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .rpc('void_event_reservation_item_redemption', {
      p_redemption_id: redemptionId,
      p_admin_id: adminId,
      p_reason: reason || null,
    })
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = data as VoidRpcRow;
  if (!row.success) return NextResponse.json({ error: row.reason }, { status: 409 });

  return NextResponse.json({ success: true, quantity_remaining: row.quantity_remaining });
}
