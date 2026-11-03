'use client';

import { useRef, useState } from 'react';
import { CheckboxField, FieldMessage, TextField } from '@/components/ui/form';
import { PostalLocalityField } from './PostalLocalityField';
import { CountrySelect } from '@/components/ui/form/CountrySelect';
import { fieldIds } from '@/components/ui/form/FieldShell';
import {
  ADDRESS_LIMITS,
  COUNTRY_ADDRESS_RULES,
  NO_HOUSE_NUMBER,
  countryOptions,
  isDeliveryCountry,
  isNoHouseNumber,
  splitLine1,
  validateAddressDraft,
  type AddressDraft,
  type AddressErrors,
  type AddressField,
} from '@/lib/address/addressRules';
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
  const valueRef = useRef(value);
  valueRef.current = value;
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

  const company = Boolean(value.deliverToCompany);

  return (
    <div className="flex flex-col gap-4">
      {showFullName && (
        <TextField
          id={id('fullName')}
          label={ADDRESS_COPY.fullName}
          requiredMark
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
              requiredMark
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
        requiredMark
        value={value.country}
        countries={options.map((entry) => entry.code)}
        hint={countryHint}
        error={errorFor('country')}
        onChange={(code) => {
          // Le code postal saisi n'est plus supposé valide et la localité choisie non plus : tout est revérifié pour le nouveau pays.
          update({ country: code, city: '' });
          if (value.postalCode) touch('postalCode');
        }}
      />

      <PostalLocalityField
        id={id('postalCode')}
        cityId={id('city')}
        country={value.country}
        postalCode={value.postalCode}
        city={value.city}
        postalDigits={postalDigits}
        autoComplete={auto('postal-code')}
        error={errorFor('postalCode')}
        cityError={errorFor('city')}
        onChange={(patch) => {
          // Une saisie de code postal annule la localité choisie ; seul le formulaire écrit dans `value`.
          const next = { ...valueRef.current, ...patch };
          onChange(next, Object.keys(patch) as AddressField[]);
          valueRef.current = next;
        }}
        onTouch={touch}
        onChosen={() => focusField('street')}
      />

      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-start gap-3">
          <TextField
            id={id('street')}
            label={ADDRESS_COPY.street}
            requiredMark
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
            requiredMark
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
