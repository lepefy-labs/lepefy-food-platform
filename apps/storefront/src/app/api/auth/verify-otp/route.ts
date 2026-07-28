import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/server';
import { verifyOtp } from '@/lib/auth/verifyOtp';
import { getTenant } from '@/lib/tenant/getTenant';

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

    return applyCookies(NextResponse.json({ authenticated: true }));
  } catch (err) {
    console.error('[api/auth/verify-otp] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
