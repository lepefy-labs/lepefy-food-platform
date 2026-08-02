import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';

interface ManualPurchaseRpcRow {
  points_awarded: number;
  new_confirmed_balance: number;
}

// Attribue les points d'un achat en caisse via process_manual_purchase_points_atomic
// (047_loyalty_card_system.sql) — réutilise tenants.purchase_points_rate, le
// même taux que process_order_points_atomic pour les commandes en ligne, sans
// créer de ligne orders. Accessible à tenant_admin ET tenant_cashier.
export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id, ['tenant_admin', 'tenant_cashier']);
  if (denied) return denied;

  if (!tenant.loyalty_enabled) {
    return NextResponse.json(
      { error: 'Le programme de fidélité n\'est pas activé pour cette boutique.' },
      { status: 400 },
    );
  }

  const body = await req.json() as { customerId?: string; amount?: number };
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

  const { data, error } = await supabase.rpc('process_manual_purchase_points_atomic', {
    p_tenant_id: tenant.id,
    p_customer_id: customer.id,
    p_staff_admin_id: adminId,
    p_amount: Math.round(amount * 100) / 100,
  });

  if (error || !data || data.length === 0) {
    return NextResponse.json(
      { error: error?.message ?? 'Erreur lors de l\'attribution des points.' },
      { status: 500 },
    );
  }

  const row = data[0] as ManualPurchaseRpcRow;

  return NextResponse.json({
    customerName: customer.full_name,
    pointsAwarded: row.points_awarded,
    newBalance: row.new_confirmed_balance,
  });
}
