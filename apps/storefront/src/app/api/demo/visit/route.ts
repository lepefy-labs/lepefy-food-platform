/**
 * POST /api/demo/visit — ouvre l'administration en visite lecture seule.
 *
 * Démo uniquement (déploiement + tenant, sinon 404). Crée un compte visiteur
 * éphémère (lib/demo/server/visitorAccounts.ts) et ouvre sa session : les
 * cookies Supabase sont posés sur la réponse, comme /api/admin/login. Un admin
 * déjà connecté (le présentateur) garde sa session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getDemoContext, hasDemoAccess } from '@/lib/demo/server/demoContext';
import { countDemoEvent, demoBucket, demoRateAllowed, type DemoEventKey } from '@/lib/demo/server/demoServices';
import { createVisitorAccount, isVisitorAccountValid, purgeExpiredVisitors } from '@/lib/demo/server/visitorAccounts';
import { DEMO_VISITOR_ROLE } from '@/lib/demo/visitorPermissions';
import { demoPath } from '@/lib/demo/tours';
import { clientIp } from '@/lib/http/memoryRateLimit';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const VISITS_PER_HOUR = 6;

export async function POST(request: NextRequest) {
  const demo = await getDemoContext();
  if (!demo) return NextResponse.json({ error: 'Introuvable.' }, { status: 404 });
  if (!hasDemoAccess()) return NextResponse.json({ error: 'Ouvrez d’abord le lien d’accès à cette démo.' }, { status: 403 });

  const body = await request.json().catch(() => null) as { path?: unknown } | null;
  const path = demoPath(typeof body?.path === 'string' ? body.path : '');
  if (!path || !path.admin) return NextResponse.json({ error: 'Parcours inconnu.' }, { status: 400 });
  const redirect = path.steps[0]?.href ?? '/admin';
  const pathEvent = `path.${path.key}` as DemoEventKey;

  const cookieStore = cookies();
  const pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];
  const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) { pendingCookies.push(...cookiesToSet); },
      get(name: string) { return cookieStore.get(name)?.value; },
      set(name: string, value: string, options?: Record<string, unknown>) { pendingCookies.push({ name, value, options }); },
      remove(name: string, options?: Record<string, unknown>) { pendingCookies.push({ name, value: '', options: { ...options, maxAge: 0 } }); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  // Admin déjà connecté (présentateur, visite en cours) : on garde sa session.
  // Un client de la boutique connecté est remplacé par le compte visiteur.
  const { data: { user } } = await auth.auth.getUser();
  const admin = user
    ? (await createServiceClient().from('admin_users').select('id, role').eq('id', user.id).eq('active', true).maybeSingle()).data
    : null;
  const signedInAdmin = Boolean(admin) && (admin!.role !== DEMO_VISITOR_ROLE || await isVisitorAccountValid(admin!.id, demo.tenant.id));
  if (signedInAdmin) {
    await countDemoEvent(pathEvent);
    return NextResponse.json({ ok: true, redirect });
  }

  if (!(await demoRateAllowed(demoBucket('visit', clientIp(request.headers)), VISITS_PER_HOUR, 3600))) {
    await countDemoEvent('visit.refused');
    return NextResponse.json({ error: 'Trop de visites ouvertes depuis cette connexion. Réessayez dans une heure.' }, { status: 429 });
  }

  await purgeExpiredVisitors();
  let credentials;
  try {
    credentials = await createVisitorAccount(demo.tenant.id);
  } catch (error) {
    console.error('[demo/visit] visitor not created:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'La visite n’a pas pu s’ouvrir. Réessayez dans un instant.' }, { status: 503 });
  }
  const { error } = await auth.auth.signInWithPassword({ email: credentials.email, password: credentials.password });
  if (error) {
    console.error('[demo/visit] sign-in failed:', error.message);
    return NextResponse.json({ error: 'La visite n’a pas pu s’ouvrir. Réessayez dans un instant.' }, { status: 503 });
  }

  await Promise.all([countDemoEvent('visit.started'), countDemoEvent(pathEvent)]);
  const response = NextResponse.json({ ok: true, redirect, expiresAt: credentials.expiresAt.toISOString() });
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]));
  return response;
}
