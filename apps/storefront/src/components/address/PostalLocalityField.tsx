'use client';

import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { TextField } from '@/components/ui/form';
import { CLOSED_COMBOBOX, comboboxKeyAction, comboboxReducer } from '@/components/ui/form/comboboxState';
import { SuggestionList, comboboxInputProps } from '@/components/ui/form/SuggestionList';
import { isDeliveryCountry, isValidPostalCode, normalizePostalCode } from '@/lib/address/addressRules';
import type { PostalLookupCity } from '@/lib/address/postalLookup';
import { localityLabel, postalDigitsFromInput, reconcileLocality } from '@/lib/address/postalLocality';
import { ADDRESS_COPY } from '@/lib/storefrontCopy/addressCopy';

type LookupState =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'unavailable'; key: string }
  | { status: 'done'; key: string; cities: PostalLookupCity[] };

type Item = PostalLookupCity | { notListed: true };

class LookupError extends Error {}

async function lookupPostal(country: string, postalCode: string, signal: AbortSignal): Promise<PostalLookupCity[]> {
  const res = await fetch(`/api/address/postal-lookup?${new URLSearchParams({ country, postalCode }).toString()}`, { signal });
  if (!res.ok) throw new LookupError('lookup_failed');
  const data = await res.json() as { cities?: PostalLookupCity[]; unavailable?: boolean };
  if (data.unavailable) throw new LookupError('index_unavailable');
  return Array.isArray(data.cities) ? data.cities : [];
}

export interface PostalLocalityFieldProps {
  /** Id of the control (the form's `postalCode` id: the error summary focuses it). */
  id: string;
  /** Id of the manual locality field (the form's `city` id). */
  cityId: string;
  country: string;
  postalCode: string;
  city: string;
  postalDigits: number;
  autoComplete: string;
  error?: string;
  cityError?: string;
  onChange: (patch: { postalCode?: string; city?: string }) => void;
  onTouch: (field: 'postalCode' | 'city') => void;
  /** The customer chose a locality: move on to the street. */
  onChosen: () => void;
}

/**
 * One control for « Code postal et localité ». The customer types the postal
 * code only; the localities of the internal index for that exact code are
 * listed as « CAP - Localité ». Nothing is ever chosen for the customer.
 * One answer: still a list of one, the customer chooses. No answer or no index: a
 * manual locality field appears (controlled path, nothing is invented).
 * The form data stays `postalCode` + `city`.
 */
export function PostalLocalityField({
  id, cityId, country, postalCode, city, postalDigits, autoComplete, error, cityError, onChange, onTouch, onChosen,
}: PostalLocalityFieldProps) {
  const listId = useId().replace(/:/g, '');
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const [retry, setRetry] = useState(0);
  const [manual, setManual] = useState(false);
  const [combo, dispatch] = useReducer(comboboxReducer, CLOSED_COMBOBOX);
  const cityRef = useRef(city);
  cityRef.current = city;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const deliverable = isDeliveryCountry(country);
  const key = deliverable && isValidPostalCode(country, postalCode) ? `${country}:${normalizePostalCode(country, postalCode)}` : '';

  useEffect(() => {
    setManual(false);
    if (!key) { setLookup({ status: 'idle' }); dispatch({ type: 'results', count: 0 }); return; }
    const controller = new AbortController();
    setLookup({ status: 'loading', key });
    const timer = window.setTimeout(() => {
      const [lookupCountry, lookupCode] = key.split(':') as [string, string];
      lookupPostal(lookupCountry, lookupCode, controller.signal)
        .then((cities) => {
          setLookup({ status: 'done', key, cities });
          const action = reconcileLocality(cities, cityRef.current);
          if (action.kind === 'clear') onChangeRef.current({ city: '' });
          // The list always exists (even for one locality, plus « not listed »); it only opens by itself when a choice is missing.
          const needsChoice = cities.length > 0 && (action.kind === 'clear' || (action.kind === 'keep' && !cityRef.current.trim()));
          dispatch({ type: 'results', count: cities.length > 0 ? cities.length + 1 : 0 });
          if (!needsChoice) dispatch({ type: 'close' });
        })
        .catch((failure: unknown) => {
          if ((failure as { name?: string }).name === 'AbortError') return;
          setLookup({ status: 'unavailable', key });
        });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, retry]);

  const current = lookup.status !== 'idle' && lookup.key === key ? lookup : { status: 'idle' as const };
  const cities = current.status === 'done' ? current.cities : [];
  const items: Item[] = cities.length > 0 ? [...cities, { notListed: true }] : [];
  const showManual = manual || (current.status === 'done' && cities.length === 0) || current.status === 'unavailable';
  const selected = Boolean(key && city.trim()) && !showManual;
  const text = selected ? localityLabel(normalizePostalCode(country, postalCode), city) : postalCode;
  const loading = current.status === 'loading';

  function choose(item: Item) {
    if ('notListed' in item) {
      setManual(true);
      onChange({ city: '' });
      dispatch({ type: 'close' });
      window.requestAnimationFrame(() => document.getElementById(cityId)?.focus());
      return;
    }
    onChange({ city: item.city });
    dispatch({ type: 'close' });
    onTouch('postalCode');
    onTouch('city');
    onChosen();
  }

  function onInput(raw: string) {
    // Any edit drops the previous choice: the pair is only valid for the code the customer did not change.
    const digits = deliverable ? postalDigitsFromInput(raw, postalDigits) : raw;
    onChange({ postalCode: digits, ...(city ? { city: '' } : {}) });
    if (city) dispatch({ type: 'reopen' });
  }

  const announce = loading ? ADDRESS_COPY.postalLookupLoading
    : cities.length > 0 && !selected ? ADDRESS_COPY.postalLocalityPick : '';
  const message = current.status === 'done' && cities.length === 0
    ? { tone: 'info' as const, text: ADDRESS_COPY.postalLocalityNoResult }
    : current.status === 'unavailable' ? { tone: 'info' as const, text: ADDRESS_COPY.postalLocalityUnavailable }
    : loading ? { tone: 'info' as const, text: ADDRESS_COPY.postalLookupLoading } : null;
  const pickError = !selected && !showManual && !combo.open && cities.length > 0 && cityError ? ADDRESS_COPY.postalLocalityChoose : undefined;

  return (
    <div className="flex flex-col gap-2">
      <TextField
        id={id}
        label={ADDRESS_COPY.postalLocality}
        requiredMark
        autoComplete={autoComplete}
        inputMode={deliverable ? 'numeric' : 'text'}
        enterKeyHint="next"
        maxLength={selected ? undefined : postalDigits}
        value={text}
        error={error ?? pickError}
        message={message}
        {...comboboxInputProps(listId, combo)}
        describedById={`${listId}-status`}
        onChange={(event) => onInput(event.target.value)}
        onFocus={() => dispatch({ type: 'reopen' })}
        onClick={() => dispatch({ type: 'reopen' })}
        onBlur={() => {
          onTouch('postalCode');
          if (!showManual) onTouch('city');
          dispatch({ type: 'close' });
          const normalized = normalizePostalCode(country, postalCode);
          if (!city && normalized !== postalCode) onChange({ postalCode: normalized });
        }}
        onKeyDown={(event) => {
          const action = comboboxKeyAction(event.key, combo);
          if (!action) return;
          event.preventDefault();
          if (action === 'choose') choose(items[combo.activeIndex]!);
          else dispatch(action);
        }}
      />
      <p id={`${listId}-status`} role="status" aria-live="polite" className="sr-only">{announce}</p>
      <SuggestionList
        id={listId}
        label={ADDRESS_COPY.postalLocalityPick}
        items={items}
        state={combo}
        getKey={(item) => ('notListed' in item ? '__other' : `${item.city}|${item.area ?? ''}`)}
        onChoose={choose}
        onHover={(index) => dispatch({ type: 'hover', index })}
        className="max-h-[min(18rem,40dvh)] overflow-y-auto overscroll-contain"
        render={(item) => ('notListed' in item
          ? <span className="text-[15px] font-semibold text-[color:var(--color-primary-dark)]">{ADDRESS_COPY.localityNotListed}</span>
          : (
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-gray-950">{localityLabel(normalizePostalCode(country, postalCode), item.city)}</span>
              {item.area && <span className="block text-[13px] text-gray-700">{item.area}</span>}
            </span>
          ))}
      />
      {current.status === 'unavailable' && (
        <button type="button" className="min-h-11 self-start font-bold text-[color:var(--color-primary-dark)] underline underline-offset-4"
          onClick={() => setRetry((n) => n + 1)}>
          {ADDRESS_COPY.postalLookupRetry}
        </button>
      )}
      {showManual && (
        <TextField
          id={cityId}
          label={ADDRESS_COPY.postalLocalityManual}
          requiredMark
          autoComplete="address-level2"
          maxLength={80}
          enterKeyHint="next"
          value={city}
          error={cityError}
          onChange={(event) => onChange({ city: event.target.value })}
          onBlur={() => onTouch('city')}
        />
      )}
    </div>
  );
}
