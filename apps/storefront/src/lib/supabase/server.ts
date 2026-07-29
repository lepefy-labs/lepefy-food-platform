import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export function createClient() {
  const cookieStore = cookies();

  // Fournit à la fois l'ancienne API (get/set/remove) et la nouvelle
  // (getAll/setAll) : @supabase/ssr@0.3.x lit les cookies en interne via
  // get(name), pas getAll() — sans get() ici, auth.getUser()/getSession()
  // échoue silencieusement (retourne toujours null) même avec un cookie de
  // session valide. Même pattern que admin/(protected)/layout.tsx.
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options as never);
            });
          } catch {
            // Server Component — cookies may be read-only
          }
        },
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options?: object) {
          try {
            cookieStore.set(name, value, options as never);
          } catch {
            // Server Component — cookies may be read-only
          }
        },
        remove(name: string, options?: object) {
          try {
            cookieStore.set(name, '', { ...options, maxAge: 0 } as never);
          } catch {
            // Server Component — cookies may be read-only
          }
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  );
}

// Client "scrivente" per Route Handlers che devono impostare/rimuovere i
// cookie di sessione (login, OTP verify, logout). @supabase/ssr@0.3.x
// invoca get/set/remove in interno — non solo getAll/setAll — quindi le due
// API vanno fornite insieme (cf. nota in CLAUDE.md). I cookie non vengono
// scritti direttamente su next/headers ma raccolti e applicati alla
// NextResponse tramite applyCookies(), l'unico modo affidabile di farli
// arrivare al browser da un Route Handler.
export function createRouteClient() {
  const cookieStore = cookies();
  const pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          pendingCookies.push(...cookiesToSet);
        },
        get(name: string) { return cookieStore.get(name)?.value; },
        set(name: string, value: string, options?: Record<string, unknown>) {
          pendingCookies.push({ name, value, options });
        },
        remove(name: string, options?: Record<string, unknown>) {
          pendingCookies.push({ name, value: '', options: { ...options, maxAge: 0 } });
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  );

  function applyCookies(response: NextResponse) {
    pendingCookies.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]),
    );
    return response;
  }

  return { supabase, applyCookies };
}

export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() { return []; },
        setAll() {},
      },
    },
  );
}
