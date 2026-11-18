import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient, createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { googleClientIds, verifyGoogleIdToken } from '@/lib/auth/googleIdToken';
import { finishCustomerSignIn, hasTenantCustomerWithEmail } from '@/lib/auth/customerSignIn';
import { resolveOrCreateCustomer } from '@/lib/customers/resolveOrCreateCustomer';

// Sign in with Google (button or One Tap): the browser sends the Google ID
// token and the raw nonce whose SHA-256 it gave Google.
//
// 1. We verify the token ourselves (signature, audience, nonce, verified
//    e-mail) — nothing is written yet.
// 2. A new customer of this shop must accept the CGV first: without
//    `termsAccepted` we answer `needsConsent` and the browser re-sends the
//    same token once the box is ticked.
// 3. Supabase signs in with the same token (it verifies it again) and the
//    customer row, consent and referral follow the e-mail-code path.

const TOKEN_MAX_LENGTH = 4096;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as {
      credential?: unknown; nonce?: unknown; termsAccepted?: unknown; marketingOptIn?: unknown;
    } | null;
    const credential = typeof body?.credential === 'string' ? body.credential : '';
    const nonce = typeof body?.nonce === 'string' ? body.nonce : '';

    if (!credential || credential.length > TOKEN_MAX_LENGTH || !nonce || nonce.length > 200) {
      return NextResponse.json({ error: 'Connexion Google invalide.' }, { status: 400 });
    }
    if (googleClientIds().length === 0) {
      return NextResponse.json({ error: 'Connexion Google indisponible.' }, { status: 404 });
    }

    const verified = await verifyGoogleIdToken(credential, nonce);
    if (!verified.ok) {
      console.warn('[api/auth/google] token refused:', verified.issue);
      const message = verified.issue === 'email_unverified' || verified.issue === 'email_missing'
        ? "Votre adresse Google n'est pas vérifiée. Utilisez la connexion par code."
        : 'Connexion Google expirée. Veuillez réessayer.';
      return NextResponse.json({ error: message }, { status: 401 });
    }
    const { email, name } = verified.identity;

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(tenantSlug);

    const isNewCustomer = !(await hasTenantCustomerWithEmail(tenant.id, email));
    if (isNewCustomer && body?.termsAccepted !== true) {
      return NextResponse.json({ needsConsent: true, email });
    }

    const { supabase, applyCookies } = createRouteClient();
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: credential,
      nonce,
    });
    if (error || !data.session) {
      console.error('[api/auth/google] signInWithIdToken error:', error?.message);
      return NextResponse.json({ error: 'Connexion Google impossible. Veuillez réessayer.' }, { status: 401 });
    }

    const resolved = await resolveOrCreateCustomer({
      tenantId: tenant.id,
      authUserId: data.session.user.id,
      email,
      fullName: name,
      source: 'signup',
      supabase: createServiceClient(),
    });

    const response = applyCookies(NextResponse.json({ authenticated: true }));
    await finishCustomerSignIn({
      req,
      response,
      tenantId: tenant.id,
      customerId: resolved.id,
      isNewCustomer: resolved.created,
      marketingOptIn: body?.marketingOptIn === true,
      logTag: 'api/auth/google',
    });
    return response;
  } catch (err) {
    console.error('[api/auth/google] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
