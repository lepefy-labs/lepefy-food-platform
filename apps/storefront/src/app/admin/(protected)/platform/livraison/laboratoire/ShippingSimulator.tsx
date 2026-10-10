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
  'w-full border border-a-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-a-focus focus:border-transparent bg-a-surface text-a-text';
const LABEL_CLS = 'text-a-text-3 text-xs uppercase tracking-wide mb-0.5 block';

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
    <section className="bg-tone-info-bg border border-tone-info-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <IconInfoCircle size={18} stroke={1.5} className="text-tone-info-fg" />
          <h2 className="text-sm font-semibold text-tone-info-fg">{t.title}</h2>
        </div>
        <div className="flex gap-1">
          {(['fr', 'it'] as ExplanationLang[]).map((l) => (
            <button
              key={l}
              onClick={() => switchLang(l)}
              className={`text-xs px-2 py-1 rounded font-medium border transition-colors ${
                lang === l
                  ? 'border-tone-info-solid text-tone-info-fg bg-tone-info-bg'
                  : 'border-transparent text-tone-info-fg hover:bg-tone-info-bg'
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <ol className="list-decimal list-inside space-y-1.5 text-sm text-tone-info-fg">
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
      <div className="bg-a-surface rounded-xl border border-a-border p-5">
        <p className="text-sm text-a-text-2">
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

      <section className="bg-a-surface rounded-xl border border-a-border p-5">
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
          <div className="mt-3 px-3 py-2 rounded-lg text-xs bg-tone-danger-bg text-tone-danger-fg">{error}</div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="mt-4 min-h-11 px-4 py-2 text-sm rounded-lg text-a-on-brand bg-a-brand disabled:opacity-50"
        >
          {loading ? 'Calcul en cours…' : 'Calculer'}
        </button>
      </section>

      {result && !result.available && (
        <div className="px-4 py-3 rounded-lg text-sm bg-tone-warning-bg text-tone-warning-fg border border-tone-warning-border">
          {result.message}
        </div>
      )}

      {result?.available && result.services && (
        <>
          <section className="bg-a-surface rounded-xl border border-a-border p-5 overflow-x-auto">
            <p className="text-xs text-a-text-3 mb-3">
              {result.input?.numParcels} colis · surplus emballage total : {formatPrice(result.input?.packagingSurchargeTotal ?? 0, currency)}
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-a-text-3 uppercase tracking-wide border-b border-a-border">
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
                  <tr key={s.id} className="border-b border-a-border">
                    <td className="py-2.5 pr-3 text-a-text-2">{s.carrierName || '—'}</td>
                    <td className="py-2.5 pr-3 text-a-text-2">{s.serviceName || '—'}</td>
                    <td className="py-2.5 pr-3 text-a-text-2">{formatPrice(s.basePrice, currency)}</td>
                    <td className="py-2.5 pr-3 text-a-text-3">
                      {formatPrice(s.vatAmount, currency)}
                      <span className="text-xs text-a-text-3"> ({s.vatSource === 'packlink' ? 'Packlink' : 'config. pays'})</span>
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-a-text">
                      {formatPrice(s.priceWithPackaging, currency)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {s.chosen && (
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-a-brand-soft text-a-brand-fg flex items-center gap-0.5">
                            <IconCheck size={11} stroke={2} /> Choisi par le système
                          </span>
                        )}
                        {s.eligible ? (
                          !s.chosen && (
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-tone-success-bg text-tone-success-fg">
                              Éligible
                            </span>
                          )
                        ) : (
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-a-hover text-a-text-3 flex items-center gap-0.5">
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

          <section className="bg-a-surface rounded-xl border border-a-border p-5">
            <p className="text-xs uppercase tracking-wide text-a-text-3 mb-1">Prix final vu par le client</p>
            <p className="text-2xl font-semibold text-a-text mb-3">
              {result.finalCustomerPrice != null ? formatPrice(result.finalCustomerPrice, currency) : '—'}
            </p>

            {result.countryRule?.applied && (
              <div className="space-y-1.5">
                {result.countryRule.freeShippingApplied && (
                  <span className="inline-block text-xs font-semibold px-2 py-1 rounded bg-tone-success-bg text-tone-success-fg mr-2">
                    Livraison offerte (règle pays)
                  </span>
                )}
                {result.countryRule.rule?.flat_rate_override != null && (
                  <span className="inline-block text-xs font-semibold px-2 py-1 rounded bg-tone-info-bg text-tone-info-fg mr-2">
                    Forfait fixe appliqué : {formatPrice(result.countryRule.rule.flat_rate_override, currency)}
                  </span>
                )}
                {result.countryRule.discountApplied > 0 && (
                  <span className="inline-block text-xs font-semibold px-2 py-1 rounded bg-a-brand-soft text-a-brand-fg mr-2">
                    Remise appliquée : -{formatPrice(result.countryRule.discountApplied, currency)}
                  </span>
                )}
                {!result.countryRule.freeShippingApplied && result.countryRule.amountMissingForFreeShipping != null && (
                  <p className="text-xs text-a-text-3">
                    Livraison offerte à partir de {formatPrice(result.countryRule.amountMissingForFreeShipping, currency)} de panier
                    (le simulateur ne modélise pas de panier — ce montant est le seuil brut de la règle).
                  </p>
                )}
              </div>
            )}

            {!result.countryRule?.applied && (
              <p className="text-xs text-a-text-3">Aucune règle pays spécifique — calcul standard.</p>
            )}
          </section>

          {result.comparison && (result.input?.numParcels ?? 0) > 1 && (
            <section className="bg-a-surface rounded-xl border border-a-border p-5">
              <p className="text-xs uppercase tracking-wide text-a-text-3 mb-3">
                Comparaison : envoi groupé vs colis séparés
              </p>

              {!result.comparison.available && (
                <p className="text-xs text-tone-warning-fg bg-tone-warning-bg border border-tone-warning-border rounded-lg px-3 py-2">
                  Comparaison indisponible : un des colis n&apos;a aucun service éligible séparément.
                </p>
              )}

              {result.comparison.available && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div
                      className={`rounded-lg border p-3 ${
                        result.comparison.savings != null && result.comparison.savings < 0
                          ? 'border-tone-success-border bg-tone-success-bg'
                          : 'border-a-border'
                      }`}
                    >
                      <p className="text-xs uppercase tracking-wide text-a-text-3 mb-1">Groupé (actuel)</p>
                      <p className="text-lg font-semibold text-a-text">
                        {result.comparison.groupedTotal != null ? formatPrice(result.comparison.groupedTotal, currency) : '—'}
                      </p>
                    </div>
                    <div
                      className={`rounded-lg border p-3 ${
                        result.comparison.savings != null && result.comparison.savings > 0
                          ? 'border-tone-success-border bg-tone-success-bg'
                          : 'border-a-border'
                      }`}
                    >
                      <p className="text-xs uppercase tracking-wide text-a-text-3 mb-1">Colis séparés</p>
                      <p className="text-lg font-semibold text-a-text mb-2">
                        {result.comparison.separateTotal != null ? formatPrice(result.comparison.separateTotal, currency) : '—'}
                      </p>
                      <ul className="space-y-1">
                        {result.comparison.separateParcels?.map((p) => (
                          <li key={p.parcelIndex} className="text-xs text-a-text-3">
                            Colis {p.parcelIndex + 1} ({(p.weightG / 1000).toFixed(2)} kg) — {p.carrierName || '—'} · {p.serviceName || '—'} —{' '}
                            {formatPrice(p.basePrice + p.vatAmount, currency)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {result.comparison.savings != null && (
                    <p className={`text-sm font-medium ${result.comparison.savings > 0 ? 'text-tone-success-fg' : 'text-a-text-3'}`}>
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
