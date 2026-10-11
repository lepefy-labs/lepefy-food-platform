import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  contentLabel,
  describePrice,
  formatCount,
  parseNetQuantity,
  quantityNoun,
  referencePriceLine,
  resolveSellingFormat,
  unitPhrase,
} from '../../src/lib/storefrontCopy/sellingFormat';
import { definiteArticle, getSaleUnit } from '../../src/lib/storefrontCopy/saleUnits';
import {
  groupProgressCopy,
  minimumChip,
  minimumHeadline,
  quantityViolationCopy,
  stepLine,
} from '../../src/lib/storefrontCopy/quantityRuleCopy';
import { belowMinimumDetail, cartLineIssue, deriveAvailability, insufficientStockMessage } from '../../src/lib/storefrontCopy/availability';
import { totalWithPendingShipping } from '../../src/lib/storefrontCopy/copy';
import { formatQuantityViolationMessage, validatePurchaseQuantityRules } from '../../src/lib/purchaseQuantityRules';

/** Intl fr-FR uses (narrow) no-break spaces around amounts. */
const norm = (value: string | null) => value?.replace(/[  ]/g, ' ') ?? null;

test.describe('format de vente', () => {
  test('quantité nette : lecture stricte uniquement', () => {
    expect(parseNetQuantity('500 g')).toEqual({ value: 500, unit: 'g' });
    expect(parseNetQuantity('1,5 kg')).toEqual({ value: 1.5, unit: 'kg' });
    expect(parseNetQuantity('33cl')).toEqual({ value: 33, unit: 'cl' });
    expect(parseNetQuantity('1 L')).toEqual({ value: 1, unit: 'l' });
    for (const loose of ['env. 500 g', '500 g x2', '1,5 kg net', '500', 'g', '', '0 g', '2 pièces', '12 × 33 cl']) {
      expect(parseNetQuantity(loose), loose).toBeNull();
    }
    expect(parseNetQuantity(null)).toBeNull();
  });

  test('niveau 3 : rien de fiable → « l\'article », jamais le poids logistique', () => {
    const format = resolveSellingFormat({ net_quantity_display: null });
    expect(format.source).toBe('none');
    expect(unitPhrase(format)).toBe("l'article");
    expect(referencePriceLine(8.5, format)).toBeNull();
    // weight_grams n'est pas une source : même présent, il est ignoré.
    const withWeight = resolveSellingFormat({ weight_grams: 1100 } as never);
    expect(unitPhrase(withWeight)).toBe("l'article");
  });

  test('niveau 2 : quantité nette lisible', () => {
    const grams = resolveSellingFormat({ net_quantity_display: '500 g' });
    expect(grams.source).toBe('net_quantity');
    expect(unitPhrase(grams)).toBe('les 500 g');
    expect(norm(referencePriceLine(8.5, grams))).toBe('soit 17,00 € le kilo');

    const litre = resolveSellingFormat({ net_quantity_display: '1 L' });
    expect(unitPhrase(litre)).toBe('le litre');
    expect(referencePriceLine(4, litre)).toBeNull();

    const kilo = resolveSellingFormat({ net_quantity_display: '1 kg' });
    expect(unitPhrase(kilo)).toBe('le kilo');

    expect(unitPhrase(resolveSellingFormat({ net_quantity_display: '1000 g' }))).toBe('le kilo');
    expect(unitPhrase(resolveSellingFormat({ net_quantity_display: '100 cl' }))).toBe('le litre');
    expect(unitPhrase(resolveSellingFormat({ net_quantity_display: '1500 g' }))).toBe('les 1,5 kg');
    expect(unitPhrase(resolveSellingFormat({ net_quantity_display: '2 L' }))).toBe('les 2 L');
    const can = resolveSellingFormat({ net_quantity_display: '33 cl' });
    expect(norm(referencePriceLine(1.4, can))).toBe('soit 4,24 € le litre');

    // Texte libre non strict : pas de phrase inventée, mais la fiche peut
    // toujours afficher le texte tel quel (contentLabel = null).
    const loose = resolveSellingFormat({ net_quantity_display: 'env. 500 g' });
    expect(unitPhrase(loose)).toBe("l'article");
    expect(contentLabel(loose)).toBeNull();
  });

  test('niveau 1 : format structuré (migration 154)', () => {
    const pack = resolveSellingFormat({ sale_unit: 'paquet', net_content_value: 500, net_content_unit: 'g' });
    expect(pack.source).toBe('structured');
    expect(unitPhrase(pack)).toBe('le paquet de 500 g');
    expect(norm(describePrice(8.5, pack).sentence)).toBe('8,50 € le paquet de 500 g, soit 17,00 € le kilo');
    expect(formatCount(pack, 4)).toBe('4 paquets');
    expect(formatCount(pack, 1)).toBe('1 paquet');

    const bottle = resolveSellingFormat({ sale_unit: 'bouteille', net_content_value: '1', net_content_unit: 'l' });
    expect(unitPhrase(bottle)).toBe('la bouteille de 1 L');
    expect(referencePriceLine(4, bottle)).toBeNull();

    const carton = resolveSellingFormat({ sale_unit: 'carton', pack_count: 12, net_content_value: 33, net_content_unit: 'cl' });
    expect(unitPhrase(carton)).toBe('le carton de 12 × 33 cl');
    expect(contentLabel(carton)).toBe('12 × 33 cl');
    expect(norm(referencePriceLine(18, carton))).toBe('soit 4,55 € le litre');

    const cartonNoContent = resolveSellingFormat({ sale_unit: 'carton', pack_count: 12 });
    expect(unitPhrase(cartonNoContent)).toBe('le carton de 12');

    const piece = resolveSellingFormat({ sale_unit: 'piece' });
    expect(unitPhrase(piece)).toBe('la pièce');

    const byWeight = resolveSellingFormat({ sale_unit: 'kg', net_content_value: 500, net_content_unit: 'g' });
    expect(unitPhrase(byWeight)).toBe('le kilo');
    expect(referencePriceLine(12, byWeight)).toBeNull();
    expect(quantityNoun(byWeight, 2)).toBeNull();

    // Le structuré sans contenu retombe sur la quantité nette lisible.
    const fallbackContent = resolveSellingFormat({ sale_unit: 'sachet', net_quantity_display: '1 kg' });
    expect(unitPhrase(fallbackContent)).toBe('le sachet de 1 kg');
  });

  test('clé d\'unité inconnue ou invalide : ignorée, jamais une erreur', () => {
    expect(getSaleUnit('bidule')).toBeNull();
    expect(unitPhrase(resolveSellingFormat({ sale_unit: 'bidule', net_quantity_display: '500 g' }))).toBe('les 500 g');
    expect(unitPhrase(resolveSellingFormat({ sale_unit: 'paquet', pack_count: 1 }))).toBe('le paquet');
    expect(unitPhrase(resolveSellingFormat({ sale_unit: 'paquet', net_content_value: -3, net_content_unit: 'g' }))).toBe('le paquet');
  });

  test('article défini et élision', () => {
    expect(definiteArticle('paquet', false)).toBe('le paquet');
    expect(definiteArticle('boîte', true)).toBe('la boîte');
    expect(definiteArticle('article', false)).toBe("l'article");
  });
});

test.describe('règles de quantité', () => {
  test('phrases du minimum et du pas', () => {
    expect(minimumHeadline(4, 'paquets')).toBe('Achetez 4 paquets minimum.');
    expect(minimumHeadline(4, null)).toBe('Achetez-en 4 minimum.');
    expect(stepLine(4, 2)).toBe('Ensuite : 6, 8, 10…');
    expect(stepLine(4, 1)).toBeNull();
    expect(norm(minimumChip(4, 2.5))).toBe('4 minimum · 10,00 €');
  });

  test('message canonique des violations, mêmes types qu\'avant', () => {
    const products = [{ id: 'p', name: 'Ndolé', min_order_quantity: 4, order_quantity_step: 2 }];
    const groups = [{ id: 'g', name: 'Boissons', min_quantity: 12, quantity_step: 6, productIds: ['a', 'b'] }];

    const [productMin] = validatePurchaseQuantityRules(new Map([['p', 2]]), products, []);
    expect(formatQuantityViolationMessage(productMin!)).toBe('Ndolé : achetez-en 4 minimum. Ajoutez-en encore 2.');

    const [productStep] = validatePurchaseQuantityRules(new Map([['p', 5]]), products, []);
    expect(formatQuantityViolationMessage(productStep!)).toBe('Ndolé : se vend par 2 (4, 6, 8, 10…). Ajoutez-en encore 1 pour arriver à 6.');

    const [groupMin] = validatePurchaseQuantityRules(new Map([['a', 5], ['b', 4]]), [], groups);
    expect(formatQuantityViolationMessage(groupMin!)).toBe('Boissons : encore 3 à ajouter. Il en faut 12 minimum, et vous pouvez mélanger les produits.');

    const [groupStep] = validatePurchaseQuantityRules(new Map([['a', 10], ['b', 5]]), [], groups);
    expect(formatQuantityViolationMessage(groupStep!)).toBe('Boissons : se vend par 6 (12, 18, 24, 30…). Encore 3 à ajouter pour arriver à 18.');

    expect(quantityViolationCopy({ type: 'PRODUCT_MINIMUM', label: 'X', requiredMinimum: 2, step: 1, nextValidQuantity: 2, missingQuantity: 1 }))
      .not.toMatch(/unité\(s\)|quantité minimale/);
  });

  test('avancement d\'un groupe à mélanger', () => {
    expect(groupProgressCopy('Boissons', 9, 12, 12)).toEqual({
      done: false,
      title: 'Boissons : encore 3 à ajouter',
      detail: 'Vous en avez 9. Il en faut 12 minimum, et vous pouvez mélanger les produits.',
    });
    expect(groupProgressCopy('Boissons', 15, 18, 12).detail).toBe('Vous en avez 15. Ajoutez-en 3 pour arriver à 18. Vous pouvez mélanger les produits.');
    expect(groupProgressCopy('Boissons', 12, 12, 12)).toMatchObject({ done: true, title: "C'est bon pour « Boissons » (12)." });
  });
});

test.describe('disponibilité', () => {
  test('épuisé, sous le minimum, maximum atteint', () => {
    expect(deriveAvailability({ stock: 0, minimum: 1, step: 1 })).toBe('sold_out');
    expect(deriveAvailability({ stock: 4, minimum: 6, step: 1 })).toBe('below_minimum');
    expect(deriveAvailability({ stock: 10, minimum: 4, step: 4, inCart: 8 })).toBe('at_limit');
    expect(deriveAvailability({ stock: 10, minimum: 4, step: 4, inCart: 4 })).toBe('available');
    expect(deriveAvailability({ stock: null })).toBe('available');
    expect(belowMinimumDetail(6)).toBe("Il n'en reste pas assez pour le minimum de 6.");
  });

  test('problèmes d\'une ligne de panier, avec l\'action à faire', () => {
    const base = { removed: false, minimum: 4, step: 2, countLabel: (n: number) => `${n} paquets` };
    expect(cartLineIssue({ ...base, removed: true, stock: 10, quantity: 4 })?.kind).toBe('removed');
    expect(cartLineIssue({ ...base, stock: 0, quantity: 4 })?.message).toBe('Plus disponible. Retirez-le pour continuer.');
    expect(cartLineIssue({ ...base, stock: 3, quantity: 4 })?.message).toBe("Il n'en reste que 3 : pas assez pour le minimum de 4. Retirez ce produit.");
    expect(cartLineIssue({ ...base, stock: 7, quantity: 8 })).toEqual({ kind: 'over_stock', target: 6, message: "Il n'en reste que 7. Passez à 6 paquets." });
    expect(cartLineIssue({ ...base, stock: 20, quantity: 8 })).toBeNull();
    expect(insufficientStockMessage('Gari', 2)).toBe("Gari : il n'en reste que 2. Changez la quantité pour continuer.");
  });
});

test('total sans livraison connue : explicite, jamais « estimé »', () => {
  expect(norm(totalWithPendingShipping(33.7))).toBe('33,70 € + livraison');
});

test.describe('garde-fous du storefront', () => {
  const customerFiles = [
    'src/components/catalog/ProductCard.tsx',
    'src/components/catalog/ProductPrice.tsx',
    'src/components/product/ProductDetail.tsx',
    'src/components/product/ProductSpecs.tsx',
    'src/components/cart/CartItem.tsx',
    'src/components/cart/AddToCartConfirmation.tsx',
    'src/components/cart/QuantityGroupProgress.tsx',
    'src/app/(shop)/cart/CartPurchaseClient.tsx',
    'src/app/(shop)/checkout/CheckoutFlow.tsx',
    'src/app/(shop)/checkout/CheckoutProgressIndicator.tsx',
  ];

  for (const file of customerFiles) {
    test(`${file} : pas de « / unité », pas de texte sous 12 px, pas de poids logistique affiché`, () => {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('/ unité');
      expect(source).not.toMatch(/text-\[(9|10|10\.5|11|11\.5)px\]/);
      expect(source).not.toMatch(/formatWeight|weight_grams\s*\?\s*`/);
      expect(source).not.toMatch(/Épuisé|Stock maximum|Stock inférieur au minimum|Total estimé|Sous-total/);
    });
  }
});

