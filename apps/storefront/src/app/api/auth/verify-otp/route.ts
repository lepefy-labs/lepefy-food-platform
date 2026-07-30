import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/server';
import { verifyOtp } from '@/lib/auth/verifyOtp';
import { getTenant } from '@/lib/tenant/getTenant';
import { registerWithReferral } from '@/lib/loyalty/registerWithReferral';

export async function POST(req: NextRequest) {
  try {
    const { email, token } = await req.json();

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

    // ── Attribution referral: solo al primo login/creazione di questo customer
    // (isNewCustomer, vedi verifyOtp.ts) — mai su un re-login successivo, e mai
    // se non c'è un cookie referral_code posato da /invite/[code]. Best-effort:
    // un fallimento qui non deve mai invalidare un login già riuscito.
    const referralCookie = req.cookies.get('referral_code')?.value;

    if (referralCookie && result.isNewCustomer) {
      const forwardedFor = req.headers.get('x-forwarded-for');
      const signupIp = forwardedFor?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '';

      try {
        // Esito definitivo (referred: true o false con reason) → il codice è
        // stato valutato, il cookie va consumato in entrambi i casi. Solo
        // un'eccezione imprevista (errore permessi, rete, RPC) prima di
        // arrivare a un esito lascia il cookie intatto, per permettere un
        // retry entro la finestra dei 30 giorni già prevista.
        await registerWithReferral({
          tenantId: tenant.id,
          newCustomerId: result.session.user.id,
          referralCode: referralCookie,
          signupIp,
          // Nessun device fingerprinting esiste altrove nel progetto — non
          // introdotto qui (fuori scope di questo fix mirato). checkFraudSignals
          // confronterà una stringa vuota, che semplicemente non potrà mai
          // produrre un match SAME_DEVICE finché non verrà implementato altrove.
          deviceFingerprint: '',
        });

        // Consumato — non riusabile su un secondo account.
        response.cookies.delete('referral_code');
      } catch (referralErr) {
        console.error('[api/auth/verify-otp] registerWithReferral failed:', referralErr,
          '— customer_id:', result.session.user.id);
      }
    }

    return response;
  } catch (err) {
    console.error('[api/auth/verify-otp] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
