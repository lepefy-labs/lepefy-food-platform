import { expect, test } from '@playwright/test';
import { extraCustomsTerritory, extraCustomsUnavailableMessage } from '../../src/lib/shipping/extraCustomsTerritories';

test('Livigno and Campione d\'Italia are recognised as extra-customs territories', () => {
  expect(extraCustomsTerritory('IT', '23041')).toBe('Livigno');
  expect(extraCustomsTerritory('it', ' 22061 ')).toBe("Campione d'Italia");
  expect(extraCustomsTerritory('IT', '40131')).toBeNull();
  expect(extraCustomsTerritory('CH', '23041')).toBeNull();
});

test('the unavailable message only offers store pickup when click & collect is enabled', () => {
  expect(extraCustomsUnavailableMessage('Livigno', true))
    .toBe('Livraison indisponible vers Livigno (zone extra-douanière). Choisissez le retrait en magasin ou contactez-nous.');
  expect(extraCustomsUnavailableMessage('Livigno', false))
    .toBe('Livraison indisponible vers Livigno (zone extra-douanière). Contactez-nous pour trouver une solution.');
});
