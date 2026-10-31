'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { dialCode, phoneCountries } from '@/lib/address/countries';
import { formatNationalLive, parseStoredPhone, readPastedInternational, toE164Phone } from '@/lib/phone/internationalPhone';
import { FieldShell, describedBy, type FieldShellProps } from './FieldShell';
import { CountryPicker } from './CountryPicker';

export interface InternationalPhoneFieldProps extends FieldShellProps {
  id?: string;
  /** Valeur enregistrée : E.164 ou ancien format libre. */
  value: string;
  /**
   * Reçoit l'E.164 quand le numéro est valide, sinon « +indicatif saisie »
   * (jamais perdu), pour que la validation du formulaire reste cohérente.
   */
  onChange: (value: string, meta: { valid: boolean; country: string }) => void;
  onBlur?: () => void;
  /** Préfixe proposé au départ (pays de livraison) ; le client le change librement. */
  initialCountry: string;
  locale?: string;
  autoComplete?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Erreur affichée pour un numéro invalide dans le pays du préfixe. */
  invalidText?: string;
}

/**
 * Téléphone international : sélecteur de préfixe (drapeau SVG + indicatif,
 * recherche par nom ou indicatif) et numéro national, séparés. Le préfixe est
 * indépendant du pays de livraison. Un numéro collé avec « + » remplace le
 * préfixe. La valeur remontée est l'E.164 dès que le numéro est valide.
 */
export function InternationalPhoneField({
  id: idProp, label, optional, labelNote, hideLabel, hint, error, message, messagesOutside, className,
  value, onChange, onBlur, initialCountry, locale = 'fr', autoComplete = 'tel-national',
  searchPlaceholder = 'Pays ou indicatif', emptyText = 'Aucun résultat', invalidText = 'Numéro invalide pour ce pays.',
}: InternationalPhoneFieldProps) {
  const autoId = useId();
  const id = idProp ?? `field-${autoId.replace(/:/g, '')}`;
  const [parsed, setParsed] = useState(() => parseStoredPhone(value, initialCountry));
  const [touched, setTouched] = useState(false);
  const lastEmitted = useRef(value);
  const countries = useMemo(() => phoneCountries(locale, [initialCountry, 'IT', 'FR', 'BE', 'DE', 'CH']), [locale, initialCountry]);

  // Valeur rechargée de l'extérieur (profil, brouillon) : relue sans écraser la saisie en cours.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setParsed(parseStoredPhone(value, initialCountry));
  }, [value, initialCountry]);

  function emit(country: string, national: string) {
    const e164 = toE164Phone(national, country);
    const dial = dialCode(country);
    const out = e164 ?? (national.trim() ? `${dial ? `+${dial} ` : ''}${national.trim()}` : '');
    lastEmitted.current = out;
    setParsed({ country, national, e164 });
    onChange(out, { valid: Boolean(e164), country });
  }

  const typedError = touched && parsed.national.trim() && !parsed.e164 ? invalidText : undefined;
  const shownError = error ?? typedError;

  return (
    <FieldShell id={id} label={label} optional={optional} labelNote={labelNote} hideLabel={hideLabel}
      hint={hint} error={shownError} message={message} messagesOutside={messagesOutside} className={className}>
      <div className="flex items-stretch gap-2">
        <CountryPicker
          id={`${id}-country`}
          ariaLabel="Indicatif"
          trigger="compact"
          showDialCode
          value={parsed.country}
          countries={countries}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          invalid={Boolean(shownError)}
          onChange={(code) => emit(code, parsed.national)}
          className="shrink-0"
        />
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          enterKeyHint="done"
          value={parsed.national}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy(id, { hint, error: shownError, message })}
          className="sf-control min-w-0 flex-1"
          onPaste={(event) => {
            const pasted = readPastedInternational(event.clipboardData.getData('text'));
            if (!pasted) return;
            event.preventDefault();
            emit(pasted.country, pasted.national);
          }}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw.trim().startsWith('+')) {
              const international = readPastedInternational(raw);
              if (international) { emit(international.country, international.national); return; }
            }
            emit(parsed.country, formatNationalLive(raw, parsed.country));
          }}
          onBlur={() => { setTouched(true); onBlur?.(); }}
        />
      </div>
    </FieldShell>
  );
}
