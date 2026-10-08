import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { resolveArtifactsRoot, safeArtifactPath } from '../../src/lib/externalCatalog/artifacts';
import { normalizeExternalProduct, parseMinorUnitPrice, previewValidQuantities, toLepefyQuantityRule } from '../../src/lib/externalCatalog/normalizeProduct';
import { mapGreenApiProduct } from '../../src/lib/externalCatalog/providers/greenApi';
import { buildRunReport, escapeHtml, renderReportHtml } from '../../src/lib/externalCatalog/report';
import { initialDecision, mergeDecisions, parseReviewDecisions } from '../../src/lib/externalCatalog/reviewDecisions';
import type { RawExternalProduct } from '../../src/lib/externalCatalog/types';

// Dati d'esempio per normalizzatore/report: NON una lettura reale del catalogo.

const ctx = { provider: 'green_api' as const, catalogId: '33612345678', rawFile: 'raw/catalog.json' };

function raw(over: Partial<RawExternalProduct> = {}): RawExternalProduct {
  return {
    providerProductId: 'p1', name: 'Haricot rouge petite graines', description: '4 paquets de 500g',
    rawPrice: '12000', rawSalePrice: null, currency: 'EUR', availability: 'IN_STOCK', isHidden: false,
    retailerId: null, url: null,
    images: [{ providerImageId: 'i1', originalUrl: 'https://scontent.xx.fbcdn.net/o.jpg', previewUrl: 'https://scontent.xx.fbcdn.net/s.jpg' }],
    rawRef: { page: 0, index: 3 },
    ...over,
  };
}

test.describe('normalizzazione', () => {
  test('caso di riferimento: risultato atteso del brief', () => {
    const n = normalizeExternalProduct(raw(), ctx);
    expect(n).toMatchObject({
      source_provider: 'green_api',
      source_catalog_id: '33612345678',
      source_product_id: 'p1',
      original_name: 'Haricot rouge petite graines',
      original_description: '4 paquets de 500g',
      displayed_price: 12,
      currency: 'EUR',
      suggested_min_quantity: 4,
      unit_format: { value: 500, unit: 'g' },
      package_count: 4,
      package_total_weight: { value: 2000, unit: 'g' },
      selling_model: 'requires_review',
      requires_review: true,
      raw_data_reference: { file: 'raw/catalog.json', page: 0, index: 3 },
    });
    // 12 € resta il prezzo mostrato: nessun prezzo unitario (3 €) derivato.
    expect(Object.keys(n).filter((k) => /unit_price|price_per/.test(k))).toEqual([]);
    expect(n.displayed_price).toBe(12);
  });

  test('immagine originale preferita alla miniatura', () => {
    const n = normalizeExternalProduct(raw(), ctx);
    expect(n.images[0]).toMatchObject({ url: 'https://scontent.xx.fbcdn.net/o.jpg', variant: 'original' });
    const onlyPreview = normalizeExternalProduct(raw({ images: [{ providerImageId: null, originalUrl: null, previewUrl: 'https://scontent.xx.fbcdn.net/s.jpg' }] }), ctx);
    expect(onlyPreview.images[0]?.variant).toBe('preview');
  });

  test('prodotto senza descrizione', () => {
    const n = normalizeExternalProduct(raw({ description: null }), ctx);
    expect(n.original_description).toBeNull();
    expect(n.review_reasons.map((r) => r.code)).toContain('NO_DESCRIPTION');
    expect(n.suggested_min_quantity).toBeNull();
  });

  test('prodotto senza immagine', () => {
    const n = normalizeExternalProduct(raw({ images: [] }), ctx);
    expect(n.images).toEqual([]);
    expect(n.review_reasons.map((r) => r.code)).toContain('NO_IMAGE');
  });

  test('prezzo assente o non valido: null, mai inventato, revisione obbligatoria', () => {
    for (const [rawPrice, code] of [[null, 'PRICE_MISSING'], ['', 'PRICE_MISSING'], ['12,00 €', 'PRICE_INVALID'], ['-5', 'PRICE_INVALID'], ['0', 'PRICE_INVALID']] as const) {
      const n = normalizeExternalProduct(raw({ rawPrice, description: 'Sac de riz' }), ctx);
      expect(n.displayed_price).toBeNull();
      expect(n.requires_review).toBe(true);
      expect(n.review_reasons.map((r) => r.code)).toContain(code);
    }
  });

  test('valuta assente segnalata', () => {
    const n = normalizeExternalProduct(raw({ currency: null }), ctx);
    expect(n.currency).toBeNull();
    expect(n.review_reasons.map((r) => r.code)).toContain('CURRENCY_MISSING');
  });

  test('articolo singolo completo non richiede revisione', () => {
    const n = normalizeExternalProduct(raw({ description: 'Sac de riz parfumé 1 kg' }), ctx);
    expect(n.selling_model).toBe('single_item');
    expect(n.requires_review).toBe(false);
  });

  test('prezzo in millesimi (scala verificata sul catalogo reale, non ÷100 come la doc)', () => {
    expect(parseMinorUnitPrice('10000')).toEqual({ value: 10, issue: null });
    expect(parseMinorUnitPrice('12990')).toEqual({ value: 12.99, issue: null });
    expect(parseMinorUnitPrice(null).issue).toBe('missing');
  });

  test('mapping GREEN-API conserva il dato sorgente senza interpretarlo', () => {
    const mapped = mapGreenApiProduct({ id: 42, name: 'X', price: '1200', currency: 'EUR', media: { images: [{ original_image_url: 'https://a.fbcdn.net/x.jpg' }] } }, 0, 1);
    expect(mapped).toMatchObject({ providerProductId: '42', rawPrice: '1200', description: null, images: [{ originalUrl: 'https://a.fbcdn.net/x.jpg', previewUrl: null }] });
    expect(mapGreenApiProduct({ name: 'senza id' }, 0, 0)).toBeNull();
  });

  test('forma reale GREEN-API: `availability` e `sale_price` oggetto', () => {
    const mapped = mapGreenApiProduct({
      id: 'b', name: 'Bobolo du Cameroun', price: '50000', currency: 'EUR', availability: 'IN_STOCK',
      sale_price: { end_date: null, price: '45000', start_date: null }, media: { images: [] },
    }, 0, 0);
    expect(mapped).toMatchObject({ availability: 'IN_STOCK', rawSalePrice: '45000' });
    const n = normalizeExternalProduct(mapped!, ctx);
    expect(n).toMatchObject({ displayed_price: 50, sale_price: 45, product_availability: 'IN_STOCK' });
  });
});

test.describe('separazione inferenza / dato confermato e regole Lepefy', () => {
  test('la decisione iniziale pre-compila ma non conferma', () => {
    const d = initialDecision(normalizeExternalProduct(raw(), ctx), 'now');
    expect(d).toMatchObject({ min_quantity: 4, min_quantity_confirmed: false, price_model: 'unknown', price_model_confirmed: false, status: 'pending' });
    expect(toLepefyQuantityRule(d)).toEqual({ min_order_quantity: 1, order_quantity_step: 1, from_confirmed_review: false });
  });

  test('minimo confermato separatamente dal modello di prezzo', () => {
    const d = { ...initialDecision(normalizeExternalProduct(raw(), ctx), 'now'), min_quantity_confirmed: true };
    expect(toLepefyQuantityRule(d)).toEqual({ min_order_quantity: 4, order_quantity_step: 1, from_confirmed_review: true });
    expect(d.price_model_confirmed).toBe(false);
    expect(previewValidQuantities(4, 1)).toEqual([4, 5, 6, 7]);
    expect(previewValidQuantities(6, 3)).toEqual([6, 9, 12, 15]);
  });

  test('decisioni salvate: validate, solo prodotti noti, mai sovrascritte da un nuovo parsing', () => {
    const products = [normalizeExternalProduct(raw(), ctx)];
    const saved = parseReviewDecisions({
      version: 1,
      decisions: [
        { ...initialDecision(products[0]!, 't'), min_quantity: 2, min_quantity_confirmed: true },
        { ...initialDecision(products[0]!, 't'), source_product_id: 'sconosciuto' },
      ],
    }, new Set(['p1']));
    expect([...saved.keys()]).toEqual(['p1']);
    expect(mergeDecisions(products, saved, 'now')[0]?.min_quantity).toBe(2);
  });

  test('decisioni incoerenti rifiutate', () => {
    const base = initialDecision(normalizeExternalProduct(raw(), ctx), 't');
    expect(() => parseReviewDecisions({ version: 1, decisions: [{ ...base, min_quantity: null, min_quantity_confirmed: true }] }, new Set(['p1']))).toThrow();
    expect(() => parseReviewDecisions({ version: 1, decisions: [{ ...base, price_model_confirmed: true }] }, new Set(['p1']))).toThrow();
    expect(() => parseReviewDecisions({ version: 1, decisions: [{ ...base, min_quantity: 0 }] }, new Set(['p1']))).toThrow();
  });
});

test.describe('report', () => {
  test('conteggi e origine dei dati', () => {
    const products = [normalizeExternalProduct(raw(), ctx), normalizeExternalProduct(raw({ providerProductId: 'p2', description: '1 kg', images: [] }), ctx)];
    const r = buildRunReport({
      generatedAt: 't', status: 'success', provider: 'green_api', sourceUrl: 'https://wa.me/c/1', chatId: '1@c.us',
      options: { limit: 10, dry_run: false, images: true }, products, truncated: true, diagnostics: [],
    });
    expect(r.data_origin).toBe('live_provider');
    expect(r.counts).toMatchObject({ products_retrieved: 2, products_with_images: 1, min_quantity_proposed: 1, requires_review: 1 });
    expect(r.unrecoverable_data.join(' ')).toContain('lettura interrotta');
    expect(r.production_limitations.length).toBeGreaterThan(0);
  });

  test('HTML: contenuti del catalogo esterno sempre escapati', () => {
    const evil = normalizeExternalProduct(raw({ name: '<img src=x onerror=alert(1)>', description: '</script><script>alert(1)</script>' }), ctx);
    const report = buildRunReport({
      generatedAt: 't', status: 'success', provider: 'green_api', sourceUrl: null, chatId: null,
      options: { limit: 1, dry_run: false, images: true }, products: [evil], truncated: false, diagnostics: [],
    });
    const html = renderReportHtml(report, [evil], [initialDecision(evil, 't')]);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(escapeHtml('"<&>\'')).toBe('&quot;&lt;&amp;&gt;&#39;');
  });
});

test.describe('isolamento degli artefatti', () => {
  const repo = path.resolve('/repo');
  test('--out confinato sotto artifacts/whatsapp-catalog', () => {
    expect(resolveArtifactsRoot(repo)).toBe(path.join(repo, 'artifacts', 'whatsapp-catalog'));
    expect(resolveArtifactsRoot(repo, 'artifacts/whatsapp-catalog/run-2')).toBe(path.join(repo, 'artifacts', 'whatsapp-catalog', 'run-2'));
    expect(() => resolveArtifactsRoot(repo, 'apps/storefront/public')).toThrow();
    expect(() => resolveArtifactsRoot(repo, 'artifacts/whatsapp-catalog/../../supabase')).toThrow();
  });
  test('nessun percorso relativo può uscire dalla radice', () => {
    const root = resolveArtifactsRoot(repo);
    expect(safeArtifactPath(root, 'images/a.jpg')).toBe(path.join(root, 'images', 'a.jpg'));
    for (const bad of ['../x.json', 'images/../../x', path.resolve('/etc/passwd'), '']) {
      expect(() => safeArtifactPath(root, bad)).toThrow();
    }
  });
  test('artifacts/ è escluso dal versionamento', () => {
    const gitignore = readFileSync(path.resolve(__dirname, '../../../../.gitignore'), 'utf8');
    expect(gitignore.split(/\r?\n/)).toContain('artifacts/');
  });
});
