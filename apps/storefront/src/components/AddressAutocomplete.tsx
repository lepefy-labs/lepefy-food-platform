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
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (selectedLabel) return;

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
  }, [query, country, selectedLabel]);

  const handleSelect = (result: GeocodeResult) => {
    setSelectedLabel(result.label);
    setQuery(result.label);
    setResults([]);
    setSearched(false);
    onSelect(result);
  };

  const handleReset = () => {
    setSelectedLabel(null);
    setQuery('');
    setResults([]);
    setSearched(false);
  };

  return (
    <div className="relative flex-1">
      <div className="relative">
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          readOnly={!!selectedLabel}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
        {selectedLabel && (
          <button
            type="button"
            onClick={handleReset}
            aria-label="Réinitialiser"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
          >
            ✕
          </button>
        )}
      </div>

      {!selectedLabel && results.length > 0 && (
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

      {!selectedLabel && !loading && searched && results.length === 0 && (
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
