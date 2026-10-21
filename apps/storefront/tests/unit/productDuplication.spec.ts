import { test, expect } from '@playwright/test';
import {
  duplicateGallery, emptyProductDraft, labelBackgroundStoragePath, nextAvailableSlug, parseDuplicateSourceId,
  productSlugBase, toDuplicateDraft, type DuplicateSourceRow,
} from '../../src/lib/catalog/productDuplication';

const SOURCE_ID = '11111111-2222-4333-8444-555555555555';
const SUPABASE = 'https://abc.supabase.co/storage/v1/object/public/assets';

function source(overrides: Partial<DuplicateSourceRow> = {}): DuplicateSourceRow {
  return {
    id: SOURCE_ID, name: 'Ndolé 500 g', name_alt: 'Ndole', description: 'Texte', descriptions: { fr: 'Texte', it: 'Testo' },
    description_source: 'human', price: 8.9, compare_at_price: null, promo_price: null, promo_starts_at: null,
    promo_ends_at: null, promo_until_sold_out: false, promo_applied: false, position: 12, weight_grams: 520,
    min_order_quantity: 1, order_quantity_step: 1, storage_type: 'frozen',
    image_url: 'https://cdn/a.webp', images: [{ url: 'https://cdn/a.webp', alt: 'A' }, { url: 'https://cdn/b.webp' }],
    category_id: 'cat-1', producer_id: 'prod-1', importer_id: 'imp-1', ingredients_text: 'Feuilles', allergens_text: 'Arachide',
    gluten_free_certified: true, usage_instructions: 'Réchauffer', conservation_instructions: '-18 °C',
    conservation_after_opening: '48 h', country_of_origin: 'Cameroun', durability_type: 'best_before',
    quid_ingredient: 'Ndolé', quid_percentage: 40, alcohol_pct: null, net_quantity_display: '500 g',
    sale_unit: 'sachet', net_content_value: 500, net_content_unit: 'g', pack_count: null, fulfillment_policy: 'pickup_only',
    packaging_material: 'Plastique', recycling_note: 'Poubelle jaune', nutrition_basis: '100g', nutrition: { kcal: 120 },
    label_background_image_url: null, label_background_color: '#ffffff',
    ...overrides,
  };
}

test('structural fields are copied, operational ones start from scratch', () => {
  const draft = toDuplicateDraft(source());
  expect(draft).toMatchObject({
    id: '', slug: '', name: 'Ndolé 500 g', name_alt: 'Ndole', descriptions: { fr: 'Texte', it: 'Testo' },
    price: 8.9, weight_grams: 520, storage_type: 'frozen', category_id: 'cat-1', producer_id: 'prod-1', importer_id: 'imp-1',
    ingredients_text: 'Feuilles', allergens_text: 'Arachide', gluten_free_certified: true, country_of_origin: 'Cameroun',
    net_quantity_display: '500 g', sale_unit: 'sachet', net_content_value: 500, net_content_unit: 'g',
    fulfillment_policy: 'pickup_only', nutrition: { kcal: 120 }, label_background_color: '#ffffff', position: 12,
  });
  expect(draft).toMatchObject({
    stock: 0, active: false, featured: false, warehouse_location: null, barcode_value: null,
    new_until: null, manual_new_until: null, compare_at_price: null, promo_price: null,
    promo_starts_at: null, promo_ends_at: null, promo_until_sold_out: false, promo_applied: false,
  });
});

test('the name is kept as is (no « copie » suffix)', () => {
  expect(toDuplicateDraft(source()).name).toBe('Ndolé 500 g');
});

test('a running promotion is not inherited: the regular price is used', () => {
  const draft = toDuplicateDraft(source({ price: 6.9, compare_at_price: 8.9, promo_price: 6.9, promo_applied: true, promo_ends_at: '2026-11-01T00:00:00Z' }));
  expect(draft.price).toBe(8.9);
  expect(draft.compare_at_price).toBeNull();
  expect(draft.promo_price).toBeNull();
  expect(draft.promo_applied).toBe(false);
});

test('a manual strikethrough price and a scheduled promotion are dropped too', () => {
  expect(toDuplicateDraft(source({ price: 7, compare_at_price: 9 })).price).toBe(9);
  const scheduled = toDuplicateDraft(source({ price: 8.9, promo_price: 5, promo_starts_at: '2026-12-01T00:00:00Z' }));
  expect(scheduled.price).toBe(8.9);
  expect(scheduled.promo_price).toBeNull();
});

test('custom minimum and step are kept, invalid values fall back to 1', () => {
  expect(toDuplicateDraft(source({ min_order_quantity: 12, order_quantity_step: 6 }))).toMatchObject({ min_order_quantity: 12, order_quantity_step: 6 });
  expect(toDuplicateDraft(source({ min_order_quantity: null, order_quantity_step: 0 }))).toMatchObject({ min_order_quantity: 1, order_quantity_step: 1 });
});

test('an inactive source gives the same draft (inactive, stock 0)', () => {
  expect(toDuplicateDraft(source())).toEqual(toDuplicateDraft(source()));
  expect(toDuplicateDraft({ ...source(), position: null }).position).toBe(9999);
});

test('the gallery is normalised, cover first, every image kept', () => {
  expect(duplicateGallery(source())).toEqual({
    image_url: 'https://cdn/a.webp',
    images: [{ url: 'https://cdn/a.webp', alt: 'A' }, { url: 'https://cdn/b.webp' }],
  });
  expect(duplicateGallery(source({ image_url: null, images: null }))).toEqual({ image_url: null, images: [] });
});

test('the draft does not share mutable objects with the source', () => {
  const row = source();
  const draft = toDuplicateDraft(row);
  draft.descriptions!.fr = 'Changé';
  draft.nutrition!.kcal = 1;
  expect(row.descriptions!.fr).toBe('Texte');
  expect(row.nutrition!.kcal).toBe(120);
});

test('empty draft keeps the historical defaults of « Nouveau produit »', () => {
  expect(emptyProductDraft('cat-9')).toMatchObject({ category_id: 'cat-9', stock: 0, active: false, position: 9999, min_order_quantity: 1, fulfillment_policy: 'delivery_or_pickup', images: [] });
});

test('duplicateFrom accepts only a UUID', () => {
  expect(parseDuplicateSourceId(SOURCE_ID.toUpperCase())).toBe(SOURCE_ID);
  for (const raw of ['', 'abc', `${SOURCE_ID}' or 1=1`, 42, null, undefined, { id: SOURCE_ID }]) {
    expect(parseDuplicateSourceId(raw)).toBeNull();
  }
});

test('slug base keeps the admin convention', () => {
  expect(productSlugBase('Ndolé 500 g')).toBe('ndole-500-g');
  expect(productSlugBase('  Bière  « Top » ')).toBe('biere-top');
  expect(productSlugBase('???')).toBe('produit');
});

test('slug conflicts get an incremental suffix, never an existing slug', () => {
  expect(nextAvailableSlug('ndole-500-g', [])).toBe('ndole-500-g');
  expect(nextAvailableSlug('ndole-500-g', ['ndole-500-g'])).toBe('ndole-500-g-2');
  expect(nextAvailableSlug('ndole-500-g', ['ndole-500-g', 'ndole-500-g-2', 'ndole-500-g-3', 'ndole-500-g-kit'])).toBe('ndole-500-g-4');
});

test('a product-bound label background is detected for copy, other URLs are shared', () => {
  expect(labelBackgroundStoragePath(`${SUPABASE}/labels/product-background-${SOURCE_ID}.png?v=123`)).toEqual({ path: `labels/product-background-${SOURCE_ID}.png`, ext: 'png' });
  expect(labelBackgroundStoragePath(`${SUPABASE}/labels/category-background-${SOURCE_ID}.png`)).toBeNull();
  expect(labelBackgroundStoragePath('https://example.com/bg.png')).toBeNull();
  expect(labelBackgroundStoragePath(null)).toBeNull();
});
