import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  classifyEmail, eventKey, isAuthorizedBrevoWebhook, isFoodEmail, maskEmail, normalizeBrevoEvent, parseBrevoEvent,
  recipientHash, sanitizeReason, typesForCategory, NOTIFICATION_TYPE_CATEGORY,
} from '../../src/lib/notifications/brevoEvents';
import {
  computeKpis, dailySeries, enrich, failureDistribution, matchesEventFilter, median, messageStatus, openKindOf,
  resolvePeriod, shopDayStart, type MessageRow,
} from '../../src/lib/notifications/brevoAnalytics';

const TOKEN = 'x'.repeat(32);
const NOW = new Date('2026-10-28T10:00:00Z');

function payload(extra: Record<string, unknown> = {}) {
  return { event: 'delivered', email: 'Marie@Example.com', 'message-id': '<202610280900.1@smtp-relay.mailin.fr>', ts_event: 1_793_181_600, tags: ['order_confirmed'], template_id: 4, subject: 'Votre commande', ...extra };
}

function row(extra: Partial<MessageRow> = {}): MessageRow {
  return {
    message_id: '<m1>', recipient_hash: 'h1', first_event_at: '2026-10-27T09:00:00Z', sent_at: '2026-10-27T09:00:00Z', delivered_at: '2026-10-27T09:00:05Z',
    first_open_at: null, proxy_open_at: null, click_at: null, click_events: 0, open_events: 0, failed_at: null, failure_event: null,
    has_error: false, has_deferred: false, recipient_masked: 'm***@example.com', tags: ['order_confirmed'], template_id: null, reason: null,
    delivery_id: 'd1', tenant_id: 't1', notification_type: 'order_confirmed', subject: 'Commande', entity_type: 'order', entity_id: 'o1', ...extra,
  };
}

test.describe('webhook payload', () => {
  test('Brevo event names map to the normalised events and unknown ones are ignored', () => {
    expect(normalizeBrevoEvent('request')).toBe('sent');
    expect(normalizeBrevoEvent('unique_opened')).toBe('first_open');
    expect(normalizeBrevoEvent('opened')).toBe('open');
    expect(normalizeBrevoEvent('click')).toBe('click');
    expect(normalizeBrevoEvent('proxy_open')).toBe('proxy_open');
    expect(normalizeBrevoEvent('soft_bounce')).toBe('soft_bounce');
    expect(normalizeBrevoEvent('hard_bounce')).toBe('hard_bounce');
    expect(normalizeBrevoEvent('blocked')).toBe('blocked');
    expect(normalizeBrevoEvent('invalid_email')).toBe('invalid');
    expect(normalizeBrevoEvent('error')).toBe('error');
    expect(normalizeBrevoEvent('something_new')).toBeNull();
    expect(normalizeBrevoEvent(42)).toBeNull();
  });

  test('parses a delivered event; subject and address are not kept in the parsed event beyond what is needed', () => {
    const result = parseBrevoEvent(payload(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ event: 'delivered', messageId: '<202610280900.1@smtp-relay.mailin.fr>', email: 'marie@example.com', tags: ['order_confirmed'], templateId: 4, linkHost: null });
    expect(JSON.stringify(result.value)).not.toContain('Votre commande');
  });

  test('rejects malformed payloads', () => {
    expect(parseBrevoEvent(null).ok).toBe(false);
    expect(parseBrevoEvent([]).ok).toBe(false);
    expect(parseBrevoEvent(payload({ event: 'weird' }))).toMatchObject({ ok: false, reason: 'unknown_event' });
    expect(parseBrevoEvent(payload({ 'message-id': '' }))).toMatchObject({ ok: false, reason: 'missing_message_id' });
    expect(parseBrevoEvent(payload({ email: 'not-an-email' }))).toMatchObject({ ok: false, reason: 'missing_email' });
    expect(parseBrevoEvent(payload({ ts_event: undefined, ts_epoch: undefined, date: 'garbage' }), NOW)).toMatchObject({ ok: false, reason: 'invalid_date' });
    // A timestamp far in the future is not a real event time.
    expect(parseBrevoEvent(payload({ ts_event: Math.floor(NOW.getTime() / 1000) + 10 * 86_400 }), NOW)).toMatchObject({ ok: false, reason: 'invalid_date' });
  });

  test('click keeps only the host of the link, never path or query', () => {
    const result = parseBrevoEvent(payload({ event: 'click', link: 'https://shop.chloefood.com/o/SECRET-TOKEN?sig=abc#x' }), NOW);
    expect(result.ok && result.value.linkHost).toBe('shop.chloefood.com');
    expect(JSON.stringify(result)).not.toContain('SECRET-TOKEN');
  });

  test('reasons are truncated and e-mail addresses masked; tags accept string or array', () => {
    expect(sanitizeReason('550 5.1.1 <bob@corp.com> user unknown')).toBe('550 5.1.1 <[email]> user unknown');
    expect(sanitizeReason('x'.repeat(500))!.length).toBe(200);
    const single = parseBrevoEvent(payload({ tags: undefined, tag: 'a,b' }), NOW);
    expect(single.ok && single.value.tags).toEqual(['a', 'b']);
    expect(maskEmail('Marie@Example.com')).toBe('m***@example.com');
  });

  test('ts_epoch is milliseconds, ts_event seconds', () => {
    const a = parseBrevoEvent(payload({ ts_epoch: 1_793_181_600_000, ts_event: undefined }), NOW);
    const b = parseBrevoEvent(payload({ ts_epoch: undefined, ts_event: 1_793_181_600 }), NOW);
    expect(a.ok && b.ok && a.value.occurredAt.getTime()).toBe(b.ok ? b.value.occurredAt.getTime() : -1);
  });
});

test.describe('dedupe and recipient correlation', () => {
  test('same message to two recipients gives distinct message keys; a provider retry gives the same event key', () => {
    const date = new Date('2026-10-28T09:00:00Z');
    const h1 = recipientHash('a@example.com', TOKEN);
    const h2 = recipientHash('b@example.com', TOKEN);
    expect(h1).not.toBe(h2);
    expect(h1).toBe(recipientHash(' A@Example.com ', TOKEN));
    const k1 = eventKey('<m>', h1, 'delivered', date);
    expect(k1).toBe(eventKey('<m>', h1, 'delivered', new Date(date)));
    expect(k1).not.toBe(eventKey('<m>', h2, 'delivered', date));
    expect(k1).not.toBe(eventKey('<m>', h1, 'open', date));
    // A second real open (other timestamp) is a new row.
    expect(eventKey('<m>', h1, 'open', date)).not.toBe(eventKey('<m>', h1, 'open', new Date(date.getTime() + 60_000)));
  });
});

test.describe('webhook security', () => {
  test('bearer token: constant-time match, fail closed without configuration', () => {
    expect(isAuthorizedBrevoWebhook(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorizedBrevoWebhook(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorizedBrevoWebhook(`Bearer ${TOKEN}y`, TOKEN)).toBe(false);
    expect(isAuthorizedBrevoWebhook(TOKEN, TOKEN)).toBe(true);
    expect(isAuthorizedBrevoWebhook(`Basic ${TOKEN}`, TOKEN)).toBe(false);
    expect(isAuthorizedBrevoWebhook(null, TOKEN)).toBe(false);
    expect(isAuthorizedBrevoWebhook(`Bearer ${TOKEN}`, undefined)).toBe(false);
    expect(isAuthorizedBrevoWebhook('Bearer short', 'short')).toBe(false);
  });

  test('route refuses a missing/invalid token before touching the database, and rejects GET', async () => {
    const previous = process.env.BREVO_WEBHOOK_TOKEN;
    process.env.BREVO_WEBHOOK_TOKEN = TOKEN;
    try {
      const { POST, GET } = await import('../../src/app/api/webhooks/brevo/route');
      const noAuth = await POST(new NextRequest('http://localhost/api/webhooks/brevo', { method: 'POST', body: JSON.stringify(payload()) }));
      expect(noAuth.status).toBe(401);
      const wrong = await POST(new NextRequest('http://localhost/api/webhooks/brevo', { method: 'POST', headers: { authorization: 'Bearer nope' }, body: '{}' }));
      expect(wrong.status).toBe(401);
      const badJson = await POST(new NextRequest('http://localhost/api/webhooks/brevo', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: '{not json' }));
      expect(badJson.status).toBe(400);
      expect(GET().status).toBe(405);
      process.env.BREVO_WEBHOOK_TOKEN = '';
      const unconfigured = await POST(new NextRequest('http://localhost/api/webhooks/brevo', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: '{}' }));
      expect(unconfigured.status).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.BREVO_WEBHOOK_TOKEN; else process.env.BREVO_WEBHOOK_TOKEN = previous;
    }
  });

  test('dashboard sits under the platform-owner layout, which redirects everyone else', () => {
    const root = path.resolve(__dirname, '../../src/app/admin/(protected)/platform');
    expect(readFileSync(path.join(root, 'notifications/email-analytics/page.tsx'), 'utf8')).toContain('PlatformEmailAnalyticsPage');
    const layout = readFileSync(path.join(root, 'layout.tsx'), 'utf8');
    expect(layout).toContain("admin.role !== 'platform_owner'");
    expect(layout).toContain("redirect('/admin')");
  });

  test('migration keeps the table service-role only and never stores an address column', () => {
    const sql = readFileSync(path.resolve(__dirname, '../../../../supabase/migrations/170_brevo_email_events.sql'), 'utf8');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('revoke all on table public.brevo_email_events from public, anon, authenticated');
    expect(sql).not.toMatch(/\bemail\s+text\b/i);
    expect(sql).not.toMatch(/\bsubject\b[^\n]*\n[^\n]*create table/i);
  });
});

test.describe('categories and scope', () => {
  test('classified by notification type, then tags, never by subject; other projects are out of scope', () => {
    expect(classifyEmail({ notificationType: 'order_confirmed', tags: [], hasLedgerMatch: true })).toBe('order_confirmation');
    expect(classifyEmail({ notificationType: null, tags: ['review_invite'], hasLedgerMatch: false })).toBe('review_request');
    expect(classifyEmail({ notificationType: 'payment_reminder', tags: null, hasLedgerMatch: true })).toBe('reminder');
    expect(classifyEmail({ notificationType: 'order_shipped', tags: [], hasLedgerMatch: true })).toBe('shipping_update');
    expect(classifyEmail({ notificationType: 'event_reservation_confirmed', tags: [], hasLedgerMatch: true })).toBe('reservation_confirmation');
    expect(classifyEmail({ notificationType: 'card_quick_payment_customer', tags: [], hasLedgerMatch: true })).toBe('payment_confirmation');
    expect(classifyEmail({ notificationType: 'order_completed', tags: [], hasLedgerMatch: true })).toBe('order_completed');
    expect(classifyEmail({ notificationType: 'daily_order_digest', tags: [], hasLedgerMatch: true })).toBe('other_food');
    // Ledger-linked but unknown type: still ours.
    expect(classifyEmail({ notificationType: null, tags: [], hasLedgerMatch: true })).toBe('other_food');
    // Another Lepefy project on the same Brevo account.
    expect(isFoodEmail({ notificationType: null, tags: ['newsletter-other-project'], hasLedgerMatch: false })).toBe(false);
    expect(classifyEmail({ notificationType: null, tags: [], hasLedgerMatch: false })).toBeNull();
  });

  test('server-side category filters cover every mapped type exactly once', () => {
    const mapped = Object.keys(NOTIFICATION_TYPE_CATEGORY);
    const all = new Set(['reservation_confirmation', 'payment_confirmation', 'order_confirmation', 'shipping_update', 'order_completed', 'reminder', 'review_request'].flatMap((category) => typesForCategory(category as never)));
    expect([...all].sort()).toEqual([...mapped].sort());
    expect(typesForCategory('other_food').some((type) => mapped.includes(type))).toBe(false);
  });
});

test.describe('KPIs', () => {
  test('counts messages and distinct recipients, ignores repeated opens, keeps proxy opens apart', () => {
    const rows = enrich([
      row({ message_id: '<a>', recipient_hash: 'r1', first_open_at: '2026-10-27T09:10:00Z', open_events: 5, click_at: '2026-10-27T09:11:00Z', click_events: 3 }),
      row({ message_id: '<b>', recipient_hash: 'r1', first_open_at: null, proxy_open_at: '2026-10-27T09:00:20Z' }),
      row({ message_id: '<c>', recipient_hash: 'r2', delivered_at: null, failure_event: 'hard_bounce', failed_at: '2026-10-27T09:00:02Z' }),
      row({ message_id: '<d>', recipient_hash: 'r3', delivered_at: '2026-10-27T09:00:05Z', first_open_at: '2026-10-27T09:00:06Z' }),
      row({ message_id: '<x>', recipient_hash: 'r9', delivery_id: null, notification_type: null, tags: ['other-project'] }),
    ]);
    expect(rows).toHaveLength(4);
    const kpis = computeKpis(rows);
    expect(kpis.tracked).toEqual({ messages: 4, recipients: 3 });
    expect(kpis.delivered).toEqual({ messages: 3, recipients: 2 });
    expect(kpis.firstOpen.messages).toBe(2);
    expect(kpis.suspiciousOpens).toBe(1);
    expect(kpis.proxyOnly).toBe(1);
    expect(kpis.clicked.messages).toBe(1);
    expect(kpis.undelivered).toEqual({ messages: 1, recipients: 1 });
    expect(kpis.deliveryRate).toEqual({ value: 0.75, numerator: 3, denominator: 4 });
    expect(kpis.firstOpenRate).toEqual({ value: 2 / 3, numerator: 2, denominator: 3 });
    expect(kpis.clickRate.denominator).toBe(3);
    // Only the human-like open (10 min after delivery) enters the median.
    expect(kpis.medianOpenDelaySeconds).toBe(595);
    expect(kpis.medianOpenSample).toBe(1);
  });

  test('no data is "not available", never 0%', () => {
    const empty = computeKpis([]);
    expect(empty.deliveryRate.value).toBeNull();
    expect(empty.firstOpenRate.value).toBeNull();
    expect(empty.clickRate.value).toBeNull();
    expect(empty.medianOpenDelaySeconds).toBeNull();
    // Messages without any open event: open rate is 0 of N delivered (a real zero), delay stays n.d.
    const noOpens = computeKpis(enrich([row()]));
    expect(noOpens.firstOpenRate).toMatchObject({ value: 0, denominator: 1 });
    expect(noOpens.medianOpenDelaySeconds).toBeNull();
  });

  test('out-of-order events: an open before the delivery is kept as an open but not in the delay; a soft bounce later delivered is not a failure', () => {
    const early = row({ delivered_at: '2026-10-27T09:05:00Z', first_open_at: '2026-10-27T09:04:00Z' });
    expect(openKindOf(early)).toBe('human_likely');
    const kpis = computeKpis(enrich([early]));
    expect(kpis.firstOpen.messages).toBe(1);
    expect(kpis.medianOpenDelaySeconds).toBeNull();
    const retried = enrich([row({ failure_event: 'soft_bounce', failed_at: '2026-10-27T09:00:01Z' })])[0]!;
    expect(retried.undelivered).toBe(false);
    expect(messageStatus(retried)).toBe('delivered');
  });

  test('messages with only a delivery (no request event) still count; status without any confirmation is "unknown"', () => {
    const noSent = enrich([row({ sent_at: null })])[0]!;
    expect(computeKpis([noSent]).tracked.messages).toBe(1);
    expect(messageStatus(enrich([row({ sent_at: null, delivered_at: null })])[0]!)).toBe('unknown');
  });

  test('failure distribution counts errors separately from bounces', () => {
    const rows = enrich([
      row({ delivered_at: null, failure_event: 'blocked' }), row({ message_id: '<2>', delivered_at: null, failure_event: 'hard_bounce' }),
      row({ message_id: '<3>', delivered_at: null, has_error: true }),
    ]);
    expect(failureDistribution(rows).map((item) => [item.kind, item.messages]).sort()).toEqual([['blocked', 1], ['error', 1], ['hard_bounce', 1]]);
  });

  test('median', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

test.describe('filters and period', () => {
  test('presets cover N shop days; custom range is clamped; day bounds follow Paris time', () => {
    const p7 = resolvePeriod({ range: '7', from: undefined, to: undefined }, NOW);
    expect(p7).toMatchObject({ fromDay: '2026-10-22', toDay: '2026-10-28' });
    const custom = resolvePeriod({ range: 'custom', from: '2026-10-01', to: '2026-12-31' }, NOW);
    expect(custom.toDay).toBe('2026-10-28');
    expect(resolvePeriod({ range: '30', from: '2026-10-10', to: '2026-10-05' }, NOW)).toMatchObject({ fromDay: '2026-10-10', toDay: '2026-10-28' });
    // Summer time (UTC+2) on 2026-10-10, winter (UTC+1) on 2026-10-28.
    expect(shopDayStart('2026-10-10')).toBe('2026-10-09T22:00:00.000Z');
    expect(shopDayStart('2026-10-29')).toBe('2026-10-28T23:00:00.000Z');
  });

  test('event filter and daily series', () => {
    const rows = enrich([
      row({ message_id: '<a>', first_open_at: '2026-10-27T10:00:00Z' }),
      row({ message_id: '<b>', delivered_at: null, failure_event: 'hard_bounce' }),
      row({ message_id: '<c>', click_at: '2026-10-28T08:00:00Z' }),
    ]);
    expect(rows.filter((r) => matchesEventFilter(r, 'opened'))).toHaveLength(1);
    expect(rows.filter((r) => matchesEventFilter(r, 'failed'))).toHaveLength(1);
    expect(rows.filter((r) => matchesEventFilter(r, 'clicked'))).toHaveLength(1);
    expect(rows.filter((r) => matchesEventFilter(r, 'no_open'))).toHaveLength(1);
    expect(rows.filter((r) => matchesEventFilter(r, 'all'))).toHaveLength(3);
    const series = dailySeries(rows, '2026-10-26', '2026-10-28');
    expect(series.map((point) => point.day)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
    expect(series[1]).toMatchObject({ sent: 3, delivered: 2, firstOpen: 1 });
    expect(series[2]).toMatchObject({ clicked: 1 });
    expect(series[0]).toMatchObject({ sent: 0, delivered: 0 });
  });
});
