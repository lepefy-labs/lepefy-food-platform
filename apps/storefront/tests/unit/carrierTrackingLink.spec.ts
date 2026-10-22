import { test, expect } from '@playwright/test';
import { carrierTrackingLink } from '../../src/lib/shipping/shipmentPresentation';

test('Poste Italiane: the link opens on the shipment (risultati-spedizioni + code), never on an empty search', () => {
  expect(carrierTrackingLink({ carrier: 'Poste Italiane', trackingCode: 'ZA123456789IT' }))
    .toBe('https://www.poste.it/cerca/index.html#/risultati-spedizioni/ZA123456789IT');
  expect(carrierTrackingLink({ carrier: ' poste ', trackingCode: ' ZA123456789IT ' }))
    .toBe('https://www.poste.it/cerca/index.html#/risultati-spedizioni/ZA123456789IT');
  // Real Packlink value for a Poste order (#5CA23A93): the base without the code.
  expect(carrierTrackingLink({ carrier: 'Poste Italiane', trackingCode: '1UW1YZT056163', providerUrl: 'https://www.poste.it/cerca/index.html#/risultati-spedizioni/' }))
    .toBe('https://www.poste.it/cerca/index.html#/risultati-spedizioni/1UW1YZT056163');
  // Old route kept by a provider: repaired so the code is not dropped.
  expect(carrierTrackingLink({ carrier: 'Poste Italiane', trackingCode: 'ZA1IT', providerUrl: 'https://www.poste.it/cerca/index.html#/risultati-ricerca-spedizioni/ZA1IT' }))
    .toBe('https://www.poste.it/cerca/index.html#/risultati-spedizioni/ZA1IT');
});

test('provider URL is kept only when it already carries the code; otherwise the carrier page with the code', () => {
  expect(carrierTrackingLink({ carrier: 'BRT', trackingCode: 'ABC1', providerUrl: 'https://track.example.com/ABC1' }))
    .toBe('https://track.example.com/ABC1');
  expect(carrierTrackingLink({ carrier: 'Poste Italiane', trackingCode: 'ZA1IT', providerUrl: 'https://www.poste.it/cerca/index.html' }))
    .toBe('https://www.poste.it/cerca/index.html#/risultati-spedizioni/ZA1IT');
  // Unknown carrier: the provider URL is the only link we have.
  expect(carrierTrackingLink({ carrier: 'Colissimo', trackingCode: 'X9', providerUrl: 'https://carrier.example.com/search' }))
    .toBe('https://carrier.example.com/search');
  expect(carrierTrackingLink({ carrier: 'Colissimo', trackingCode: 'X9' })).toBeNull();
  expect(carrierTrackingLink({ carrier: 'Poste Italiane', trackingCode: null })).toBeNull();
  expect(carrierTrackingLink({ carrier: 'BRT', trackingCode: 'A', providerUrl: 'javascript:alert(1)' }))
    .toBe('https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numsped_par.hsm&Nspediz=A');
  expect(carrierTrackingLink({ carrier: 'DHL', trackingCode: 'a b/c' })).toBe('https://www.dhl.com/it-it/home/tracking.html?tracking-id=a%20b%2Fc');
});
