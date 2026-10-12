import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  composeLine1,
  countryOptions,
  defaultDeliveryCountry,
  draftToShippingAddress,
  emptyAddressDraft,
  firstErrorField,
  isValidPostalCode,
  normalizePostalCode,
  normalizeAddressParts,
  normalizeShippingAddress,
  shippingAddressToDraft,
  splitLine1,
  validateAddressDraft,
  NO_HOUSE_NUMBER,
} from '../../src/lib/address/addressRules';
import { buildPostalLookupCities, cityQueryKey, MAX_POSTAL_CODES } from '../../src/lib/address/postalLookup';
import { photonToSuggestions } from '../../src/lib/address/geocodeSearch';
import { CLOSED_COMBOBOX, comboboxKeyAction, comboboxReducer } from '../../src/components/ui/form/comboboxState';
import { ADDRESS_COPY, searchResultsAnnouncement } from '../../src/lib/storefrontCopy/addressCopy';

const filled = {
  country: 'IT', street: 'Via Roma', houseNumber: '25', postalCode: '42121', city: 'Reggio Emilia', line2: '',
};

test.describe('règles d\'adresse', () => {
  test('code postal par pays : chiffres exacts, espaces retirés', () => {
    expect(isValidPostalCode('IT', '42121')).toBe(true);
    expect(isValidPostalCode('IT', '4212')).toBe(false);
    expect(isValidPostalCode('IT', '421211')).toBe(false);
    expect(isValidPostalCode('FR', '75 011')).toBe(true);
    expect(isValidPostalCode('BE', '1000')).toBe(true);
    expect(isValidPostalCode('CH', '12010')).toBe(false);
    expect(isValidPostalCode('DE', 'ABCDE')).toBe(false);
    expect(normalizePostalCode('FR', ' 75 011 ')).toBe('75011');
    // Pays hors liste : format générique, jamais rejeté pour un format inconnu.
    expect(isValidPostalCode('NL', '1012 AB')).toBe(true);
  });

  test('pays par défaut : celui de la boutique s\'il est livré', () => {
    expect(defaultDeliveryCountry('fr')).toBe('FR');
    expect(defaultDeliveryCountry('CM')).toBe('IT');
    expect(defaultDeliveryCountry(null)).toBe('IT');
  });

  test('rue + numéro ↔ line1, y compris « s.n. »', () => {
    expect(splitLine1('Via Roma 25')).toEqual({ street: 'Via Roma', houseNumber: '25' });
    expect(splitLine1('Via XX Settembre 12/B')).toEqual({ street: 'Via XX Settembre', houseNumber: '12/B' });
    expect(splitLine1('Strada Pratofontana s.n.')).toEqual({ street: 'Strada Pratofontana', houseNumber: 's.n.' });
    expect(splitLine1('Via Roma')).toEqual({ street: 'Via Roma', houseNumber: '' });
    expect(composeLine1('  Via   Roma ', ' 25 ')).toBe('Via Roma 25');
    expect(composeLine1('Strada Pratofontana', NO_HOUSE_NUMBER)).toBe('Strada Pratofontana s.n.');
  });

  test('validation champ par champ, messages en français simple', () => {
    expect(validateAddressDraft(filled)).toEqual({});
    const errors = validateAddressDraft({ ...filled, houseNumber: '', postalCode: '4212' });
    expect(errors.houseNumber).toBe(ADDRESS_COPY.houseNumberRequired);
    expect(errors.postalCode).toBe('En Italie, le code postal a 5 chiffres. Exemple : 42121');
    expect(firstErrorField(errors)).toBe('houseNumber');
    // Complément facultatif ; nom demandé seulement quand le formulaire l'affiche.
    expect(validateAddressDraft({ ...filled, line2: '' })).toEqual({});
    expect(validateAddressDraft(filled, { requireFullName: true }).fullName).toBe(ADDRESS_COPY.required);
    expect(validateAddressDraft({ ...filled, line2: 'x'.repeat(121) }).line2).toBe(ADDRESS_COPY.tooLong);
    // « Pas de numéro » est une réponse valide.
    expect(validateAddressDraft({ ...filled, houseNumber: NO_HOUSE_NUMBER })).toEqual({});
  });

  test('formulaire → adresse stockée → formulaire', () => {
    const stored = draftToShippingAddress({ ...filled, line2: ' Interphone  Kamga ' }, ' Marie  Kamga ');
    expect(stored).toEqual({
      full_name: 'Marie Kamga', line1: 'Via Roma 25', line2: 'Interphone Kamga',
      city: 'Reggio Emilia', postal_code: '42121', country: 'IT',
    });
    expect(draftToShippingAddress(filled, 'Marie')).not.toHaveProperty('line2');
    expect(shippingAddressToDraft(stored)).toEqual({ ...filled, line2: 'Interphone Kamga', fullName: 'Marie Kamga' });
    expect(emptyAddressDraft('FR')).toEqual({ country: 'FR', street: '', houseNumber: '', postalCode: '', city: '', line2: '' });
  });
});

test.describe('contrôle serveur de l\'adresse (checkout, compte)', () => {
  const valid = { full_name: 'Marie Kamga', line1: 'Via Roma 25', city: 'Reggio Emilia', postal_code: '42121', country: 'it' };

  test('ne garde que les champs connus, texte nettoyé', () => {
    const result = normalizeShippingAddress({ ...valid, line2: '  2e étage ', is_admin: true, notes: 'x', city: 'Reggio\nEmilia' });
    expect(result).toEqual({
      ok: true,
      address: { full_name: 'Marie Kamga', line1: 'Via Roma 25', line2: '2e étage', city: 'Reggio Emilia', postal_code: '42121', country: 'IT' },
    });
  });

  test('refuse les adresses incomplètes ou invalides avec un message lisible', () => {
    expect(normalizeShippingAddress(null)).toMatchObject({ ok: false, field: 'address' });
    expect(normalizeShippingAddress('Via Roma')).toMatchObject({ ok: false });
    expect(normalizeShippingAddress({ ...valid, city: '  ' })).toMatchObject({ ok: false, field: 'city' });
    expect(normalizeShippingAddress({ ...valid, postal_code: '4212' })).toMatchObject({ ok: false, field: 'postal_code' });
    expect(normalizeShippingAddress({ ...valid, country: 'Italia' })).toMatchObject({ ok: false, field: 'country' });
    expect(normalizeShippingAddress({ ...valid, line2: 'x'.repeat(121) })).toMatchObject({ ok: false, field: 'line2' });
    expect(normalizeShippingAddress({ ...valid, full_name: 42 })).toMatchObject({ ok: false, field: 'full_name' });
  });

  test('anciennes adresses sans numéro toujours acceptées (aucune régression)', () => {
    expect(normalizeShippingAddress({ ...valid, line1: 'Via Roma' })).toMatchObject({ ok: true });
  });

  test('code postal identique à celui du devis (jeton lié au CAP)', () => {
    const result = normalizeShippingAddress({ ...valid, postal_code: ' 42121 ' });
    expect(result.ok && result.address.postal_code).toBe('42121');
  });
});

test.describe('location de matériel : pays du tenant et adresse découpée', () => {
  test('pays proposés = pays de livraison du tenant, noms en français', () => {
    expect(countryOptions(['it', 'IT', ' es ', 'Italie', ''])).toEqual([
      { code: 'IT', label: 'Italie' },
      { code: 'ES', label: 'Espagne' },
    ]);
    // Sans liste : pays de livraison de la boutique (checkout inchangé).
    expect(countryOptions(undefined).map((option) => option.code)).toEqual(['IT', 'FR', 'BE', 'DE', 'CH']);
  });

  test('validation limitée aux pays du contexte', () => {
    const spain = { country: 'ES', street: 'Calle Mayor', houseNumber: '3', postalCode: '28013', city: 'Madrid', line2: '' };
    expect(validateAddressDraft(spain, { allowedCountries: ['ES'] })).toEqual({});
    expect(validateAddressDraft(spain).country).toBe(ADDRESS_COPY.countryUnsupported);
    expect(validateAddressDraft(filled, { allowedCountries: ['ES'] }).country).toBe(ADDRESS_COPY.countryUnsupported);
  });

  test('contrôle serveur : pays ISO, numéro, code postal', () => {
    expect(normalizeAddressParts({ street: ' Via  Roma ', houseNumber: '25', postalCode: '42 121', city: 'Reggio Emilia', country: 'it' })).toEqual({
      ok: true, address: { street: 'Via Roma', houseNumber: '25', postalCode: '42121', city: 'Reggio Emilia', country: 'IT' },
    });
    // « Italie » en toutes lettres n'est plus envoyé par le formulaire, et serait refusé clairement.
    expect(normalizeAddressParts({ street: 'Via Roma', houseNumber: '25', postalCode: '42121', city: 'Reggio Emilia', country: 'Italie' }))
      .toMatchObject({ ok: false, field: 'country' });
    expect(normalizeAddressParts({ street: 'Via Roma', houseNumber: '', postalCode: '42121', city: 'Reggio Emilia', country: 'IT' }))
      .toMatchObject({ ok: false, field: 'house_number', error: ADDRESS_COPY.houseNumberRequired });
    expect(normalizeAddressParts({ street: 'Via Roma', houseNumber: '25', postalCode: '4212', city: 'Reggio Emilia', country: 'IT' }))
      .toMatchObject({ ok: false, field: 'postal_code' });
    expect(normalizeAddressParts({ street: 'Via Roma', houseNumber: 's.n.', postalCode: '42121', city: 'Reggio Emilia', country: 'IT' }))
      .toMatchObject({ ok: true });
    expect(normalizeAddressParts({ street: 42, houseNumber: '25', postalCode: '42121', city: 'X', country: 'IT' }))
      .toMatchObject({ ok: false, field: 'street' });
  });
});

test.describe('suggestions code postal ↔ ville (index GeoNames)', () => {
  const row = (place: string, postal: string, admin2 = 'Reggio Emilia', code2 = 'RE', admin1 = 'Emilia-Romagna') => ({
    place_name: place, place_name_normalized: cityQueryKey(place),
    admin_name1: admin1, admin_code1: '05', admin_name2: admin2, admin_code2: code2, postal_code: postal,
  });

  test('une ville à plusieurs codes : tous proposés, aucun choisi', () => {
    const cities = buildPostalLookupCities([
      row("Reggio nell'Emilia", '42124'), row("Reggio nell'Emilia", '42121'), row("Reggio nell'Emilia", '42122'),
    ], 'IT');
    expect(cities).toHaveLength(1);
    expect(cities[0]).toEqual({
      city: "Reggio nell'Emilia", area: 'Reggio Emilia (RE)', postalCodes: ['42121', '42122', '42124'], postalCodeCount: 3,
    });
  });

  test('CAP générique d\'avant réforme (IT) jamais proposé', () => {
    const [modena] = buildPostalLookupCities([
      row('Modena', '41100', 'Modena', 'MO'), row('Modena', '41121', 'Modena', 'MO'), row('Modena', '41122', 'Modena', 'MO'),
    ], 'IT');
    expect(modena?.postalCodes).toEqual(['41121', '41122']);
    // Varese 21100 : seul code de sa racine, donc valide.
    const [varese] = buildPostalLookupCities([row('Varese', '21100', 'Varese', 'VA', 'Lombardia')], 'IT');
    expect(varese?.postalCodes).toEqual(['21100']);
  });

  test('homonymes séparés par rattachement administratif', () => {
    const cities = buildPostalLookupCities([
      row('San Martino', '42018'), row('San Martino', '35010', 'Padova', 'PD', 'Veneto'),
    ], 'IT');
    expect(cities.map((city) => city.area).sort()).toEqual(['Padova (PD)', 'Reggio Emilia (RE)']);
  });

  test('trop de codes postaux : liste vide, compte conservé', () => {
    const rows = Array.from({ length: MAX_POSTAL_CODES + 5 }, (_, index) => row('Roma', String(118 + index).padStart(5, '0'), 'Roma', 'RM', 'Lazio'));
    const [roma] = buildPostalLookupCities(rows, 'IT');
    expect(roma?.postalCodes).toEqual([]);
    expect(roma?.postalCodeCount).toBe(MAX_POSTAL_CODES + 5);
  });

  test('la ville exacte passe en premier', () => {
    const cities = buildPostalLookupCities([
      row('Reggiolo', '42046'), row('Reggio di Calabria', '89121', 'Reggio Calabria', 'RC', 'Calabria'), row('Reggio di Calabria', '89122', 'Reggio Calabria', 'RC', 'Calabria'),
    ], 'IT', cityQueryKey('Reggiolo'));
    expect(cities[0]?.city).toBe('Reggiolo');
  });

  test('requête nettoyée : accents et jokers SQL retirés', () => {
    expect(cityQueryKey('  Genève%_ ')).toBe('geneve');
  });
});

test.describe('recherche rapide (Photon)', () => {
  const feature = (properties: Record<string, string>) => ({ properties });

  test('rues et adresses du pays demandé seulement, sans doublons', () => {
    const results = photonToSuggestions({
      features: [
        feature({ type: 'house', street: 'Via Roma', housenumber: '25', postcode: '42121', city: "Reggio nell'Emilia", countrycode: 'IT' }),
        feature({ type: 'street', name: 'Via Emilia a San Pietro', postcode: '42121', city: "Reggio nell'Emilia", countrycode: 'IT' }),
        feature({ type: 'street', name: 'Via Emilia a San Pietro', postcode: '42121', city: "Reggio nell'Emilia", countrycode: 'IT' }),
        feature({ type: 'house', street: 'Rue de Rome', housenumber: '3', postcode: '75008', city: 'Paris', countrycode: 'FR' }),
        feature({ type: 'city', name: 'Reggio Emilia', countrycode: 'IT' }),
        feature({ type: 'street', name: 'Sentiero senza nome', countrycode: 'IT' }),
      ],
    }, 'it');
    expect(results).toEqual([
      { street: 'Via Roma', houseNumber: '25', postalCode: '42121', city: "Reggio nell'Emilia", country: 'IT', primary: 'Via Roma 25', secondary: "42121 Reggio nell'Emilia" },
      { street: 'Via Emilia a San Pietro', houseNumber: '', postalCode: '42121', city: "Reggio nell'Emilia", country: 'IT', primary: 'Via Emilia a San Pietro', secondary: "42121 Reggio nell'Emilia" },
    ]);
  });

  test('réponse inattendue : aucune suggestion, jamais une erreur', () => {
    expect(photonToSuggestions(null, 'IT')).toEqual([]);
    expect(photonToSuggestions({ features: 'x' }, 'IT')).toEqual([]);
  });

  test('annonce pour lecteur d\'écran', () => {
    expect(searchResultsAnnouncement(3)).toContain('3 adresses trouvées');
    expect(searchResultsAnnouncement(1)).toContain('1 adresse trouvée');
    expect(searchResultsAnnouncement(0)).toBe(ADDRESS_COPY.searchNoResults);
  });
});

test.describe('liste de suggestions au clavier (combobox)', () => {
  test('flèches, Entrée, Échap', () => {
    let state = comboboxReducer(CLOSED_COMBOBOX, { type: 'results', count: 3 });
    expect(state).toEqual({ open: true, activeIndex: -1, count: 3 });
    expect(comboboxKeyAction('Enter', state)).toBeNull();
    state = comboboxReducer(state, { type: 'next' });
    state = comboboxReducer(state, { type: 'next' });
    expect(state.activeIndex).toBe(1);
    expect(comboboxKeyAction('Enter', state)).toBe('choose');
    state = comboboxReducer(state, { type: 'previous' });
    state = comboboxReducer(state, { type: 'previous' });
    expect(state.activeIndex).toBe(2);
    state = comboboxReducer(state, { type: 'close' });
    expect(state).toEqual({ open: false, activeIndex: -1, count: 3 });
    expect(comboboxKeyAction('Escape', state)).toBeNull();
    state = comboboxReducer(state, { type: 'next' });
    expect(state).toEqual({ open: true, activeIndex: 0, count: 3 });
  });

  test('aucun résultat : rien ne s\'ouvre', () => {
    const empty = comboboxReducer(CLOSED_COMBOBOX, { type: 'results', count: 0 });
    expect(comboboxReducer(empty, { type: 'next' })).toEqual(empty);
    expect(comboboxReducer(empty, { type: 'reopen' })).toEqual(empty);
  });
});

test.describe('garde-fous des formulaires clients (Form Readability V2)', () => {
  const migrated = [
    'src/app/(shop)/checkout/CheckoutFlow.tsx',
    'src/app/(shop)/compte/adresses/AdresseFormClient.tsx',
    'src/app/(shop)/compte/modifier/ModifierProfilClient.tsx',
    'src/app/(shop)/compte/ambassadeur/AmbassadorClient.tsx',
    'src/app/(shop)/orders/OrderLookupForm.tsx',
    'src/app/(shop)/supprimer-compte/AccountDeletionClient.tsx',
    'src/app/(shop)/feedback/FeedbackForm.tsx',
    'src/app/(shop)/avis/donner/ReviewForm.tsx',
    'src/app/pay/[token]/PayPreorderClient.tsx',
    'src/components/auth/OtpLoginForm.tsx',
    'src/components/card/CardQuickPay.tsx',
    'src/components/checkout-session/CheckoutSessionEditor.tsx',
    'src/components/address/CustomerAddressForm.tsx',
    'src/components/address/AddressSearch.tsx',
    'src/components/address/SavedAddressPicker.tsx',
    'src/app/(evenementiel)/evenementiel/services/[slug]/RentalCheckoutClient.tsx',
  ];

  for (const file of migrated) {
    test(`${file} : champs lisibles, pas d'état d'adresse trompeur`, () => {
      const source = readFileSync(file, 'utf8');
      // Champs texte du kit uniquement : pas d'input/select/textarea à bordure quasi invisible.
      for (const match of source.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
        expect(match[0], `${file}: ${match[0].slice(0, 80)}`).not.toMatch(/border-gray-200|border-black\/10|placeholder:text-gray-400/);
      }
      // Libellés gris clair en petites capitales (2,5:1) interdits.
      expect(source).not.toMatch(/text-gray-400 text-xs uppercase/);
      expect(source).not.toMatch(/text-\[(9|10|10\.5|11|11\.5)px\]/);
      // Une suggestion géographique n'est jamais une adresse « validée » ni livrable.
      expect(source).not.toMatch(/Adresse validée|Adresse trouvée/);
      expect(source).not.toContain('AddressAutocomplete');
    });
  }

  test('pays et découpage rue/numéro définis une seule fois', () => {
    for (const file of ['src/app/(shop)/checkout/CheckoutFlow.tsx', 'src/app/(shop)/compte/adresses/AdresseFormClient.tsx', 'src/components/checkout-session/CheckoutSessionEditor.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/const COUNTRIES = \[/);
      expect(source, file).not.toMatch(/function splitLine1/);
    }
  });

  test('barres fixes du checkout ciblées par attribut, jamais par classes Tailwind', () => {
    const css = readFileSync('src/app/(shop)/checkout/checkoutSticky.module.css', 'utf8');
    expect(css).not.toMatch(/min-h-12|rounded-2xl|\.mx-auto/);
    expect(css).toContain("[data-checkout-sticky='cta']");
    expect(css).toContain("[data-typing='true'] [data-checkout-sticky]");
  });

  test('location : pays choisi dans une liste, jamais en texte libre', () => {
    const source = readFileSync('src/app/(evenementiel)/evenementiel/services/[slug]/RentalCheckoutClient.tsx', 'utf8');
    expect(source).not.toContain('Ex. IT, FR');
    expect(source).toContain('<CustomerAddressForm');
    for (const file of ['src/app/api/rental/checkout/route.ts', 'src/app/api/rental/checkout-external-link/route.ts']) {
      expect(readFileSync(file, 'utf8'), file).toContain('normalizeAddressParts(');
    }
  });

  test('le checkout normalise l\'adresse côté serveur', () => {
    for (const file of [
      'src/app/api/checkout/route.ts',
      'src/app/api/checkout/external-link/route.ts',
      'src/app/api/checkout-sessions/[id]/route.ts',
      'src/app/api/customers/me/addresses/route.ts',
      'src/app/api/customers/me/addresses/[id]/route.ts',
    ]) {
      expect(readFileSync(file, 'utf8'), file).toContain('normalizeShippingAddress(');
    }
  });
});
