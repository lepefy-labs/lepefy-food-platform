'use client';

import { useState } from 'react';
import { IconInfoCircle, IconCheck, IconX } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import type { ShippingProvider } from '@lepefy/types';

// Mêmes pays que le sélecteur d'adresse du panier (CartClient.tsx) et que
// ShippingCountryRulesSection.tsx — seuls pays pour lesquels un devis de
// livraison a un sens sur cette plateforme.
const COUNTRIES = [
  { value: 'IT', label: 'Italie' },
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'DE', label: 'Allemagne' },
  { value: 'CH', label: 'Suisse' },
];

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

// ─── "Comment ça marche" — bilingue FR/IT, texte simple pour Dalice ────────────

const explanationTranslations = {
  fr: {
    title: 'Comment ça marche',
    steps: [
      'Le nombre de colis = poids total du panier ÷ poids maximum par colis (réglable dans la configuration).',
      "Packlink PRO renvoie les tarifs disponibles pour cette destination ; le système choisit toujours le moins cher parmi les livraisons à domicile (les points relais et les services professionnels sont exclus).",
      'La TVA est appliquée selon la configuration du pays de destination.',
      "Le surplus d'emballage est ajouté (par colis ou par commande, selon la configuration).",
      "S'il existe une règle pour ce pays (forfait fixe, remise, ou livraison offerte au-delà d'un certain montant), elle est appliquée en dernier, sur le prix obtenu ci-dessus.",
    ],
  },
  it: {
    title: 'Come funziona',
    steps: [
      'Il numero di colli = peso totale del carrello ÷ peso massimo per collo (configurabile).',
      "Packlink PRO restituisce le tariffe disponibili per questa destinazione; il sistema sceglie sempre la più economica tra le consegne a domicilio (i punti di ritiro e i servizi per aziende vengono esclusi).",
      "L'IVA viene applicata secondo la configurazione del paese di destinazione.",
      "Il surplus di imballaggio viene aggiunto (per collo o per ordine, secondo la configurazione).",
      "Se esiste una regola per quel paese (forfait fisso, sconto, o spedizione gratuita sopra una certa soglia), viene applicata per ultima, sul prezzo ottenuto sopra.",
    ],
  },
} as const;

type ExplanationLang = keyof typeof explanationTranslations;

function ExplanationBlock() {
  const [lang, setLang] = useState<ExplanationLang>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('lepefy-admin-lang') as ExplanationLang) ?? 'fr';
    }
    return 'fr';
  });

  function switchLang(l: ExplanationLang) {
    setLang(l);
    localStorage.setItem('lepefy-admin-lang', l);
  }

  const t = explanationTranslations[lang];

  return (
    <section className="bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <IconInfoCircle size={18} stroke={1.5} className="text-blue-600 dark:text-blue-400" />
          <h2 className="text-sm font-semibold text-blue-900 dark:text-blue-200">{t.title}</h2>
        </div>
        <div className="flex gap-1">
          {(['fr', 'it'] as ExplanationLang[]).map((l) => (
            <button
              key={l}
              onClick={() => switchLang(l)}
              className={`text-xs px-2 py-1 rounded font-medium border transition-colors ${
                lang === l
                  ? 'border-blue-400 text-blue-700 bg-blue-100 dark:text-blue-200 dark:bg-blue-900'
                  : 'border-transparent text-blue-400 hover:bg-blue-100/60'
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <ol className="list-decimal list-inside space-y-1.5 text-sm text-blue-900 dark:text-blue-200">
        {t.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

// ─── Résultat API ───────────────────────────────────────────────────────────────

interface SimulatorService {
  id:                      number;
  carrierName:             string;
  serviceName:             string;
  infoLabels:              string[];
  dropoff:                 boolean;
  basePrice:               number;
  taxPrice:                number;
  vatAmount:               number;
  vatRate:                 number;
  vatSource:               'packlink' | 'db';
  packagingSurchargeTotal: number;
  priceWithPackaging:      number;
  eligible:                boolean;
  exclusionReason:         'dropoff' | 'b2b' | null;
  chosen:                  boolean;
}

interface CountryRulePayload {
  applied:                      boolean;
  rule: {
    countries:           string[];
    free_shipping_above: number | null;
    flat_rate_override:  number | null;
    discount_type:       'percentage' | 'fixed' | null;
    discount_value:      number | null;
  } | null;
  originalCost:                 number | null;
  discountApplied:              number;
  freeShippingApplied:          boolean;
  amountMissingForFreeShipping: number | null;
}

interface SeparateParcel {
  parcelIndex: number;
  weightG:     number;
  carrierName: string;
  serviceName: string;
  basePrice:   number;
  vatAmount:   number;
}

interface ComparisonPayload {
  available:       boolean;
  groupedTotal:    number | null;
  separateTotal:   number | null;
  separateParcels: SeparateParcel[] | null;
  savings:         number | null;
}

interface SimulatorResult {
  available: boolean;
  reason?:   'provider_not_packlink' | 'packlink_error' | 'no_service';
  message?:  string;
  input?: {
    weightKg: number; country: string; postalCode: string;
    totalWeightG: number; numParcels: number; packagingSurchargeTotal: number;
  };
  services?:           SimulatorService[];
  chosenServiceId?:    number | null;
  countryRule?:        CountryRulePayload;
  finalCustomerPrice?: number | null;
  comparison?:         ComparisonPayload;
}

function exclusionLabel(reason: 'dropoff' | 'b2b' | null): string {
  if (reason === 'dropoff') return 'Exclu (point relais)';
  if (reason === 'b2b') return 'Exclu (service professionnel)';
  return '';
}

// ─── Composant ────────────────────────────────────────────────────────────────

interface ShippingSimulatorProps {
  shippingProvider: ShippingProvider;
  currency:         string;
}

export function ShippingSimulator({ shippingProvider, currency }: ShippingSimulatorProps) {
  const [weightKg, setWeightKg]     = useState('1');
  const [country, setCountry]       = useState('FR');
  const [postalCode, setPostalCode] = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [result, setResult]         = useState<SimulatorResult | null>(null);

  if (shippingProvider !== 'packlink') {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {shippingProvider === 'flat_rate'
            ? 'Ce tenant utilise un tarif fixe, le simulateur Packlink ne s\'applique pas.'
            : 'Ce tenant est en retrait uniquement, le simulateur Packlink ne s\'applique pas.'}
        </p>
      </div>
    );
  }

  async function handleSubmit() {
    setError(null);
    const weight = Number(weightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      setError('Indiquez un poids supérieur à 0.');
      return;
    }
    if (!postalCode.trim()) {
      setError('Indiquez un code postal.');
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/shipping-simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weightKg: weight, country, postalCode: postalCode.trim() }),
      });
      const data = await res.json() as SimulatorResult;
      if (!res.ok) {
        setError(data.message ?? 'Erreur lors de la simulation.');
      } else {
        setResult(data);
      }
    } catch {
      setError('Erreur réseau lors de la simulation.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <ExplanationBlock />

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={LABEL_CLS}>Poids total (kg)</label>
            <input
              type="number" step="0.1" min={0.01}
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Pays</label>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={INPUT_CLS}>
              {COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Code postal</label>
            <input
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="Ex. 75001"
              className={INPUT_CLS}
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg text-xs bg-red-50 text-red-700">{error}</div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="mt-4 min-h-11 px-4 py-2 text-sm rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
        >
          {loading ? 'Calcul en cours…' : 'Calculer'}
        </button>
      </section>

      {result && !result.available && (
        <div className="px-4 py-3 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200">
          {result.message}
        </div>
      )}

      {result?.available && result.services && (
        <>
          <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 overflow-x-auto">
            <p className="text-xs text-gray-400 mb-3">
              {result.input?.numParcels} colis · surplus emballage total : {formatPrice(result.input?.packagingSurchargeTotal ?? 0, currency)}
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-3">Transporteur</th>
                  <th className="py-2 pr-3">Service</th>
                  <th className="py-2 pr-3">Prix Packlink</th>
                  <th className="py-2 pr-3">TVA</th>
                  <th className="py-2 pr-3">Prix + emballage</th>
                  <th className="py-2 pr-3">Statut</th>
                </tr>
              </thead>
              <tbody>
                {result.services.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 dark:border-gray-800/60">
                    <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300">{s.carrierName || '—'}</td>
                    <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300">{s.serviceName || '—'}</td>
                    <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300">{formatPrice(s.basePrice, currency)}</td>
                    <td className="py-2.5 pr-3 text-gray-500 dark:text-gray-400">
                      {formatPrice(s.vatAmount, currency)}
                      <span className="text-2xs text-gray-400"> ({s.vatSource === 'packlink' ? 'Packlink' : 'config. pays'})</span>
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-gray-900 dark:text-gray-100">
                      {formatPrice(s.priceWithPackaging, currency)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {s.chosen && (
                          <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-[var(--color-primary-light)] text-[var(--color-primary-dark)] flex items-center gap-0.5">
                            <IconCheck size={11} stroke={2} /> Choisi par le système
                          </span>
                        )}
                        {s.eligible ? (
                          !s.chosen && (
                            <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                              Éligible
                            </span>
                          )
                        ) : (
                          <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center gap-0.5">
                            <IconX size={11} stroke={2} /> {exclusionLabel(s.exclusionReason)}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Prix final vu par le client</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
              {result.finalCustomerPrice != null ? formatPrice(result.finalCustomerPrice, currency) : '—'}
            </p>

            {result.countryRule?.applied && (
              <div className="space-y-1.5">
                {result.countryRule.freeShippingApplied && (
                  <span className="inline-block text-2xs font-semibold px-2 py-1 rounded bg-green-50 text-green-700 mr-2">
                    Livraison offerte (règle pays)
                  </span>
                )}
                {result.countryRule.rule?.flat_rate_override != null && (
                  <span className="inline-block text-2xs font-semibold px-2 py-1 rounded bg-blue-50 text-blue-700 mr-2">
                    Forfait fixe appliqué : {formatPrice(result.countryRule.rule.flat_rate_override, currency)}
                  </span>
                )}
                {result.countryRule.discountApplied > 0 && (
                  <span className="inline-block text-2xs font-semibold px-2 py-1 rounded bg-purple-50 text-purple-700 mr-2">
                    Remise appliquée : -{formatPrice(result.countryRule.discountApplied, currency)}
                  </span>
                )}
                {!result.countryRule.freeShippingApplied && result.countryRule.amountMissingForFreeShipping != null && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Livraison offerte à partir de {formatPrice(result.countryRule.amountMissingForFreeShipping, currency)} de panier
                    (le simulateur ne modélise pas de panier — ce montant est le seuil brut de la règle).
                  </p>
                )}
              </div>
            )}

            {!result.countryRule?.applied && (
              <p className="text-xs text-gray-400">Aucune règle pays spécifique — calcul standard.</p>
            )}
          </section>

          {result.comparison && (result.input?.numParcels ?? 0) > 1 && (
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-3">
                Comparaison : envoi groupé vs colis séparés
              </p>

              {!result.comparison.available && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Comparaison indisponible : un des colis n&apos;a aucun service éligible séparément.
                </p>
              )}

              {result.comparison.available && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div
                      className={`rounded-lg border p-3 ${
                        result.comparison.savings != null && result.comparison.savings < 0
                          ? 'border-green-300 bg-green-50 dark:bg-green-950/30'
                          : 'border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      <p className="text-2xs uppercase tracking-wide text-gray-400 mb-1">Groupé (actuel)</p>
                      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {result.comparison.groupedTotal != null ? formatPrice(result.comparison.groupedTotal, currency) : '—'}
                      </p>
                    </div>
                    <div
                      className={`rounded-lg border p-3 ${
                        result.comparison.savings != null && result.comparison.savings > 0
                          ? 'border-green-300 bg-green-50 dark:bg-green-950/30'
                          : 'border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      <p className="text-2xs uppercase tracking-wide text-gray-400 mb-1">Colis séparés</p>
                      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                        {result.comparison.separateTotal != null ? formatPrice(result.comparison.separateTotal, currency) : '—'}
                      </p>
                      <ul className="space-y-1">
                        {result.comparison.separateParcels?.map((p) => (
                          <li key={p.parcelIndex} className="text-2xs text-gray-500 dark:text-gray-400">
                            Colis {p.parcelIndex + 1} ({(p.weightG / 1000).toFixed(2)} kg) — {p.carrierName || '—'} · {p.serviceName || '—'} —{' '}
                            {formatPrice(p.basePrice + p.vatAmount, currency)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {result.comparison.savings != null && (
                    <p className={`text-sm font-medium ${result.comparison.savings > 0 ? 'text-green-700' : 'text-gray-500 dark:text-gray-400'}`}>
                      {result.comparison.savings > 0
                        ? `Économie potentielle : ${formatPrice(result.comparison.savings, currency)}`
                        : 'Le groupé reste plus économique.'}
                    </p>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
