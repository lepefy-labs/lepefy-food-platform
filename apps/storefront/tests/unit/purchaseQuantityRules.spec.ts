import { test, expect } from '@playwright/test';
import { computeQuantityRuleState, validatePurchaseQuantityRules } from '../../src/lib/purchaseQuantityRules';

test('below minimum reports the minimum as next valid quantity', () => {
  const state = computeQuantityRuleState(10, 12, 6);
  expect(state.isValid).toBe(false);
  expect(state.nextValidQuantity).toBe(12);
  expect(state.missingQuantity).toBe(2);
});

test('above minimum but off-step rounds up to the next step', () => {
  const state = computeQuantityRuleState(13, 12, 6);
  expect(state.isValid).toBe(false);
  expect(state.nextValidQuantity).toBe(18);
  expect(state.missingQuantity).toBe(5);
});

test('exact valid quantity is reported as valid with zero missing', () => {
  const state = computeQuantityRuleState(18, 12, 6);
  expect(state.isValid).toBe(true);
  expect(state.nextValidQuantity).toBe(18);
  expect(state.missingQuantity).toBe(0);
});

test('minimum=4 / step=1 accepts every quantity from the minimum up', () => {
  expect(computeQuantityRuleState(4, 4, 1).isValid).toBe(true);
  expect(computeQuantityRuleState(5, 4, 1).isValid).toBe(true);
  expect(computeQuantityRuleState(3, 4, 1).isValid).toBe(false);
});

test('minimum=4 / step=4 only accepts multiples of the step from the minimum', () => {
  expect(computeQuantityRuleState(4, 4, 4).isValid).toBe(true);
  expect(computeQuantityRuleState(8, 4, 4).isValid).toBe(true);
  expect(computeQuantityRuleState(6, 4, 4).isValid).toBe(false);
  expect(computeQuantityRuleState(6, 4, 4).nextValidQuantity).toBe(8);
});

test('zero quantity is never reported as valid', () => {
  expect(computeQuantityRuleState(0, 1, 1).isValid).toBe(false);
});

test('malformed minimum/step normalize to 1 instead of dividing by zero', () => {
  const state = computeQuantityRuleState(5, 0, 0);
  expect(state.minimumQuantity).toBe(1);
  expect(state.step).toBe(1);
  expect(state.isValid).toBe(true);
});

test('validatePurchaseQuantityRules ignores products/groups absent from the cart', () => {
  const violations = validatePurchaseQuantityRules(
    new Map(),
    [{ id: 'ndole', name: 'Ndolé', min_order_quantity: 4, order_quantity_step: 1 }],
    [{ id: 'boissons', name: 'Boissons', min_quantity: 12, quantity_step: 6, productIds: ['coca', 'fanta'] }],
  );
  expect(violations).toEqual([]);
});

test('validatePurchaseQuantityRules flags a product under its minimum', () => {
  const violations = validatePurchaseQuantityRules(
    new Map([['ndole', 2]]),
    [{ id: 'ndole', name: 'Ndolé', min_order_quantity: 4, order_quantity_step: 1 }],
    [],
  );
  expect(violations).toEqual([{
    type: 'PRODUCT_MINIMUM',
    productId: 'ndole',
    productName: 'Ndolé',
    requiredMinimum: 4,
    step: 1,
    currentQuantity: 2,
    nextValidQuantity: 4,
    missingQuantity: 2,
  }]);
});

test('validatePurchaseQuantityRules sums a free mix of group members toward the group total', () => {
  const violations = validatePurchaseQuantityRules(
    new Map([['coca', 5], ['fanta', 4], ['malta', 3]]), // total 12
    [],
    [{ id: 'boissons', name: 'Boissons', min_quantity: 12, quantity_step: 6, productIds: ['coca', 'fanta', 'malta'] }],
  );
  expect(violations).toEqual([]);
});

test('validatePurchaseQuantityRules flags a group total off-step', () => {
  const violations = validatePurchaseQuantityRules(
    new Map([['coca', 7], ['fanta', 6]]), // total 13
    [],
    [{ id: 'boissons', name: 'Boissons', min_quantity: 12, quantity_step: 6, productIds: ['coca', 'fanta'] }],
  );
  expect(violations).toEqual([{
    type: 'GROUP_STEP',
    groupId: 'boissons',
    groupName: 'Boissons',
    requiredMinimum: 12,
    step: 6,
    currentQuantity: 13,
    nextValidQuantity: 18,
    missingQuantity: 5,
  }]);
});

test('validatePurchaseQuantityRules applies product and group rules independently', () => {
  // Coca has its own product-level minimum of 2, on top of the group rule.
  const violations = validatePurchaseQuantityRules(
    new Map([['coca', 1], ['fanta', 11]]), // group total 12 (valid), coca below its own minimum
    [{ id: 'coca', name: 'Coca', min_order_quantity: 2, order_quantity_step: 1 }],
    [{ id: 'boissons', name: 'Boissons', min_quantity: 12, quantity_step: 6, productIds: ['coca', 'fanta'] }],
  );
  expect(violations).toEqual([{
    type: 'PRODUCT_MINIMUM',
    productId: 'coca',
    productName: 'Coca',
    requiredMinimum: 2,
    step: 1,
    currentQuantity: 1,
    nextValidQuantity: 2,
    missingQuantity: 1,
  }]);
});
