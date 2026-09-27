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
  /** Codes GeoNames de la commune résolue — conservés jusqu'à la création de campagne. */
  adminCode1: string | null;
  adminCode2: string | null;
  postalCodes: string[];
  manualPostalCode: string;
  zoneCode: string | null;
}

interface CityCandidate {
  country: string;
  city: string;
  stateName: string;
  stateCodes: string[];
  adminCode1: string | null;
  adminCode2: string | null;
  source: 'index' | 'nominatim';
  label: string;
}

interface AmbiguousOption {
  city: string;
  adminCode1: string | null;
  adminCode2: string | null;
  adminName1: string | null;
  adminName2: string | null;
  postalCodeCount: number;
  label: string;
}

type ResolveResponse =
  | { status: 'resolved'; city: string; adminCode1: string | null; adminCode2: string | null; adminName: string; postalCodes: string[] }
  | { status: 'ambiguous'; options: AmbiguousOption[] }
  | { status?: undefined; error?: string };

export function emptyCampaignDestination(country = 'IT'): CampaignDestinationRow {
  return {
    country,
    mode: 'city',
    city: '',
    stateName: '',
    stateCodes: [],
    adminCode1: null,
    adminCode2: null,
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
  const [ambiguous, setAmbiguous] = useState<AmbiguousOption[]>([]);
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
      setAmbiguous([]);
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

  async function resolveCity(
    country: string,
    city: string,
    context: { exact: true; adminCode1: string | null; adminCode2: string | null } | { exact: false; stateCodes: string[] },
    fallbackStateName: string,
  ) {
    setResolving(true);
    setError(null);
    setCandidates([]);
    setAmbiguous([]);
    try {
      const params = new URLSearchParams({ mode: 'resolve', country, city });
      if (context.exact) {
        params.set('exact', '1');
        params.set('adminCode1', context.adminCode1 ?? '');
        params.set('adminCode2', context.adminCode2 ?? '');
      } else {
        params.set('stateCodes', context.stateCodes.join(','));
      }
      const res = await fetch(`/api/admin/shipping-simulation-campaigns/city-postal-codes?${params.toString()}`);
      const data = await res.json() as ResolveResponse;
      if (res.ok && data.status === 'ambiguous') {
        // Homonymes non départageables : jamais de fusion automatique.
        setAmbiguous(data.options);
        return;
      }
      if (!res.ok || data.status !== 'resolved' || data.postalCodes.length === 0) {
        throw new Error('postal_codes_not_found');
      }

      onChange({
        ...value,
        country,
        mode: 'city',
        city: data.city,
        stateName: data.adminName || fallbackStateName,
        stateCodes: [data.adminCode2, data.adminCode1].filter((c): c is string => Boolean(c)),
        adminCode1: data.adminCode1,
        adminCode2: data.adminCode2,
        postalCodes: data.postalCodes,
        manualPostalCode: '',
      });
      setQuery(data.city);
      setEditing(false);
    } catch {
      setError('Impossible de récupérer les codes postaux de cette commune. Vous pouvez saisir un code postal manuellement.');
    } finally {
      setResolving(false);
    }
  }

  function selectCity(candidate: CityCandidate) {
    return resolveCity(
      candidate.country,
      candidate.city,
      candidate.source === 'index'
        ? { exact: true, adminCode1: candidate.adminCode1, adminCode2: candidate.adminCode2 }
        : { exact: false, stateCodes: candidate.stateCodes },
      candidate.stateName,
    );
  }

  function changeCountry(country: string) {
    setQuery('');
    setCandidates([]);
    setAmbiguous([]);
    setError(null);
    setEditing(true);
    onChange(emptyCampaignDestination(country));
  }

  function switchMode(mode: 'city' | 'postal') {
    setCandidates([]);
    setAmbiguous([]);
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
                    <p className="mt-0.5 text-xs text-gray-600">{value.postalCodes.length} code(s) postal(aux) connu(s) pour cette commune — exhaustivité non garantie</p>
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
                {(searching || resolving) && <p className="mt-1 text-xs text-gray-400">{resolving ? 'Récupération des codes postaux de la commune…' : 'Recherche…'}</p>}
                {ambiguous.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                    <p className="text-xs text-amber-800 mb-1.5">
                      Plusieurs communes portent ce nom et leur rattachement administratif ne peut pas être déduit. Choisissez la bonne commune, ou saisissez le code postal manuellement.
                    </p>
                    <div className="space-y-1">
                      {ambiguous.map((option) => (
                        <button
                          key={`${option.adminCode1 ?? ''}-${option.adminCode2 ?? ''}-${option.city}`}
                          type="button"
                          onClick={() => void resolveCity(value.country, option.city, { exact: true, adminCode1: option.adminCode1, adminCode2: option.adminCode2 }, option.adminName2 ?? option.adminName1 ?? '')}
                          className="block w-full min-h-10 rounded-md border border-amber-200 bg-white px-2.5 py-1.5 text-left text-sm hover:bg-amber-100"
                        >
                          {option.label} <span className="text-2xs text-gray-500">· {option.postalCodeCount} CAP</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
      <p className="mt-2 text-[10px] text-gray-400">Communes et codes postaux : index GeoNames interne, repli OpenStreetMap / Zippopotam.us / GeoNames. La liste des CAP reflète ces jeux de données, sans garantie d&apos;exhaustivité officielle.</p>
    </div>
  );
}
