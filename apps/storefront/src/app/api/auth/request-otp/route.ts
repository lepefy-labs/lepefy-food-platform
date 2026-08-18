import { NextRequest, NextResponse } from 'next/server';
import { requestOtp } from '@/lib/auth/requestOtp';
import { getTenant } from '@/lib/tenant/getTenant';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email requis.' }, { status: 400 });
    }

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(tenantSlug);

    const result = await requestOtp(email, tenant.id);
    if (!result.sent) {
      return NextResponse.json({ error: 'Erreur lors de l\'envoi du code.' }, { status: 500 });
    }

    return NextResponse.json({ sent: true, isNewCustomer: result.isNewCustomer ?? false });
  } catch (err) {
    console.error('[api/auth/request-otp] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
