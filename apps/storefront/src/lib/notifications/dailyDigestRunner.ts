import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyDigest, renderDigestHtml, tenantClock,
  type DigestOrder, type DigestPreorder,
} from '@/lib/notifications/dailyOrderDigest';
import { dailyDigestModule, toDigestThresholds, DAILY_DIGEST_FEATURE_KEY, type DailyDigestConfig } from '@/lib/notifications/dailyDigestConfig';
import { resolveModuleConfig, type ModuleConfigRow } from '@/lib/tenantConfig/moduleConfig';
import type { TenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';

export type DigestOutcome =
  | 'accepted' | 'failed' | 'not_due' | 'no_recipients' | 'already_claimed' | 'empty' | 'invalid_config';

/** Injected side effects so the runner can be exercised without Supabase/n8n. */
export interface DigestRunnerDeps {
  db: SupabaseClient;
  getRecipients: (tenantId: string) => Promise<string[]>;
  getBranding: (tenantId: string) => Promise<TenantNotificationContext | null>;
  notify: (path: string, payload: Record<string, unknown>) => Promise<boolean>;
}

export interface DigestTenant {
  tenantId: string;
  config: DailyDigestConfig;
}

/**
 * Tenants whose digest is operationally enabled with a valid configuration.
 * A missing settings row never activates the module; an invalid one is
 * reported separately and skipped (fail closed, no silent defaults).
 */
export async function listDigestTenants(db: SupabaseClient): Promise<{ tenants: DigestTenant[]; invalid: string[] }> {
  const { data, error } = await db
    .from('tenant_feature_settings')
    .select('tenant_id, enabled, config, tenants!inner(active)')
    .eq('feature_key', DAILY_DIGEST_FEATURE_KEY)
    .eq('enabled', true)
    .eq('tenants.active', true);
  if (error) throw error;
  const tenants: DigestTenant[] = [];
  const invalid: string[] = [];
  for (const row of (data ?? []) as Array<ModuleConfigRow & { tenant_id: string }>) {
    const state = resolveModuleConfig(dailyDigestModule, row);
    if (state.status === 'ok' && state.active) tenants.push({ tenantId: row.tenant_id, config: state.config });
    else invalid.push(row.tenant_id);
  }
  return { tenants, invalid };
}

async function readAll<T>(db: SupabaseClient, table: 'orders' | 'checkout_sessions',
  tenant: string, columns: string): Promise<T[]> {
  const result: T[] = [];
  // Paginated, never silently truncate a tenant's action list.
  for (let start = 0; start < 10000; start += 1000) {
    let query = db.from(table).select(columns).eq('tenant_id', tenant);
    query = table === 'orders'
      ? query.not('status', 'in', '("delivered","cancelled")')
      : query.in('status', ['draft', 'open', 'awaiting_verification']);
    const { data, error } = await query.order('created_at', { ascending: true }).order('id', { ascending: true }).range(start, start + 999);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    result.push(...batch);
    if (batch.length < 1000) return result;
  }
  throw new Error('digest_row_limit_exceeded');
}

/**
 * One tenant, one tenant-local day. Only at 08:00 local time, only with at
 * least one opted-in recipient, and only after winning the idempotent claim.
 */
export async function deliverTenantDigest(deps: DigestRunnerDeps, tenant: DigestTenant, now: Date): Promise<DigestOutcome> {
  const { db } = deps;
  const tenantId = tenant.tenantId;
  const clock = tenantClock(now, tenant.config.timezone);
  if (clock.hour !== 8) return 'not_due';
  const recipients = await deps.getRecipients(tenantId);
  if (!recipients.length) return 'no_recipients';
  const branding = await deps.getBranding(tenantId);
  if (!branding?.storefrontUrl) throw new Error('missing_tenant_storefront');
  const { data: claimed, error: claimError } = await db.rpc('claim_tenant_daily_digest',
    { p_tenant: tenantId, p_date: clock.localDate });
  if (claimError) throw claimError;
  if (!claimed) return 'already_claimed';
  try {
    const [orders, preorders, prior] = await Promise.all([
      readAll<DigestOrder>(db, 'orders', tenantId,
        'id,full_name,email,payment_status,status,fulfillment_type,created_at,updated_at,shipping_normalized_status,shipping_sync_error,shipping_provider_reference,shipping_estimated_delivery_at,shipping_provider_synced_at,shipping_tracking_events'),
      readAll<DigestPreorder>(db, 'checkout_sessions', tenantId,
        'id,full_name,email,phone,origin,status,created_at,declared_payment_at'),
      db.from('tenant_daily_digest_runs').select('snapshot')
        .eq('tenant_id', tenantId).eq('status', 'accepted').lt('local_date', clock.localDate)
        .order('local_date', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (prior.error) throw prior.error;
    const storefrontUrl = branding.storefrontUrl.replace(/\/$/, '');
    const adminUrl = storefrontUrl + '/admin';
    const items = classifyDigest(orders, preorders, toDigestThresholds(tenant.config), now, storefrontUrl);
    const snapshot = { keys: items.map(i => i.key), counts: {
      urgent: items.filter(i => i.priority === 'urgent').length,
      today: items.filter(i => i.priority === 'today').length,
      monitor: items.filter(i => i.priority === 'monitor').length,
    } };
    const old = (prior.data?.snapshot ?? {}) as { keys?: string[] };
    const previousKeys = Array.isArray(old.keys) ? old.keys : [];
    if (!items.length && !tenant.config.include_empty) {
      const { error } = await db.from('tenant_daily_digest_runs').update({ status: 'skipped', snapshot })
        .eq('tenant_id', tenantId).eq('local_date', clock.localDate).eq('status', 'processing');
      if (error) throw error;
      return 'empty';
    }
    const html = renderDigestHtml(branding.tenantName, clock.localDate, items, previousKeys,
      adminUrl, branding.branding.logoUrl);
    const subject = '[Rapport du matin] ' + snapshot.counts.urgent + ' urgentes · ' +
      snapshot.counts.today + ' à traiter · ' + branding.tenantName;
    const accepted = await deps.notify('/webhook/daily-order-digest', {
      ...branding, notificationType: 'daily_order_digest', recipients,
      localDate: clock.localDate, generatedAt: now.toISOString(),
      idempotencyKey: tenantId + ':' + clock.localDate, subject, html, items,
      snapshot, adminUrl,
    });
    if (!accepted) throw new Error('n8n_not_accepted');
    const { error } = await db.from('tenant_daily_digest_runs').update({
      status: 'accepted', accepted_at: new Date().toISOString(), snapshot,
    }).eq('tenant_id', tenantId).eq('local_date', clock.localDate).eq('status', 'processing');
    if (error) throw error;
    return 'accepted';
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 60) : 'unknown';
    console.error('[daily digest] failed', tenantId, code);
    await db.from('tenant_daily_digest_runs').update({ status: 'failed', error_code: code })
      .eq('tenant_id', tenantId).eq('local_date', clock.localDate).eq('status', 'processing');
    return 'failed';
  }
}
