'use client';

import { useId, useMemo } from 'react';
import { countryDisplayName } from '@/lib/address/countries';
import { FieldShell, describedBy, type FieldShellProps } from './FieldShell';
import { CountryPicker } from './CountryPicker';

export interface CountrySelectProps extends FieldShellProps {
  id?: string;
  value: string;
  /** Codes ISO2 réellement proposés (pays livrés par la boutique). Ordre conservé. */
  countries: ReadonlyArray<string>;
  onChange: (code: string) => void;
  /** Langue du nom des pays (interface). */
  locale?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
}

/**
 * Sélecteur de pays réutilisable : drapeaux SVG en couleur, noms dans la
 * langue de l'interface, recherche, clavier, mobile. Ne propose que les pays
 * donnés (jamais une liste mondiale pour une adresse de livraison).
 */
export function CountrySelect({
  id: idProp, label, optional, requiredMark, labelNote, hideLabel, hint, error, message, messagesOutside, className,
  value, countries, onChange, locale = 'fr', searchPlaceholder = 'Rechercher un pays', emptyText = 'Aucun pays trouvé', disabled,
}: CountrySelectProps) {
  const autoId = useId();
  const id = idProp ?? `field-${autoId.replace(/:/g, '')}`;
  const entries = useMemo(
    () => countries.map((code) => ({ code: code.toUpperCase(), name: countryDisplayName(code, locale) })),
    [countries, locale],
  );
  return (
    <FieldShell id={id} label={label} optional={optional} requiredMark={requiredMark} labelNote={labelNote} hideLabel={hideLabel}
      hint={hint} error={error} message={message} messagesOutside={messagesOutside} className={className}>
      <CountryPicker
        id={id}
        ariaLabel={typeof label === 'string' ? label : 'Pays'}
        value={value}
        countries={entries}
        onChange={onChange}
        searchPlaceholder={searchPlaceholder}
        emptyText={emptyText}
        disabled={disabled}
        invalid={Boolean(error)}
        describedBy={describedBy(id, { hint, error, message })}
      />
    </FieldShell>
  );
}
