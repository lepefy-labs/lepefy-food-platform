'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckboxField, FieldMessage, TextField } from '@/components/ui/form';
import { CountrySelect } from '@/components/ui/form/CountrySelect';
import { fieldIds } from '@/components/ui/form/FieldShell';
import {
  ADDRESS_LIMITS,
  COUNTRY_ADDRESS_RULES,
  NO_HOUSE_NUMBER,
  countryOptions,
  isDeliveryCountry,
  isNoHouseNumber,
  isValidPostalCode,
  normalizePostalCode,
  splitLine1,
  validateAddressDraft,
  type AddressDraft,
  type AddressErrors,
  type AddressField,
} from '@/lib/address/addressRules';
import type { PostalLookupCity } from '@/lib/address/postalLookup';
import { ADDRESS_COPY } from '@/lib/storefrontCopy/addressCopy';

export function addressFieldId(idPrefix: string, field: AddressField): string {
  return `${idPrefix}-${field}`;
}

export interface CustomerAddressFormProps {
  /** Préfixe des id de champs (résumé d'erreurs, focus). */
  idPrefix: string;
  value: AddressDraft;
  onChange: (next: AddressDraft, changed: AddressField[]) => void;
  /** Champ « Nom et prénom » (/compte). Au checkout, le nom vient de la section dédiée. */
  showFullName?: boolean;
  /** Affiche toutes les erreurs (après un envoi), sinon seulement les champs quittés. */
  showAllErrors?: boolean;
  /** Erreurs renvoyées par le serveur, prioritaires. */
  serverErrors?: AddressErrors;
  /** Conservé pour compatibilité : la recherche d'adresse n'est plus proposée (la rue se saisit librement). */
  searchMode?: 'open' | 'collapsed' | 'hidden';
  /** Pays proposés (codes ISO2). Par défaut : pays de livraison de la boutique (DELIVERY_COUNTRIES). */
  countries?: ReadonlyArray<string>;
  /** Complément d'adresse (`line2`) ; masqué quand la donnée n'est pas enregistrée (location). */
  showLine2?: boolean;
  /** Case « Livrer en entreprise » (affichée par défaut). */
  showCompany?: boolean;
  /** Section d'autocomplétion HTML (« shipping » au checkout). */
  autofillSection?: 'shipping';
  /** Aide sous le pays, ex. « Livraison possible en Italie. » */
  countryHint?: string;
}

type LookupState =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'error'; key: string }
  | { status: 'done'; key: string; cities: PostalLookupCity[] };

async function lookupPostal(country: string, postalCode: string, signal: AbortSignal): Promise<PostalLookupCity[]> {
  const res = await fetch(`/api/address/postal-lookup?${new URLSearchParams({ country, postalCode }).toString()}`, { signal });
  if (!res.ok) throw new Error('lookup_failed');
  const data = await res.json() as { cities?: PostalLookupCity[] };
  return Array.isArray(data.cities) ? data.cities : [];
}

function sameCity(a: string, b: string) {
  const norm = (text: string) => text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return norm(a) === norm(b);
}

/**
 * Formulaire d'adresse unique du storefront (checkout, compte, reprise).
 * Ordre : pays → code postal → ville → rue → numéro → complément. Le code
 * postal propose les villes de l'index (jamais une association inventée) ; la
 * rue est toujours libre. Ce composant ne dit jamais qu'une adresse est livrable.
 */
export function CustomerAddressForm({
  idPrefix,
  value,
  onChange,
  showFullName = false,
  showAllErrors = false,
  serverErrors,
  autofillSection,
  countries,
  showLine2 = true,
  showCompany = true,
  countryHint,
}: CustomerAddressFormProps) {
  const [touched, setTouched] = useState<Set<AddressField>>(() => new Set());
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const [retry, setRetry] = useState(0);
  // Ville posée par la recherche : seule celle-ci est revalidée quand le code change.
  const cityFromLookupRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const id = (field: AddressField) => addressFieldId(idPrefix, field);
  const auto = (token: string) => (autofillSection ? `${autofillSection} ${token}` : token);
  const postalDigits = isDeliveryCountry(value.country) ? COUNTRY_ADDRESS_RULES[value.country].postalDigits : ADDRESS_LIMITS.postalCode;
  const noNumber = isNoHouseNumber(value.houseNumber);

  const options = countryOptions(countries);
  const allowedCountries = countries ? options.map((option) => option.code) : undefined;
  const computed = validateAddressDraft(value, { requireFullName: showFullName, allowedCountries });
  const errorFor = (field: AddressField): string | undefined =>
    serverErrors?.[field] ?? (showAllErrors || touched.has(field) ? computed[field] : undefined);

  function update(patch: Partial<AddressDraft>) {
    onChange({ ...value, ...patch }, Object.keys(patch) as AddressField[]);
  }

  function touch(field: AddressField) {
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));
  }

  function focusField(field: AddressField) {
    window.requestAnimationFrame(() => document.getElementById(id(field))?.focus());
  }

  // Code postal valide → villes de l'index. Une réponse périmée (pays ou code
  // changé entre-temps) est abandonnée par AbortController.
  const postalKey = isValidPostalCode(value.country, value.postalCode) && isDeliveryCountry(value.country)
    ? `${value.country}:${normalizePostalCode(value.country, value.postalCode)}` : '';
  useEffect(() => {
    if (!postalKey) { setLookup({ status: 'idle' }); return; }
    const controller = new AbortController();
    setLookup({ status: 'loading', key: postalKey });
    const timer = window.setTimeout(() => {
      const [country, postalCode] = postalKey.split(':') as [string, string];
      lookupPostal(country, postalCode, controller.signal)
        .then((cities) => {
          setLookup({ status: 'done', key: postalKey, cities });
          const current = valueRef.current;
          if (cities.some((city) => sameCity(city.city, current.city))) return;
          if (cities.length === 1 && (!current.city.trim() || cityFromLookupRef.current)) {
            // Correspondance unique : présélectionnée, toujours modifiable.
            cityFromLookupRef.current = true;
            onChangeRef.current({ ...current, city: cities[0]!.city }, ['city']);
          } else if (cities.length > 0 && cityFromLookupRef.current) {
            // Ville d'un ancien code postal : à rechoisir, sans rien inventer.
            cityFromLookupRef.current = false;
            onChangeRef.current({ ...current, city: '' }, ['city']);
          }
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name === 'AbortError') return;
          setLookup({ status: 'error', key: postalKey });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [postalKey, retry]);

  function chooseCity(city: PostalLookupCity) {
    cityFromLookupRef.current = true;
    update({ city: city.city });
    touch('city');
    focusField('street');
  }

  const cities = lookup.status === 'done' && lookup.key === postalKey ? lookup.cities : [];
  const company = Boolean(value.deliverToCompany);

  return (
    <div className="flex flex-col gap-4">
      {showFullName && (
        <TextField
          id={id('fullName')}
          label={ADDRESS_COPY.fullName}
          autoComplete={autoName(auto)}
          maxLength={ADDRESS_LIMITS.fullName}
          value={value.fullName ?? ''}
          error={errorFor('fullName')}
          onChange={(event) => update({ fullName: event.target.value })}
          onBlur={() => touch('fullName')}
        />
      )}

      {showCompany && (
        <div className="flex flex-col gap-3">
          <CheckboxField
            label={ADDRESS_COPY.deliverToCompany}
            checked={company}
            onChange={(event) => {
              // Décocher conserve le nom saisi (rien n'est perdu) ; il n'est plus transmis.
              update({ deliverToCompany: event.target.checked });
              if (event.target.checked) focusField('companyName');
            }}
          />
          {company && (
            <TextField
              id={id('companyName')}
              label={ADDRESS_COPY.companyName}
              autoComplete={auto('organization')}
              maxLength={ADDRESS_LIMITS.company}
              value={value.companyName ?? ''}
              error={errorFor('companyName')}
              onChange={(event) => update({ companyName: event.target.value })}
              onBlur={() => touch('companyName')}
            />
          )}
        </div>
      )}

      <CountrySelect
        id={id('country')}
        label={ADDRESS_COPY.country}
        value={value.country}
        countries={options.map((entry) => entry.code)}
        hint={countryHint}
        error={errorFor('country')}
        onChange={(code) => {
          // Le code postal saisi n'est plus supposé valide : il est revérifié avec les règles du nouveau pays.
          setLookup({ status: 'idle' });
          update({ country: code, ...(cityFromLookupRef.current ? { city: '' } : {}) });
          cityFromLookupRef.current = false;
          if (value.postalCode) touch('postalCode');
        }}
      />

      <TextField
        id={id('postalCode')}
        label={ADDRESS_COPY.postalCode}
        autoComplete={auto('postal-code')}
        inputMode="numeric"
        enterKeyHint="next"
        maxLength={postalDigits}
        value={value.postalCode}
        error={errorFor('postalCode')}
        onChange={(event) => {
          const raw = event.target.value;
          update({ postalCode: isDeliveryCountry(value.country) ? raw.replace(/\D/g, '').slice(0, postalDigits) : raw });
        }}
        onBlur={() => {
          touch('postalCode');
          const normalized = normalizePostalCode(value.country, value.postalCode);
          if (normalized !== value.postalCode) update({ postalCode: normalized });
        }}
      />

      {cities.length > 1 && (
        <div role="radiogroup" aria-label={ADDRESS_COPY.cityPick} className="flex flex-col gap-2">
          <p className="sf-label">{ADDRESS_COPY.cityPick}</p>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto overscroll-contain">
            {cities.map((city) => {
              const selected = sameCity(city.city, value.city);
              return (
                <button key={`${city.city}|${city.area ?? ''}`} type="button" role="radio" aria-checked={selected}
                  onClick={() => chooseCity(city)}
                  className={`min-h-11 rounded-xl border-[1.5px] px-4 py-2 text-left ${selected ? 'border-[color:var(--color-primary)] bg-gray-50' : 'bg-white hover:bg-gray-50'}`}
                  style={selected ? undefined : { borderColor: 'var(--field-border)' }}>
                  <span className="block text-[15px] font-semibold text-gray-950">{city.city}</span>
                  {city.area && <span className="block text-[13px] text-gray-700">{city.area}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <TextField
          id={id('city')}
          label={ADDRESS_COPY.city}
          autoComplete={auto('address-level2')}
          maxLength={ADDRESS_LIMITS.city}
          enterKeyHint="next"
          value={value.city}
          error={errorFor('city')}
          message={lookup.status === 'loading' && lookup.key === postalKey ? { tone: 'info', text: ADDRESS_COPY.postalLookupLoading } : null}
          onChange={(event) => {
            cityFromLookupRef.current = false;
            update({ city: event.target.value });
          }}
          onBlur={() => touch('city')}
        />
        {lookup.status === 'error' && lookup.key === postalKey && (
          <div className="flex flex-wrap items-center gap-3">
            <FieldMessage tone="info">{ADDRESS_COPY.postalLookupFailed}</FieldMessage>
            <button type="button" className="min-h-11 font-bold text-[color:var(--color-primary-dark)] underline underline-offset-4"
              onClick={() => setRetry((n) => n + 1)}>
              {ADDRESS_COPY.postalLookupRetry}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-start gap-3">
          <TextField
            id={id('street')}
            label={ADDRESS_COPY.street}
            autoComplete={auto('address-line1')}
            messagesOutside
            maxLength={ADDRESS_LIMITS.line1}
            enterKeyHint="next"
            value={value.street}
            error={errorFor('street')}
            onChange={(event) => update({ street: event.target.value })}
            onBlur={() => {
              touch('street');
              // Autofill du navigateur « Via Roma 25 » : le numéro va dans son champ.
              if (!value.houseNumber.trim()) {
                const split = splitLine1(value.street);
                if (split.houseNumber && split.street) update({ street: split.street, houseNumber: split.houseNumber });
              }
            }}
          />
          <TextField
            id={id('houseNumber')}
            label={ADDRESS_COPY.houseNumber}
            autoComplete="off"
            maxLength={12}
            enterKeyHint="next"
            disabled={noNumber}
            value={noNumber ? NO_HOUSE_NUMBER : value.houseNumber}
            messagesOutside
            error={errorFor('houseNumber')}
            onChange={(event) => update({ houseNumber: event.target.value })}
            onBlur={() => touch('houseNumber')}
          />
        </div>
        {errorFor('street') && <FieldMessage id={fieldIds(id('street')).error} tone="error">{errorFor('street')}</FieldMessage>}
        {errorFor('houseNumber') && <FieldMessage id={fieldIds(id('houseNumber')).error} tone="error">{errorFor('houseNumber')}</FieldMessage>}
        <CheckboxField
          label={ADDRESS_COPY.noNumber}
          checked={noNumber}
          onChange={(event) => {
            update({ houseNumber: event.target.checked ? NO_HOUSE_NUMBER : '' });
            if (!event.target.checked) focusField('houseNumber');
          }}
        />
      </div>

      {showLine2 && (
        <TextField
          id={id('line2')}
          label={ADDRESS_COPY.line2}
          optional
          autoComplete={auto('address-line2')}
          maxLength={ADDRESS_LIMITS.line2}
          value={value.line2}
          error={errorFor('line2')}
          onChange={(event) => update({ line2: event.target.value })}
          onBlur={() => touch('line2')}
        />
      )}
    </div>
  );
}

function autoName(auto: (token: string) => string): string {
  return auto('name');
}
