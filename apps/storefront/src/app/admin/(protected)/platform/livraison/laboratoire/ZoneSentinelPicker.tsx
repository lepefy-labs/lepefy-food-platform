'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ShippingScenarioDestination, ShippingZoneRow } from '@lepefy/types';

const UNZONED_KEY = '__sans_zone__';

interface SentinelPlan {
  zoneCode: string | null;
  candidates: number;
  sentinels: Array<{ postalCode: string; city: string; adminCode2: string | null }>;
  excludedGeneric: number;
  excludedRejected: number;
}

/**
 * « Couverture par zone » : propose automatiquement 1 à 3 CAP témoins par zone
 * tarifaire active (index GeoNames, hors CAP génériques et CAP déjà refusés
 * par Packlink). Aucun appel Packlink ici : seulement la liste de destinations
 * que la campagne mesurera.
 */
export function ZoneSentinelPicker({
  zones,
  onChange,
}: {
  zones: ShippingZoneRow[];
  onChange: (destinations: ShippingScenarioDestination[], sentinelsPerZone: number) => void;
}) {
  const countries = useMemo(() => Array.from(new Set(zones.map((z) => z.country.toUpperCase()))).sort(), [zones]);
  const [country, setCountry] = useState(countries[0] ?? 'IT');
  const [perZone, setPerZone] = useState(2);
  const [includeUnzoned, setIncludeUnzoned] = useState(false);
  const [plans, setPlans] = useState<SentinelPlan[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPlan() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ country, perZone: String(perZone), includeUnzoned: includeUnzoned ? '1' : '0' });
      const res = await fetch(`/api/admin/shipping-simulation-campaigns/zone-sentinels?${params.toString()}`);
      const data = await res.json() as { zones?: SentinelPlan[]; error?: string };
      if (!res.ok || !data.zones) throw new Error(data.error ?? 'Erreur');
      setPlans(data.zones);
      setSelected(new Set(data.zones.filter((z) => z.sentinels.length > 0 && z.zoneCode !== null).map((z) => z.zoneCode ?? UNZONED_KEY)));
    } catch (err) {
      setPlans(null);
      setError(err instanceof Error ? err.message : 'Impossible de proposer les CAP témoins.');
    } finally {
      setLoading(false);
    }
  }

  // Invalidate the proposal when its parameters change.
  useEffect(() => { setPlans(null); setSelected(new Set()); }, [country, perZone, includeUnzoned]);

  useEffect(() => {
    const destinations: ShippingScenarioDestination[] = (plans ?? [])
      .filter((plan) => selected.has(plan.zoneCode ?? UNZONED_KEY))
      .flatMap((plan) => plan.sentinels.map((s) => ({
        country,
        postalCode: s.postalCode,
        zoneCode: plan.zoneCode,
        city: s.city,
        adminCode2: s.adminCode2,
        label: `${s.city} · ${s.postalCode}`,
      })));
    onChange(destinations, perZone);
    // onChange est stable côté parent (setter) ; on ne dépend que des données.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, selected, country, perZone]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (zones.length === 0) {
    return <p className="text-xs text-amber-700">Aucune zone active : configurez les zones dans « Tarification » pour utiliser la couverture par zone.</p>;
  }

  const selectedCount = (plans ?? []).filter((p) => selected.has(p.zoneCode ?? UNZONED_KEY)).reduce((sum, p) => sum + p.sentinels.length, 0);

  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-3">
      <p className="text-xs text-gray-500">
        Les devis Packlink sont identiques pour tous les CAP d&apos;une même zone (le prix dépend du poids et des dimensions).
        On mesure donc quelques CAP témoins par zone, choisis automatiquement et répartis dans la zone.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">
          Pays
          <select value={country} onChange={(e) => setCountry(e.target.value)} className="mt-0.5 block border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-900">
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          CAP témoins par zone
          <select value={perZone} onChange={(e) => setPerZone(Number(e.target.value))} className="mt-0.5 block border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-900">
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-2">
          <input type="checkbox" checked={includeUnzoned} onChange={(e) => setIncludeUnzoned(e.target.checked)} />
          Inclure les CAP hors zone
        </label>
        <button type="button" onClick={() => void loadPlan()} disabled={loading} className="min-h-10 px-3 py-1.5 text-xs rounded-lg border border-[var(--color-primary)] text-[var(--color-primary-dark)] disabled:opacity-50">
          {loading ? 'Préparation…' : plans ? 'Recalculer' : 'Proposer les CAP témoins'}
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {plans && (
        <>
          <p className="text-2xs text-gray-400">{selectedCount} CAP témoin(s) sélectionné(s). CAP génériques d&apos;avant réforme et CAP déjà refusés par Packlink exclus automatiquement.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="py-1.5 pr-2" /><th className="py-1.5 pr-3">Zone</th><th className="py-1.5 pr-3">CAP témoins</th><th className="py-1.5 pr-3">CAP connus</th><th className="py-1.5 pr-3">Exclus</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => {
                  const key = plan.zoneCode ?? UNZONED_KEY;
                  const disabled = plan.sentinels.length === 0;
                  return (
                    <tr key={key} className={`border-b border-gray-50 align-top ${disabled ? 'opacity-50' : ''}`}>
                      <td className="py-1.5 pr-2">
                        <input type="checkbox" aria-label={`Inclure ${plan.zoneCode ?? 'hors zone'}`} checked={selected.has(key)} disabled={disabled} onChange={() => toggle(key)} />
                      </td>
                      <td className="py-1.5 pr-3 font-medium">{plan.zoneCode ?? 'Hors zone'}</td>
                      <td className="py-1.5 pr-3 text-gray-600">
                        {plan.sentinels.length === 0 ? '—' : plan.sentinels.map((s) => `${s.postalCode} ${s.city}`).join(' · ')}
                      </td>
                      <td className="py-1.5 pr-3 text-gray-400">{plan.candidates}</td>
                      <td className="py-1.5 pr-3 text-2xs text-gray-400">
                        {[plan.excludedGeneric > 0 ? `${plan.excludedGeneric} génériques` : null, plan.excludedRejected > 0 ? `${plan.excludedRejected} refusés` : null].filter(Boolean).join(' · ') || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
