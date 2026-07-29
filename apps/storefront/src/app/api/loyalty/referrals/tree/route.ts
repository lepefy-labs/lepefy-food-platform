import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { resolveReferralDownline } from '@/lib/loyalty/resolveReferralDownline';

// Lecture seule : visiteur non authentifié → arbre vide plutôt qu'une 401
// (même choix que /balance et /eligibility, cf. rapport final).
//
// Déviation vs. la spec littérale : celle-ci pointait vers resolveReferralChain,
// qui remonte vers les PARRAINS (utilisé, à raison, dans processOrderPointsOnDelivery
// pour le calcul des commissions). Cet endpoint doit au contraire montrer le
// réseau des FILLEULS de l'utilisateur — d'où resolveReferralDownline (voir
// migration 040, fonction resolve_referral_downline, et le rapport final).
export async function GET() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) {
    return NextResponse.json({ nodes: [] });
  }

  const downline = await resolveReferralDownline(tenant.id, customer.id, tenant.referral_max_depth);

  const supabase = createServiceClient();

  const nodes = await Promise.all(
    downline.map(async ({ customerId, level }) => {
      // "Punti générés par cette branche" = les points REFERRAL_EARNED que
      // l'utilisateur courant a reçus directement grâce à ce filleul —
      // agrégation demandée "par customerId/niveau", pas un rollup de
      // sous-arbre. Jamais de champ sensible (email/téléphone) exposé.
      const { data: rows } = await supabase
        .from('points_ledger')
        .select('amount')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', customer.id)
        .eq('transaction_type', 'REFERRAL_EARNED')
        .eq('reference_customer_id', customerId);

      const points = (rows ?? []).reduce((sum, r) => sum + r.amount, 0);

      return { customerId, level, points };
    }),
  );

  return NextResponse.json({ nodes });
}
