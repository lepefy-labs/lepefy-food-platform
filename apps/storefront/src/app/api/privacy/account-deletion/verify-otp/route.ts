import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { verifyAccountDeletionOtp } from '@/lib/privacy/accountDeletionOtp';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const { supabase, applyCookies } = createRouteClient();
    const result = await verifyAccountDeletionOtp(supabase, body?.email, body?.token, tenant.id);

    if (result.invalid) {
      return applyCookies(NextResponse.json({ error: 'Email ou code invalide.' }, { status: 400 }));
    }
    if (!result.session) {
      return applyCookies(NextResponse.json({ error: 'Code invalide ou expiré.' }, { status: 401 }));
    }

    return applyCookies(NextResponse.json({ verified: true }));
  } catch {
    console.error('[privacy/account-deletion/verify-otp] verification failed');
    return NextResponse.json({ error: 'Vérification impossible. Veuillez réessayer.' }, { status: 500 });
  }
}
