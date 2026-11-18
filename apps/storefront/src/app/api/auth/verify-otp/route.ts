import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/server';
import { verifyOtp } from '@/lib/auth/verifyOtp';
import { getTenant } from '@/lib/tenant/getTenant';
import { finishCustomerSignIn } from '@/lib/auth/customerSignIn';

export async function POST(req: NextRequest) {
  try {
    const { email, token, marketingOptIn } = await req.json();

    if (!email || !token) {
      return NextResponse.json({ error: 'Email et code requis.' }, { status: 400 });
    }

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant      = await getTenant(tenantSlug);

    const { supabase, applyCookies } = createRouteClient();
    const result = await verifyOtp(supabase, email, token, tenant.id);

    if (!result.session) {
      return NextResponse.json({ error: 'Code invalide ou expiré.' }, { status: 401 });
    }

    const response = applyCookies(NextResponse.json({ authenticated: true }));

    // Consent (Ciclo 4) and referral attribution: only on the first
    // sign-in of this customer (isNewCustomer, see verifyOtp.ts).
    await finishCustomerSignIn({
      req,
      response,
      tenantId: tenant.id,
      customerId: result.customerId!,
      isNewCustomer: result.isNewCustomer === true,
      marketingOptIn: marketingOptIn === true,
      logTag: 'api/auth/verify-otp',
    });

    return response;
  } catch (err) {
    console.error('[api/auth/verify-otp] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
