'use client';

import { useState } from 'react';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'Élevée', medium: 'Moyenne', low: 'Faible', insufficient_data: 'Données insuffisantes',
};
const CONFIDENCE_CLS: Record<string, string> = {
  high: 'bg-green-50 text-green-700', medium: 'bg-amber-50 text-amber-700',
  low: 'bg-red-50 text-red-700', insufficient_data: 'bg-gray-100 text-gray-500',
};

interface CarrierEstimation {
  carrier: string;
  sampleSize: number;
  confidence: string;
  minCost: number;
  medianCost: number;
  maxCost: number;
  freshnessDays: number;
}

interface Recommendation {
  packagingProfileId: string;
  packagingProfileName: string;
  sampleSize: number;
  confidence: string;
  minCost: number | null;
  medianCost: number | null;
  maxCost: number | null;
  freshnessDays: number | null;
  nextBoundary: { deltaKg: number; nextCost: number } | null;
  recommended: boolean;
  costDeltaVsRecommended: number | null;
  byCarrier: CarrierEstimation[];
  boxDimensions: { length: number; width: number; height: number };
  parcelWeightsG: number[];
}

function formatParcels(parcelWeightsG: number[]): string {
  const kg = parcelWeightsG.map((g) => g / 1000);
  if (kg.length === 1) return `1 colis de ${kg[0]!.toFixed(1)} kg`;
  const allEqual = kg.every((w) => Math.abs(w - kg[0]!) < 0.01);
  return allEqual
    ? `${kg.length} colis × ${kg[0]!.toFixed(1)} kg`
    : `${kg.length} colis (${kg.map((w) => w.toFixed(1)).join(' + ')} kg)`;
}

export function AssistantClient() {
  const [weightKg, setWeightKg] = useState('');
  const [country, setCountry] = useState('IT');
  const [postalCode, setPostalCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);

  async function handleSubmit() {
    setError(null);
    setRecommendations(null);
    if (!weightKg || Number(weightKg) <= 0) { setError('Poids invalide.'); return; }
    if (!postalCode.trim()) { setError('Code postal requis.'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/shipping-advisor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weightKg: Number(weightKg), country, postalCode: postalCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      setRecommendations(data.recommendations as Recommendation[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du calcul.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Quel emballage choisir pour cette expédition ?</h2>

      {error && <div className="mb-4 px-3 py-2 rounded-lg text-xs bg-red-50 text-red-700">{error}</div>}

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div><label className={LABEL_CLS}>Poids (kg)</label><input type="number" step="0.1" min={0.1} value={weightKg} onChange={(e) => setWeightKg(e.target.value)} className={`${INPUT_CLS} w-28`} /></div>
        <div><label className={LABEL_CLS}>Pays</label>
          <select value={country} onChange={(e) => setCountry(e.target.value)} className={`${INPUT_CLS} w-32`}>
            <option value="IT">Italie</option><option value="FR">France</option><option value="BE">Belgique</option><option value="DE">Allemagne</option><option value="CH">Suisse</option>
          </select>
        </div>
        <div><label className={LABEL_CLS}>Code postal</label><input type="text" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className={`${INPUT_CLS} w-32`} /></div>
        <button onClick={() => void handleSubmit()} disabled={loading} className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50">{loading ? 'Analyse…' : 'Analyser'}</button>
      </div>

      {recommendations && (
        <div className="space-y-3">
          {recommendations.map((r) => (
            <div key={r.packagingProfileId} className={`rounded-xl border p-4 ${r.recommended ? 'border-[var(--color-primary)]' : 'border-gray-200 dark:border-gray-800'}`}>
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {r.packagingProfileName} <span className="font-normal text-gray-400">({r.boxDimensions.length}×{r.boxDimensions.width}×{r.boxDimensions.height} cm)</span>
                </p>
                <div className="flex items-center gap-2">
                  {r.recommended && <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]">RECOMMANDÉ</span>}
                  <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${CONFIDENCE_CLS[r.confidence] ?? ''}`}>{CONFIDENCE_LABEL[r.confidence] ?? r.confidence}</span>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-2">{formatParcels(r.parcelWeightsG)} — prix ci-dessous pour l&apos;expédition complète</p>
              {!r.recommended && r.costDeltaVsRecommended != null && r.costDeltaVsRecommended > 0 && (
                <p className="text-xs text-gray-400 mb-2">+{r.costDeltaVsRecommended.toFixed(2)} € vs le meilleur transporteur recommandé</p>
              )}

              {r.byCarrier.length > 0 ? (
                <div className="space-y-1.5">
                  {r.byCarrier.map((c, i) => (
                    <div key={c.carrier} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm ${i === 0 ? 'bg-[var(--color-primary-light)]/40' : 'bg-gray-50 dark:bg-gray-800/40'}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-2xs font-semibold text-gray-400 w-4 shrink-0">#{i + 1}</span>
                        <span className="truncate text-gray-700 dark:text-gray-200">{c.carrier}</span>
                        <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded shrink-0 ${CONFIDENCE_CLS[c.confidence] ?? ''}`}>{CONFIDENCE_LABEL[c.confidence] ?? c.confidence}</span>
                      </div>
                      <div className="text-right shrink-0 pl-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{c.medianCost.toFixed(2)} €</span>
                        <span className="text-gray-400"> ({c.minCost.toFixed(2)}–{c.maxCost.toFixed(2)})</span>
                        <span className="text-gray-400"> · {c.sampleSize} obs.</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">Pas assez d&apos;observations pour ce profil et cette destination — demandez un devis Packlink à jour.</p>
              )}
              {r.nextBoundary && (
                <p className="text-xs text-gray-500 mt-2">
                  Vous pouvez ajouter environ <b>{r.nextBoundary.deltaKg} kg</b> avant d&apos;atteindre le prochain palier de coût observé ({r.nextBoundary.nextCost.toFixed(2)} €).
                </p>
              )}
            </div>
          ))}
          <p className="text-xs text-gray-400 pt-2">Estimation basée sur l&apos;historique — jamais un prix garanti. Demandez un devis Packlink à jour avant une expédition réelle.</p>
        </div>
      )}
    </section>
  );
}
