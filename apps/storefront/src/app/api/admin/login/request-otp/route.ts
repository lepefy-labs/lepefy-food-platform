import { NextRequest, NextResponse } from 'next/server';
import { requestAdminOtp } from '@/lib/auth/requestAdminOtp';

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email requis.' }, { status: 400 });
  }

  const result = await requestAdminOtp(email);

  if (!result.sent) {
    return NextResponse.json(
      { error: result.error ?? 'Erreur lors de l\'envoi du code.' },
      { status: 429 },
    );
  }

  return NextResponse.json({ ok: true });
}
