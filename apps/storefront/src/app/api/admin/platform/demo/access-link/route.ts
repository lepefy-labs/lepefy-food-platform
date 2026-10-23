/**
 * POST /api/admin/platform/demo/access-link — lien d'accès signé d'une démo
 * privée (1 à 7 jours). Propriétaire de la plateforme, déploiement de démo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getDemoContext } from '@/lib/demo/server/demoContext';
import { createDemoAccessToken } from '@/lib/demo/accessToken';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (!(await getDemoContext())) return NextResponse.json({ error: 'Ce déploiement n’est pas une démo.' }, { status: 409 });
  const secret = process.env.DEMO_ACCESS_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: 'DEMO_ACCESS_SECRET n’est pas configuré sur ce déploiement.' }, { status: 503 });
  const body = await request.json().catch(() => null) as { label?: unknown; days?: unknown } | null;
  const label = typeof body?.label === 'string' ? body.label.trim().toLowerCase() : '';
  if (!/^[a-z0-9-]{1,40}$/.test(label)) return NextResponse.json({ error: 'Nom du lien : lettres minuscules, chiffres et tirets, 40 caractères au plus.' }, { status: 400 });
  const days = typeof body?.days === 'number' && Number.isInteger(body.days) ? Math.min(Math.max(body.days, 1), 7) : 7;
  const expiresAt = new Date(Date.now() + days * 24 * 3600_000);
  const token = createDemoAccessToken(secret, label, expiresAt);
  const url = new URL('/api/demo/access', request.nextUrl.origin);
  url.searchParams.set('token', token);
  return NextResponse.json({ ok: true, url: url.toString(), expiresAt: expiresAt.toISOString() });
}
