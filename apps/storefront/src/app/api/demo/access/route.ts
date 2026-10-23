/**
 * GET /api/demo/access?token=… — lien d'accès d'une démo privée.
 * Vérifie le jeton signé (lib/demo/accessToken.ts), pose le cookie et renvoie
 * vers /demo. Le cookie expire avec le jeton (7 jours au plus).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isDemoDeployment } from '@/lib/demo/demoEnvironment';
import { DEMO_ACCESS_COOKIE, verifyDemoAccessToken } from '@/lib/demo/accessToken';

export const dynamic = 'force-dynamic';

const MAX_AGE_SECONDS = 7 * 24 * 3600;

export async function GET(request: NextRequest) {
  if (!isDemoDeployment()) return NextResponse.json({ error: 'Introuvable.' }, { status: 404 });
  const token = request.nextUrl.searchParams.get('token');
  const access = verifyDemoAccessToken(process.env.DEMO_ACCESS_SECRET, token);
  const target = new URL('/demo', request.nextUrl.origin);
  if (!access || !token) {
    target.searchParams.set('acces', 'invalide');
    return NextResponse.redirect(target, 303);
  }
  const response = NextResponse.redirect(target, 303);
  const maxAge = Math.min(MAX_AGE_SECONDS, Math.floor((access.expiresAt.getTime() - Date.now()) / 1000));
  response.cookies.set(DEMO_ACCESS_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge });
  return response;
}
