import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NOTIFICATION_GROUPS, NOTIFICATION_PRESETS, NOTIFICATION_TYPES, MAX_SUBSCRIPTION_CHANGES,
  applySubscriptionChanges, availableNotificationTypes, defaultNotificationTypeKeys, diffSubscriptions,
  groupNotificationTypes, matchingPreset, notificationTypeContext, parseSubscriptionChanges, parseTypeKeys, presetTypeKeys,
} from '../../src/lib/notifications/notificationTypes';
import { getNotificationRecipients } from '../../src/lib/notifications/getNotificationRecipients';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

const R1 = '0f8c2b36-5a3d-4c41-9f2e-6c1b8c0a1d11';
const withEvents = availableNotificationTypes(notificationTypeContext({ events_enabled: true }));
const shopOnly = availableNotificationTypes(notificationTypeContext({ events_enabled: false }));

test.describe('notification type registry', () => {
  test('keys are unique, DB-safe and every group/preset reference is valid', () => {
    const keys = NOTIFICATION_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Same check as tenant_notification_subscriptions.type_key (migration 143).
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]{1,62}$/);
    const groupKeys = new Set(NOTIFICATION_GROUPS.map((g) => g.key));
    for (const type of NOTIFICATION_TYPES) expect(groupKeys.has(type.group)).toBe(true);
    for (const preset of NOTIFICATION_PRESETS) {
      if (preset.types !== 'all') for (const key of preset.types) expect(keys).toContain(key);
    }
  });

  test('legacy notify_* flags all map to a type (backfill of migration 143)', () => {
    const legacy = ['notify_card_payment', 'notify_external_payment_pending', 'notify_order_stock_conflict',
      'notify_event_booking_closed_reports', 'notify_daily_digest', 'notify_service_inquiries', 'notify_rental_reservations'];
    expect(legacy.map((flag) => flag.slice('notify_'.length)).sort()).toEqual(NOTIFICATION_TYPES.map((t) => t.key).sort());
  });

  test('event types are hidden when the events module is off; empty groups dropped', () => {
    expect(withEvents).toHaveLength(NOTIFICATION_TYPES.length);
    expect(shopOnly.map((t) => t.key)).toEqual(['card_payment', 'external_payment_pending', 'order_stock_conflict', 'daily_digest']);
    expect(groupNotificationTypes(shopOnly).map((g) => g.key)).toEqual(['orders', 'reports']);
    expect(groupNotificationTypes(withEvents).map((g) => g.key)).toEqual(['orders', 'events', 'reports']);
  });

  test('defaults keep the historical behaviour of the add form', () => {
    expect(defaultNotificationTypeKeys(withEvents)).toEqual(['card_payment', 'external_payment_pending', 'event_booking_closed_reports']);
    expect(defaultNotificationTypeKeys(shopOnly)).toEqual(['card_payment', 'external_payment_pending']);
  });

  test('presets resolve on available types and are recognised back', () => {
    const manager = NOTIFICATION_PRESETS.find((p) => p.key === 'manager')!;
    const operations = NOTIFICATION_PRESETS.find((p) => p.key === 'operations')!;
    expect(presetTypeKeys(manager, shopOnly)).toEqual(shopOnly.map((t) => t.key));
    expect(presetTypeKeys(operations, shopOnly)).toEqual(['order_stock_conflict', 'daily_digest']);
    expect(matchingPreset(presetTypeKeys(operations, withEvents), withEvents)?.key).toBe('operations');
    // Hidden subscriptions don't prevent matching on the visible ones.
    expect(matchingPreset(['card_payment', 'external_payment_pending', 'daily_digest', 'rental_reservations'], shopOnly)?.key).toBe('accounting');
    expect(matchingPreset(['card_payment'], withEvents)).toBeNull();
  });
});

test.describe('subscription changes', () => {
  test('parse rejects unknown types, bad ids, empty and oversized batches', () => {
    expect(parseSubscriptionChanges({ changes: [{ recipientId: R1, typeKey: 'card_payment', subscribed: true }] }))
      .toEqual([{ recipientId: R1, typeKey: 'card_payment', subscribed: true }]);
    expect(parseSubscriptionChanges({ changes: [{ recipientId: R1, typeKey: 'notify_card_payment', subscribed: true }] })).toBeNull();
    expect(parseSubscriptionChanges({ changes: [{ recipientId: 'x', typeKey: 'card_payment', subscribed: true }] })).toBeNull();
    expect(parseSubscriptionChanges({ changes: [{ recipientId: R1, typeKey: 'card_payment', subscribed: 'yes' }] })).toBeNull();
    expect(parseSubscriptionChanges({ changes: [] })).toBeNull();
    expect(parseSubscriptionChanges(null)).toBeNull();
    const many = Array.from({ length: MAX_SUBSCRIPTION_CHANGES + 1 }, () => ({ recipientId: R1, typeKey: 'card_payment', subscribed: true }));
    expect(parseSubscriptionChanges({ changes: many })).toBeNull();
    expect(parseTypeKeys(['daily_digest', 'daily_digest'])).toEqual(['daily_digest']);
    expect(parseTypeKeys(['nope'])).toBeNull();
    expect(parseTypeKeys('daily_digest')).toBeNull();
  });

  test('diff only touches the scope and apply keeps catalogue order', () => {
    const scope = shopOnly.map((t) => t.key as 'card_payment');
    const changes = diffSubscriptions(R1, ['daily_digest', 'rental_reservations'], ['card_payment', 'daily_digest'], scope);
    expect(changes).toEqual([{ recipientId: R1, typeKey: 'card_payment', subscribed: true }]);
    // rental_reservations is out of scope (events module off): preserved.
    expect(applySubscriptionChanges(R1, ['daily_digest', 'rental_reservations'], changes)).toEqual(['card_payment', 'rental_reservations', 'daily_digest']);
    expect(applySubscriptionChanges(R1, ['card_payment'], [{ recipientId: 'other', typeKey: 'card_payment', subscribed: false }])).toEqual(['card_payment']);
  });
});

test.describe('getNotificationRecipients', () => {
  test('calls the lookup RPC with the type key and email channel', async () => {
    const calls: Array<[string, unknown]> = [];
    const db = { rpc: async (fn: string, args: unknown) => { calls.push([fn, args]); return { data: [{ email: 'a@x.test' }, { email: 'b@x.test' }], error: null }; } } as unknown as SupabaseClient;
    expect(await getNotificationRecipients(db, 't1', 'daily_digest')).toEqual(['a@x.test', 'b@x.test']);
    expect(calls).toEqual([['notification_recipient_emails', { p_tenant_id: 't1', p_type_key: 'daily_digest', p_channel: 'email' }]]);
  });

  test('is best-effort: an RPC error yields no recipients', async () => {
    const db = { rpc: async () => ({ data: null, error: { message: 'function does not exist' } }) } as unknown as SupabaseClient;
    expect(await getNotificationRecipients(db, 't1', 'card_payment')).toEqual([]);
  });
});

test('subscription batch endpoint uses the settings permissions', () => {
  expect(permissionForAdminApi('/api/admin/notification-recipients/subscriptions', 'POST')).toBe('tenant_settings.manage');
});
