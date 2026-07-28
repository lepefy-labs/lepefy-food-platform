import { NextRequest, NextResponse } from 'next/server';
import { requestOtp } from '@/lib/auth/requestOtp';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email requis.' }, { status: 400 });
    }

    const result = await requestOtp(email);
    if (!result.sent) {
      return NextResponse.json({ error: 'Erreur lors de l\'envoi du code.' }, { status: 500 });
    }

    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error('[api/auth/request-otp] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
