'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { CheckboxField, FieldMessage, SelectField, TextField } from '@/components/ui/form';
import { CLOSED_COMBOBOX, comboboxKeyAction, comboboxReducer } from '@/components/ui/form/comboboxState';
import { SuggestionList, comboboxInputProps } from '@/components/ui/form/SuggestionList';
import { fieldIds } from '@/components/ui/form/FieldShell';
import {
  ADDRESS_LIMITS,
  COUNTRY_ADDRESS_RULES,
  DELIVERY_COUNTRIES,
  NO_HOUSE_NUMBER,
  addressExample,
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
import type { AddressSuggestion } from '@/lib/address/geocodeSearch';
import type { PostalLookupCity } from '@/lib/address/postalLookup';
import { ADDRESS_COPY, postalCityQuestion } from '@/lib/storefrontCopy/addressCopy';
import { AddressSearch } from './AddressSearch';

export function addressFieldId(idPrefix: string, field: AddressField): string {
  return `${idPrefix}-${field}`;
}

export interface CustomerAddressFormProps {
  /** Préfixe des id de champs (résumé d'erreurs, focus). */
  idPrefix: string;
  value: AddressDraft;
  onChange: (next: AddressDraft, changed: AddressField[]) => void;
  /** Champ « Nom et prénom du destinataire » (/compte). Au checkout, le nom vient de la section dédiée. */
  showFullName?: boolean;
  /** Affiche toutes les erreurs (après un envoi), sinon seulement les champs quittés. */
  showAllErrors?: boolean;
  /** Erreurs renvoyées par le serveur, prioritaires. */
  serverErrors?: AddressErrors;
  /** 'open' : recherche visible ; 'collapsed' : lien pour l'ouvrir (modification d'une adresse). */
  searchMode?: 'open' | 'collapsed';
  /** Section d'autocomplétion HTML (« shipping » au checkout). */
  autofillSection?: 'shipping';
}

async function lookup(params: Record<string, string>, signal: AbortSignal): Promise<PostalLookupCity[]> {
  const res = await fetch(`/api/address/postal-lookup?${new URLSearchParams(params).toString()}`, { signal });
  if (!res.ok) return [];
  const data = await res.json() as { cities?: PostalLookupCity[] };
  return Array.isArray(data.cities) ? data.cities : [];
}

function sameCity(a: string, b: string) {
  const norm = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return norm(a) === norm(b);
}

/**
 * Formulaire d'adresse unique du storefront (checkout, compte, reprise).
 * Tous les champs sont visibles et modifiables dès le départ ; la recherche
 * rapide et les suggestions code postal ↔ ville ne font que proposer.
 * Ce composant ne dit jamais qu'une adresse est livrable.
 */
export function CustomerAddressForm({
  idPrefix,
  value,
  onChange,
  showFullName = false,
  showAllErrors = false,
  serverErrors,
  searchMode = 'open',
  autofillSection,
}: CustomerAddressFormProps) {
  const [touched, setTouched] = useState<Set<AddressField>>(() => new Set());
  const [searchOpen, setSearchOpen] = useState(searchMode === 'open');
  const [filledFromSearch, setFilledFromSearch] = useState(false);
  const [numberHint, setNumberHint] = useState(false);

  // Ville → codes postaux.
  const [cityResults, setCityResults] = useState<PostalLookupCity[]>([]);
  const [cityCombobox, cityDispatch] = useReducer(comboboxReducer, CLOSED_COMBOBOX);
  const cityTypedRef = useRef(false);
  const [codeChoices, setCodeChoices] = useState<{ city: string; codes: string[]; tooMany: boolean } | null>(null);
  // Code postal → ville.
  const [postalCities, setPostalCities] = useState<PostalLookupCity[]>([]);
  const postalTypedRef = useRef(false);

  const id = (field: AddressField) => addressFieldId(idPrefix, field);
  const auto = (token: string) => (autofillSection ? `${autofillSection} ${token}` : token);
  const example = addressExample(value.country);
  const postalDigits = isDeliveryCountry(value.country) ? COUNTRY_ADDRESS_RULES[value.country].postalDigits : ADDRESS_LIMITS.postalCode;
  const noNumber = isNoHouseNumber(value.houseNumber);

  const computed = validateAddressDraft(value, { requireFullName: showFullName });
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

  // Ville tapée par le client → communes de l'index (facultatif).
  useEffect(() => {
    if (!cityTypedRef.current) return;
    const query = value.city.trim();
    if (query.length < 3 || !isDeliveryCountry(value.country)) {
      setCityResults([]);
      cityDispatch({ type: 'results', count: 0 });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      lookup({ country: value.country, city: query }, controller.signal)
        .then((cities) => {
          // Une seule commune qui correspond exactement : rien à proposer.
          const useful = cities.length === 1 && sameCity(cities[0]!.city, query) && cities[0]!.postalCodes.includes(value.postalCode)
            ? [] : cities;
          setCityResults(useful);
          cityDispatch({ type: 'results', count: useful.length });
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value.city, value.country, value.postalCode]);

  // Code postal complet tapé par le client → « c'est bien <ville> ? » si la ville est vide.
  useEffect(() => {
    if (!postalTypedRef.current) return;
    setPostalCities([]);
    if (value.city.trim() || !isValidPostalCode(value.country, value.postalCode)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      lookup({ country: value.country, postalCode: value.postalCode }, controller.signal)
        .then((cities) => setPostalCities(cities.slice(0, 3)))
        .catch(() => undefined);
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value.postalCode, value.country, value.city]);

  function pickSuggestion(suggestion: AddressSuggestion) {
    const patch: Partial<AddressDraft> = { street: suggestion.street };
    // Une suggestion sans numéro ne vide jamais un numéro déjà écrit.
    if (suggestion.houseNumber) patch.houseNumber = suggestion.houseNumber;
    const postal = normalizePostalCode(value.country, suggestion.postalCode);
    if (isValidPostalCode(value.country, postal)) patch.postalCode = postal;
    if (suggestion.city) patch.city = suggestion.city;
    cityTypedRef.current = false;
    postalTypedRef.current = false;
    setCityResults([]);
    setPostalCities([]);
    setCodeChoices(null);
    update(patch);
    setFilledFromSearch(true);
    const missingNumber = !suggestion.houseNumber;
    setNumberHint(missingNumber);
    if (missingNumber && !value.houseNumber.trim()) focusField('houseNumber');
  }

  function chooseCity(city: PostalLookupCity) {
    cityTypedRef.current = false;
    setCityResults([]);
    cityDispatch({ type: 'results', count: 0 });
    const patch: Partial<AddressDraft> = { city: city.city };
    const postalKnown = city.postalCodes.includes(normalizePostalCode(value.country, value.postalCode));
    if (city.postalCodes.length === 1 && !postalKnown) {
      // Un seul code postal : on peut le proposer sans choisir à la place du client.
      patch.postalCode = city.postalCodes[0]!;
      setCodeChoices(null);
    } else if (!postalKnown && (city.postalCodes.length > 1 || city.postalCodeCount > 1)) {
      setCodeChoices({ city: city.city, codes: city.postalCodes, tooMany: city.postalCodes.length === 0 });
    } else {
      setCodeChoices(null);
    }
    update(patch);
  }

  const cityListId = `${id('city')}-list`;

  return (
    <div className="flex flex-col gap-4">
      {showFullName && (
        <TextField
          id={id('fullName')}
          label={ADDRESS_COPY.fullName}
          autoComplete={auto('name')}
          placeholder={ADDRESS_COPY.fullNameExample}
          maxLength={ADDRESS_LIMITS.fullName}
          value={value.fullName ?? ''}
          error={errorFor('fullName')}
          onChange={(event) => update({ fullName: event.target.value })}
          onBlur={() => touch('fullName')}
        />
      )}

      <SelectField
        id={id('country')}
        label={ADDRESS_COPY.country}
        autoComplete={auto('country')}
        value={value.country}
        options={DELIVERY_COUNTRIES.map((entry) => ({ value: entry.code, label: entry.label }))}
        error={errorFor('country')}
        onChange={(event) => {
          // Changer de pays ne vide aucun champ : seul le code postal est à revérifier.
          setCodeChoices(null);
          setPostalCities([]);
          setCityResults([]);
          update({ country: event.target.value });
          if (value.postalCode) touch('postalCode');
        }}
      />

      {searchOpen ? (
        <>
          <AddressSearch id={`${idPrefix}-search`} country={value.country} onPick={pickSuggestion} />
          <p className="flex items-center gap-3 text-sm font-semibold text-gray-700" aria-hidden="true">
            <span className="h-px flex-1 bg-gray-300" />
            {ADDRESS_COPY.orWrite}
            <span className="h-px flex-1 bg-gray-300" />
          </p>
        </>
      ) : (
        <button type="button" onClick={() => setSearchOpen(true)}
          className="min-h-11 self-start text-sm font-bold text-[color:var(--color-primary-dark)] underline underline-offset-4">
          {ADDRESS_COPY.searchAgain}
        </button>
      )}

      {filledFromSearch && (
        <p className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-[#1E3A5F]" role="status">
          {ADDRESS_COPY.filledFromSearch}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-start gap-3">
          <TextField
            id={id('street')}
            label={ADDRESS_COPY.street}
            autoComplete={auto('address-line1')}
            placeholder={`Ex. : ${example.street}`}
            hint={ADDRESS_COPY.streetHint}
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
            placeholder={`Ex. : ${example.houseNumber}`}
            maxLength={12}
            enterKeyHint="next"
            disabled={noNumber}
            describedById={numberHint ? `${id('houseNumber')}-search-hint` : undefined}
            value={noNumber ? NO_HOUSE_NUMBER : value.houseNumber}
            messagesOutside
            error={errorFor('houseNumber')}
            onChange={(event) => {
              setNumberHint(false);
              update({ houseNumber: event.target.value });
            }}
            onBlur={() => touch('houseNumber')}
          />
        </div>
        {/* Messages des deux champs sous la rangée (colonne du numéro trop étroite). */}
        {errorFor('street') && <FieldMessage id={fieldIds(id('street')).error} tone="error">{errorFor('street')}</FieldMessage>}
        {errorFor('houseNumber') && <FieldMessage id={fieldIds(id('houseNumber')).error} tone="error">{errorFor('houseNumber')}</FieldMessage>}
        <p id={fieldIds(id('street')).hint} className="sf-hint">{ADDRESS_COPY.streetHint}</p>
        {numberHint && !errorFor('houseNumber') && (
          <FieldMessage id={`${id('houseNumber')}-search-hint`} tone="info">{ADDRESS_COPY.checkHouseNumber}</FieldMessage>
        )}
        <CheckboxField
          label={ADDRESS_COPY.noNumber}
          checked={noNumber}
          onChange={(event) => {
            setNumberHint(false);
            update({ houseNumber: event.target.checked ? NO_HOUSE_NUMBER : '' });
            if (!event.target.checked) focusField('houseNumber');
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-1 items-start gap-3 min-[360px]:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <TextField
            id={id('postalCode')}
            label={ADDRESS_COPY.postalCode}
            autoComplete={auto('postal-code')}
            inputMode="numeric"
            enterKeyHint="next"
            placeholder={`Ex. : ${example.postalCode}`}
            maxLength={postalDigits}
            value={value.postalCode}
            messagesOutside
            error={errorFor('postalCode')}
            onChange={(event) => {
              postalTypedRef.current = true;
              setCodeChoices(null);
              const raw = event.target.value;
              update({ postalCode: isDeliveryCountry(value.country) ? raw.replace(/\D/g, '').slice(0, postalDigits) : raw });
            }}
            onBlur={() => {
              touch('postalCode');
              const normalized = normalizePostalCode(value.country, value.postalCode);
              if (normalized !== value.postalCode) update({ postalCode: normalized });
            }}
          />
          <div className="flex min-w-0 flex-col gap-2">
            <TextField
              id={id('city')}
              label={ADDRESS_COPY.city}
              autoComplete={auto('address-level2')}
              placeholder={`Ex. : ${example.city}`}
              maxLength={ADDRESS_LIMITS.city}
              enterKeyHint="next"
              value={value.city}
              messagesOutside
              error={errorFor('city')}
              onChange={(event) => {
                cityTypedRef.current = true;
                setPostalCities([]);
                update({ city: event.target.value });
              }}
              onKeyDown={(event) => {
                const action = comboboxKeyAction(event.key, cityCombobox);
                if (!action) return;
                event.preventDefault();
                if (action === 'choose') {
                  const item = cityResults[cityCombobox.activeIndex];
                  if (item) chooseCity(item);
                } else {
                  cityDispatch(action);
                }
              }}
              onBlur={() => {
                touch('city');
                cityDispatch({ type: 'close' });
              }}
              {...comboboxInputProps(cityListId, cityCombobox)}
            />
          </div>
        </div>
        {errorFor('postalCode') && <FieldMessage id={fieldIds(id('postalCode')).error} tone="error">{errorFor('postalCode')}</FieldMessage>}
        {errorFor('city') && <FieldMessage id={fieldIds(id('city')).error} tone="error">{errorFor('city')}</FieldMessage>}
        <SuggestionList
          id={cityListId}
          label={ADDRESS_COPY.city}
          items={cityResults}
          state={cityCombobox}
          getKey={(item) => `${item.city}|${item.area ?? ''}`}
          onHover={(index) => cityDispatch({ type: 'hover', index })}
          onChoose={chooseCity}
          render={(item) => (
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-gray-950">{item.city}</span>
              {item.area && <span className="block text-[13px] text-gray-700">{item.area}</span>}
            </span>
          )}
        />

        {codeChoices && !codeChoices.tooMany && (
          <div className="flex flex-col gap-2" role="group" aria-label={ADDRESS_COPY.cityHasManyPostalCodes}>
            <FieldMessage tone="info">{ADDRESS_COPY.cityHasManyPostalCodes}</FieldMessage>
            <div className="flex flex-wrap gap-2">
              {codeChoices.codes.map((code) => (
                <button key={code} type="button"
                  className="min-h-11 rounded-full border-[1.5px] bg-white px-4 text-[15px] font-semibold tabular-nums text-gray-950 hover:bg-gray-50"
                  style={{ borderColor: 'var(--field-border)' }}
                  onClick={() => {
                    setCodeChoices(null);
                    update({ postalCode: code });
                    touch('postalCode');
                  }}>
                  {code}
                </button>
              ))}
              <button type="button"
                className="min-h-11 rounded-full border-[1.5px] bg-white px-4 text-[15px] font-semibold text-gray-950 hover:bg-gray-50"
                style={{ borderColor: 'var(--field-border)' }}
                onClick={() => {
                  setCodeChoices(null);
                  focusField('postalCode');
                }}>
                {ADDRESS_COPY.otherPostalCode}
              </button>
            </div>
          </div>
        )}
        {codeChoices?.tooMany && <FieldMessage tone="info">{ADDRESS_COPY.cityHasTooManyPostalCodes}</FieldMessage>}

        {postalCities.length > 0 && !value.city.trim() && (
          <div className="flex flex-col gap-2">
            {postalCities.map((city) => (
              <p key={`${city.city}|${city.area ?? ''}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-200 bg-gray-100 px-3.5 py-2 text-sm text-gray-800">
                <span>{postalCityQuestion(value.postalCode, city.city)}{city.area ? ` (${city.area})` : ''}</span>
                <button type="button"
                  className="min-h-10 font-bold text-[color:var(--color-primary-dark)] underline underline-offset-4"
                  onClick={() => {
                    setPostalCities([]);
                    postalTypedRef.current = false;
                    update({ city: city.city });
                    touch('city');
                  }}>
                  {ADDRESS_COPY.useThisCity}
                </button>
              </p>
            ))}
          </div>
        )}

        {!codeChoices && postalCities.length === 0 && !value.postalCode && (
          <p className="sf-hint">{ADDRESS_COPY.postalCodeHint}</p>
        )}
      </div>

      <TextField
        id={id('line2')}
        label={ADDRESS_COPY.line2}
        optional
        autoComplete={auto('address-line2')}
        placeholder={ADDRESS_COPY.line2Example}
        maxLength={ADDRESS_LIMITS.line2}
        value={value.line2}
        error={errorFor('line2')}
        onChange={(event) => update({ line2: event.target.value })}
        onBlur={() => touch('line2')}
      />
    </div>
  );
}
