import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getLoyaltySettings } from '@/lib/loyalty/loyaltyConfig';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { recordCustomerEvents } from '@/lib/customers/recordCustomerEvents';
import { DUPLICATE_WINDOW_SECONDS, findRecentDuplicate } from '@/lib/loyalty/loyaltyScan';

interface ManualPurchaseRpcRow {
  points_awarded: number;
  new_confirmed_balance: number;
}

// Attribue les points d'un achat en caisse via process_manual_purchase_points_atomic
// (047, réécrite par 131) — lit le taux de tenant_feature_settings('loyalty'),
// le même que pour les commandes en ligne, sans créer de ligne orders.
// Accessible à tenant_admin ET tenant_cashier.
export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id, ['tenant_admin', 'tenant_cashier']);
  if (denied) return denied;

  const loyalty = await getLoyaltySettings(createServiceClient(), tenant.id);
  if (!loyalty.enabled) {
    return NextResponse.json(
      { error: 'Le programme de fidélité n\'est pas activé pour cette boutique.' },
      { status: 400 },
    );
  }

  const body = await req.json() as { customerId?: string; amount?: number; confirmDuplicate?: boolean };
  const amount = Number(body.amount);

  if (!body.customerId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Client et montant valides requis.' }, { status: 400 });
  }

  const adminId = await getAdminId();
  if (!adminId) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: customer } = await supabase
    .from('customers')
    .select('id, full_name')
    .eq('id', body.customerId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!customer) {
    return NextResponse.json({ error: 'Client introuvable.' }, { status: 404 });
  }

  const roundedAmount = Math.round(amount * 100) / 100;

  // Double-credit guard (double tap, cashier re-scanning the same receipt): an
  // identical purchase for this customer within the window needs an explicit
  // confirmDuplicate. Best effort — two strictly simultaneous requests can
  // still both pass; closing that needs an idempotency key in the RPC.
  if (body.confirmDuplicate !== true) {
    const since = new Date(Date.now() - DUPLICATE_WINDOW_SECONDS * 1000).toISOString();
    const { data: recent, error: recentError } = await supabase
      .from('loyalty_manual_purchases')
      .select('amount, points_awarded, created_at')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10);
    if (recentError) {
      console.error('[loyalty/scan/confirm] duplicate check failed:', recentError);
      return NextResponse.json({ error: 'Vérification impossible — réessayez.' }, { status: 500 });
    }
    const secondsAgo = findRecentDuplicate(recent ?? [], roundedAmount);
    if (secondsAgo !== null) {
      const match = (recent ?? []).find((p) => Math.round(Number(p.amount) * 100) === Math.round(roundedAmount * 100));
      return NextResponse.json({
        code: 'DUPLICATE_RECENT',
        error: 'Achat identique déjà enregistré pour ce client.',
        secondsAgo,
        pointsAwarded: match?.points_awarded ?? null,
      }, { status: 409 });
    }
  }

  const { data, error } = await supabase.rpc('process_manual_purchase_points_atomic', {
    p_tenant_id: tenant.id,
    p_customer_id: customer.id,
    p_staff_admin_id: adminId,
    p_amount: roundedAmount,
  });

  if (error || !data || data.length === 0) {
    return NextResponse.json(
      { error: error?.message ?? 'Erreur lors de l\'attribution des points.' },
      { status: 500 },
    );
  }

  const row = data[0] as ManualPurchaseRpcRow;
  const { data: purchase } = await supabase.from('loyalty_manual_purchases').select('id,created_at')
    .eq('tenant_id', tenant.id).eq('customer_id', customer.id).eq('staff_admin_id', adminId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (purchase) await recordCustomerEvents([{
    tenantId: tenant.id, customerId: customer.id, eventType: 'in_store_purchase', source: 'loyalty_scan',
    entityType: 'loyalty_manual_purchase', entityId: purchase.id, eventKey: `in_store_purchase:${purchase.id}`,
    occurredAt: purchase.created_at, metadata: { amount: roundedAmount, points_awarded: row.points_awarded },
  }]);

  return NextResponse.json({
    customerName: customer.full_name,
    pointsAwarded: row.points_awarded,
    newBalance: row.new_confirmed_balance,
  });
}
