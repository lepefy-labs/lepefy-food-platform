'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { IconMapPin, IconSearch, IconX } from '@tabler/icons-react';
import { TextField } from '@/components/ui/form';
import { CLOSED_COMBOBOX, comboboxKeyAction, comboboxReducer } from '@/components/ui/form/comboboxState';
import { SuggestionList, comboboxInputProps } from '@/components/ui/form/SuggestionList';
import { addressExample } from '@/lib/address/addressRules';
import type { AddressSuggestion } from '@/lib/address/geocodeSearch';
import { ADDRESS_COPY, searchResultsAnnouncement } from '@/lib/storefrontCopy/addressCopy';

type SearchStatus = 'idle' | 'loading' | 'results' | 'empty' | 'unavailable';

const MIN_QUERY = 4;
const DEBOUNCE_MS = 350;

/**
 * « Recherche rapide » facultative : propose des adresses qui remplissent les
 * champs. Ne valide rien et ne bloque rien ; en cas d'échec le client écrit
 * son adresse dans les champs, toujours visibles en dessous.
 */
export function AddressSearch({
  id,
  country,
  onPick,
}: {
  id: string;
  country: string;
  onPick: (suggestion: AddressSuggestion) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [combobox, dispatch] = useReducer(comboboxReducer, CLOSED_COMBOBOX);
  const abortRef = useRef<AbortController | null>(null);
  const pickedRef = useRef<string | null>(null);
  const listId = `${id}-list`;
  const statusId = `${id}-status`;
  const example = addressExample(country);

  useEffect(() => {
    const trimmed = query.trim();
    if (pickedRef.current === trimmed) return;
    abortRef.current?.abort();
    if (trimmed.length < MIN_QUERY) {
      setResults([]);
      setStatus('idle');
      dispatch({ type: 'results', count: 0 });
      return;
    }
    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus('loading');
      fetch(`/api/geocode/search?q=${encodeURIComponent(trimmed)}&country=${encodeURIComponent(country)}`, { signal: controller.signal })
        .then((res) => res.json() as Promise<{ results?: AddressSuggestion[]; unavailable?: boolean }>)
        .then((data) => {
          const list = Array.isArray(data.results) ? data.results : [];
          setResults(list);
          setStatus(data.unavailable ? 'unavailable' : list.length > 0 ? 'results' : 'empty');
          dispatch({ type: 'results', count: list.length });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setResults([]);
          setStatus('unavailable');
          dispatch({ type: 'results', count: 0 });
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, country]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function choose(suggestion: AddressSuggestion) {
    const label = [suggestion.primary, suggestion.secondary].filter(Boolean).join(', ');
    pickedRef.current = label;
    setQuery(label);
    setResults([]);
    setStatus('idle');
    dispatch({ type: 'results', count: 0 });
    onPick(suggestion);
  }

  function clear() {
    pickedRef.current = null;
    setQuery('');
    setResults([]);
    setStatus('idle');
    dispatch({ type: 'results', count: 0 });
    document.getElementById(id)?.focus();
  }

  const announcement = status === 'loading'
    ? ADDRESS_COPY.searchLoading
    : status === 'results' ? searchResultsAnnouncement(results.length)
      : status === 'empty' ? ADDRESS_COPY.searchNoResults
        : status === 'unavailable' ? ADDRESS_COPY.searchUnavailable : '';

  return (
    <div className="flex flex-col gap-2">
      <TextField
        id={id}
        label={ADDRESS_COPY.searchLabel}
        optional
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={`Ex. : ${example.street} ${example.houseNumber}, ${example.city}`}
        value={query}
        hint={status === 'idle' ? ADDRESS_COPY.searchHint : undefined}
        describedById={statusId}
        leading={<IconSearch size={20} stroke={2} />}
        trailing={status === 'loading'
          ? <span className="mr-1.5 h-5 w-5 rounded-full border-[2.5px] border-gray-300 motion-safe:animate-spin" style={{ borderTopColor: 'var(--color-primary)' }} aria-hidden="true" />
          : query
            ? (
              <button type="button" onClick={clear} aria-label={ADDRESS_COPY.searchClear}
                className="flex h-10 w-10 items-center justify-center rounded-full text-[color:var(--field-ink)] hover:bg-gray-100">
                <IconX size={18} stroke={2.2} aria-hidden="true" />
              </button>
            )
            : null}
        onChange={(event) => {
          pickedRef.current = null;
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          const action = comboboxKeyAction(event.key, combobox);
          if (!action) return;
          event.preventDefault();
          if (action === 'choose') {
            const item = results[combobox.activeIndex];
            if (item) choose(item);
          } else {
            dispatch(action);
          }
        }}
        onBlur={() => dispatch({ type: 'close' })}
        onFocus={() => dispatch({ type: 'reopen' })}
        {...comboboxInputProps(listId, combobox)}
      />

      <p id={statusId} role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <SuggestionList
        id={listId}
        label={ADDRESS_COPY.searchLabel}
        items={results}
        state={combobox}
        getKey={(item) => `${item.primary}|${item.secondary}`}
        onHover={(index) => dispatch({ type: 'hover', index })}
        onChoose={choose}
        render={(item) => (
          <>
            <IconMapPin size={20} stroke={1.8} className="mt-0.5 shrink-0 text-gray-600" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-gray-950">{item.primary}</span>
              <span className="block text-[13px] text-gray-700">
                {item.secondary}
                {!item.houseNumber && <> · {ADDRESS_COPY.noHouseNumberResult}</>}
              </span>
            </span>
          </>
        )}
      />

      {status === 'results' && combobox.open && <p className="sf-hint">{ADDRESS_COPY.searchNotInList}</p>}
      {(status === 'empty' || status === 'unavailable') && (
        <p className="rounded-xl border border-gray-200 bg-gray-100 px-3.5 py-2.5 text-sm text-gray-800">
          {status === 'empty' ? ADDRESS_COPY.searchNoResults : ADDRESS_COPY.searchUnavailable}
        </p>
      )}
    </div>
  );
}
