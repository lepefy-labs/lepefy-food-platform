import { test, expect } from '@playwright/test';
import { buildCatalogUrl, CATALOG_PROMOS_HREF, isPromoFilter } from '../../src/lib/catalog/catalogSearchUrl';
import { isCartPath, isOrderTrackingPath, shouldShowBottomNav, shouldShowGlobalSearch, shouldShowSearchBar } from '../../src/lib/storefront/shopChrome';
import {
  getShoppingReturn,
  markShoppingReturn,
  rememberCatalogPosition,
  rememberShoppingReturn,
  safeCatalogTarget,
  takeCatalogScrollRestore,
} from '../../src/lib/catalog/shoppingReturn';

test.describe('zones collantes du panier', () => {
  test('panier : BottomNav présente (vide ou non), pas de recherche collante globale', () => {
    expect(shouldShowBottomNav('/cart')).toBe(true);
    expect(shouldShowSearchBar('/cart')).toBe(false);
    // L'en-tête desktop garde sa recherche ; sur mobile l'en-tête contextuel remplace l'en-tête commercial.
    expect(shouldShowGlobalSearch('/cart')).toBe(true);
    expect(isCartPath('/cart')).toBe(true);
  });

  test('le paiement privilégie la fin de l’achat : pas de BottomNav', () => {
    expect(shouldShowBottomNav('/checkout')).toBe(false);
    expect(shouldShowBottomNav('/checkout/en-attente')).toBe(false);
    expect(shouldShowBottomNav('/avis/donner')).toBe(false);
  });

  test('suivi de commande : ni recherche collante ni BottomNav, la liste des commandes garde la navigation', () => {
    const tracking = '/orders/5ca23a93-1111-4222-8333-444455556666';
    expect(isOrderTrackingPath(tracking)).toBe(true);
    expect(shouldShowSearchBar(tracking)).toBe(false);
    expect(shouldShowBottomNav(tracking)).toBe(false);
    expect(isOrderTrackingPath('/orders')).toBe(false);
    expect(isOrderTrackingPath('/orders/')).toBe(false);
    expect(shouldShowBottomNav('/orders')).toBe(true);
    expect(shouldShowSearchBar('/orders')).toBe(true);
  });

  test('ailleurs : inchangé', () => {
    expect(shouldShowBottomNav('/')).toBe(true);
    expect(shouldShowBottomNav('/products/riz')).toBe(true);
    expect(isCartPath('/')).toBe(false);
    expect(isCartPath('/cart/x')).toBe(false);
    expect(shouldShowSearchBar('/')).toBe(true);
    expect(shouldShowSearchBar('/checkout')).toBe(false);
  });
});

test.describe('« Nos promos » dans l’URL du catalogue', () => {
  test('ouvrir les promos retire recherche, catégorie, groupe et page', () => {
    expect(buildCatalogUrl('/', 'q=riz&category=epicerie&quantityGroup=g1&page=3&sort=newest', { promo: true })).toBe('/?sort=newest&promo=1');
    expect(CATALOG_PROMOS_HREF).toBe('/?promo=1');
  });

  test('une recherche, une catégorie ou la fermeture quittent la vue promo', () => {
    expect(buildCatalogUrl('/', 'promo=1', { q: 'riz' })).toBe('/?q=riz');
    expect(buildCatalogUrl('/', 'promo=1', { category: 'boissons' })).toBe('/?category=boissons');
    expect(buildCatalogUrl('/', 'promo=1&sort=newest', { promo: false })).toBe('/?sort=newest');
    // Effacer une recherche vide ne touche pas au reste.
    expect(buildCatalogUrl('/', 'promo=1', { q: '' })).toBe('/?promo=1');
  });

  test('seule la valeur 1 active le filtre', () => {
    expect(isPromoFilter('1')).toBe(true);
    expect(isPromoFilter('true')).toBe(false);
    expect(isPromoFilter(undefined)).toBe(false);
  });
});

test.describe('retour au catalogue depuis le panier', () => {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };

  test.beforeAll(() => {
    Object.defineProperty(globalThis, 'window', {
      value: { sessionStorage, location: { origin: 'https://shop.example' } }, configurable: true, writable: true,
    });
  });
  test.afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
  });
  test.beforeEach(() => store.clear());

  test('ne garde que le catalogue et ses filtres connus, jamais une autre page', () => {
    expect(safeCatalogTarget('/', '?category=boissons&promo=1&page=2&utm=x')).toBe('/?category=boissons&page=2&promo=1');
    expect(safeCatalogTarget('/products/riz', '')).toBeNull();
    expect(safeCatalogTarget('/checkout', '?q=a')).toBeNull();
  });

  test('défaut : le catalogue du tenant', () => {
    expect(getShoppingReturn('/')).toBe('/');
  });

  test('le catalogue affiché est retenu, même sans clic sur une carte', () => {
    rememberCatalogPosition({ pathname: '/', search: '?q=riz&page=3&day=2026-10-14' }, 1840);
    expect(getShoppingReturn('/')).toBe('/?q=riz&day=2026-10-14&page=3');
  });

  test('la position est rendue une seule fois, après « Continuer mes achats », pour la même URL', () => {
    const location = { pathname: '/', search: '?category=boissons&page=2' };
    rememberCatalogPosition(location, 1200.4);
    // Visite ordinaire : pas de restauration.
    expect(takeCatalogScrollRestore(location)).toBeNull();
    markShoppingReturn();
    expect(takeCatalogScrollRestore(location)).toBe(1200);
    expect(takeCatalogScrollRestore(location)).toBeNull();
    // Autre URL : pas de restauration hasardeuse.
    markShoppingReturn();
    expect(takeCatalogScrollRestore({ pathname: '/', search: '?category=epices' })).toBeNull();
  });

  test('une valeur hors catalogue enregistrée est ignorée', () => {
    rememberShoppingReturn({ pathname: '/checkout', search: '' });
    expect(getShoppingReturn('/')).toBe('/');
    store.set('lepefy-shopping-return', '//evil.example/');
    expect(getShoppingReturn('/')).toBe('/');
    store.set('lepefy-shopping-return', 'https://evil.example/?q=a');
    expect(getShoppingReturn('/')).toBe('/');
  });
});
