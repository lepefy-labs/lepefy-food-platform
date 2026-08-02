import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { resolveCheckoutAmbassadorDiscount } from '@/lib/ambassador/resolveCheckoutAmbassadorDiscount';

interface Body {
  subtotal?: number;
}

// Anteprima seule — affichage de la ligne "Réduction parrainage" dans le
// récapitulatif AVANT confirmation. Ne fait foi pour rien : POST
// /api/checkout recalcule indépendamment le même montant (même fonction
// pure sous-jacente) au moment de fixer le PaymentIntent / créer la
// commande in_store, donc aucune valeur envoyée par le client ici n'est
// jamais faite confiance pour le montant réellement débité.
export async function POST(req: NextRequest) {
  const body: Body = await req.json();
  const subtotal = typeof body.subtotal === 'number' && Number.isFinite(body.subtotal) ? body.subtotal : 0;

  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const sessionCustomer = await getSessionCustomer(tenant.id);

  const discount = await resolveCheckoutAmbassadorDiscount({
    tenant: {
      id: tenant.id,
      ambassador_min_purchase_amount: tenant.ambassador_min_purchase_amount,
      ambassador_first_order_discount_type: tenant.ambassador_first_order_discount_type,
      ambassador_first_order_discount_value: tenant.ambassador_first_order_discount_value,
    },
    customerId: sessionCustomer?.id ?? null,
    subtotal,
  });

  return NextResponse.json({ discount });
}
