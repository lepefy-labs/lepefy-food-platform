import 'server-only';
import type { NextResponse } from 'next/server';
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
