import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requestAccountDeletionOtp } from '@/lib/privacy/accountDeletionOtp';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const result = await requestAccountDeletionOtp(body?.email, tenant.id);

    if (result.invalid) {
      return NextResponse.json({ error: 'Adresse email invalide.' }, { status: 400 });
    }

    // Réponse volontairement identique, que le compte existe ou non.
    return NextResponse.json({ sent: true });
  } catch {
    console.error('[privacy/account-deletion/request-otp] request failed');
    return NextResponse.json({ error: 'Envoi impossible. Veuillez réessayer.' }, { status: 500 });
  }
}
