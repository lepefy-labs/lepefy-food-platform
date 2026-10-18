import { headers } from 'next/headers';

/**
 * Who is acting in the current request, for the audit triggers (migration 153,
 * docs/ADMIN_ACTIVITY_AUDIT.md §5).
 *
 * The service client sends `x-lepefy-audit-*` headers with its WRITES only;
 * PostgREST exposes them to the triggers (`request.headers`), which trust them
 * only for a service_role request. Reads, and the read RPCs of ISR pages, never
 * touch `headers()`, so cached storefront pages stay static.
 *
 * The actor itself is registered by requirePermission() once the admin is
 * verified, under the request id that the middleware always regenerates
 * (`x-request-id`, never taken from the client).
 */

export type AuditActorType = 'admin' | 'platform_owner' | 'customer' | 'system' | 'provider' | 'automation';
export type AuditSource = 'app' | 'webhook' | 'worker' | 'rpc';

export interface AuditActor {
  actorType: AuditActorType;
  adminId?: string | null;
  label?: string | null;
  /** Route, job or provider name (ASCII, ≤ 160). */
  ref?: string | null;
  source?: AuditSource;
}

export const REQUEST_ID_HEADER = 'x-request-id';

const TTL_MS = 60_000;
const MAX_ENTRIES = 500;
const registry = new Map<string, { actor: AuditActor; at: number }>();

function prune(now: number) {
  if (registry.size < MAX_ENTRIES) return;
  for (const [key, entry] of registry) {
    if (now - entry.at > TTL_MS || registry.size >= MAX_ENTRIES) registry.delete(key);
    if (registry.size < MAX_ENTRIES / 2) break;
  }
}

/** Called by requirePermission() after the admin has been verified. */
export function registerRequestActor(requestId: string | null | undefined, actor: AuditActor): void {
  if (!requestId) return;
  const now = Date.now();
  prune(now);
  registry.set(requestId, { actor, at: now });
}

export function requestActor(requestId: string | null | undefined): AuditActor | null {
  if (!requestId) return null;
  const entry = registry.get(requestId);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) { registry.delete(requestId); return null; }
  return entry.actor;
}

export function adminActorLabel(context: { firstName: string | null; lastName: string | null; nickname: string | null }): string {
  const full = [context.firstName, context.lastName].filter(Boolean).join(' ').trim();
  return full || context.nickname?.trim() || 'Administrateur';
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

const SAFE_REF = /^[A-Za-z0-9/:._[\]-]{1,160}$/;
const SAFE_CORRELATION = /^[A-Za-z0-9:._-]{1,100}$/;

/** Header set read by `audit_request_context()`; invalid parts are dropped. */
export function auditHeaders(actor: AuditActor | null, correlationId: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (actor) {
    out['x-lepefy-audit-actor-type'] = actor.actorType;
    if (actor.adminId && /^[0-9a-f-]{36}$/i.test(actor.adminId)) out['x-lepefy-audit-actor-id'] = actor.adminId.toLowerCase();
    if (actor.label) out['x-lepefy-audit-actor-label'] = base64Utf8(actor.label.slice(0, 120));
    if (actor.ref && SAFE_REF.test(actor.ref)) out['x-lepefy-audit-actor-ref'] = actor.ref;
    out['x-lepefy-audit-source'] = actor.source ?? 'app';
  }
  if (correlationId && SAFE_CORRELATION.test(correlationId)) out['x-lepefy-audit-correlation-id'] = correlationId;
  return out;
}

/** Normalises a dynamic admin path into its route shape (ids → [id]). */
export function routeRef(path: string | null | undefined): string | null {
  if (!path) return null;
  const shape = path.split('?')[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    .replace(/\/\d+(?=\/|$)/g, '/[n]');
  return SAFE_REF.test(shape) ? shape : null;
}

/**
 * RPCs that write audited tables. Only these POSTs read the request headers:
 * read RPCs (match_products, catalog_ranked_product_ids…) run inside ISR pages.
 */
const AUDITED_WRITE_RPCS = new Set([
  'convert_checkout_session_to_order', 'replace_admin_role_permissions', 'external_catalog_apply_item',
  'record_supplier_receipt', 'reverse_supplier_receipt', 'adjust_inventory', 'adjust_event_capacity',
  'delete_customer_account_data', 'select_shipping_tariff_shadow_version', 'activate_shipping_tariff_version', 'publish_shipping_tariff_version',
  'rollback_shipping_tariff_to_provider_cost', 'retire_shipping_tariff_country', 'process_manual_purchase_points_atomic',
  'record_audit_event', 'apply_product_promotion_schedule',
  'catalog_campaign_select_products', 'catalog_campaign_remove_products', 'catalog_campaign_override_price',
  'catalog_campaign_create', 'catalog_campaign_duplicate', 'catalog_campaign_action',
]);

/** Does this PostgREST request change data the triggers audit? */
export function isAuditedWrite(url: string, method: string | undefined): boolean {
  const verb = (method ?? 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false;
  const match = /\/rest\/v1\/(rpc\/)?([A-Za-z0-9_]+)/.exec(url);
  if (!match) return false;
  return match[1] ? AUDITED_WRITE_RPCS.has(match[2]!) : true;
}

/** Context of the current request; null outside a request (scripts, build). */
function currentRequestAudit(): { actor: AuditActor | null; correlationId: string | null } | null {
  try {
    const h = headers();
    const requestId = h.get(REQUEST_ID_HEADER);
    const correlationId = requestId ?? h.get('x-vercel-id')?.replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 100) ?? null;
    return { actor: requestActor(requestId), correlationId };
  } catch {
    return null;
  }
}

/**
 * fetch for the Supabase service client. Adds the audit headers to writes;
 * an explicit actor (workers, webhooks) wins over the request registry.
 * Never throws because of auditing: worst case, the write goes out unattributed.
 */
export function createAuditFetch(explicit?: AuditActor): typeof fetch {
  return (input, init) => {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : undefined);
      if (isAuditedWrite(url, method)) {
        const context = currentRequestAudit();
        const extra = auditHeaders(explicit ?? context?.actor ?? null, context?.correlationId ?? null);
        if (Object.keys(extra).length > 0) {
          const merged = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
          for (const [key, value] of Object.entries(extra)) merged.set(key, value);
          return fetch(input, { ...init, headers: merged });
        }
      }
    } catch {
      // Attribution is best effort; the business write must go through.
    }
    return fetch(input, init);
  };
}
