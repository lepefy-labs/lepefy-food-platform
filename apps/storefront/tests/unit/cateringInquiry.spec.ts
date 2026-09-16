import { expect, test } from '@playwright/test';
import { applyCateringFormat } from '../../src/lib/events/cateringInquiry';

test('selecting a format pre-fills the message while preserving customer details', () => {
  expect(applyCateringFormat('Repas pour 30 personnes, option végétarienne.', 'Buffet convivial'))
    .toBe('Format souhaité : Buffet convivial\n\nRepas pour 30 personnes, option végétarienne.');
});
test('switching formats replaces only the known prefix and preserves multiline details', () => {
  const message = applyCateringFormat('Première ligne\nDeuxième ligne', 'Buffet convivial');
  expect(applyCateringFormat(message, 'Réception privée'))
    .toBe('Format souhaité : Réception privée\n\nPremière ligne\nDeuxième ligne');
});
test('reselecting a format is idempotent and an empty message needs no trailing blank lines', () => {
  const message = applyCateringFormat('', 'Événement professionnel');
  expect(applyCateringFormat(message, 'Événement professionnel')).toBe(message);
  expect(message).toBe('Format souhaité : Événement professionnel');
});
test('unknown customer text resembling a prefix is preserved', () => {
  expect(applyCateringFormat('Format souhaité : Autre\nInformations personnelles', 'Buffet convivial'))
    .toBe('Format souhaité : Buffet convivial\n\nFormat souhaité : Autre\nInformations personnelles');
});
