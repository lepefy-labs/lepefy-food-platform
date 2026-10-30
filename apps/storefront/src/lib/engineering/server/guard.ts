import 'server-only';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import type { EngineeringPermission } from '../access';

/**
 * Guard of every Engineering Hub API route (`/api/admin/platform/engineering/**`).
 *
 * Phase 1 is Platform Owner only, checked on the server for each request: no tenant
 * parameter, header or cookie widens it, and tenant admins get the same 403 as anonymous
 * users get a 401. Engineering routes are intentionally absent from `adminApiPermissions.ts`:
 * the tenant RBAC wildcard of `tenant_admin` must never apply here.
 *
 * `permission` documents the capability the route needs and is where the IT-member check
 * (`canAccessEngineering`) plugs in once that access is approved; today only the owner passes.
 */
export async function requireEngineeringApi(_permission: EngineeringPermission): Promise<NextResponse | null> {
  return requirePlatformOwner();
}

/** Id of the signed-in Platform Owner (to attribute a credential to a person); null when unknown. */
export async function currentOwnerId(): Promise<string | null> {
  const cookieStore = cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {},
      get(name: string) { return cookieStore.get(name)?.value; },
      set() {},
      remove() {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
