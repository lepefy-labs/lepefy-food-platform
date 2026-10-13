import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { buildCatalogUrl, catalogSearchHref } from '../../src/lib/catalog/catalogSearchUrl';
import { isCatalogSearchPath, isCheckoutPath, shouldShowGlobalSearch, shouldShowPromoTicker } from '../../src/lib/storefront/shopChrome';
import {
  CART_NUDGE_MAX_PER_SESSION,
  CART_NUDGE_MIN_INTERVAL_MS,
  CART_NUDGE_QUIET_MS,
  parseNudgeHistory,
  shouldNudgeCart,
  type CartNudgeInput,
} from '../../src/lib/cart/cartNudgePolicy';
import { cartAriaLabel, formatCartBadge } from '../../src/lib/cart/cartBadge';
import { accentTextOnWhite, contrastRatio, readableOn } from '../../src/lib/utils/color';
import { parseLimitParam, PRODUCTS_PAGE_SIZE } from '../../src/lib/catalog/pagination';

test.describe('URL de recherche du Catalogue', () => {
  test('une recherche repart de la page 1 et garde le tri', () => {
    expect(buildCatalogUrl('/', 'sort=price_asc&page=3&day=2026-10-12', { q: '  riz ' })).toBe('/?sort=price_asc&q=riz');
  });

  test('une recherche vide retire q, une valeur absente conserve celle de l’URL', () => {
    expect(buildCatalogUrl('/', 'q=riz&category=epicerie', { q: '   ' })).toBe('/?category=epicerie');
    expect(buildCatalogUrl('/', 'q=riz', { sort: 'newest' })).toBe('/?q=riz&sort=newest');
  });

  test('une catégorie efface le groupe à compléter ; recommandé retire le tri', () => {
    expect(buildCatalogUrl('/', 'quantityGroup=g1&sort=newest', { q: '', category: 'boissons', sort: 'recommended' })).toBe('/?category=boissons');
    expect(buildCatalogUrl('/', 'category=boissons', { category: null })).toBe('/');
  });

  test('lien « Voir tous les résultats » encodé', () => {
    expect(catalogSearchHref('piment & co')).toBe('/?q=piment+%26+co');
  });
});

test.describe('éléments du layout boutique', () => {
  test('la recherche est absente des parcours paiement et sensibles', () => {
    for (const path of ['/checkout', '/checkout/paiement', '/order-confirmation', '/avis/donner', '/supprimer-compte']) {
      expect(shouldShowGlobalSearch(path), path).toBe(false);
    }
    for (const path of ['/', '/accueil', '/products/attieke', '/cart', '/gadgets', '/avis', '/compte', '/orders/1', '/o/token']) {
      expect(shouldShowGlobalSearch(path), path).toBe(true);
    }
    // Un préfixe partiel ne masque rien.
    expect(shouldShowGlobalSearch('/checkout-info')).toBe(true);
  });

  test('le Catalogue filtre, le bandeau défilant ne reste que sur Découvrir', () => {
    expect(isCatalogSearchPath('/')).toBe(true);
    expect(isCatalogSearchPath('/gadgets')).toBe(false);
    expect(shouldShowPromoTicker('/accueil')).toBe(true);
    for (const path of ['/', '/products/attieke', '/cart', '/gadgets', '/checkout']) expect(shouldShowPromoTicker(path), path).toBe(false);
    expect(isCheckoutPath('/checkout/x')).toBe(true);
    expect(isCheckoutPath('/cart')).toBe(false);
  });

  test('le layout boutique reste sans cookies et monte recherche puis bandeau', () => {
    const layout = readFileSync('src/app/(shop)/layout.tsx', 'utf8');
    expect(layout).not.toMatch(/cookies\(|headers\(/);
    expect(layout.indexOf('<ShopSearchBar />')).toBeGreaterThan(layout.indexOf('<Header'));
    expect(layout.indexOf('<PromoTickerGate />')).toBeGreaterThan(layout.indexOf('<ShopSearchBar />'));
  });

  test('le panier latéral reste accessible à côté de la recherche mobile', () => {
    const bar = readFileSync('src/components/search/ShopSearchBar.tsx', 'utf8');
    expect(bar).toContain('<CartShortcutButton />');
    // À 768 px l'header (logo 320 px + liens) n'a pas la place du bouton « Mon panier ».
    const header = readFileSync('src/components/layout/Header.tsx', 'utf8');
    expect(header).toMatch(/hidden min-h-11[^`]*lg:inline-flex/);
    const button = readFileSync('src/components/cart/CartShortcutButton.tsx', 'utf8');
    expect(button).toContain('openDrawer()');
    expect(button).toContain('href="/cart"');
  });

  test('un seul champ de recherche : CatalogClient n’en possède plus', () => {
    const catalog = readFileSync('src/components/catalog/CatalogClient.tsx', 'utf8');
    expect(catalog).not.toContain('type="search"');
    expect(catalog).toContain('useCatalogSearchStore');
  });
});

const NOW = 10_000_000;
function nudge(overrides: Partial<CartNudgeInput> = {}): boolean {
  return shouldNudgeCart({
    now: NOW,
    itemCount: 3,
    onCartOrCheckout: false,
    drawerOpen: false,
    confirmationOpen: false,
    reducedMotion: false,
    documentHidden: false,
    sessionStartedAt: NOW - CART_NUDGE_QUIET_MS,
    lastAddAt: null,
    lastCartViewAt: null,
    history: [],
    ...overrides,
  });
}

test.describe('rappel du panier (anti-spam)', () => {
  test('rappel possible après un calme suffisant avec un panier non vide', () => {
    expect(nudge()).toBe(true);
  });

  test('jamais sans produit, sur panier/checkout, drawer ou confirmation ouverts', () => {
    expect(nudge({ itemCount: 0 })).toBe(false);
    expect(nudge({ onCartOrCheckout: true })).toBe(false);
    expect(nudge({ drawerOpen: true })).toBe(false);
    expect(nudge({ confirmationOpen: true })).toBe(false);
  });

  test('jamais avec mouvement réduit ou page en arrière-plan', () => {
    expect(nudge({ reducedMotion: true })).toBe(false);
    expect(nudge({ documentHidden: true })).toBe(false);
  });

  test('calme après arrivée, ajout ou consultation du panier', () => {
    expect(nudge({ sessionStartedAt: NOW - 1000 })).toBe(false);
    expect(nudge({ lastAddAt: NOW - CART_NUDGE_QUIET_MS + 1 })).toBe(false);
    expect(nudge({ lastCartViewAt: NOW - 60_000 })).toBe(false);
    expect(nudge({ lastAddAt: NOW - CART_NUDGE_QUIET_MS })).toBe(true);
  });

  test('intervalle minimal et plafond par session', () => {
    expect(nudge({ history: [NOW - CART_NUDGE_MIN_INTERVAL_MS + 1] })).toBe(false);
    expect(nudge({ history: [NOW - CART_NUDGE_MIN_INTERVAL_MS] })).toBe(true);
    const full = Array.from({ length: CART_NUDGE_MAX_PER_SESSION }, (_, i) => NOW - (i + 2) * CART_NUDGE_MIN_INTERVAL_MS);
    expect(nudge({ history: full })).toBe(false);
  });

  test('historique tolérant (stockage corrompu ou bloqué)', () => {
    expect(parseNudgeHistory(null)).toEqual([]);
    expect(parseNudgeHistory('{oops')).toEqual([]);
    expect(parseNudgeHistory('"x"')).toEqual([]);
    expect(parseNudgeHistory('[1, "a", 2, null, 3]')).toEqual([2, 3]);
  });
});

test.describe('pastille et libellé du panier', () => {
  test('99+ au-delà de 99', () => {
    expect(formatCartBadge(1)).toBe('1');
    expect(formatCartBadge(99)).toBe('99');
    expect(formatCartBadge(100)).toBe('99+');
  });

  test('aria-label singulier, pluriel, vide', () => {
    expect(cartAriaLabel(0)).toBe('Panier, vide');
    expect(cartAriaLabel(1)).toBe('Panier, 1 article');
    expect(cartAriaLabel(120)).toBe('Panier, 120 articles');
    expect(cartAriaLabel(2, 'Ouvrir le panier')).toBe('Ouvrir le panier, 2 articles');
  });
});

test.describe('couleurs lisibles sur les tokens tenant', () => {
  test('icône sur la couleur primaire : blanc tant que lisible, sinon foncé', () => {
    expect(readableOn('#1267C7')).toBe('#ffffff');
    expect(readableOn('#1D9E75')).toBe('#ffffff');
    expect(readableOn('#F2C811')).toBe('#111827');
    expect(readableOn('fff')).toBe('#111827');
    expect(readableOn('rgb(0,0,0)')).toBe('#ffffff');
    expect(readableOn(null)).toBe('#ffffff');
  });

  test('petit texte sur la secondaire : 4.5:1 exigé', () => {
    const color = readableOn('#1D9E75', 4.5);
    expect(contrastRatio('#1D9E75', color)).toBeGreaterThanOrEqual(4.5);
  });

  test('couleur tenant comme texte sur blanc seulement si lisible', () => {
    expect(accentTextOnWhite('#1267C7')).toBe('#1267C7');
    expect(accentTextOnWhite('#F2C811')).toBe('#111827');
    expect(accentTextOnWhite(undefined)).toBe('#111827');
  });
});

test.describe('paramètre limit de /api/products', () => {
  test('défaut, bornes et valeurs invalides', () => {
    expect(parseLimitParam(null)).toBe(PRODUCTS_PAGE_SIZE);
    expect(parseLimitParam('')).toBe(PRODUCTS_PAGE_SIZE);
    expect(parseLimitParam('5')).toBe(5);
    expect(parseLimitParam('5.9')).toBe(5);
    expect(parseLimitParam('0')).toBe(PRODUCTS_PAGE_SIZE);
    expect(parseLimitParam('-3')).toBe(PRODUCTS_PAGE_SIZE);
    expect(parseLimitParam('abc')).toBe(PRODUCTS_PAGE_SIZE);
    expect(parseLimitParam('10000')).toBe(PRODUCTS_PAGE_SIZE);
  });
});
