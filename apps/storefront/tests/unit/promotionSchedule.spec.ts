import { test, expect } from '@playwright/test';
import {
  isSoldOutForPromotion,
  parsePricingBody,
  PRICING_COPY,
  pricingInputFromRow,
  promotionState,
  resolvePricingColumns,
} from '../../src/lib/catalog/promotionSchedule';
import { isActivePromotion, promotionEndLabel } from '../../src/lib/catalog/promotions';
import {
  getActiveNovelties,
  hasNoveltyBadge,
  isActiveNovelty,
  noveltyUntil,
  NOVELTY_COPY,
  parseNoveltyUntil,
  selectActiveNovelties,
} from '../../src/lib/catalog/novelties';
import { formatShopDate, isoToShopLocal, shopLocalToIso } from '../../src/lib/time/shopTime';
import { buildCatalogUrl, CATALOG_NOVELTIES_HREF } from '../../src/lib/catalog/catalogSearchUrl';
import { summarizeCatalogSchedule } from '../../src/lib/catalog/catalogScheduleTick';
import { applyCatalogueStatus, CATALOGUE_STATUS_OPTIONS } from '../../src/lib/catalog/catalogueFilters';

const NOW = new Date('2026-10-15T10:00:00Z');
const stock = { stock: 20, minimum: 1 };

test.describe('Heure de la boutique (Paris)', () => {
  test('champ datetime-local ↔ ISO, été et hiver', () => {
    expect(shopLocalToIso('2026-10-20T09:00')).toBe('2026-10-20T07:00:00.000Z');
    expect(shopLocalToIso('2026-11-03T09:00')).toBe('2026-11-03T08:00:00.000Z');
    expect(isoToShopLocal('2026-10-31T22:59:00.000Z')).toBe('2026-10-31T23:59');
    expect(isoToShopLocal('2026-10-20T07:00:00.000Z')).toBe('2026-10-20T09:00');
    for (const local of ['2026-01-05T08:30', '2026-07-14T23:59', '2026-12-31T00:00']) {
      expect(isoToShopLocal(shopLocalToIso(local))).toBe(local);
    }
  });

  test('passage à l’heure d’été : l’heure inexistante est décalée, jamais perdue', () => {
    const iso = shopLocalToIso('2026-03-29T02:30');
    expect(iso).not.toBeNull();
    expect(['2026-03-29T03:30', '2026-03-29T01:30']).toContain(isoToShopLocal(iso));
  });

  test('valeurs vides ou mal formées', () => {
    expect(shopLocalToIso('')).toBeNull();
    expect(shopLocalToIso('20/10/2026 09:00')).toBeNull();
    expect(isoToShopLocal(null)).toBe('');
    expect(isoToShopLocal('pas une date')).toBe('');
  });

  test('dates affichées en français, à l’heure de Paris', () => {
    expect(formatShopDate('2026-10-31T22:59:00.000Z')).toBe('sam. 31 oct.');
    expect(formatShopDate('2026-10-31T22:59:00.000Z', 'long')).toBe('samedi 31 octobre à 23:59');
  });
});

test.describe('Colonnes de prix calculées par l’admin', () => {
  test('sans promotion : prix normal, aucun prix barré', () => {
    const result = resolvePricingColumns({ regular_price: '4,90', promo: null }, stock, NOW);
    expect(result).toEqual({ ok: true, columns: {
      price: 4.9, compare_at_price: null, promo_price: null, promo_starts_at: null,
      promo_ends_at: null, promo_until_sold_out: false, promo_applied: false,
    } });
  });

  test('promo qui commence maintenant : prix promo payé, prix normal barré', () => {
    const result = resolvePricingColumns({ regular_price: 30, promo: { price: '25.90', starts_at: null, ends_at: '2026-10-31T22:59:00Z', until_sold_out: true } }, stock, NOW);
    expect(result.ok && result.columns).toMatchObject({
      price: 25.9, compare_at_price: 30, promo_price: 25.9, promo_applied: true,
      promo_ends_at: '2026-10-31T22:59:00.000Z', promo_until_sold_out: true,
    });
  });

  test('promo programmée : le prix normal reste payé jusqu’au début', () => {
    const result = resolvePricingColumns({ regular_price: 30, promo: { price: 25.9, starts_at: '2026-10-20T07:00:00Z', ends_at: null, until_sold_out: false } }, stock, NOW);
    expect(result.ok && result.columns).toMatchObject({
      price: 30, compare_at_price: null, promo_price: 25.9, promo_applied: false, promo_starts_at: '2026-10-20T07:00:00.000Z',
    });
  });

  test('refus explicites', () => {
    const promo = (over: object) => ({ regular_price: 30, promo: { price: 25, starts_at: null, ends_at: null, until_sold_out: false, ...over } });
    expect(resolvePricingColumns({ regular_price: 0, promo: null }, stock, NOW)).toEqual({ ok: false, error: PRICING_COPY.invalidRegular });
    expect(resolvePricingColumns(promo({ price: 30 }), stock, NOW)).toEqual({ ok: false, error: PRICING_COPY.promoNotLower });
    expect(resolvePricingColumns(promo({ price: 0 }), stock, NOW)).toEqual({ ok: false, error: PRICING_COPY.invalidPromo });
    expect(resolvePricingColumns(promo({ ends_at: '2026-10-14T00:00:00Z' }), stock, NOW)).toEqual({ ok: false, error: PRICING_COPY.endInPast });
    expect(resolvePricingColumns(promo({ starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-10-19T00:00:00Z' }), stock, NOW)).toEqual({ ok: false, error: PRICING_COPY.endBeforeStart });
    expect(resolvePricingColumns(promo({ ends_at: 'demain' }), stock, NOW)).toEqual({ ok: false, error: PRICING_COPY.invalidDate });
    expect(resolvePricingColumns(promo({ until_sold_out: true }), { stock: 3, minimum: 4 }, NOW)).toEqual({ ok: false, error: PRICING_COPY.soldOutWithoutStock });
  });

  test('épuisé = le stock ne couvre plus le minimum (même règle que le trigger SQL)', () => {
    expect(isSoldOutForPromotion(0, 1)).toBe(true);
    expect(isSoldOutForPromotion(3, 4)).toBe(true);
    expect(isSoldOutForPromotion(4, 4)).toBe(false);
  });

  test('état et valeur de l’éditeur pour chaque ligne', () => {
    const active = { price: 25.9, compare_at_price: 30, promo_price: 25.9, promo_applied: true, promo_starts_at: null, promo_ends_at: '2026-10-31T22:59:00Z', promo_until_sold_out: true };
    const scheduled = { price: 30, compare_at_price: null, promo_price: 25.9, promo_applied: false, promo_starts_at: '2026-10-20T07:00:00Z', promo_ends_at: null, promo_until_sold_out: false };
    const manual = { price: 25.9, compare_at_price: 30 };
    const none = { price: 30, compare_at_price: null };
    expect([active, scheduled, manual, none].map(promotionState)).toEqual(['active', 'scheduled', 'manual', 'none']);
    expect(pricingInputFromRow(active)).toEqual({ regular_price: 30, promo: { price: 25.9, starts_at: null, ends_at: '2026-10-31T22:59:00Z', until_sold_out: true } });
    expect(pricingInputFromRow(scheduled).regular_price).toBe(30);
    expect(pricingInputFromRow(manual)).toEqual({ regular_price: 30, promo: { price: 25.9, starts_at: null, ends_at: null, until_sold_out: false } });
    expect(pricingInputFromRow(none)).toEqual({ regular_price: 30, promo: null });
    // Réenregistrer une promo en cours donne les mêmes colonnes.
    const again = resolvePricingColumns(pricingInputFromRow(active), stock, NOW);
    expect(again.ok && again.columns).toMatchObject({ price: 25.9, compare_at_price: 30, promo_applied: true });
  });

  test('corps `pricing` de l’éditeur', () => {
    expect(parsePricingBody({ regular_price: '30', promo: null })).toEqual({ regular_price: '30', promo: null });
    expect(parsePricingBody({ regular_price: 30, promo: { price: '25', starts_at: ' ', ends_at: '2026-10-31T22:59:00Z', until_sold_out: 'oui' } }))
      .toEqual({ regular_price: 30, promo: { price: '25', starts_at: null, ends_at: '2026-10-31T22:59:00Z', until_sold_out: false } });
    expect(parsePricingBody(null)).toBeNull();
    expect(parsePricingBody({ regular_price: {} })).toBeNull();
    expect(parsePricingBody({ regular_price: 30, promo: { price: null } })).toBeNull();
  });
});

test.describe('Fin de promotion affichée au client', () => {
  const base = { price: 25.9, compare_at_price: 30, promo_applied: true };
  test('date, épuisement des stocks, les deux', () => {
    expect(promotionEndLabel({ ...base, promo_ends_at: '2026-10-31T22:59:00Z' })).toBe('Jusqu’au sam. 31 oct.');
    expect(promotionEndLabel({ ...base, promo_ends_at: '2026-10-31T22:59:00Z', promo_until_sold_out: true })).toBe('Jusqu’au sam. 31 oct. ou épuisement des stocks');
    expect(promotionEndLabel({ ...base, promo_until_sold_out: true })).toBe('Jusqu’à épuisement des stocks');
    expect(promotionEndLabel({ ...base, promo_ends_at: '2026-10-31T22:59:00Z' }, 'long')).toBe('Jusqu’au samedi 31 octobre à 23:59');
  });

  test('rien sans promotion programmée en cours', () => {
    expect(promotionEndLabel({ ...base })).toBeNull();
    expect(promotionEndLabel({ price: 25.9, compare_at_price: 30 })).toBeNull();
    expect(promotionEndLabel({ price: 30, compare_at_price: null, promo_applied: false, promo_ends_at: '2026-10-31T22:59:00Z' })).toBeNull();
  });

  test('une promo dont la fin est passée n’est plus comptée, même avant le tick', () => {
    const row = { id: 'a', ...base, stock: 5, min_order_quantity: 1, order_quantity_step: 1, promo_ends_at: '2026-10-15T09:59:00Z' };
    expect(isActivePromotion(row, NOW.getTime())).toBe(false);
    expect(isActivePromotion({ ...row, promo_ends_at: '2026-10-15T10:01:00Z' }, NOW.getTime())).toBe(true);
  });
});

test.describe('Nouveautés', () => {
  const row = (id: string, until: string | null, extra = {}) => ({ id, new_until: until, stock: 10, min_order_quantity: 1, order_quantity_step: 1, ...extra });

  test('badge et compteur', () => {
    expect(hasNoveltyBadge({ new_until: '2026-10-29T00:00:00Z' })).toBe(true);
    expect(hasNoveltyBadge({ new_until: null })).toBe(false);
    expect(isActiveNovelty(row('a', '2026-10-29T00:00:00Z'), NOW.getTime())).toBe(true);
    expect(isActiveNovelty(row('b', '2026-10-15T09:00:00Z'), NOW.getTime())).toBe(false);
    expect(isActiveNovelty(row('c', '2026-10-29T00:00:00Z', { stock: 0 }), NOW.getTime())).toBe(false);
    expect(selectActiveNovelties([row('a', '2026-10-29T00:00:00Z'), row('a', '2026-10-29T00:00:00Z'), row('b', null)], NOW.getTime()).map((r) => r.id)).toEqual(['a']);
  });

  test('durées et saisie admin', () => {
    expect(noveltyUntil(14, NOW)).toBe('2026-10-29T10:00:00.000Z');
    expect(parseNoveltyUntil('', NOW)).toEqual({ ok: true, value: null });
    expect(parseNoveltyUntil('2026-10-29T10:00:00Z', NOW)).toEqual({ ok: true, value: '2026-10-29T10:00:00.000Z' });
    expect(parseNoveltyUntil('2026-10-01T10:00:00Z', NOW)).toEqual({ ok: false, error: NOVELTY_COPY.pastDate });
    expect(parseNoveltyUntil(12, NOW)).toEqual({ ok: false, error: NOVELTY_COPY.invalidDate });
  });

  test('lecture par tenant : tenant, actif, catégories boutique, date future', async () => {
    const calls: unknown[][] = [];
    const builder = {
      select: (...a: unknown[]) => { calls.push(['select', ...a]); return builder; },
      eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return builder; },
      in: (...a: unknown[]) => { calls.push(['in', ...a]); return builder; },
      gt: (...a: unknown[]) => { calls.push(['gt', ...a]); return builder; },
      order: (...a: unknown[]) => { calls.push(['order', ...a]); return builder; },
      limit: async () => ({ data: [row('n1', '2026-10-29T00:00:00Z'), row('n2', '2026-10-01T00:00:00Z')], error: null }),
    };
    const client = { from: (table: string) => { calls.push(['from', table]); return builder; } };
    const result = await getActiveNovelties(client as never, 'tenant-1', ['cat-shop'], NOW);
    expect(result.map((r) => r.id)).toEqual(['n1']);
    expect(calls).toContainEqual(['eq', 'tenant_id', 'tenant-1']);
    expect(calls).toContainEqual(['eq', 'active', true]);
    expect(calls).toContainEqual(['in', 'category_id', ['cat-shop']]);
    expect(calls).toContainEqual(['gt', 'new_until', NOW.toISOString()]);
    expect(await getActiveNovelties(client as never, '', ['cat-shop'], NOW)).toEqual([]);
  });

  test('URL du catalogue : promos et nouveautés s’excluent', () => {
    expect(CATALOG_NOVELTIES_HREF).toBe('/?new=1');
    expect(buildCatalogUrl('/', 'promo=1&q=riz&category=epices', { novelty: true })).toBe('/?new=1');
    expect(buildCatalogUrl('/', 'new=1', { promo: true })).toBe('/?promo=1');
    expect(buildCatalogUrl('/', 'new=1&sort=newest', { novelty: false })).toBe('/?sort=newest');
    expect(buildCatalogUrl('/', 'new=1', { q: 'riz' })).toBe('/?q=riz');
    expect(buildCatalogUrl('/', 'new=1', { category: 'epices' })).toBe('/?category=epices');
  });
});

test.describe('Tick et liste admin', () => {
  test('résumé du tick : compteurs et tenants à invalider', () => {
    expect(summarizeCatalogSchedule([
      { out_tenant_id: 't2', out_product_id: 'a', out_change: 'promo_started' },
      { out_tenant_id: 't1', out_product_id: 'b', out_change: 'promo_ended' },
      { out_tenant_id: 't1', out_product_id: 'c', out_change: 'novelty_ended' },
      { out_tenant_id: 't1', out_product_id: 'd', out_change: 'promo_expired' },
    ])).toEqual({ started: 1, ended: 1, expired: 1, noveltiesEnded: 1, tenantIds: ['t1', 't2'] });
    expect(summarizeCatalogSchedule([])).toEqual({ started: 0, ended: 0, expired: 0, noveltiesEnded: 0, tenantIds: [] });
  });

  test('filtres « Mise en avant » de la liste catalogue', () => {
    expect(CATALOGUE_STATUS_OPTIONS.filter((o) => o.group === 'highlight').map((o) => o.key)).toEqual(['promo', 'promo_scheduled', 'novelty']);
    const record = () => {
      const calls: unknown[][] = [];
      const q: Record<string, (...a: unknown[]) => unknown> = {};
      for (const m of ['not', 'eq', 'gt']) q[m] = (...a: unknown[]) => { calls.push([m, ...a]); return q; };
      return { q, calls };
    };
    const promo = record(); applyCatalogueStatus(promo.q, 'promo', NOW);
    expect(promo.calls).toEqual([['not', 'compare_at_price', 'is', null]]);
    const scheduled = record(); applyCatalogueStatus(scheduled.q, 'promo_scheduled', NOW);
    expect(scheduled.calls).toEqual([['not', 'promo_price', 'is', null], ['eq', 'promo_applied', false]]);
    const novelty = record(); applyCatalogueStatus(novelty.q, 'novelty', NOW);
    expect(novelty.calls).toEqual([['gt', 'new_until', NOW.toISOString()]]);
  });
});
