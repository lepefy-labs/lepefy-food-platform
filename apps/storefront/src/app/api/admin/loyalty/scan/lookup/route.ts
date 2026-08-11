import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Lookup carte fidélité → nom + solde, pour confirmation visuelle avant
// d'attribuer des points (éviter de créditer la mauvaise personne).
// Accessible à tenant_admin ET tenant_cashier (047) — seule route où le
// personnel de caisse est autorisé, voir requireAdmin.ts.
export async function GET(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id, ['tenant_admin', 'tenant_cashier']);
  if (denied) return denied;

  const raw = req.nextUrl.searchParams.get('cardNumber') ?? '';
  const cardNumber = raw.trim().replace(/[^0-9]/g, '').slice(0, 13);

  if (cardNumber.length < 8) {
    return NextResponse.json({ error: 'Numéro de carte invalide.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, full_name, email')
    .eq('tenant_id', tenant.id)
    .eq('loyalty_card_number', cardNumber)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!customer) {
    return NextResponse.json({ error: 'Aucun client trouvé pour cette carte.' }, { status: 404 });
  }

  const { data: balance } = await supabase
    .from('customer_points_balance')
    .select('confirmed_balance')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', customer.id)
    .maybeSingle();

  return NextResponse.json({
    customer: {
      id: customer.id,
      fullName: customer.full_name,
      email: customer.email,
      confirmedBalance: balance?.confirmed_balance ?? 0,
    },
  });
}
