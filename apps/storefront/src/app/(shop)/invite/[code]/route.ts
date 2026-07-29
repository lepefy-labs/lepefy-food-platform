import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

// Route Handler, non un Server Component page.tsx — deviazione obbligata
// dallo snippet del prompt: in Next.js 14 App Router, cookies().set() lancia
// un errore runtime ("Cookies can only be modified in a Server Action or
// Route Handler") se chiamato da un Server Component in rendering. Un
// route.ts GET produce lo stesso URL pubblico /invite/[code] e può sia
// leggere DB sia scrivere cookie sulla risposta prima del redirect.
//
// Sempre dinamica per costruzione (query DB + redirect ad ogni hit) —
// nessuna cache/revalidate, isolata dalle pagine ISR esistenti.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const supabase   = createServiceClient();

  const { data: codeRow } = await supabase
    .from('referral_codes')
    .select('is_active, max_uses, uses_count')
    .eq('tenant_id', tenant.id)
    .eq('code', params.code)
    .maybeSingle();

  const isValid = Boolean(codeRow?.is_active)
    && (codeRow?.max_uses == null || codeRow.uses_count < codeRow.max_uses);

  const response = NextResponse.redirect(new URL('/', req.url));

  if (isValid) {
    response.cookies.set('referral_code', params.code, {
      maxAge: 60 * 60 * 24 * 30, // 30 giorni, finestra di attribuzione standard
      httpOnly: true, // mai letto da JS client, solo server-side in verify-otp
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }

  // Silenzioso anche se invalido — nessun errore mostrato all'invitato,
  // stesso redirect verso la home in entrambi i casi.
  return response;
}
