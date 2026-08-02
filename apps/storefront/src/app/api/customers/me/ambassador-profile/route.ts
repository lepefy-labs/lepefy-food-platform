import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';

interface Body {
  firstName?: string;
  lastName?: string;
  paymentMethod?: 'IBAN' | 'PAYPAL';
  iban?: string;
  paypalEmail?: string;
}

// Complétion du profil ambassadeur — accessible uniquement au client
// connecté lui-même (pas d'admin ici, c'est son propre IBAN/PayPal). Ne fait
// jamais passer is_ambassador à true : ce champ reste exclusivement
// administrable via /api/admin/ambassador/promote.
export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const body: Body = await req.json();
  const firstName = (body.firstName ?? '').trim();
  const lastName  = (body.lastName ?? '').trim();
  const paymentMethod = body.paymentMethod;

  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'Prénom et nom requis.' }, { status: 400 });
  }
  if (paymentMethod !== 'IBAN' && paymentMethod !== 'PAYPAL') {
    return NextResponse.json({ error: 'Moyen de paiement invalide.' }, { status: 400 });
  }

  const ibanInput        = (body.iban ?? '').replace(/\s+/g, '').toUpperCase();
  const paypalEmailInput = (body.paypalEmail ?? '').trim();

  if (paymentMethod === 'IBAN' && ibanInput.length < 15) {
    return NextResponse.json({ error: 'IBAN invalide.' }, { status: 400 });
  }
  if (paymentMethod === 'PAYPAL' && !paypalEmailInput.includes('@')) {
    return NextResponse.json({ error: 'Email PayPal invalide.' }, { status: 400 });
  }

  const iban        = paymentMethod === 'IBAN' ? ibanInput : null;
  const paypalEmail = paymentMethod === 'PAYPAL' ? paypalEmailInput : null;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('customers')
    .update({
      ambassador_first_name: firstName,
      ambassador_last_name: lastName,
      ambassador_payment_method: paymentMethod,
      ambassador_iban: iban,
      ambassador_paypal_email: paypalEmail,
      ambassador_profile_completed_at: new Date().toISOString(),
    })
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .select('ambassador_first_name, ambassador_last_name, ambassador_payment_method, ambassador_iban, ambassador_paypal_email, ambassador_profile_completed_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
