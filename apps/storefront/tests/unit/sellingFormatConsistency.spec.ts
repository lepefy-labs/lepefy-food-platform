import { test, expect } from '@playwright/test';
import { sellingFormatWeightWarning } from '../../src/lib/catalog/sellingFormatConsistency';

test('format written as the purchase minimum is flagged with the per-unit value to use', () => {
  // Arachides frais: 1 kg unit sold by 2, label « 2 kg ».
  const warning = sellingFormatWeightWarning({ net_quantity_display: '2 kg' }, 1000, 2);
  expect(warning).toContain('minimum d’achat (2 × 1 kg)');
  expect(warning).toContain('indiquez « 1 kg »');
  // Same mix-up through the structured fields.
  expect(sellingFormatWeightWarning({ sale_unit: 'sachet', net_content_value: 3, net_content_unit: 'kg' }, 1000, 3)).toContain('indiquez « 1 kg »');
});

test('format heavier than the shipping weight of one unit is flagged', () => {
  expect(sellingFormatWeightWarning({ net_quantity_display: '5kg' }, 1000, 1)).toContain('pèse plus que le poids d’expédition d’une unité (1 kg)');
  // A lot counts all its pieces: 3 × 400 g = 1,2 kg > 1 kg.
  expect(sellingFormatWeightWarning({ sale_unit: 'lot', pack_count: 3, net_content_value: 400, net_content_unit: 'g' }, 1000, 1)).not.toBeNull();
});

test('consistent, volume, unparsable or weightless formats are never flagged', () => {
  expect(sellingFormatWeightWarning({ net_quantity_display: '1 kg' }, 1000, 2)).toBeNull();
  expect(sellingFormatWeightWarning({ net_quantity_display: '500 g' }, 560, 1)).toBeNull(); // packaging on top
  expect(sellingFormatWeightWarning({ net_quantity_display: '1,03 kg' }, 1000, 1)).toBeNull(); // within 5 %
  expect(sellingFormatWeightWarning({ sale_unit: 'lot', pack_count: 3, net_content_value: 400, net_content_unit: 'g' }, 1300, 1)).toBeNull();
  expect(sellingFormatWeightWarning({ net_quantity_display: '2 L' }, 1000, 1)).toBeNull();
  expect(sellingFormatWeightWarning({ net_quantity_display: '3 × 400 g' }, 1000, 1)).toBeNull();
  expect(sellingFormatWeightWarning({ net_quantity_display: '2 kg' }, null, 2)).toBeNull();
  expect(sellingFormatWeightWarning({ net_quantity_display: '2 kg' }, 0, 2)).toBeNull();
  expect(sellingFormatWeightWarning({}, 1000, 2)).toBeNull();
});
