import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatWhatsappPhone, maskWhatsappPhone, normalizeWhatsappPhone } from '../../src/lib/notifications/staff/staffWhatsapp';
import {
  coldChainKinds, countryCode, customerShortName, isInternationalDestination, itemCount, newOrderPriority,
} from '../../src/lib/notifications/staff/orderSignals';
import {
  backlogSummaryAlert, orderCreatedAlert, renderStaffWhatsapp, shipmentAlert, staffAlertUrl, staffEmailSubject, type OrderFacts,
} from '../../src/lib/notifications/staff/staffMessages';
import { staffAlertEmail } from '../../src/lib/notifications/operationalEmails';
import { classifySendResponse, readGreenApiOutboundConfig, sendGreenApiText, whatsappChatId } from '../../src/lib/notifications/providers/greenApiOutbound';
import { attemptUpdate } from '../../src/lib/notifications/deliveryLedger';
import { followUpUpdate } from '../../src/lib/notifications/whatsappFollowUp';
import { buildDeliveryRow, deliveryKey, dispatchTenantNotification, type DispatchDeps } from '../../src/lib/notifications/staff/dispatcher';
import { orderCreatedAudience, orderFactsFrom } from '../../src/lib/notifications/staff/orderEvents';
import { shipmentIssuesFor } from '../../src/lib/notifications/staff/shipmentSignals';
import {
  buildBackfillPlan, classifyOrder, ineligibilityReason, planFingerprintSource, type BackfillOrder, type ExistingDelivery, type RecipientTargets,
} from '../../src/lib/notifications/staff/backfillPlan';
import { orderIdRange } from '../../src/lib/notifications/staff/backfillPlan';
import { parseSubscriptionChanges, typeSupportsChannel, RECOMMENDED_SUBSCRIPTIONS } from '../../src/lib/notifications/notificationTypes';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';

const R1 = '0f8c2b36-5a3d-4c41-9f2e-6c1b8c0a1d11';
const R2 = '1f8c2b36-5a3d-4c41-9f2e-6c1b8c0a1d12';
const ORDER = 'a82f19c4-1111-4111-8111-111111111111';

const context = {
  tenantId: 't1', tenantSlug: 'chloefood', tenantName: 'Chloe Food', storefrontUrl: 'https://shop.chloefood.com', locale: 'fr-FR', currency: 'EUR',
  branding: { logoUrl: null, primaryColor: '#7c3aed', secondaryColor: '#111111', accentColor: '#eeeeee' },
  emailBranding: { fromName: 'Chloe Food', fromEmail: 'chloe@lepefy.com', supportEmail: 'support@chloe.test', whatsappNumber: '+390000000000' },
  business: { city: 'Roma', country: 'IT', legalAddress: null }, pickup: { address: null, mapsUrl: null, hours: null },
} as TenantNotificationContext;

function facts(partial: Partial<OrderFacts> = {}): OrderFacts {
  return {
    orderId: ORDER, orderNumber: '#A82F19C4', customer: 'Marie K.', total: 86.5, items: 5, fulfillment: 'delivery',
    paymentLabel: 'Carte bancaire', paymentPending: false, destinationCountry: 'BE', international: true, fresh: true, frozen: false, assisted: false,
    shipment: { provider: 'Packlink PRO', providerReference: 'IT2026PRO0012345', lepefyReference: 'LEPEFY-A82F19C4', draftStatus: 'Brouillon créé', carrier: 'BRT', trackingCode: 'BRT123', trackingUrl: 'https://track.example/BRT123', estimatedDelivery: null },
    ...partial,
  };
}

test.describe('channels and numbers', () => {
  test('WhatsApp numbers are international E.164, never guessed', () => {
    expect(normalizeWhatsappPhone('+39 333 123 4567')).toBe('+393331234567');
    expect(normalizeWhatsappPhone('0039 (333) 123-4567')).toBe('+393331234567');
    expect(normalizeWhatsappPhone('333 123 4567')).toBeNull();
    expect(normalizeWhatsappPhone('+39 333 abc')).toBeNull();
    expect(normalizeWhatsappPhone('+0123456789')).toBeNull();
    expect(maskWhatsappPhone('+393331234567')).toBe('+39 333 ••• 4567');
    expect(formatWhatsappPhone('+393331234567')).toBe('+39 333 123 4567');
    expect(whatsappChatId('+393331234567')).toBe('393331234567@c.us');
    expect(whatsappChatId('393331234567')).toBeNull();
  });

  test('a subscription is only stored on a channel its type supports', () => {
    expect(parseSubscriptionChanges({ changes: [{ recipientId: R1, typeKey: 'order_created', subscribed: true, channel: 'whatsapp' }] }))
      .toEqual([{ recipientId: R1, typeKey: 'order_created', subscribed: true, channel: 'whatsapp' }]);
    expect(parseSubscriptionChanges({ changes: [{ recipientId: R1, typeKey: 'daily_digest', subscribed: true, channel: 'whatsapp' }] })).toBeNull();
    expect(parseSubscriptionChanges({ changes: [{ recipientId: R1, typeKey: 'order_created', subscribed: true, channel: 'sms' }] })).toBeNull();
    // Payloads written before migration 158 stay email.
    expect(parseSubscriptionChanges({ changes: [{ recipientId: R1, typeKey: 'card_payment', subscribed: true }] })).toEqual([{ recipientId: R1, typeKey: 'card_payment', subscribed: true }]);
    for (const channel of ['email', 'whatsapp'] as const) for (const key of RECOMMENDED_SUBSCRIPTIONS[channel]) expect(typeSupportsChannel(key, channel)).toBe(true);
  });

  test('test messages and recipient edits use the settings permissions', () => {
    expect(permissionForAdminApi(`/api/admin/notification-recipients/${R1}/test`, 'POST')).toBe('tenant_settings.manage');
    expect(permissionForAdminApi(`/api/admin/notification-recipients/${R1}/whatsapp-confirm`, 'POST')).toBe('tenant_settings.manage');
    // The catch-up is platform-owner only: no tenant permission grants it.
    expect(permissionForAdminApi('/api/admin/platform/notifications/backfill/preview', 'POST')).toBeNull();
  });
});

test.describe('order signals', () => {
  test('international, cold chain and priority come from stored data only', () => {
    expect(countryCode('Italia')).toBe('IT');
    expect(countryCode('be')).toBe('BE');
    expect(countryCode('Atlantide')).toBeNull();
    expect(isInternationalDestination('BE', 'IT')).toBe(true);
    expect(isInternationalDestination('IT', 'Italie')).toBe(false);
    expect(isInternationalDestination('BE', null)).toBeNull();
    // Names never matter: « Poisson frais » stored as dry is not fresh.
    expect(coldChainKinds([{ quantity: 1, storage_type: 'dry' }])).toEqual({ fresh: false, frozen: false });
    expect(coldChainKinds([{ quantity: 1, storage_type: 'frozen' }])).toEqual({ fresh: false, frozen: true });
    expect(itemCount([{ quantity: 2 }, { quantity: 3 }])).toBe(5);
    expect(newOrderPriority({ international: false, fresh: false, frozen: false, fulfillmentType: 'pickup' })).toBe('normal');
    expect(newOrderPriority({ international: true, fresh: false, frozen: false, fulfillmentType: 'delivery' })).toBe('high');
    expect(customerShortName('Marie Koné')).toBe('Marie K.');
    expect(customerShortName('  ')).toBeNull();
  });

  test('order facts: Packlink PRO references and audience flags', () => {
    const { facts: built, priority } = orderFactsFrom({
      id: ORDER, tenant_id: 't1', full_name: 'Marie Koné', total: 86.5, fulfillment_type: 'delivery', shipping_address: { country: 'BE' },
      payment_method: 'stripe', payment_status: 'paid', status: 'preparing', external_payment_label: null, is_test: false, created_at: '', updated_at: '',
      shipping_provider_key: null, shipping_provider_reference: null, shipping_creation_status: 'pending',
    }, [{ quantity: 2, storage_type: 'fresh' }, { quantity: 3, storage_type: 'dry' }], { country: 'IT', shipping_provider: 'packlink' });
    expect(built).toMatchObject({ orderNumber: '#A82F19C4', customer: 'Marie K.', items: 5, international: true, fresh: true, paymentLabel: 'Carte bancaire' });
    expect(built.shipment).toMatchObject({ provider: 'Packlink PRO', lepefyReference: 'LEPEFY-A82F19C4', draftStatus: 'Création en attente', providerReference: null });
    expect(priority).toBe('high');
    expect(orderCreatedAudience(built)).toEqual(['order_created', 'order_international', 'order_fresh_products']);
    expect(orderCreatedAudience({ international: false, fresh: false, frozen: false })).toEqual(['order_created']);
  });
});

test.describe('templates', () => {
  test('one WhatsApp message per order with indicators, Packlink refs and the canonical admin link', () => {
    const text = renderStaffWhatsapp(orderCreatedAlert(facts(), 'high'), { tenantName: 'Chloe Food', storefrontUrl: 'https://shop.chloefood.com' });
    expect(text).toContain('*Nouvelle commande #A82F19C4*');
    expect(text).toContain('🟠 PRIORITAIRE');
    expect(text).toContain('🌍 Livraison internationale : Belgique');
    expect(text).toContain('❄️ Produits frais');
    expect(text).toContain('Montant : 86,50 €');
    expect(text).toContain('Packlink PRO : réf. IT2026PRO0012345');
    expect(text).toContain('Réf. Lepefy : LEPEFY-A82F19C4');
    expect(text).toContain('https://shop.chloefood.com/admin/orders/a82f19c4-1111-4111-8111-111111111111');
    expect(text).not.toMatch(/@|Téléphone|IBAN/);
    expect(text.length).toBeLessThan(1500);
  });

  test('no link without a canonical https storefront URL', () => {
    expect(staffAlertUrl(null, '/admin')).toBeNull();
    expect(staffAlertUrl('http://shop.example', '/admin')).toBeNull();
    const text = renderStaffWhatsapp(orderCreatedAlert(facts(), 'normal'), { tenantName: 'X', storefrontUrl: null });
    expect(text).not.toContain('Voir la commande');
  });

  test('email rendering escapes values and marks tests', () => {
    const alert = orderCreatedAlert(facts({ customer: '<script>x</script>' }), 'normal');
    const email = staffAlertEmail(context, alert, true);
    expect(email.subject).toBe('[TEST] Nouvelle commande #A82F19C4 · Chloe Food');
    expect(email.html).not.toContain('<script>x');
    expect(email.html).toContain('[TEST]');
    expect(staffEmailSubject(shipmentAlert('shipment_creation_failed', facts(), 'Colis non déterminable'), 'Chloe Food')).toMatch(/^\[Urgent\] Expédition non créée/);
  });

  test('catch-up summary is bounded', () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({ orderNumber: `#O${i}`, customer: null, total: 10, priority: i === 0 ? 'high' as const : 'normal' as const, international: false, fresh: false, frozen: false }));
    const alert = backlogSummaryAlert(lines, '/admin');
    expect(alert.title).toBe('20 commandes à traiter');
    expect(alert.note).toContain('… et 5 autres');
    expect(alert.details).toEqual([['Montant total', '200,00 €']]);
  });
});

test.describe('Green API outcomes', () => {
  test('HTTP answers are classified without ever claiming a false success', () => {
    expect(classifySendResponse(200, '{"idMessage":"3EB0C767D097B7C7C030"}')).toMatchObject({ ok: true, messageId: '3EB0C767D097B7C7C030' });
    expect(classifySendResponse(200, '{}')).toMatchObject({ ok: false, uncertain: true });
    expect(classifySendResponse(466, '{"correspondentsStatus":{}}')).toMatchObject({ ok: false, definitive: true, error: 'green_api_quota_exceeded' });
    expect(classifySendResponse(400, 'instance is starting or not authorized')).toMatchObject({ ok: false, error: 'green_api_instance_not_authorized' });
    expect(classifySendResponse(400, 'Validation failed')).toMatchObject({ ok: false, definitive: true });
    expect(classifySendResponse(429, '')).toMatchObject({ ok: false, error: 'green_api_rate_limited' });
    expect(classifySendResponse(401, '').uncertain).toBeUndefined();
    expect(classifySendResponse(499, '')).toMatchObject({ uncertain: true });
  });

  test('a timeout is uncertain and the token never appears in errors', async () => {
    const config = { apiUrl: 'https://7105.api.green-api.com', idInstance: '7105123456', apiToken: 'SECRETTOKEN123456', source: 'shared' as const };
    const urls: string[] = [];
    const slow: typeof fetch = async (url, init) => {
      urls.push(String(url));
      await new Promise((resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      throw new Error('unreachable');
    };
    const result = await sendGreenApiText(config, { phone: '+393331234567', message: 'x' }, { fetch: slow, timeoutMs: 10 });
    expect(result).toMatchObject({ ok: false, uncertain: true, error: 'green_api_timeout' });
    expect(JSON.stringify(result)).not.toContain('SECRETTOKEN');
    expect(urls[0]).toBe('https://7105.api.green-api.com/waInstance7105123456/sendMessage/SECRETTOKEN123456');
    const down: typeof fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
    expect(await sendGreenApiText(config, { phone: '+393331234567', message: 'x' }, { fetch: down })).toMatchObject({ ok: false, error: 'green_api_unreachable' });
    expect((await sendGreenApiText(config, { phone: '333', message: 'x' })).definitive).toBe(true);
  });

  test('credentials: dedicated first, names only on failure', () => {
    expect(readGreenApiOutboundConfig({})).toMatchObject({ ok: false, reason: 'missing' });
    expect(readGreenApiOutboundConfig({ GREEN_API_URL: 'https://x.api.green-api.com', GREEN_API_INSTANCE_ID: '1234', GREEN_API_TOKEN: 'abcdefgh12' }))
      .toMatchObject({ ok: true, config: { source: 'shared' } });
    expect(readGreenApiOutboundConfig({ GREEN_API_NOTIFY_URL: 'https://x.api.green-api.com', GREEN_API_NOTIFY_INSTANCE_ID: '1234', GREEN_API_NOTIFY_TOKEN: 'abcdefgh12', GREEN_API_URL: 'https://y.api.green-api.com', GREEN_API_INSTANCE_ID: '9', GREEN_API_TOKEN: 'z' }))
      .toMatchObject({ ok: true, config: { source: 'dedicated', idInstance: '1234' } });
    const evil = readGreenApiOutboundConfig({ GREEN_API_URL: 'https://evil.example.com', GREEN_API_INSTANCE_ID: '1234', GREEN_API_TOKEN: 'abcdefgh12' });
    expect(evil).toEqual({ ok: false, reason: 'invalid', detail: 'GREEN_API_URL' });
  });
});

test.describe('ledger statuses', () => {
  const wa = { attempts: 1, max_attempts: 5, webhook_path: '/whatsapp/send-message' };
  test('accepted WhatsApp keeps its payload for the delivery check; uncertain is never retried', () => {
    expect(attemptUpdate(wa, { ok: true })).toMatchObject({ status: 'accepted' });
    expect(attemptUpdate(wa, { ok: true })).not.toHaveProperty('payload');
    expect(attemptUpdate({ ...wa, webhook_path: '/webhook/send-email' }, { ok: true })).toMatchObject({ status: 'accepted', payload: null });
    expect(attemptUpdate(wa, { ok: false, uncertain: true, error: 'green_api_timeout' })).toMatchObject({ status: 'unknown' });
    expect(attemptUpdate(wa, { ok: false, uncertain: true })).not.toHaveProperty('next_attempt_at');
    expect(attemptUpdate(wa, { ok: false, definitive: true })).toMatchObject({ status: 'dead' });
    expect(attemptUpdate(wa, { ok: false, error: 'green_api_rate_limited' })).toMatchObject({ status: 'failed' });
    expect(attemptUpdate(wa, { ok: true, skipped: true, error: 'whatsapp_disabled' })).toMatchObject({ status: 'skipped', payload: null });
  });

  test('provider status: delivered/read → delivered (read is not assumed), failed → retry', () => {
    const now = new Date('2026-10-16T10:00:00Z');
    expect(followUpUpdate({ attempts: 1, max_attempts: 5 }, 'read', now)).toMatchObject({ status: 'delivered', provider_status: 'read', payload: null });
    expect(followUpUpdate({ attempts: 1, max_attempts: 5 }, 'sent', now)).toEqual({ provider_status: 'sent', provider_checked_at: now.toISOString() });
    expect(followUpUpdate({ attempts: 5, max_attempts: 5 }, 'failed', now)).toMatchObject({ status: 'dead' });
    expect(followUpUpdate({ attempts: 1, max_attempts: 5 }, null, now)).not.toHaveProperty('status');
  });
});

test.describe('shipment incidents', () => {
  test('only provider data: exception once per status, delay once per ETA', () => {
    const snapshot = { normalizedStatus: 'exception', providerStatus: 'INCIDENT', estimatedDeliveryAt: null, providerReference: 'P1' };
    expect(shipmentIssuesFor({ normalizedStatus: 'in_transit' }, snapshot)).toHaveLength(1);
    expect(shipmentIssuesFor({ normalizedStatus: 'exception' }, snapshot)).toHaveLength(0);
    const late = { normalizedStatus: 'in_transit', providerStatus: null, estimatedDeliveryAt: '2026-10-10', providerReference: 'P1' };
    const [delay] = shipmentIssuesFor({ normalizedStatus: 'in_transit' }, late, new Date('2026-10-16T00:00:00Z'));
    expect(delay).toMatchObject({ kind: 'shipment_delayed', occurrenceId: 'eta:P1:2026-10-10' });
    expect(shipmentIssuesFor({ normalizedStatus: 'in_transit' }, late, new Date('2026-10-10T20:00:00Z'))).toHaveLength(0);
    expect(shipmentIssuesFor({ normalizedStatus: 'delivered' }, { ...late, normalizedStatus: 'delivered' }, new Date('2026-10-16'))).toHaveLength(0);
  });
});

// ─── Dispatcher with an in-memory database ──────────────────────────────────

function memoryDb(targets: Array<{ recipient_id: string; type_key: string; address: string; channel: string }>) {
  const events: Array<Record<string, unknown>> = [];
  const deliveries: Array<Record<string, unknown>> = [];
  const db = {
    rpc: async (_fn: string, args: { p_channel: string; p_type_keys: string[] }) => ({
      data: targets.filter((t) => t.channel === args.p_channel && args.p_type_keys.includes(t.type_key)), error: null,
    }),
    from(table: string) {
      const rows = table === 'tenant_notification_events' ? events : deliveries;
      const filters: Record<string, unknown> = {};
      const builder = {
        upsert(input: Record<string, unknown> | Array<Record<string, unknown>>, options: { onConflict: string }) {
          const keys = options.onConflict.split(',');
          const inserted: Array<Record<string, unknown>> = [];
          for (const row of Array.isArray(input) ? input : [input]) {
            if (rows.some((existing) => keys.every((key) => existing[key] === row[key]))) continue;
            const created = { id: `${table}-${rows.length + 1}`, ...row };
            rows.push(created); inserted.push(created);
          }
          return { select: async () => ({ data: inserted, error: null }) };
        },
        select() { return builder; },
        match(values: Record<string, unknown>) { Object.assign(filters, values); return builder; },
        eq(key: string, value: unknown) { filters[key] = value; return builder; },
        maybeSingle: async () => ({ data: rows.find((row) => Object.entries(filters).every(([k, v]) => row[k] === v)) ?? null, error: null }),
        update(patch: Record<string, unknown>) {
          const where: Record<string, unknown> = {};
          const chain = {
            eq(key: string, value: unknown) { where[key] = value; return chain; },
            select() { return chain; },
            maybeSingle: async () => {
              const row = rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v));
              if (row) Object.assign(row, patch);
              return { data: row ?? null, error: null };
            },
            then(resolve: (value: { error: null }) => void) {
              for (const row of rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v))) Object.assign(row, patch);
              resolve({ error: null });
            },
          };
          return chain;
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, events, deliveries };
}

function deps(db: SupabaseClient, options: { whatsapp?: boolean; send?: DispatchDeps['send'] } = {}): DispatchDeps {
  return {
    db, getContext: async () => context, isWhatsappEnabled: async () => options.whatsapp ?? true,
    send: options.send ?? (async () => ({ ok: true, transport: 'green_api', messageId: 'm1' })), pause: async () => {},
  };
}

const input = () => ({
  tenantId: 't1', eventType: 'order_created', entityType: 'order', entityId: ORDER, occurrenceId: 'created',
  alert: orderCreatedAlert(facts(), 'high'), audienceTypes: ['order_created', 'order_international'],
});

test.describe('dispatcher', () => {
  const targets = [
    { recipient_id: R1, type_key: 'order_created', address: 'owner@chloe.test', channel: 'email' },
    { recipient_id: R1, type_key: 'order_created', address: '+393331234567', channel: 'whatsapp' },
    // Subscribed to the flag only: still one message, not two.
    { recipient_id: R2, type_key: 'order_international', address: '+393339999999', channel: 'whatsapp' },
    { recipient_id: R2, type_key: 'order_created', address: '+393339999999', channel: 'whatsapp' },
  ];

  test('one row per recipient × channel; a replayed webhook sends nothing more', async () => {
    const memory = memoryDb(targets);
    const sends: string[] = [];
    const d = deps(memory.db, { send: async (path) => { sends.push(path); return { ok: true }; } });
    const first = await dispatchTenantNotification(input(), d);
    expect(first).toMatchObject({ queued: 3, alreadyQueued: 0, targets: { email: 1, whatsapp: 2 }, accepted: 3 });
    expect(memory.deliveries.map((row) => row.idempotency_key)).toEqual([
      deliveryKey(first.eventId!, R1, 'email'), deliveryKey(first.eventId!, R1, 'whatsapp'), deliveryKey(first.eventId!, R2, 'whatsapp'),
    ]);
    const replay = await dispatchTenantNotification(input(), d);
    expect(replay).toMatchObject({ eventId: first.eventId, queued: 0, alreadyQueued: 3, accepted: 0 });
    expect(memory.events).toHaveLength(1);
    expect(sends).toHaveLength(3);
  });

  test('WhatsApp flag off: email only; provider down never throws', async () => {
    const memory = memoryDb(targets);
    const off = await dispatchTenantNotification(input(), deps(memory.db, { whatsapp: false }));
    expect(off).toMatchObject({ queued: 1, targets: { email: 1, whatsapp: 0 } });
    const memory2 = memoryDb(targets);
    const down = await dispatchTenantNotification(input(), deps(memory2.db, { send: async () => { throw new Error('boom'); } }));
    expect(down.error).toBeUndefined();
    expect(down).toMatchObject({ queued: 3, accepted: 0 });
    expect(memory2.deliveries.every((row) => row.status === 'failed')).toBe(true);
  });

  test('catch-up restriction and queue-only mode', async () => {
    const memory = memoryDb(targets);
    const result = await dispatchTenantNotification({ ...input(), only: [{ recipientId: R2, channel: 'whatsapp' }], sendNow: false, source: 'backfill' }, deps(memory.db));
    expect(result).toMatchObject({ queued: 1, attempted: 0 });
    expect(memory.deliveries[0]).toMatchObject({ status: 'pending', recipient_id: R2, channel: 'whatsapp' });
    expect(memory.events[0]).toMatchObject({ source: 'backfill' });
  });

  test('delivery rows carry a masked number in the history, the full one only in the payload', () => {
    const row = buildDeliveryRow({ tenantId: 't1', eventId: 'e1', eventType: 'order_created', target: { recipientId: R1, channel: 'whatsapp', address: '+393331234567' }, alert: orderCreatedAlert(facts(), 'normal'), context, now: new Date() });
    expect(row).toMatchObject({ webhook_path: '/whatsapp/send-message', recipients: ['+39 333 ••• 4567'], status: 'pending', attempts: 0 });
    expect((row.payload as { to: string }).to).toBe('+393331234567');
    const email = buildDeliveryRow({ tenantId: 't1', eventId: 'e1', eventType: 'order_created', target: { recipientId: R1, channel: 'email', address: 'a@b.it' }, alert: orderCreatedAlert(facts(), 'normal'), context, now: new Date() });
    expect(email).toMatchObject({ webhook_path: '/webhook/send-email', recipients: ['a@b.it'] });
    expect((email.payload as { idempotencyKey: string }).idempotencyKey).toBe('notif:e1:' + R1 + ':email');
  });
});

// ─── Catch-up planning ──────────────────────────────────────────────────────

function order(id: string, partial: Partial<BackfillOrder> = {}): BackfillOrder {
  return {
    id, orderNumber: `#${id.slice(0, 8).toUpperCase()}`, customer: null, total: 10, status: 'preparing', paymentStatus: 'paid', paymentMethod: 'stripe',
    isTest: false, fulfillment: 'delivery', international: false, fresh: false, frozen: false, priority: 'normal', createdAt: '2026-10-01', updatedAt: '2026-10-01',
    audience: ['order_created'], ...partial,
  };
}

const targetsBoth = (): RecipientTargets => ({
  email: new Map([[R1, new Set(['order_created'])]]),
  whatsapp: new Map([[R1, new Set(['order_created'])], [R2, new Set(['order_fresh_products'])]]),
});

test.describe('catch-up plan', () => {
  test('eligibility: open, paid (or to collect in the shop), not test', () => {
    expect(ineligibilityReason(order('a'))).toBeNull();
    expect(ineligibilityReason(order('a', { paymentMethod: 'in_store', paymentStatus: 'pending' }))).toBeNull();
    expect(ineligibilityReason(order('a', { status: 'cancelled' }))).toBe('Annulée');
    expect(ineligibilityReason(order('a', { status: 'delivered' }))).toBe('Livrée ou retirée');
    expect(ineligibilityReason(order('a', { paymentStatus: 'pending' }))).toBe('Paiement non confirmé');
    expect(ineligibilityReason(order('a', { isTest: true }))).toBe('Commande de test');
  });

  test('classification separates not notified, failed, in flight, uncertain and notified', () => {
    const pairs = [{ recipientId: R1, channel: 'email' as const }, { recipientId: R1, channel: 'whatsapp' as const }];
    const d = (status: ExistingDelivery['status'], channel: 'email' | 'whatsapp', id = `${status}-${channel}`): ExistingDelivery => ({ id, orderId: 'o', recipientId: R1, channel, status });
    expect(classifyOrder(pairs, []).state).toBe('not_notified');
    expect(classifyOrder(pairs, [d('accepted', 'email'), d('delivered', 'whatsapp')]).state).toBe('notified');
    expect(classifyOrder(pairs, [d('failed', 'email'), d('dead', 'whatsapp')])).toMatchObject({ state: 'failed', retry: [{ deliveryId: 'failed-email' }, { deliveryId: 'dead-whatsapp' }] });
    expect(classifyOrder(pairs, [d('accepted', 'email')])).toMatchObject({ state: 'partial', missing: [{ channel: 'whatsapp' }] });
    expect(classifyOrder(pairs, [d('pending', 'email'), d('processing', 'whatsapp')]).state).toBe('pending');
    expect(classifyOrder(pairs, [d('accepted', 'email'), d('unknown', 'whatsapp')])).toMatchObject({ state: 'partial', uncertain: 1, missing: [], retry: [] });
    expect(classifyOrder([], []).state).toBe('no_target');
    expect(classifyOrder(pairs, [], new Set([`${R1}:email`, `${R1}:whatsapp`])).state).toBe('notified');
  });

  test('mixed batch: counts are deliveries, not orders; notified/cancelled/unpaid excluded with a reason', () => {
    const plan = buildBackfillPlan({
      orders: [
        order('o1'), order('o2', { fresh: true, audience: ['order_created', 'order_fresh_products'] }),
        order('o3'), order('o4', { status: 'cancelled' }), order('o5', { paymentStatus: 'pending' }),
      ],
      missingIds: ['o6-missing'],
      targets: targetsBoth(),
      existing: new Map([
        ['o3', [{ id: 'x', orderId: 'o3', recipientId: R1, channel: 'email', status: 'accepted' }, { id: 'y', orderId: 'o3', recipientId: R1, channel: 'whatsapp', status: 'accepted' }]],
        ['o1', [{ id: 'f1', orderId: 'o1', recipientId: R1, channel: 'whatsapp', status: 'failed' }]],
      ]),
      covered: new Map(),
      channels: ['whatsapp', 'email'],
      mode: 'individual',
    });
    expect(plan.selected).toBe(6);
    expect(plan.eligibleIds).toEqual(['o1', 'o2']);
    // o1: email new + whatsapp retry; o2: email + whatsapp R1 + whatsapp R2 (fresh flag).
    expect(plan.messages).toEqual({ email: 2, whatsapp: 3 });
    expect(plan.retries).toBe(1);
    expect(plan.newDeliveries).toBe(4);
    expect(plan.recipients).toBe(2);
    expect(plan.excluded.map((item) => item.reason).sort()).toEqual(['Annulée', 'Commande introuvable', 'Déjà notifiée', 'Paiement non confirmé']);
  });

  test('summary: one message per recipient × channel; fingerprint changes when an order changes', () => {
    const base = { targets: targetsBoth(), existing: new Map(), covered: new Map(), channels: ['email', 'whatsapp'] as const, mode: 'summary' as const };
    const orders = [order('o1'), order('o2', { fresh: true, audience: ['order_created', 'order_fresh_products'] })];
    const plan = buildBackfillPlan({ ...base, channels: [...base.channels], orders });
    expect(plan.messages).toEqual({ email: 1, whatsapp: 2 });
    expect(plan.summaryOrderIds).toEqual(['o1', 'o2']);
    const fp = planFingerprintSource(orders, plan);
    const changed = [order('o1', { updatedAt: '2026-10-02' }), orders[1]!];
    expect(planFingerprintSource(changed, buildBackfillPlan({ ...base, channels: [...base.channels], orders: changed }))).not.toBe(fp);
    // Re-scan after the summary was delivered: nothing left to send.
    const covered = new Map([['o1', new Set([`${R1}:email`, `${R1}:whatsapp`])], ['o2', new Set([`${R1}:email`, `${R1}:whatsapp`, `${R2}:whatsapp`])]]);
    expect(buildBackfillPlan({ ...base, channels: [...base.channels], orders, covered }).eligibleIds).toEqual([]);
  });

  test('order reference search becomes an id range', () => {
    expect(orderIdRange('#A82F19C4')).toEqual(['a82f19c4-0000-0000-0000-000000000000', 'a82f19c4-ffff-ffff-ffff-ffffffffffff']);
    expect(orderIdRange('a82f')).toEqual(['a82f0000-0000-0000-0000-000000000000', 'a82fffff-ffff-ffff-ffff-ffffffffffff']);
    expect(orderIdRange('Marie')).toBeNull();
  });
});
