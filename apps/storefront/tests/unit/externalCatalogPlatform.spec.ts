import { test, expect } from '@playwright/test';
import { computeUnitPrice, lotPriceFor } from '../../src/lib/externalCatalog/pricing';
import { externalContentHash } from '../../src/lib/externalCatalog/contentHash';
import { netQuantityDisplay, proposalFor, unitWeightGrams } from '../../src/lib/externalCatalog/proposalFormat';
import { sellerChatIdFromPhone } from '../../src/lib/externalCatalog/sellerPhone';
import { normalizeExternalProduct } from '../../src/lib/externalCatalog/normalizeProduct';
import { externalCatalogRpcError } from '../../src/lib/externalCatalog/server/errors';
import { applyItemSchema, createSourceSchema, toRpcFields, updateSourceSchema } from '../../src/lib/externalCatalog/server/validation';
import { PLATFORM_NAV } from '../../src/app/admin/_components/platformNavConfig';
import { featureFlagDefinition } from '../../src/lib/featureFlags/featureFlagRegistry';
import type { RawExternalProduct } from '../../src/lib/externalCatalog/types';

test.describe('prezzo unitario dal prezzo del lotto', () => {
  test('lotto ÷ minimo, arrotondato al centesimo, con scarto esplicito', () => {
    const r = computeUnitPrice({ lotPrice: 10, minQuantity: 3, discountPct: 0, rounding: 'nearest' });
    expect(r).toEqual({ unitPrice: 3.33, unitCents: 333, lotTotal: 9.99, discountedLot: 10, roundingDelta: -0.01 });
  });

  test('divisione esatta: nessuno scarto (Isenbeck 28 € / 4)', () => {
    expect(computeUnitPrice({ lotPrice: 28, minQuantity: 4, discountPct: 0, rounding: 'nearest' })).toMatchObject({ unitPrice: 7, roundingDelta: 0 });
  });

  test('sconto applicato dopo la divisione', () => {
    // 10 / 3 = 3,3333 × 0,9 = 3,00 €
    expect(computeUnitPrice({ lotPrice: 10, minQuantity: 3, discountPct: 10, rounding: 'nearest' })?.unitPrice).toBe(3);
    // 16 / 4 = 4 × (1 − 12,5 %) = 3,50 €
    expect(computeUnitPrice({ lotPrice: 16, minQuantity: 4, discountPct: 12.5, rounding: 'nearest' })?.unitPrice).toBe(3.5);
  });

  test('arrotondamento per eccesso / per difetto', () => {
    expect(computeUnitPrice({ lotPrice: 10, minQuantity: 3, discountPct: 0, rounding: 'up' })).toMatchObject({ unitPrice: 3.34, lotTotal: 10.02, roundingDelta: 0.02 });
    expect(computeUnitPrice({ lotPrice: 10, minQuantity: 3, discountPct: 0, rounding: 'down' })?.unitPrice).toBe(3.33);
    expect(computeUnitPrice({ lotPrice: 0.05, minQuantity: 3, discountPct: 0, rounding: 'nearest' })?.unitPrice).toBe(0.02);
  });

  test('minimo 1: il prezzo unitario è il prezzo mostrato (Bobolo, 1 carton)', () => {
    expect(computeUnitPrice({ lotPrice: 50, minQuantity: 1, discountPct: 0, rounding: 'nearest' })?.unitPrice).toBe(50);
  });

  test('nessun float: 0,1 + 0,2 non trapela', () => {
    expect(computeUnitPrice({ lotPrice: 0.3, minQuantity: 1, discountPct: 0, rounding: 'nearest' })?.unitPrice).toBe(0.3);
    expect(computeUnitPrice({ lotPrice: 19.99, minQuantity: 7, discountPct: 3.33, rounding: 'nearest' })?.unitCents).toBe(276);
  });

  test('input non validi → null', () => {
    for (const bad of [
      { lotPrice: 0, minQuantity: 1, discountPct: 0 },
      { lotPrice: 10, minQuantity: 0, discountPct: 0 },
      { lotPrice: 10, minQuantity: 2.5, discountPct: 0 },
      { lotPrice: 10, minQuantity: 2, discountPct: 95 },
      { lotPrice: 10, minQuantity: 2, discountPct: -1 },
      { lotPrice: 0.01, minQuantity: 3, discountPct: 0 },
    ]) {
      expect(computeUnitPrice({ ...bad, rounding: 'down' }), JSON.stringify(bad)).toBeNull();
    }
  });

  test('promozione solo se scelta esplicitamente', () => {
    expect(lotPriceFor(50, 45, false)).toBe(50);
    expect(lotPriceFor(50, 45, true)).toBe(45);
    expect(lotPriceFor(50, null, true)).toBe(50);
  });
});

test.describe('valori proposti per il prodotto Lepefy', () => {
  test('peso unitario solo da un peso, mai da un volume o da un conteggio', () => {
    expect(unitWeightGrams({ value: 500, unit: 'g' })).toBe(500);
    expect(unitWeightGrams({ value: 1.5, unit: 'kg' })).toBe(1500);
    expect(unitWeightGrams({ value: 1, unit: 'l' })).toBeNull();
    expect(unitWeightGrams({ value: null, unit: 'unit' })).toBeNull();
    expect(netQuantityDisplay({ value: 1.5, unit: 'l' })).toBe('1,5 L');
    expect(netQuantityDisplay({ value: null, unit: 'unit' })).toBeNull();
  });

  test('caso reale Arachide: minimo 3, 500 g per unità', () => {
    const raw: RawExternalProduct = {
      providerProductId: 'x', name: 'Arachide ndolè', description: '3 paquets de 500g.', rawPrice: '10000', rawSalePrice: null,
      currency: 'EUR', availability: 'IN_STOCK', isHidden: null, retailerId: null, url: null, images: [], rawRef: { page: 0, index: 0 },
    };
    const n = normalizeExternalProduct(raw, { provider: 'green_api', catalogId: '1', rawFile: 'x' });
    expect(proposalFor(n)).toEqual({
      name: 'Arachide ndolè', description: '3 paquets de 500g.', min_order_quantity: 3, order_quantity_step: 1, weight_grams: 500, net_quantity_display: '500 g',
    });
    expect(computeUnitPrice({ lotPrice: n.displayed_price!, minQuantity: 3, discountPct: 0, rounding: 'nearest' })?.unitPrice).toBe(3.33);
  });
});

test.describe('hash del contenuto', () => {
  const base: RawExternalProduct = {
    providerProductId: 'x', name: 'A', description: 'd', rawPrice: '10000', rawSalePrice: null, currency: 'EUR',
    availability: 'IN_STOCK', isHidden: null, retailerId: null, url: null,
    images: [{ providerImageId: 'i1', originalUrl: 'https://a.fbcdn.net/x.jpg?sig=1', previewUrl: null }], rawRef: { page: 0, index: 0 },
  };
  test('stabile e indipendente dalla posizione e dalla firma degli URL', () => {
    const again = { ...base, rawRef: { page: 3, index: 9 }, images: [{ ...base.images[0]!, originalUrl: 'https://a.fbcdn.net/x.jpg?sig=2' }] };
    expect(externalContentHash(again)).toBe(externalContentHash(base));
    expect(externalContentHash(base)).toMatch(/^[a-f0-9]{64}$/);
  });
  test('cambia con prezzo, promozione, descrizione o immagini', () => {
    const h = externalContentHash(base);
    expect(externalContentHash({ ...base, rawPrice: '12000' })).not.toBe(h);
    expect(externalContentHash({ ...base, rawSalePrice: '9000' })).not.toBe(h);
    expect(externalContentHash({ ...base, description: 'e' })).not.toBe(h);
    expect(externalContentHash({ ...base, images: [] })).not.toBe(h);
  });
});

test.describe('numero del venditore', () => {
  test('formati accettati → chatId @c.us', () => {
    for (const input of ['+39 329 695 8822', '0039 329 695 8822', '393296958822', '+39-329-695-8822']) {
      expect(sellerChatIdFromPhone(input), input).toBe('393296958822@c.us');
    }
  });
  test('ID del catalogo o numero non valido rifiutati', () => {
    expect(sellerChatIdFromPhone('191701838729307')).toBeNull();
    expect(sellerChatIdFromPhone('abc')).toBeNull();
  });
});

test.describe('validazione richieste', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  test('creazione sorgente', () => {
    expect(createSourceSchema.safeParse({ tenantId, label: 'V', url: 'https://wa.me/c/1917', sellerPhone: '+39 329 695 8822' }).success).toBe(true);
    expect(createSourceSchema.safeParse({ tenantId, label: 'V', url: 'https://wa.me/c/1917', sellerPhone: '+39 329', discountPct: 91 }).success).toBe(false);
    expect(createSourceSchema.safeParse({ tenantId: 'x', label: 'V', url: 'https://wa.me/c/1917', sellerPhone: '+39 329 695 8822' }).success).toBe(false);
  });
  test('il consenso richiede una prova scritta', () => {
    expect(updateSourceSchema.safeParse({ consentStatus: 'granted' }).success).toBe(false);
    expect(updateSourceSchema.safeParse({ consentStatus: 'granted', consentNote: 'Accord WhatsApp du 08/10' }).success).toBe(true);
    expect(updateSourceSchema.safeParse({}).success).toBe(false);
  });
  test('applicazione: creazione richiede nome e prezzo; campi sconosciuti rifiutati', () => {
    const requestKey = '22222222-2222-4222-8222-222222222222';
    expect(applyItemSchema.safeParse({ mode: 'create', requestKey, fields: { name: 'A' } }).success).toBe(false);
    expect(applyItemSchema.safeParse({ mode: 'create', requestKey, fields: { name: 'A', price: '3.33', stock: 5 } }).success).toBe(false);
    expect(applyItemSchema.safeParse({ mode: 'update', requestKey, fields: { price: '3.33' } }).success).toBe(false);
    expect(applyItemSchema.safeParse({ mode: 'create', requestKey, fields: { name: 'A', price: '3,33' } }).success).toBe(false);
    const ok = applyItemSchema.parse({ mode: 'create', requestKey, fields: { name: 'A', price: '3.33', min_order_quantity: '3', weight_grams: null } });
    expect(toRpcFields(ok.fields)).toEqual({ name: 'A', price: '3.33', min_order_quantity: '3', weight_grams: null });
  });
});

test.describe('errori RPC 149 → messaggi', () => {
  test('codici noti, dettaglio dopo i due punti, migration assente', () => {
    expect(externalCatalogRpcError({ message: 'consent_required' })).toMatchObject({ status: 409, code: 'consent_required' });
    expect(externalCatalogRpcError({ message: 'field_not_allowed:stock' })).toMatchObject({ status: 400, code: 'field_not_allowed' });
    expect(externalCatalogRpcError({ message: 'relation does not exist', code: '42P01' })).toMatchObject({ status: 503, code: 'migration_missing' });
    expect(externalCatalogRpcError({ message: 'boom' })).toMatchObject({ status: 500, code: 'unexpected' });
  });
});

test('navigazione platform e flag registrati', () => {
  expect(PLATFORM_NAV.some((g) => g.href === '/admin/platform/catalogues-whatsapp')).toBe(true);
  expect(featureFlagDefinition('external_catalog_import')?.label).toBeTruthy();
});
