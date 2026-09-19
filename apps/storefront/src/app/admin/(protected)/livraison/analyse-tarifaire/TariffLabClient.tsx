'use client';

import { useState } from 'react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { ShippingTariffBand, ShippingTariffDraftRow } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface BacktestMetrics {
  sampleSize: number; avgProviderCost: number | null; medianProviderCost: number | null;
  p90ProviderCost: number | null; p95ProviderCost: number | null; avgMargin: number | null;
  negativeMarginPct: number | null; maxLoss: number | null; aggregateMargin: number | null;
}

function emptyBand(): ShippingTariffBand { return { minKg: 0, maxKg: null, price: 0 }; }

export function TariffLabClient({ initialDrafts }: { initialDrafts: ShippingTariffDraftRow[] }) {
  const [drafts, setDrafts] = useState<ShippingTariffDraftRow[]>(initialDrafts);
  const [selectedId, setSelectedId] = useState<string | null>(initialDrafts[0]?.id ?? null);
  const selected = drafts.find((d) => d.id === selectedId) ?? null;

  const [name, setName] = useState('Nouveau brouillon');
  const [bands, setBands] = useState<ShippingTariffBand[]>(selected?.bands ?? [{ minKg: 0, maxKg: 10, price: 10.5 }, { minKg: 10, maxKg: 15, price: 12.5 }]);
  const [zoneSurchargesText, setZoneSurchargesText] = useState(
    selected ? Object.entries(selected.zone_surcharges).map(([k, v]) => `${k}=${v}`).join(', ') : 'IT_SICILY=2',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [results, setResults] = useState<{ scenarioWeighted: BacktestMetrics; orderWeighted: BacktestMetrics; orderWeightedReliable: boolean } | null>(null);

  function parseZoneSurcharges(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const pair of zoneSurchargesText.split(',')) {
      const [key, value] = pair.split('=').map((s) => s.trim());
      if (key && value && Number.isFinite(Number(value))) out[key] = Number(value);
    }
    return out;
  }

  async function handleSave() {
    setError(null);
    if (bands.length === 0) { setError('Ajoutez au moins une bande de poids.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/shipping-tariff-drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bands, zone_surcharges: parseZoneSurcharges() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      setDrafts((prev) => [data as ShippingTariffDraftRow, ...prev]);
      setSelectedId((data as ShippingTariffDraftRow).id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSimulate(draftId: string) {
    setSimulating(true);
    setResults(null);
    try {
      const res = await fetch(`/api/admin/shipping-tariff-drafts/${draftId}/simulate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la simulation.');
    } finally {
      setSimulating(false);
    }
  }

  function renderMetrics(label: string, metrics: BacktestMetrics, warn?: boolean) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{label} <span className="normal-case font-normal text-gray-400">(n = {metrics.sampleSize})</span></h3>
        {warn && <p className="text-xs text-amber-600 mb-2">Échantillon faible — interpréter avec prudence.</p>}
        {metrics.sampleSize === 0 ? (
          <p className="text-sm text-gray-400">Aucune donnée disponible.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><p className="text-2xs text-gray-400">Coût moyen</p><p className="font-medium">{metrics.avgProviderCost?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400">Médiane</p><p className="font-medium">{metrics.medianProviderCost?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400">P90</p><p className="font-medium">{metrics.p90ProviderCost?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400">P95</p><p className="font-medium">{metrics.p95ProviderCost?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400">Marge moyenne</p><p className={`font-medium ${((metrics.avgMargin ?? 0) < 0) ? 'text-red-600' : 'text-green-600'}`}>{metrics.avgMargin?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400">% marge négative</p><p className="font-medium">{metrics.negativeMarginPct}%</p></div>
            <div><p className="text-2xs text-gray-400">Perte max</p><p className="font-medium text-red-600">{metrics.maxLoss?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400">Marge agrégée</p><p className="font-medium">{metrics.aggregateMargin?.toFixed(2)} €</p></div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {drafts.length > 0 && (
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h2 className="text-sm font-semibold mb-3">Brouillons existants</h2>
          <div className="flex flex-wrap gap-2">
            {drafts.map((d) => (
              <button key={d.id} onClick={() => { setSelectedId(d.id); void handleSimulate(d.id); }} className={`text-xs px-3 py-1.5 rounded-lg border ${selectedId === d.id ? 'border-[var(--color-primary)] text-[var(--color-primary-dark)]' : 'border-gray-200 text-gray-500'}`}>
                {d.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold mb-4">Nouveau brouillon</h2>
        {error && <div className="mb-4 px-3 py-2 rounded-lg text-xs bg-red-50 text-red-700">{error}</div>}

        <div className="mb-4">
          <label className={LABEL_CLS}>Nom</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} />
        </div>

        <div className="mb-4">
          <label className={LABEL_CLS}>Bandes de poids</label>
          <div className="space-y-2">
            {bands.map((band, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="number" step="0.1" value={band.minKg} onChange={(e) => setBands((prev) => prev.map((b, idx) => idx === i ? { ...b, minKg: Number(e.target.value) } : b))} placeholder="Min kg" className={`${INPUT_CLS} w-24`} />
                <span className="text-xs text-gray-400">à</span>
                <input type="number" step="0.1" value={band.maxKg ?? ''} onChange={(e) => setBands((prev) => prev.map((b, idx) => idx === i ? { ...b, maxKg: e.target.value === '' ? null : Number(e.target.value) } : b))} placeholder="Max kg (vide = illimité)" className={`${INPUT_CLS} w-40`} />
                <span className="text-xs text-gray-400">=</span>
                <input type="number" step="0.01" value={band.price} onChange={(e) => setBands((prev) => prev.map((b, idx) => idx === i ? { ...b, price: Number(e.target.value) } : b))} placeholder="Prix €" className={`${INPUT_CLS} w-28`} />
                <button onClick={() => setBands((prev) => prev.filter((_, idx) => idx !== i))} className="text-red-500"><IconTrash size={14} stroke={1.5} /></button>
              </div>
            ))}
          </div>
          <button onClick={() => setBands((prev) => [...prev, emptyBand()])} className="mt-2 text-xs text-[var(--color-primary-dark)] flex items-center gap-1"><IconPlus size={13} stroke={1.5} />Ajouter une bande</button>
        </div>

        <div className="mb-4">
          <label className={LABEL_CLS}>Surcharges de zone (code=montant, séparés par des virgules)</label>
          <input type="text" value={zoneSurchargesText} onChange={(e) => setZoneSurchargesText(e.target.value)} className={INPUT_CLS} placeholder="IT_SICILY=2" />
        </div>

        <button onClick={() => void handleSave()} disabled={saving} className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer et rétrotester'}</button>
      </section>

      {simulating && <p className="text-sm text-gray-400">Calcul du rétrotest…</p>}

      {results && (
        <section className="space-y-4">
          {renderMetrics('Scénarios synthétiques (laboratoire)', results.scenarioWeighted)}
          {renderMetrics('Commandes réelles', results.orderWeighted, !results.orderWeightedReliable)}
          <p className="text-xs text-gray-400">
            Les deux métriques ne sont jamais moyennées ensemble — les commandes réelles reflètent la distribution effective, les scénarios synthétiques une grille de test uniforme.
          </p>
        </section>
      )}
    </div>
  );
}
