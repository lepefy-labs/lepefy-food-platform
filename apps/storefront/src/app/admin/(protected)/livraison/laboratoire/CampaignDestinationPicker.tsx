'use client';

import { useEffect, useRef, useState } from 'react';
import { IconMapPin, IconSearch, IconX } from '@tabler/icons-react';
import type { ShippingZoneRow } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';

const COUNTRIES = [
  { value: 'IT', label: 'Italie' },
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'DE', label: 'Allemagne' },
  { value: 'CH', label: 'Suisse' },
];

export interface CampaignDestinationRow {
  country: string;
  mode: 'city' | 'postal';
  city: string;
  stateName: string;
  stateCodes: string[];
  postalCodes: string[];
  manualPostalCode: string;
  zoneCode: string | null;
}

interface CityCandidate {
  country: string;
  city: string;
  stateName: string;
  stateCodes: string[];
  label: string;
}

export function emptyCampaignDestination(country = 'IT'): CampaignDestinationRow {
  return {
    country,
    mode: 'city',
    city: '',
    stateName: '',
    stateCodes: [],
    postalCodes: [],
    manualPostalCode: '',
    zoneCode: null,
  };
}

export function CampaignDestinationPicker({
  value,
  zones,
  onChange,
  onRemove,
}: {
  value: CampaignDestinationRow;
  zones: ShippingZoneRow[];
  onChange: (next: CampaignDestinationRow) => void;
  onRemove?: () => void;
}) {
  const [query, setQuery] = useState(value.city);
  const [candidates, setCandidates] = useState<CityCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [editing, setEditing] = useState(!value.city || value.postalCodes.length === 0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (value.mode !== 'city' || !editing) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setCandidates([]);
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      setError(null);

      fetch(
        `/api/admin/shipping-simulation-campaigns/city-postal-codes?mode=search&country=${encodeURIComponent(value.country)}&q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
      )
        .then(async (res) => {
          if (!res.ok) throw new Error('search_failed');
          return res.json() as Promise<{ candidates?: CityCandidate[] }>;
        })
        .then((data) => setCandidates(data.candidates ?? []))
        .catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return;
          setCandidates([]);
          setError('Recherche de ville indisponible. Utilisez le code postal manuel si nécessaire.');
        })
        .finally(() => setSearching(false));
    }, 600);

    return () => clearTimeout(timer);
  }, [editing, query, value.country, value.mode]);

  async function selectCity(candidate: CityCandidate) {
    setResolving(true);
    setError(null);
    setCandidates([]);
    try {
      const params = new URLSearchParams({
        mode: 'resolve',
        country: candidate.country,
        city: candidate.city,
        stateCodes: candidate.stateCodes.join(','),
      });
      const res = await fetch(`/api/admin/shipping-simulation-campaigns/city-postal-codes?${params.toString()}`);
      const data = await res.json() as { postalCodes?: string[]; error?: string };
      if (!res.ok || !Array.isArray(data.postalCodes) || data.postalCodes.length === 0) {
        throw new Error(data.error ?? 'postal_codes_not_found');
      }

      onChange({
        ...value,
        country: candidate.country,
        mode: 'city',
        city: candidate.city,
        stateName: candidate.stateName,
        stateCodes: candidate.stateCodes,
        postalCodes: data.postalCodes,
        manualPostalCode: '',
      });
      setQuery(candidate.city);
      setEditing(false);
    } catch {
      setError('Impossible de récupérer tous les codes postaux de cette ville. Vous pouvez saisir un code postal manuellement.');
    } finally {
      setResolving(false);
    }
  }

  function changeCountry(country: string) {
    setQuery('');
    setCandidates([]);
    setError(null);
    setEditing(true);
    onChange(emptyCampaignDestination(country));
  }

  function switchMode(mode: 'city' | 'postal') {
    setCandidates([]);
    setError(null);
    setEditing(mode === 'city');
    setQuery('');
    onChange({
      ...emptyCampaignDestination(value.country),
      mode,
      zoneCode: value.zoneCode,
    });
  }

  const matchingZones = zones.filter((zone) => zone.country === value.country);
  const selectedCity = value.mode === 'city' && value.city && value.postalCodes.length > 0;

  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="grid gap-2 md:grid-cols-[8rem_minmax(0,1fr)_11rem_auto] md:items-start">
        <select value={value.country} onChange={(e) => changeCountry(e.target.value)} className={INPUT_CLS} aria-label="Pays">
          {COUNTRIES.map((country) => <option key={country.value} value={country.value}>{country.label}</option>)}
        </select>

        <div className="min-w-0">
          {value.mode === 'city' ? (
            selectedCity && !editing ? (
              <div className="rounded-lg border border-green-100 bg-green-50 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                      <IconMapPin size={15} stroke={1.6} />
                      {value.city}{value.stateName ? ` · ${value.stateName}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-600">{value.postalCodes.length} code(s) postal(aux) inclus automatiquement</p>
                    <p className="mt-1 truncate text-2xs text-gray-400" title={value.postalCodes.join(', ')}>
                      {value.postalCodes.slice(0, 10).join(', ')}
                      {value.postalCodes.length > 10 ? ` +${value.postalCodes.length - 10}` : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-xs font-medium text-[var(--color-primary-dark)]">
                    Modifier
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ville, ex. Milano"
                    className={`${INPUT_CLS} pl-9`}
                    autoComplete="off"
                  />
                </div>
                {(searching || resolving) && <p className="mt-1 text-xs text-gray-400">{resolving ? 'Récupération de tous les codes postaux…' : 'Recherche…'}</p>}
                {candidates.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                    {candidates.map((candidate) => (
                      <button
                        key={`${candidate.country}-${candidate.city}-${candidate.stateCodes.join('-')}`}
                        type="button"
                        onClick={() => void selectCity(candidate)}
                        className="block w-full border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 last:border-b-0"
                      >
                        {candidate.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          ) : (
            <input
              type="text"
              value={value.manualPostalCode}
              onChange={(e) => onChange({ ...value, manualPostalCode: e.target.value })}
              placeholder="Code postal"
              className={INPUT_CLS}
            />
          )}

          {error && <p className="mt-1 text-xs text-amber-700">{error}</p>}
          <button
            type="button"
            onClick={() => switchMode(value.mode === 'city' ? 'postal' : 'city')}
            className="mt-1.5 text-xs text-[var(--color-primary-dark)] underline"
          >
            {value.mode === 'city' ? 'Saisir un code postal manuellement' : 'Choisir une ville et inclure tous ses codes postaux'}
          </button>
        </div>

        <div>
          <select value={value.zoneCode ?? ''} onChange={(e) => onChange({ ...value, zoneCode: e.target.value || null })} className={INPUT_CLS} aria-label="Zone logistique">
            <option value="">Zone automatique</option>
            {matchingZones.map((zone) => <option key={zone.id} value={zone.code}>{zone.code}</option>)}
          </select>
          <p className="mt-1 text-2xs text-gray-400">Auto = résolution par CAP au lancement.</p>
        </div>

        {onRemove ? (
          <button type="button" onClick={onRemove} className="min-h-10 rounded-lg border border-gray-200 px-2 text-gray-400 hover:text-red-600" aria-label="Retirer la destination">
            <IconX size={16} />
          </button>
        ) : <span />}
      </div>

      {value.mode === 'city' && selectedCity && (
        <p className="mt-2 text-2xs text-gray-400">
          Chaque CAP devient une destination distincte ; les poids et profils sélectionnés sont testés pour chacun.
        </p>
      )}
      <p className="mt-2 text-[10px] text-gray-400">Recherche de ville via OpenStreetMap · codes postaux via Zippopotam.us / GeoNames.</p>
    </div>
  );
}
