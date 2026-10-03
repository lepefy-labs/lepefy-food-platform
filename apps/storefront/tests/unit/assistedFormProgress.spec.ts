import { test, expect } from '@playwright/test';
import {
  assistedFormIssues, assistedFormSteps, assistedPrimaryLabel, reorderLines, snapQuantity, type AssistedFormSnapshot,
} from '../../src/lib/orders/assisted/assistedFormProgress';

const complete: AssistedFormSnapshot = {
  isEdit: false, salesChannelLabel: 'WhatsApp', customerSelected: true, fullName: 'Mireille', hasContact: true,
  unitCount: 6, groupsUnavailable: false, quantityViolation: null, stockIssues: [], fulfillment: 'delivery',
  addressComplete: true, quoteValid: true, mode: 'to_pay', modeLabel: 'À payer (lien)', paidAtMissing: false,
};

test('a complete form has every step done with its recap', () => {
  const steps = assistedFormSteps(complete);
  expect(steps.map((step) => [step.key, step.done, step.summary])).toEqual([
    ['origin', true, 'WhatsApp'], ['customer', true, 'client existant'], ['products', true, '6 articles'],
    ['fulfillment', true, 'livraison'], ['payment', true, 'À payer (lien)'],
  ]);
  expect(assistedFormIssues(steps, 'main')).toEqual([]);
});

test('every missing step is listed, not only the first one', () => {
  const steps = assistedFormSteps({ ...complete, salesChannelLabel: null, customerSelected: false, fullName: '', hasContact: false, unitCount: 0, quoteValid: false });
  expect(assistedFormIssues(steps, 'main').map((issue) => issue.step)).toEqual(['origin', 'customer', 'customer', 'products', 'fulfillment']);
  expect(steps.find((step) => step.key === 'products')!.summary).toBeNull();
});

test('a draft needs neither the shipping quote nor the payment date', () => {
  const steps = assistedFormSteps({ ...complete, quoteValid: false, mode: 'paid', paidAtMissing: true });
  expect(assistedFormIssues(steps, 'main').map((issue) => issue.message)).toEqual(['Calculez les frais de livraison.', 'Indiquez la date d’encaissement.']);
  expect(assistedFormIssues(steps, 'draft')).toEqual([]);
});

test('pickup needs no address nor quote; editing has no payment step', () => {
  expect(assistedFormSteps({ ...complete, fulfillment: 'pickup', addressComplete: true, quoteValid: false }).every((step) => step.done)).toBe(true);
  expect(assistedFormSteps({ ...complete, isEdit: true }).map((step) => step.key)).not.toContain('payment');
});

test('product issues: rules, unavailable groups, stock', () => {
  const steps = assistedFormSteps({ ...complete, groupsUnavailable: true, quantityViolation: 'Boissons : minimum 12.', stockIssues: ['Garri'] });
  expect(steps.find((step) => step.key === 'products')!.issues).toEqual([
    'Règles de quantité indisponibles : réessayez dans un instant.', 'Boissons : minimum 12.', 'Stock insuffisant : Garri.',
  ]);
});

test('primary labels say what will happen', () => {
  expect(assistedPrimaryLabel('to_pay', false, true)).toBe('Créer et envoyer le lien');
  expect(assistedPrimaryLabel('to_verify', false, true)).toBe('Enregistrer à vérifier');
  expect(assistedPrimaryLabel('paid', false, true)).toBe('Créer la commande payée');
  expect(assistedPrimaryLabel('paid', true, true)).toBe('Enregistrer');
  expect(assistedPrimaryLabel('to_pay', false)).toBe('Créer la précommande et le lien');
});

test('reorder snaps to current rules and stock, skips what cannot be sold', () => {
  const product = (id: string, patch: Partial<{ stock: number; min_order_quantity: number; order_quantity_step: number }> = {}) =>
    ({ id, name: `Produit ${id}`, stock: 50, min_order_quantity: 1, order_quantity_step: 1, ...patch });
  expect(snapQuantity(7, product('a', { min_order_quantity: 6, order_quantity_step: 6 }))).toBe(6);
  expect(snapQuantity(2, product('a', { min_order_quantity: 6, order_quantity_step: 6 }))).toBe(6);
  expect(snapQuantity(10, product('a', { stock: 4 }))).toBe(4);
  expect(snapQuantity(3, product('a', { stock: 2, min_order_quantity: 3 }))).toBeNull();

  const result = reorderLines([
    { productId: 'a', name: 'Garri', quantity: 2 },
    { productId: 'b', name: 'Bières', quantity: 7 },
    { productId: 'gone', name: 'Arachides', quantity: 1 },
    { productId: null, name: 'Produit supprimé', quantity: 1 },
    { productId: 'c', name: 'Bobolo', quantity: 1 },
  ], [product('a'), product('b', { min_order_quantity: 6, order_quantity_step: 6 }), product('c', { stock: 0 })]);
  expect(result.lines.map((line) => [line.product.id, line.quantity])).toEqual([['a', 2], ['b', 6]]);
  expect(result.adjusted).toEqual(['Produit b']);
  expect(result.skipped).toEqual(['Arachides', 'Produit supprimé', 'Produit c']);
});
