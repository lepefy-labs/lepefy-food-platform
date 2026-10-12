import { expect, test } from '@playwright/test';
import {
  cartFulfillmentBlockingMessage,
  cartProductPolicy,
  checkFulfillmentMode,
  computeCartFulfillment,
  normalizeFulfillmentPolicy,
  type FulfillmentProduct,
} from '../../src/lib/fulfillment/fulfillmentPolicy';
import { productFulfillmentHint } from '../../src/lib/storefrontCopy/fulfillmentCopy';

const riz: FulfillmentProduct = { id: 'riz', name: 'Riz parfumé', fulfillment_policy: 'delivery_or_pickup' };
const legacy: FulfillmentProduct = { id: 'legacy', name: 'Panier ancien' };
const attieke: FulfillmentProduct = { id: 'attieke', name: 'Attiéké frais', fulfillment_policy: 'pickup_only' };
const poisson: FulfillmentProduct = { id: 'poisson', name: 'Poisson braisé', fulfillment_policy: 'pickup_only' };
const colis: FulfillmentProduct = { id: 'colis', name: 'Colis épices', fulfillment_policy: 'delivery_only' };
const PICKUP_ON = { pickupAvailable: true };
const PICKUP_OFF = { pickupAvailable: false };

test('1. only delivery_or_pickup items: both modes allowed, customer chooses', () => {
  const result = computeCartFulfillment([riz, legacy], PICKUP_ON);
  expect(result.status).toBe('flexible');
  expect(result.allowedModes).toEqual(['delivery', 'pickup']);
  expect(result.forcedMode).toBeNull();
  expect(result.blocked).toBe(false);
  expect(checkFulfillmentMode(result, 'delivery')).toBeNull();
  expect(checkFulfillmentMode(result, 'pickup')).toBeNull();
  expect(cartFulfillmentBlockingMessage(result)).toBeNull();
});

test('2. at least one pickup_only and no delivery_only: pickup forced', () => {
  const result = computeCartFulfillment([riz, attieke, poisson], PICKUP_ON);
  expect(result.status).toBe('pickup_forced');
  expect(result.allowedModes).toEqual(['pickup']);
  expect(result.forcedMode).toBe('pickup');
  expect(result.blocked).toBe(false);
  expect(result.pickupOnlyProducts.map((p) => p.name)).toEqual(['Attiéké frais', 'Poisson braisé']);
  expect(cartFulfillmentBlockingMessage(result)).toBeNull();
});

test('3. at least one delivery_only and no pickup_only: delivery forced', () => {
  const result = computeCartFulfillment([riz, colis], PICKUP_ON);
  expect(result.status).toBe('delivery_forced');
  expect(result.allowedModes).toEqual(['delivery']);
  expect(result.forcedMode).toBe('delivery');
  expect(result.deliveryOnlyProducts.map((p) => p.id)).toEqual(['colis']);
});

test('4. pickup_only + delivery_only: incompatible, blocked, culprits named', () => {
  const result = computeCartFulfillment([attieke, riz, colis], PICKUP_ON);
  expect(result.status).toBe('conflict');
  expect(result.allowedModes).toEqual([]);
  expect(result.blocked).toBe(true);
  expect(result.pickupOnlyProducts.map((p) => p.id)).toEqual(['attieke']);
  expect(result.deliveryOnlyProducts.map((p) => p.id)).toEqual(['colis']);
  expect(cartFulfillmentBlockingMessage(result)).toContain('incompatibles');
  const violation = checkFulfillmentMode(result, 'pickup');
  expect(violation?.code).toBe('FULFILLMENT_CONFLICT');
  expect(violation?.message).toContain('Attiéké frais');
  expect(violation?.message).toContain('Colis épices');
});

test('5. chosen mode mismatching the cart constraint is rejected', () => {
  expect(checkFulfillmentMode(computeCartFulfillment([attieke], PICKUP_ON), 'delivery')?.code).toBe('FULFILLMENT_MODE_NOT_ALLOWED');
  expect(checkFulfillmentMode(computeCartFulfillment([colis], PICKUP_ON), 'pickup')?.code).toBe('FULFILLMENT_MODE_NOT_ALLOWED');
  expect(checkFulfillmentMode(computeCartFulfillment([attieke], PICKUP_ON), 'pickup')).toBeNull();
  expect(checkFulfillmentMode(computeCartFulfillment([colis], PICKUP_ON), 'delivery')).toBeNull();
});

test('6. pickup disabled for the shop + pickup_only product: fail closed', () => {
  const result = computeCartFulfillment([riz, attieke], PICKUP_OFF);
  expect(result.status).toBe('pickup_unavailable');
  expect(result.allowedModes).toEqual([]);
  expect(result.blocked).toBe(true);
  expect(checkFulfillmentMode(result, 'pickup')?.code).toBe('PICKUP_NOT_ENABLED');
  expect(checkFulfillmentMode(result, 'delivery')?.code).toBe('PICKUP_NOT_ENABLED');
  expect(cartFulfillmentBlockingMessage(result)).toContain('Attiéké frais');
});

test('pickup disabled, flexible cart: delivery is the only mode, not a product constraint', () => {
  const result = computeCartFulfillment([riz], PICKUP_OFF);
  expect(result.status).toBe('flexible');
  expect(result.allowedModes).toEqual(['delivery']);
  expect(result.forcedMode).toBe('delivery');
  expect(checkFulfillmentMode(result, 'pickup')?.code).toBe('PICKUP_NOT_ENABLED');
});

test('pickup disabled, delivery_only cart stays delivery forced', () => {
  const result = computeCartFulfillment([colis], PICKUP_OFF);
  expect(result.status).toBe('delivery_forced');
  expect(result.allowedModes).toEqual(['delivery']);
});

test('duplicate lines and unknown values are deterministic', () => {
  const result = computeCartFulfillment([attieke, attieke, { id: 'x', name: 'X', fulfillment_policy: 'teleport' }], PICKUP_ON);
  expect(result.pickupOnlyProducts).toHaveLength(1);
  expect(result.status).toBe('pickup_forced');
  expect(normalizeFulfillmentPolicy(undefined)).toBe('delivery_or_pickup');
  expect(normalizeFulfillmentPolicy(null)).toBe('delivery_or_pickup');
  expect(normalizeFulfillmentPolicy('pickup_only')).toBe('pickup_only');
});

test('empty cart allows the shop modes', () => {
  expect(computeCartFulfillment([], PICKUP_ON).allowedModes).toEqual(['delivery', 'pickup']);
});

test('cartProductPolicy reads back the policy of each line', () => {
  const result = computeCartFulfillment([riz, attieke, colis], PICKUP_ON);
  expect(cartProductPolicy(result, 'attieke')).toBe('pickup_only');
  expect(cartProductPolicy(result, 'colis')).toBe('delivery_only');
  expect(cartProductPolicy(result, 'riz')).toBe('delivery_or_pickup');
});

test('product page hint never pretends pickup is possible', () => {
  expect(productFulfillmentHint('delivery_or_pickup', true)?.label).toBe('Livraison ou retrait');
  expect(productFulfillmentHint('delivery_or_pickup', false)).toBeNull();
  expect(productFulfillmentHint('pickup_only', true)).toMatchObject({ label: 'Retrait en boutique', blocked: false });
  expect(productFulfillmentHint('pickup_only', false)).toMatchObject({ blocked: true });
  expect(productFulfillmentHint('delivery_only', true)?.label).toBe('Livraison uniquement');
});
