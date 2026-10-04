import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  isModuleKey,
  isSuspendedAt,
  type ModuleKey,
  type SubscriptionRow,
  type SuspensionMode,
} from './subscriptionRules';

/**
 * Single answer to "can this tenant (or this module) serve right now?".
 *
 * Global suspension = manual suspension (tenant_subscriptions.status) or the
 * automatic policy past paid_until + grace_days, evaluated at read time: no
 * cron, a payment reactivates immediately. Module suspension = a platform row
 * in tenant_module_suspensions. Only tenant-level rows are read (no cookies),
 * so the shop layout keeps its ISR.
 *
 * Fail-open: if migration 144 is not applied or the read fails, the tenant is
 * reported active — a missing schema must never take production offline.
 */

export const serviceStateCacheTag = (tenantId: string) => `service-state:${tenantId}`;

export interface TenantServiceState {
  schemaReady: boolean;
  suspended: boolean;
  suspendedBy: 'manual' | 'automatic' | null;
  suspensionReason: string | null;
  suspendedModules: ModuleKey[];
  subscription: (SubscriptionRow & { suspension_reason: string | null }) | null;
}

interface CachedRows {
  schemaReady: boolean;
  subscription: (SubscriptionRow & { suspension_reason: string | null }) | null;
  modules: ModuleKey[];
}

const ACTIVE_ROWS: CachedRows = { schemaReady: false, subscription: null, modules: [] };

async function loadRows(tenantId: string): Promise<CachedRows> {
  const db = createServiceClient();
  const [subscription, modules] = await Promise.all([
    db.from('tenant_subscriptions')
      .select('status, suspended_at, suspension_mode, paid_until, grace_days, suspension_reason')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db.from('tenant_module_suspensions').select('module_key').eq('tenant_id', tenantId),
  ]);
  if (subscription.error || modules.error) {
    console.warn('[service-state] unavailable, tenant treated as active', tenantId, subscription.error?.message ?? modules.error?.message);
    return ACTIVE_ROWS;
  }
  const row = subscription.data as (SubscriptionRow & { suspension_reason: string | null }) | null;
  return {
    schemaReady: true,
    subscription: row ? { ...row, suspension_mode: row.suspension_mode === 'automatic' ? 'automatic' : 'manual' as SuspensionMode } : null,
    modules: ((modules.data ?? []) as Array<{ module_key: string }>).map((m) => m.module_key).filter(isModuleKey),
  };
}

function cachedRows(tenantId: string): Promise<CachedRows> {
  return unstable_cache(() => loadRows(tenantId), ['tenant-service-state', tenantId], {
    revalidate: 60,
    tags: [serviceStateCacheTag(tenantId)],
  })().catch((error) => {
    console.warn('[service-state] cache read failed, tenant treated as active', tenantId, error);
    return ACTIVE_ROWS;
  });
}

export function serviceStateFromRows(rows: CachedRows, now: Date = new Date()): TenantServiceState {
  const verdict = rows.subscription ? isSuspendedAt(rows.subscription, now) : { suspended: false, by: null };
  return {
    schemaReady: rows.schemaReady,
    suspended: verdict.suspended,
    suspendedBy: verdict.by,
    suspensionReason: verdict.by === 'manual' ? rows.subscription?.suspension_reason ?? null : null,
    suspendedModules: rows.modules,
    subscription: rows.subscription,
  };
}

export async function getTenantServiceState(tenantId: string): Promise<TenantServiceState> {
  return serviceStateFromRows(await cachedRows(tenantId));
}

export function isModuleAvailable(state: TenantServiceState, module: ModuleKey): boolean {
  return !state.suspended && !state.suspendedModules.includes(module);
}

/** Platform feature keys (entitlements) → suspendable module. */
export function moduleForFeature(featureKey: string): ModuleKey | null {
  if (featureKey === 'ai' || featureKey.startsWith('nala')) return 'ai';
  return isModuleKey(featureKey) ? featureKey : null;
}

export const SERVICE_UNAVAILABLE_MESSAGE = 'Service temporairement indisponible. Merci de réessayer plus tard.';

/**
 * Guard for public write APIs (checkout, reservations, payments…): 503 before
 * any row or PaymentIntent is created. Webhooks never call it.
 */
export async function guardModule(tenantId: string, module: ModuleKey): Promise<NextResponse | null> {
  const state = await getTenantServiceState(tenantId);
  if (isModuleAvailable(state, module)) return null;
  return NextResponse.json({ error: SERVICE_UNAVAILABLE_MESSAGE, code: 'SERVICE_SUSPENDED' }, { status: 503 });
}

/** After a payment or a platform action: visible on the next request. */
export function revalidateServiceState(tenantId: string) {
  try {
    revalidateTag(serviceStateCacheTag(tenantId));
    revalidatePath('/', 'layout');
  } catch (error) {
    console.warn('[service-state] invalidation skipped', error);
  }
}
