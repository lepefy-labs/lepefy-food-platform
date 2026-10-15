import { test, expect } from '@playwright/test';
import { loadCart, resetCart } from './helpers/loadCart';
import { cartProduct, PRODUCT_A, PRODUCT_B } from './helpers/cartFixtures';
import {
  decrementRemovesLine,
  repairQuantity,
  stepPurchaseQuantity,
  validatePurchaseQuantityRules,
} from '../../src/lib/purchaseQuantityRules';
import { computeCartQuantityViolations } from '../../src/lib/cart/cartQuantityValidation';
import { cartLineIssue } from '../../src/lib/storefrontCopy/availability';

// Contrôle +/− unique (card, fiche produit, panier, drawer, confirmation) :
// une seule transition, `stepPurchaseQuantity`, appliquée par le store.

const SEQUENCES: Array<{ minimum: number; step: number; expected: number[] }> = [
  { minimum: 4, step: 1, expected: [4, 5, 6] },
  { minimum: 4, step: 2, expected: [4, 6, 8] },
  { minimum: 2, step: 1, expected: [2, 3, 4] },
  { minimum: 6, step: 6, expected: [6, 12, 18] },
  { minimum: 12, step: 6, expected: [12, 18, 24] },
  { minimum: 1, step: 1, expected: [1, 2, 3] },
];

test.describe('Transition +/− (moteur)', () => {
  for (const { minimum, step, expected } of SEQUENCES) {
    test(`min ${minimum} / pas ${step} : 0 → ${expected.join(' → ')} puis retour à 0`, () => {
      const up: number[] = [];
      let quantity = 0;
      for (let i = 0; i < expected.length; i++) {
        quantity = stepPurchaseQuantity(quantity, minimum, step, 999, 'increment')!;
        up.push(quantity);
      }
      expect(up).toEqual(expected);

      const down: number[] = [];
      while (quantity > 0) {
        quantity = stepPurchaseQuantity(quantity, minimum, step, 999, 'decrement')!;
        down.push(quantity);
      }
      expect(down).toEqual([...expected.slice(0, -1).reverse(), 0]);
    });
  }

  test('le «−» au minimum retire la ligne ; jamais un état sous le minimum', () => {
    expect(decrementRemovesLine(12, 12, 6)).toBe(true);
    expect(decrementRemovesLine(18, 12, 6)).toBe(false);
    expect(decrementRemovesLine(1, 1, 1)).toBe(true);
    // Quantité héritée hors pas : le «−» la ramène au palier valide inférieur.
    expect(stepPurchaseQuantity(13, 12, 6, 999, 'decrement')).toBe(12);
    // Quantité héritée sous le minimum : le «−» retire.
    expect(stepPurchaseQuantity(8, 12, 6, 999, 'decrement')).toBe(0);
    expect(stepPurchaseQuantity(0, 12, 6, 999, 'decrement')).toBeNull();
  });

  test('le stock plafonne le «+» sur un palier valide', () => {
    expect(stepPurchaseQuantity(0, 12, 6, 11, 'increment')).toBeNull();
    expect(stepPurchaseQuantity(0, 12, 6, 12, 'increment')).toBe(12);
    expect(stepPurchaseQuantity(12, 12, 6, 20, 'increment')).toBe(18);
    expect(stepPurchaseQuantity(18, 12, 6, 20, 'increment')).toBeNull();
  });

  test('réparation d’une quantité enregistrée hors règle', () => {
    expect(repairQuantity(13, 99, 12, 6)).toBe(12);
    expect(repairQuantity(24, 20, 12, 6)).toBe(18);
    expect(repairQuantity(8, 99, 12, 6)).toBe(12);
    expect(repairQuantity(8, 10, 12, 6)).toBe(0);
  });
});

test.describe('Transition +/− (store, utilisée par tous les contrôles)', () => {
  test.beforeEach(async () => { await resetCart(); });

  test('premier clic = minimum, puis le pas, puis «−» jusqu’à la suppression', async () => {
    const { store } = await loadCart();
    const product = { ...cartProduct(PRODUCT_A), stock: 50, min_order_quantity: 12, order_quantity_step: 6 };
    const cart = () => store.useCartStore.getState();
    const quantity = () => cart().items.find((item) => item.product.id === product.id)?.quantity ?? 0;

    cart().addItem(product);
    expect(quantity()).toBe(12);
    cart().incrementItem(product.id);
    cart().incrementItem(product.id);
    expect(quantity()).toBe(24);
    expect(cart().decrementItem(product.id)).toBe('decremented');
    expect(quantity()).toBe(18);
    expect(cart().decrementItem(product.id)).toBe('decremented');
    expect(quantity()).toBe(12);
    expect(cart().decrementItem(product.id)).toBe('removed');
    expect(cart().items).toEqual([]);
    expect(cart().decrementItem(product.id)).toBe('unchanged');
  });

  test('clics rapides : chaque clic relit l’état courant, aucune valeur intermédiaire invalide', async () => {
    const { store } = await loadCart();
    const product = { ...cartProduct(PRODUCT_A), stock: 30, min_order_quantity: 4, order_quantity_step: 1 };
    const seen: number[] = [];
    const unsubscribe = store.useCartStore.subscribe((state) => {
      const q = state.items.find((item) => item.product.id === product.id)?.quantity;
      if (q !== undefined) seen.push(q);
    });
    store.useCartStore.getState().addItem(product);
    for (let i = 0; i < 10; i++) store.useCartStore.getState().incrementItem(product.id);
    for (let i = 0; i < 30; i++) store.useCartStore.getState().decrementItem(product.id);
    unsubscribe();
    expect(seen.every((q) => q >= 4)).toBe(true);
    expect(Math.max(...seen)).toBe(14);
    expect(store.useCartStore.getState().items).toEqual([]);
  });

  test('stock limité : le «+» s’arrête au dernier palier disponible', async () => {
    const { store } = await loadCart();
    const product = { ...cartProduct(PRODUCT_A), stock: 20, min_order_quantity: 12, order_quantity_step: 6 };
    store.useCartStore.getState().addItem(product);
    store.useCartStore.getState().incrementItem(product.id);
    store.useCartStore.getState().incrementItem(product.id);
    expect(store.useCartStore.getState().items[0]?.quantity).toBe(18);
  });

  test('un client authentifié n’envoie que des quantités valides (mutations typées)', async () => {
    const { store } = await loadCart();
    store.useCartStore.setState({ ownerCustomerId: 'cust-1' });
    const product = { ...cartProduct(PRODUCT_A), stock: 50, min_order_quantity: 6, order_quantity_step: 6 };
    const last = () => store.useCartStore.getState().pendingMutations.slice(-1)[0];
    store.useCartStore.getState().addItem(product);
    expect(last()).toMatchObject({ type: 'add', quantity: 6 });
    store.useCartStore.getState().incrementItem(product.id);
    expect(last()).toMatchObject({ type: 'set_quantity', quantity: 12 });
    store.useCartStore.getState().decrementItem(product.id);
    expect(last()).toMatchObject({ type: 'set_quantity', quantity: 6 });
    store.useCartStore.getState().decrementItem(product.id);
    // La file fusionne les mutations du même produit : il ne reste que la suppression.
    expect(store.useCartStore.getState().pendingMutations.map((m) => m.type)).toEqual(['remove']);
  });

  test('groupe combinable : règle sur la somme, jamais déduite du produit', async () => {
    const { store } = await loadCart();
    // Deux boissons à l'unité (min 1 / pas 1) dans un groupe « Boissons » min 12 / pas 6.
    const a = { ...cartProduct(PRODUCT_A), stock: 99, min_order_quantity: 1, order_quantity_step: 1 };
    const b = { ...cartProduct(PRODUCT_B), stock: 99, min_order_quantity: 1, order_quantity_step: 1 };
    const group = { id: 'g1', name: 'Boissons', min_quantity: 12, quantity_step: 6, productIds: [a.id, b.id] };
    store.useCartStore.getState().addItem(a);
    // Le premier clic ajoute le minimum du PRODUIT (1), pas celui du groupe.
    expect(store.useCartStore.getState().items[0]?.quantity).toBe(1);
    for (let i = 0; i < 6; i++) store.useCartStore.getState().incrementItem(a.id);
    store.useCartStore.getState().addItem(b);
    for (let i = 0; i < 3; i++) store.useCartStore.getState().incrementItem(b.id);
    const items = store.useCartStore.getState().items;
    expect(items.map((item) => item.quantity)).toEqual([7, 4]);
    const violations = computeCartQuantityViolations(items, [group]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ type: 'GROUP_MINIMUM', currentQuantity: 11, nextValidQuantity: 12 });
    store.useCartStore.getState().incrementItem(b.id);
    expect(computeCartQuantityViolations(store.useCartStore.getState().items, [group])).toEqual([]);
    // Même moteur que le serveur (/api/checkout).
    expect(validatePurchaseQuantityRules(new Map([[a.id, 7], [b.id, 5]]), [], [group])).toEqual([]);
    expect(validatePurchaseQuantityRules(new Map([[a.id, 7], [b.id, 6]]), [], [group])[0]?.type).toBe('GROUP_STEP');
  });
});

test.describe('Ligne de panier à corriger', () => {
  const base = { removed: false, countLabel: (n: number) => `${n} bouteilles` };

  test('quantité hors pas : action « Passer à » vers le palier valide inférieur', () => {
    expect(cartLineIssue({ ...base, minimum: 12, step: 6, stock: 99, quantity: 13 })).toEqual({
      kind: 'off_rule', target: 12, message: 'Vendu par 6 à partir de 12. Passez à 12 bouteilles.',
    });
    expect(cartLineIssue({ ...base, minimum: 4, step: 1, stock: 99, quantity: 2 })).toEqual({
      kind: 'off_rule', target: 4, message: 'Vendu à partir de 4. Passez à 4 bouteilles.',
    });
  });

  test('stock insuffisant reste prioritaire et propose le dernier palier', () => {
    expect(cartLineIssue({ ...base, minimum: 12, step: 6, stock: 20, quantity: 24 })).toMatchObject({ kind: 'over_stock', target: 18 });
    expect(cartLineIssue({ ...base, minimum: 12, step: 6, stock: 99, quantity: 18 })).toBeNull();
  });
});
