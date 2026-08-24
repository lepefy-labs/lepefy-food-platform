'use client';

import { useEffect, useRef, useState } from 'react';

interface AddressAutocompleteProps {
  country: string;
  placeholder?: string;
  onSelect: (result: { street: string; houseNumber: string; city: string; postalCode: string; country: string; label: string }) => void;
  onManualFallback?: () => void;
}

interface GeocodeResult {
  label: string;
  street: string;
  houseNumber: string;
  city: string;
  postalCode: string;
  country: string;
}

function normalizeResult(result: GeocodeResult): GeocodeResult {
  if (result.houseNumber.trim()) return result;

  const prefix = result.label.match(/^\s*([0-9]+[A-Za-z0-9\/-]*)\s*,\s*(.+)$/);
  if (!prefix) return result;

  const inferredNumber = prefix[1]?.trim() ?? '';
  const remainder = prefix[2]?.trim() ?? '';
  if (!inferredNumber) return result;

  return {
    ...result,
    houseNumber: inferredNumber,
    street: result.street.trim() || remainder.split(',')[0]?.trim() || remainder,
  };
}

export default function AddressAutocomplete({
  country,
  placeholder = 'Rue et numéro, ville',
  onSelect,
  onManualFallback,
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<GeocodeResult | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (selected) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length < 3) {
      setResults([]);
      setSearched(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      fetch(
        `/api/geocode/search?q=${encodeURIComponent(query)}&country=${encodeURIComponent(country)}`,
        { signal: controller.signal },
      )
        .then((res) => res.json())
        .then((data: { results: GeocodeResult[] }) => {
          setResults(data.results ?? []);
          setSearched(true);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            setResults([]);
            setSearched(true);
          }
        })
        .finally(() => setLoading(false));
    }, 450);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, country, selected]);

  const handleSelect = (result: GeocodeResult) => {
    const normalized = normalizeResult(result);
    setSelected(normalized);
    setQuery(normalized.label);
    setResults([]);
    setSearched(false);
    onSelect(normalized);
  };

  const handleReset = () => {
    setSelected(null);
    setQuery('');
    setResults([]);
    setSearched(false);
  };

  if (selected) {
    return (
      <div data-address-selected="true" className="rounded-2xl border border-green-100 bg-green-50 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-green-800">Adresse validée</p>
            <p className="mt-1 text-sm font-semibold leading-snug text-gray-950">
              {selected.street}{selected.houseNumber ? ` ${selected.houseNumber}` : ''}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
              {[selected.postalCode, selected.city, selected.country].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:bg-white"
          >
            Modifier
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1">
      <div className="relative">
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>

      {results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {results.map((result, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSelect(result)}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
            >
              {result.label}
            </button>
          ))}
          <p className="text-[10px] text-gray-400 px-3 py-1.5 bg-gray-50">
            Recherche via OpenStreetMap
          </p>
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="mt-1.5 text-xs text-gray-400">
          Aucune adresse trouvée — vous pouvez{' '}
          <button
            type="button"
            onClick={onManualFallback}
            className="underline text-[var(--color-primary)]"
          >
            saisir le code postal manuellement
          </button>
        </div>
      )}
    </div>
  );
}
