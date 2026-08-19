import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/server';
import { verifyAdminOtp } from '@/lib/auth/verifyAdminOtp';

export async function POST(req: NextRequest) {
  const { email, token } = await req.json();

  if (!email || !token) {
    return NextResponse.json({ error: 'Email et code requis.' }, { status: 400 });
  }

  const { supabase, applyCookies } = createRouteClient();
  const result = await verifyAdminOtp(supabase, email, token);

  if (!result.session) {
    return NextResponse.json(
      { error: result.error === 'Accès refusé.' ? result.error : 'Code invalide ou expiré.' },
      { status: 401 },
    );
  }

  return applyCookies(NextResponse.json({ ok: true }));
}
