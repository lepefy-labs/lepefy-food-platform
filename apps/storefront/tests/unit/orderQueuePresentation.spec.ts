import { test, expect } from '@playwright/test';
import { PRIORITY_GROUP_ORDER, type OrderOperation, type PriorityGroup, type QueueKey } from '../../src/lib/orders/adminOrderOperations';
import {
  defaultGroupCollapsed, groupCountLabel, orderActionEmphasis, PRIORITY_GROUP_TONE, queueGroupContextKey,
} from '../../src/lib/orders/orderQueuePresentation';
import { countPriorityGroups } from '../../src/lib/orders/loadOrderWorkQueue';

const general = { view: '', targeted: false };

test('group tones follow the work-queue table (semantic tones only)', () => {
  expect(PRIORITY_GROUP_TONE).toEqual({
    action_required: 'danger', preparation_overdue: 'urgent', pickup_overdue: 'urgent', preparing: 'warning',
    to_ship: 'warning', shipping: 'info', pickup_ready: 'success', finished: 'neutral',
  });
  for (const group of PRIORITY_GROUP_ORDER) expect(PRIORITY_GROUP_TONE[group]).toBeTruthy();
});

test('general queue: groups needing the team open, regular shipments and finished orders collapsed', () => {
  const collapsed = PRIORITY_GROUP_ORDER.filter((group) => defaultGroupCollapsed(group, general));
  expect(collapsed).toEqual(['shipping', 'finished']);
});

test('an explicit view or a targeted search opens every group', () => {
  for (const group of PRIORITY_GROUP_ORDER) {
    expect(defaultGroupCollapsed(group, { view: 'in_transit', targeted: false })).toBe(false);
    expect(defaultGroupCollapsed(group, { view: 'finished', targeted: false })).toBe(false);
    expect(defaultGroupCollapsed(group, { view: '', targeted: true })).toBe(false);
  }
});

test('user choices reset only when the defaults change', () => {
  expect(queueGroupContextKey(general)).toBe(queueGroupContextKey({ view: '', targeted: false }));
  expect(queueGroupContextKey(general)).not.toBe(queueGroupContextKey({ view: 'urgent', targeted: false }));
  expect(queueGroupContextKey(general)).not.toBe(queueGroupContextKey({ view: '', targeted: true }));
});

function op(group: PriorityGroup, action: OrderOperation['action'], flags: QueueKey[] = []): Pick<OrderOperation, 'group' | 'flags' | 'action'> {
  return { group, action, flags: new Set(flags) };
}
const prepare = { label: 'Préparer', primary: true, intent: 'detail' as const, section: 'actions' as const };
const tracking = { label: 'Voir le suivi', primary: false, intent: 'tracking' as const, section: 'tracking' as const };
const incident = { label: 'Résoudre l’incident', primary: true, intent: 'incident' as const, section: 'tracking' as const };

test('action emphasis: solid only when urgent, outline for the normal next step', () => {
  expect(orderActionEmphasis(op('preparation_overdue', prepare, ['urgent', 'to_treat']), true)).toBe('primary');
  expect(orderActionEmphasis(op('action_required', incident, ['urgent', 'incidents']), true)).toBe('primary');
  expect(orderActionEmphasis(op('preparing', prepare, ['to_treat']), true)).toBe('outline');
  // International + cold chain (classifier flag `urgent`) is the exception inside « En préparation ».
  expect(orderActionEmphasis(op('preparing', prepare, ['urgent', 'to_treat']), true)).toBe('primary');
});

test('action emphasis: consultation is secondary, finished is ghost, no manage permission never looks like work', () => {
  expect(orderActionEmphasis(op('shipping', tracking, ['in_transit']), true)).toBe('secondary');
  expect(orderActionEmphasis(op('shipping', tracking, ['in_transit']), false)).toBe('secondary');
  expect(orderActionEmphasis(op('preparation_overdue', prepare, ['urgent']), false)).toBe('secondary');
  expect(orderActionEmphasis(op('finished', { label: 'Voir', primary: false, intent: 'detail', section: 'none' }), true)).toBe('ghost');
});

test('group count: real size when the page shows part of the group', () => {
  expect(groupCountLabel(4, undefined)).toEqual({ count: 4, pageNote: null });
  expect(groupCountLabel(4, 4)).toEqual({ count: 4, pageNote: null });
  expect(groupCountLabel(4, 12)).toEqual({ count: 12, pageNote: '4 sur cette page' });
  // A stale smaller total never hides rows that are on screen.
  expect(groupCountLabel(4, 2)).toEqual({ count: 4, pageNote: null });
});

test('countPriorityGroups counts every classified order once', () => {
  const rows = (['preparing', 'preparing', 'shipping', 'action_required'] as PriorityGroup[])
    .map((group) => ({ order: { status: 'new', fulfillment_type: 'delivery', payment_status: 'paid', created_at: '', updated_at: '' }, operation: { group } })) as never[];
  expect(countPriorityGroups(rows)).toEqual({ preparing: 2, shipping: 1, action_required: 1 });
  expect(countPriorityGroups([])).toEqual({});
});

test('destination country: ISO codes and legacy names map to one code (flag badge, international flag)', async () => {
  const { normalizeCountryCode, orderHandlingFlags } = await import('../../src/lib/orders/adminOrderOperations');
  expect(normalizeCountryCode(' be ')).toBe('BE');
  expect(normalizeCountryCode('Belgique')).toBe('BE');
  expect(normalizeCountryCode('Italia')).toBe('IT');
  expect(normalizeCountryCode(null)).toBe('');
  const base = { status: 'new' as const, payment_status: 'paid', created_at: '', updated_at: '', originCountry: 'IT' };
  expect(orderHandlingFlags({ ...base, fulfillment_type: 'delivery', shipping_address: { country: 'Italia' } }).international).toBe(false);
  expect(orderHandlingFlags({ ...base, fulfillment_type: 'delivery', shipping_address: { country: 'BE' } }).international).toBe(true);
  expect(orderHandlingFlags({ ...base, fulfillment_type: 'pickup', shipping_address: { country: 'BE' } }).international).toBe(false);
});
