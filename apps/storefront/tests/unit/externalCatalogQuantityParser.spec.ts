import { test, expect } from '@playwright/test';
import { extractQuantityInfo } from '../../src/lib/externalCatalog/quantityParser';

// Test del parser su testi d'esempio: NON sono una lettura reale del catalogo.
const parse = (description: string | null, name: string | null = 'Prodotto') => extractQuantityInfo({ name, description });

test.describe('caso di riferimento "Haricot rouge petite graines"', () => {
  const r = parse('4 paquets de 500g', 'Haricot rouge petite graines');

  test('riconosce 4 confezioni da 500 g e propone minimo 4', () => {
    expect(r.package_count).toBe(4);
    expect(r.unit_format).toEqual({ value: 500, unit: 'g' });
    expect(r.package_total).toEqual({ value: 2000, unit: 'g' });
    expect(r.suggested_min_quantity).toBe(4);
  });

  test('il minimo è un\'inferenza da confermare, non una dicitura esplicita', () => {
    expect(r.min_is_explicit).toBe(false);
    expect(r.selling_model).toBe('requires_review');
    expect(r.confidence).not.toBe('high');
    expect(r.reasons.map((x) => x.code)).toEqual(expect.arrayContaining(['MIN_INFERRED_FROM_PACKAGE_COUNT', 'PRICE_MODEL_UNKNOWN']));
  });

  test('non deriva alcuno step', () => {
    expect(r.suggested_quantity_step).toBeNull();
  });
});

test.describe('tabella del brief (FR / IT / EN)', () => {
  const cases: Array<[string, { min: number | null; step: number | null; count: number | null; format: unknown }]> = [
    ['4 paquets de 500g',          { min: 4,    step: null, count: 4,    format: { value: 500, unit: 'g' } }],
    ['Lot de 6 bouteilles 1L',     { min: 6,    step: null, count: 6,    format: { value: 1, unit: 'l' } }],
    ['Minimum 2 pièces',           { min: 2,    step: null, count: null, format: null }],
    ['Carton de 12 unités',        { min: 12,   step: null, count: 12,   format: { value: null, unit: 'unit' } }],
    ['Venduto in confezioni da 3', { min: null, step: null, count: 3,    format: { value: null, unit: 'unit' } }],
    ['1 kg',                       { min: null, step: null, count: null, format: { value: 1, unit: 'kg' } }],
    ['500g x 4',                   { min: 4,    step: null, count: 4,    format: { value: 500, unit: 'g' } }],
    ['Minimum 6, par lots de 3',   { min: 6,    step: 3,    count: null, format: null }],
  ];
  for (const [text, expected] of cases) {
    test(text, () => {
      const r = parse(text);
      expect(r.suggested_min_quantity).toBe(expected.min);
      expect(r.suggested_quantity_step).toBe(expected.step);
      expect(r.package_count).toBe(expected.count);
      expect(r.unit_format).toEqual(expected.format);
    });
  }
});

test.describe('lingue', () => {
  test('IT: minimo esplicito e multipli', () => {
    const r = parse('Ordine minimo 10 pezzi, a multipli di 5');
    expect(r.suggested_min_quantity).toBe(10);
    expect(r.suggested_quantity_step).toBe(5);
    expect(r.confidence).toBe('high');
  });
  test('IT: conteggio con formato', () => {
    const r = parse('6 bottiglie da 1,5 l');
    expect(r.package_count).toBe(6);
    expect(r.unit_format).toEqual({ value: 1.5, unit: 'l' });
    expect(r.package_total).toEqual({ value: 9000, unit: 'ml' });
  });
  test('EN: minimum order and multiples', () => {
    const r = parse('Minimum order of 10, in multiples of 5');
    expect(r.suggested_min_quantity).toBe(10);
    expect(r.suggested_quantity_step).toBe(5);
  });
  test('EN: pack of N with size', () => {
    const r = parse('Pack of 6 cans 330ml');
    expect(r.package_count).toBe(6);
    expect(r.suggested_min_quantity).toBe(6);
    expect(r.unit_format).toEqual({ value: 330, unit: 'ml' });
  });
  test('FR: "à partir de" è un minimo esplicito', () => {
    expect(parse('À partir de 3 sachets').suggested_min_quantity).toBe(3);
  });
});

test.describe('minimo d\'acquisto vs contenuto della confezione', () => {
  test('minimo esplicito diverso dal conteggio: il conteggio resta contenuto', () => {
    const r = parse('Carton de 12 unités — minimum 2 cartons');
    expect(r.package_count).toBe(12);
    expect(r.suggested_min_quantity).toBe(2);
    expect(r.min_is_explicit).toBe(true);
  });
  test('"confezioni da N" senza minimo: nessun minimo né step, revisione', () => {
    const r = parse('Sold in packs of 4');
    expect(r.suggested_min_quantity).toBeNull();
    expect(r.suggested_quantity_step).toBeNull();
    expect(r.reasons.map((x) => x.code)).toContain('SALE_PACK_SIZE_AMBIGUOUS');
    expect(r.confidence).toBe('low');
  });
  test('step diverso dal minimo', () => {
    const r = parse('Minimum 12, par 6');
    expect(r.suggested_min_quantity).toBe(12);
    expect(r.suggested_quantity_step).toBe(6);
  });
  test('un solo cartone che contiene N paquets: N è contenuto, non minimo (caso reale Bobolo)', () => {
    const r = parse('1 carton de Bobolo de 20 paquets. 2 Bobolo par paquet donc 40 Bobolo au total');
    expect(r.package_count).toBe(20);
    expect(r.suggested_min_quantity).toBeNull();
    expect(r.reasons.map((x) => x.code)).toContain('SINGLE_OUTER_PACKAGE');
    expect(r.selling_model).toBe('requires_review');
  });
  test('"a pack of 6" resta un lotto con minimo proposto', () => {
    expect(parse('A pack of 6 cans 330ml').suggested_min_quantity).toBe(6);
  });
  test('casi reali del catalogo di test', () => {
    expect(parse('3 paquets de 500g.').suggested_min_quantity).toBe(3);
    expect(parse('2 paquets de 1kg').package_total).toEqual({ value: 2000, unit: 'g' });
    expect(parse('100g').suggested_min_quantity).toBeNull();
    expect(parse('4 bouteilles').suggested_min_quantity).toBe(4);
  });
  test('un singolo pezzo non propone un minimo', () => {
    const r = parse('1 paquet de 500g');
    expect(r.package_count).toBe(1);
    expect(r.suggested_min_quantity).toBeNull();
  });
});

test.describe('nessun minimo da un peso', () => {
  for (const text of ['500 g', '1 kg', '2,5 kg', '75cl', 'minimum 500 g']) {
    test(text, () => {
      const r = parse(text);
      expect(r.suggested_min_quantity).toBeNull();
      expect(r.package_count).toBeNull();
    });
  }
  test('"minimum 500 g" segnala che è una misura', () => {
    expect(parse('minimum 500 g').reasons.map((x) => x.code)).toContain('MIN_IS_MEASURE');
  });
  test('un prezzo non è un minimo', () => {
    expect(parse('À partir de 12 €').suggested_min_quantity).toBeNull();
  });
});

test.describe('ambiguità', () => {
  test('quantità in conflitto → nessun minimo, affidabilità bassa', () => {
    const r = parse('3 paquets de 500g et 2 paquets de 1kg');
    expect(r.suggested_min_quantity).toBeNull();
    expect(r.package_count).toBeNull();
    expect(r.confidence).toBe('low');
    expect(r.selling_model).toBe('requires_review');
    expect(r.reasons.map((x) => x.code)).toEqual(expect.arrayContaining(['CONFLICTING_QUANTITIES', 'CONFLICTING_FORMATS']));
  });
  test('il totale ripetuto tra parentesi non è un conflitto', () => {
    const r = parse('4 x 500 g (2 kg)');
    expect(r.reasons.map((x) => x.code)).not.toContain('CONFLICTING_FORMATS');
    expect(r.suggested_min_quantity).toBe(4);
  });
});

test.describe('campi mancanti', () => {
  test('senza descrizione usa il nome', () => {
    const r = parse(null, 'Huile de palme 4 x 1L');
    expect(r.source_field).toBe('name');
    expect(r.package_count).toBe(4);
  });
  test('senza testo: modello sconosciuto, nessuna inferenza', () => {
    const r = parse(null, null);
    expect(r.selling_model).toBe('unknown');
    expect(r.suggested_min_quantity).toBeNull();
  });
  test('testo senza segnali: articolo singolo', () => {
    const r = parse('Sac de riz parfumé');
    expect(r.selling_model).toBe('single_item');
    expect(r.confidence).toBe('none');
  });
});
