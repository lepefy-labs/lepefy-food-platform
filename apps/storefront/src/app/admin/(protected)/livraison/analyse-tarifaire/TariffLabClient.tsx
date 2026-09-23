'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type {
  ShippingMultiParcelStrategy,
  ShippingMultiParcelStrategyType,
  ShippingTariffBand,
  ShippingTariffDraftRow,
} from '@lepefy/types';
import { applyTariffDraft, splitParcelsFilled, type CostComparisonRow } from '@/lib/shipping/intelligence/tariffBacktest';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface BacktestMetrics {
  sampleSize: number; avgProviderCost: number | null; medianProviderCost: number | null;
  p90ProviderCost: number | null; p95ProviderCost: number | null; avgMargin: number | null;
  negativeMarginPct: number | null; maxLoss: number | null; minMargin?: number | null; aggregateMargin: number | null;
}

interface ScenarioSample {
  offersRead: number; executions: number; scenarios: number; alternativeOffersExcluded: number;
  olderExecutionsExcluded: number; postalCodes: number; zones: number; countries: number;
  topPostalCodeShare: number; reliability: 'insufficient' | 'limited' | 'indicative'; truncated: boolean;
}

interface BacktestResults {
  scenarioWeighted: BacktestMetrics;
  scenarioWeightedPacklinkOnly?: BacktestMetrics;
  comparison?: CostComparisonRow[];
  packaging?: { amount: number; mode: string } | null;
  scenarioSample?: ScenarioSample;
  orderWeighted: BacktestMetrics;
  orderWeightedReliable: boolean;
  verifiedShipmentCosts?: number;
}

type Population = 'scenario' | 'order';

const RELIABILITY_LABEL: Record<ScenarioSample['reliability'], { text: string; cls: string }> = {
  insufficient: { text: 'Données insuffisantes', cls: 'bg-red-50 text-red-700' },
  limited: { text: 'Couverture limitée', cls: 'bg-amber-50 text-amber-800' },
  indicative: { text: 'Indicatif', cls: 'bg-blue-50 text-blue-700' },
};

const STRATEGY_OPTIONS: Array<{ value: ShippingMultiParcelStrategyType; label: string; help: string }> = [
  { value: 'weight_bands_whole_order', label: 'Un seul prix sur le poids total', help: 'La bande s’applique au poids total de la commande, quel que soit le nombre de colis.' },
  { value: 'first_parcel_plus_percentage', label: '1er colis plein tarif + remise % sur les colis supplémentaires', help: 'Chaque colis supplémentaire est facturé au prix de SA bande de poids, moins la remise.' },
  { value: 'first_parcel_plus_discounted', label: '1er colis plein tarif + montant fixe par colis supplémentaire', help: 'Chaque colis supplémentaire ajoute le même montant.' },
  { value: 'flat_multi_parcel_rate', label: 'Prix unique dès 2 colis', help: 'Un prix fixe remplace les bandes dès que la commande dépasse un colis.' },
];

const PREVIEW_WEIGHTS = [1, 3, 5, 10, 12, 15, 15.5, 20, 25, 30, 45];

function emptyBand(): ShippingTariffBand { return { minKg: 0, maxKg: null, price: 0 }; }

function eur(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function kg(value: number): string {
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;
}

function gapCls(value: number | null): string {
  if (value == null) return 'text-gray-400';
  if (value < 0) return 'text-red-600 font-semibold';
  if (value < 1) return 'text-amber-600 font-semibold';
  return 'text-green-700 font-semibold';
}

export function TariffLabClient({ initialDrafts }: { initialDrafts: ShippingTariffDraftRow[] }) {
  const [drafts, setDrafts] = useState<ShippingTariffDraftRow[]>(initialDrafts);
  const [selectedId, setSelectedId] = useState<string | null>(initialDrafts[0]?.id ?? null);

  const [name, setName] = useState('Nouveau brouillon');
  const [bands, setBands] = useState<ShippingTariffBand[]>([{ minKg: 0, maxKg: 10, price: 10.5 }, { minKg: 10, maxKg: 15, price: 12.5 }]);
  const [zoneSurchargesText, setZoneSurchargesText] = useState('IT_SICILY=2');
  const [strategyType, setStrategyType] = useState<ShippingMultiParcelStrategyType>('weight_bands_whole_order');
  const [percentageDiscount, setPercentageDiscount] = useState(50);
  const [fixedParcelRate, setFixedParcelRate] = useState(6.25);
  const [flatRate, setFlatRate] = useState(18);
  const [parcelMaxKg, setParcelMaxKg] = useState(15);
  const [zoneSurchargeMode, setZoneSurchargeMode] = useState<'per_order' | 'per_parcel'>('per_order');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [results, setResults] = useState<BacktestResults | null>(null);

  function parseZoneSurcharges(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const pair of zoneSurchargesText.split(',')) {
      const [key, value] = pair.split('=').map((s) => s.trim());
      if (key && value && Number.isFinite(Number(value.replace(',', '.')))) out[key] = Number(value.replace(',', '.'));
    }
    return out;
  }

  function buildStrategy(): ShippingMultiParcelStrategy | null {
    const mode = zoneSurchargeMode === 'per_parcel' ? { zoneSurchargeMode } : {};
    switch (strategyType) {
      case 'first_parcel_plus_percentage': return { type: strategyType, percentageDiscount, parcelMaxKg, ...mode };
      case 'first_parcel_plus_discounted': return { type: strategyType, discountedParcelRate: fixedParcelRate, parcelMaxKg, ...mode };
      case 'flat_multi_parcel_rate': return { type: strategyType, flatMultiParcelRate: flatRate, ...mode };
      default: return zoneSurchargeMode === 'per_parcel' ? { type: 'weight_bands_whole_order', ...mode } : null;
    }
  }

  // Aperçu immédiat des prix client — même moteur que le rétrotest.
  const preview = useMemo(() => {
    const strategy = buildStrategy();
    const surcharges = parseZoneSurcharges();
    const zoneKeys = Object.keys(surcharges);
    return PREVIEW_WEIGHTS.map((weightKg) => {
      const parcels = splitParcelsFilled(weightKg, parcelMaxKg);
      const input = { weightKg, numParcels: parcels.length };
      return {
        weightKg,
        parcels,
        standard: applyTariffDraft(bands, surcharges, strategy, { ...input, zoneCode: null }),
        withSurcharge: zoneKeys.length > 0 ? applyTariffDraft(bands, surcharges, strategy, { ...input, zoneCode: zoneKeys[0]! }) : null,
        surchargeZone: zoneKeys[0] ?? null,
      };
    });
    // buildStrategy/parseZoneSurcharges lisent l'état ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bands, zoneSurchargesText, strategyType, percentageDiscount, fixedParcelRate, flatRate, parcelMaxKg, zoneSurchargeMode]);

  function loadDraft(draft: ShippingTariffDraftRow) {
    setSelectedId(draft.id);
    setName(`${draft.name} (copie)`);
    setBands(draft.bands);
    setZoneSurchargesText(Object.entries(draft.zone_surcharges).map(([k, v]) => `${k}=${v}`).join(', '));
    const strategy = draft.multi_parcel_strategy;
    setStrategyType(strategy?.type ?? 'weight_bands_whole_order');
    if (strategy?.percentageDiscount != null) setPercentageDiscount(strategy.percentageDiscount);
    if (strategy?.discountedParcelRate != null) setFixedParcelRate(strategy.discountedParcelRate);
    if (strategy?.flatMultiParcelRate != null) setFlatRate(strategy.flatMultiParcelRate);
    if (strategy?.parcelMaxKg != null) setParcelMaxKg(strategy.parcelMaxKg);
    setZoneSurchargeMode(strategy?.zoneSurchargeMode ?? 'per_order');
    void handleSimulate(draft.id);
  }

  async function handleSave() {
    setError(null);
    if (bands.length === 0) { setError('Ajoutez au moins une bande de poids.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/shipping-tariff-drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bands, zone_surcharges: parseZoneSurcharges(), multi_parcel_strategy: buildStrategy() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      setDrafts((prev) => [data as ShippingTariffDraftRow, ...prev]);
      setSelectedId((data as ShippingTariffDraftRow).id);
      void handleSimulate((data as ShippingTariffDraftRow).id);
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
      const res = await fetch(`/api/admin/shipping-tariff-drafts/${draftId}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: 'IT' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la simulation.');
    } finally {
      setSimulating(false);
    }
  }

  function renderMetrics(population: Population, label: string, metrics: BacktestMetrics, subtitle: string, warn?: string | null, extra?: ReactNode) {
    // Vocabulaire distinct par population : un scénario synthétique n'est pas
    // une commande, et un devis Packlink n'est pas une facture payée.
    const unit = population === 'scenario' ? 'scénario' : 'commande';
    const unitPlural = population === 'scenario' ? 'scénarios' : 'commandes';
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label} <span className="normal-case font-normal text-gray-400">(n = {metrics.sampleSize} {metrics.sampleSize > 1 ? unitPlural : unit})</span></h3>
        <p className="text-xs text-gray-400 mb-3">{subtitle}</p>
        {extra}
        {warn && <p className="text-xs text-amber-600 mb-2">{warn}</p>}
        {metrics.sampleSize === 0 ? (
          <p className="text-sm text-gray-400">Aucune donnée disponible.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><p className="text-2xs text-gray-400" title="Devis Packlink TTC + frais d'emballage actuels — un devis, pas une facture">Coût réel moyen</p><p className="font-medium">{eur(metrics.avgProviderCost)}</p></div>
            <div><p className="text-2xs text-gray-400" title={`La moitié des ${unitPlural} ont un coût réel inférieur, l'autre moitié supérieur`}>Médiane</p><p className="font-medium">{eur(metrics.medianProviderCost)}</p></div>
            <div><p className="text-2xs text-gray-400" title={`90 % des ${unitPlural} ont un coût réel inférieur à ce montant`}>P90 (cas cher, 1 sur 10)</p><p className="font-medium">{eur(metrics.p90ProviderCost)}</p></div>
            <div><p className="text-2xs text-gray-400" title={`95 % des ${unitPlural} ont un coût réel inférieur à ce montant`}>P95 (cas très cher, 1 sur 20)</p><p className="font-medium">{eur(metrics.p95ProviderCost)}</p></div>
            <div><p className="text-2xs text-gray-400" title="Forfait moins coût réel, en moyenne">Écart moyen</p><p className={`font-medium ${((metrics.avgMargin ?? 0) < 0) ? 'text-red-600' : 'text-green-600'}`}>{eur(metrics.avgMargin)}</p></div>
            <div><p className="text-2xs text-gray-400" title={population === 'scenario' ? 'Part des scénarios de la grille synthétique où le forfait est inférieur au coût réel — pas une part de vos commandes réelles' : 'Part des commandes où le forfait aurait été inférieur au coût réel'}>% de {unitPlural} à perte</p><p className="font-medium">{metrics.negativeMarginPct}%</p></div>
            <div><p className="text-2xs text-gray-400" title={`Le plus faible écart sur un(e) seul(e) ${unit} ; négatif = perte`}>Écart minimal (1 {unit})</p><p className={`font-medium ${((metrics.minMargin ?? metrics.maxLoss ?? 0) < 0) ? 'text-red-600' : 'text-green-600'}`}>{eur(metrics.minMargin ?? metrics.maxLoss)}</p></div>
            <div><p className="text-2xs text-gray-400" title={population === 'scenario' ? 'Somme des écarts sur les scénarios mesurés — dépend de la grille testée, pas un résultat financier' : 'Somme des écarts si ce forfait avait été appliqué à ces commandes'}>Écart cumulé</p><p className="font-medium">{eur(metrics.aggregateMargin)}</p></div>
          </div>
        )}
      </div>
    );
  }

  function renderScenarioSample(sample: ScenarioSample | undefined) {
    if (!sample) return null;
    const reliability = RELIABILITY_LABEL[sample.reliability];
    return (
      <div className="mb-3 rounded-lg bg-gray-50 dark:bg-gray-800/40 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
        <p className="flex flex-wrap items-center gap-2">
          <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${reliability.cls}`}>{reliability.text}</span>
          <span><b>{sample.scenarios}</b> scénario(s) mesuré(s) · <b>{sample.postalCodes}</b> CAP · {sample.zones} zone(s) · {sample.countries} pays</span>
        </p>
        <p className="mt-1 text-2xs text-gray-400">
          Une observation par scénario (service éligible au coût le plus bas, devis le plus récent).
          {' '}{sample.alternativeOffersExcluded} offre(s) alternative(s) et {sample.olderExecutionsExcluded} devis plus ancien(s) du même scénario non comptés comme échantillons.
          {sample.topPostalCodeShare > 0.5 && <> Plus de la moitié des scénarios concernent un seul CAP : ne pas extrapoler à une couverture nationale.</>}
          {sample.truncated && <> Jeu de données tronqué au volume maximal lu : résultats partiels.</>}
        </p>
      </div>
    );
  }

  function renderComparison(res: BacktestResults) {
    const main = res.scenarioWeighted;
    const packlinkOnly = res.scenarioWeightedPacklinkOnly;
    const forfaitAvg = main.avgProviderCost != null && main.avgMargin != null ? main.avgProviderCost + main.avgMargin : null;
    const packagingText = res.packaging
      ? `${eur(res.packaging.amount)} ${res.packaging.mode === 'per_parcel' ? 'par colis' : 'par commande'}`
      : 'aucun';
    return (
      <section className="rounded-xl border-2 border-[var(--color-primary)] bg-white dark:bg-gray-900 p-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Coûts réels Packlink vs forfait</h2>
        <p className="text-xs text-gray-500 mt-1 mb-4">
          Coût réel = devis Packlink TTC (TVA ajoutée, Packlink renvoyant des devis HT) + frais d&apos;emballage actuels ({packagingText}) — c&apos;est ce que vos clients paient aujourd&apos;hui et ce que le forfait (TTC, emballage compris) remplace. Italie, scénarios mesurés.
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3"><p className="text-2xs uppercase text-gray-400">Coût réel moyen</p><p className="text-xl font-bold">{eur(main.avgProviderCost)}</p></div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3"><p className="text-2xs uppercase text-gray-400">Forfait moyen</p><p className="text-xl font-bold">{eur(forfaitAvg)}</p></div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3"><p className="text-2xs uppercase text-gray-400">Écart moyen</p><p className={`text-xl font-bold ${gapCls(main.avgMargin)}`}>{eur(main.avgMargin)}</p></div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3"><p className="text-2xs uppercase text-gray-400">Scénarios à perte</p><p className={`text-xl font-bold ${(main.negativeMarginPct ?? 0) > 0 ? 'text-red-600' : 'text-green-700'}`}>{main.negativeMarginPct ?? 0}%</p></div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3"><p className="text-2xs uppercase text-gray-400">Écart le plus défavorable</p><p className={`text-xl font-bold ${gapCls(main.minMargin ?? null)}`}>{eur(main.minMargin ?? main.maxLoss)}</p></div>
        </div>
        {packlinkOnly && (
          <p className="text-xs text-gray-500 mb-4">
            Sans l&apos;emballage (forfait contre devis Packlink TTC seul) : écart moyen {eur(packlinkOnly.avgMargin)}, {packlinkOnly.negativeMarginPct ?? 0}% à perte, écart minimal {eur(packlinkOnly.minMargin ?? packlinkOnly.maxLoss)}.
          </p>
        )}

        {res.comparison && res.comparison.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-3">Poids</th>
                  <th className="py-2 pr-3">Zones</th>
                  <th className="py-2 pr-3 text-right" title="Devis Packlink TTC, médiane (max) des scénarios">Packlink TTC</th>
                  <th className="py-2 pr-3 text-right">+ Emballage</th>
                  <th className="py-2 pr-3 text-right" title="Médiane (cas le plus cher) du groupe">= Coût réel</th>
                  <th className="py-2 pr-3 text-right">Forfait</th>
                  <th className="py-2 pr-3 text-right" title="Forfait − coût réel médian : le cas le plus courant">Écart typique</th>
                  <th className="py-2 pr-3 text-right" title="Forfait − coût réel le plus cher du groupe (grande boîte, zone chère…)">Pire écart</th>
                </tr>
              </thead>
              <tbody>
                {res.comparison.flatMap((row) => row.cells.map((cell, i) => (
                  <tr key={`${row.weightKg}-${cell.zoneSurcharge}`} className={`border-b border-gray-50 dark:border-gray-800/60 ${cell.typicalGap != null && cell.typicalGap < 0 ? 'bg-red-50/60 dark:bg-red-950/20' : ''}`}>
                    <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{i === 0 ? <>{kg(row.weightKg)} <span className="text-2xs text-gray-400">· {row.numParcels} colis</span></> : ''}</td>
                    <td className="py-1.5 pr-3 text-xs text-gray-500" title={cell.zones.join(', ')}>
                      {cell.zoneSurcharge > 0 ? `Supplément ${eur(cell.zoneSurcharge)}` : 'Zones standard'} <span className="text-2xs text-gray-400">({cell.zones.length})</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{eur(cell.packlinkMedian)}{cell.packlinkMax !== cell.packlinkMedian && <span className="text-2xs text-gray-400"> ({eur(cell.packlinkMax)})</span>}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500">{eur(cell.packaging)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{eur(cell.realCostMedian ?? cell.realCostMax)}{cell.realCostMedian != null && cell.realCostMedian !== cell.realCostMax && <span className="text-2xs font-normal text-gray-400"> ({eur(cell.realCostMax)})</span>}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{cell.forfait == null ? <span className="text-gray-400" title="Aucune bande ne couvre ce poids">hors bandes</span> : eur(cell.forfait)}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums ${gapCls(cell.typicalGap ?? null)}`}>{eur(cell.typicalGap)}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums text-xs ${gapCls(cell.worstGap)}`}>{eur(cell.worstGap)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
            <p className="mt-2 text-2xs text-gray-400">Écart typique : cas médian (boîte et zone les plus courantes du groupe) · pire écart : cas le plus cher du groupe. Vert : ≥ 1 € · orange : 0–1 € · rouge : le forfait ne couvre pas le coût réel. Devis Packlink, pas des factures payées.</p>
          </div>
        )}
      </section>
    );
  }

  const strategyHelp = STRATEGY_OPTIONS.find((o) => o.value === strategyType)?.help;
  const perParcel = strategyType === 'first_parcel_plus_percentage' || strategyType === 'first_parcel_plus_discounted';

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold mb-2">À quoi sert cet écran ?</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
          Le Laboratoire (via ses campagnes) interroge automatiquement Packlink PRO sur des combinaisons poids × emballage × destination
          pour construire une base de devis provider. Ici, vous testez un <b>forfait client</b> (prix TTC, emballage compris) contre le coût réel
          (devis Packlink TTC + emballage), avant d&apos;activer quoi que ce soit en caisse.
        </p>
        <p className="text-xs text-gray-400">
          Rien ici n&apos;affecte le prix payé par vos clients — un brouillon reste un brouillon tant qu&apos;il n&apos;est pas explicitement activé (fonctionnalité future, hors périmètre actuel).
        </p>
      </section>

      {drafts.length > 0 && (
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h2 className="text-sm font-semibold mb-1">Brouillons existants</h2>
          <p className="text-xs text-gray-400 mb-3">Cliquer un brouillon relance son rétrotest et le recopie dans le formulaire pour tester une variante. Pour figer un brouillon et le comparer aux commandes réelles sans le facturer : <Link href="/admin/livraison/forfait-shadow" className="underline text-[var(--color-primary-dark)]">créer une version shadow</Link>.</p>
          <div className="flex flex-wrap gap-2">
            {drafts.map((d) => (
              <button key={d.id} onClick={() => loadDraft(d)} className={`text-xs px-3 py-1.5 rounded-lg border ${selectedId === d.id ? 'border-[var(--color-primary)] text-[var(--color-primary-dark)]' : 'border-gray-200 text-gray-500'}`}>
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
          <label className={LABEL_CLS}>Bandes de poids (prix client TTC, emballage compris)</label>
          <p className="text-xs text-gray-400 mb-2">Le prix que <b>le client</b> paierait pour une tranche de poids. Avec une stratégie « 1er colis + … », la bande s&apos;applique au poids de chaque colis.</p>
          <div className="space-y-2">
            {bands.map((band, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="number" step="0.1" value={band.minKg} onChange={(e) => setBands((prev) => prev.map((b, idx) => idx === i ? { ...b, minKg: Number(e.target.value) } : b))} placeholder="Min kg" aria-label="Min kg" className={`${INPUT_CLS} w-24`} />
                <span className="text-xs text-gray-400">à</span>
                <input type="number" step="0.1" value={band.maxKg ?? ''} onChange={(e) => setBands((prev) => prev.map((b, idx) => idx === i ? { ...b, maxKg: e.target.value === '' ? null : Number(e.target.value) } : b))} placeholder="Max kg (vide = illimité)" aria-label="Max kg" className={`${INPUT_CLS} w-40`} />
                <span className="text-xs text-gray-400">=</span>
                <input type="number" step="0.01" value={band.price} onChange={(e) => setBands((prev) => prev.map((b, idx) => idx === i ? { ...b, price: Number(e.target.value) } : b))} placeholder="Prix €" aria-label="Prix €" className={`${INPUT_CLS} w-28`} />
                <button onClick={() => setBands((prev) => prev.filter((_, idx) => idx !== i))} className="text-red-500" aria-label="Supprimer la bande"><IconTrash size={14} stroke={1.5} /></button>
              </div>
            ))}
          </div>
          <button onClick={() => setBands((prev) => [...prev, emptyBand()])} className="mt-2 text-xs text-[var(--color-primary-dark)] flex items-center gap-1"><IconPlus size={13} stroke={1.5} />Ajouter une bande</button>
        </div>

        <div className="mb-4">
          <label className={LABEL_CLS}>Colis supplémentaires</label>
          <select value={strategyType} onChange={(e) => setStrategyType(e.target.value as ShippingMultiParcelStrategyType)} className={INPUT_CLS} aria-label="Stratégie colis supplémentaires">
            {STRATEGY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {strategyHelp && <p className="text-xs text-gray-400 mt-1">{strategyHelp}</p>}
          <div className="mt-2 flex flex-wrap gap-3">
            {perParcel && (
              <label className="text-xs text-gray-500">
                Poids max par colis (kg)
                <input type="number" step="0.5" min="1" value={parcelMaxKg} onChange={(e) => setParcelMaxKg(Number(e.target.value))} className={`${INPUT_CLS} mt-0.5 w-28`} />
              </label>
            )}
            {strategyType === 'first_parcel_plus_percentage' && (
              <label className="text-xs text-gray-500">
                Remise sur chaque colis supplémentaire (%)
                <input type="number" step="1" min="0" max="100" value={percentageDiscount} onChange={(e) => setPercentageDiscount(Number(e.target.value))} className={`${INPUT_CLS} mt-0.5 w-28`} />
              </label>
            )}
            {strategyType === 'first_parcel_plus_discounted' && (
              <label className="text-xs text-gray-500">
                Montant par colis supplémentaire (€)
                <input type="number" step="0.01" min="0" value={fixedParcelRate} onChange={(e) => setFixedParcelRate(Number(e.target.value))} className={`${INPUT_CLS} mt-0.5 w-28`} />
              </label>
            )}
            {strategyType === 'flat_multi_parcel_rate' && (
              <label className="text-xs text-gray-500">
                Prix unique dès 2 colis (€)
                <input type="number" step="0.01" min="0" value={flatRate} onChange={(e) => setFlatRate(Number(e.target.value))} className={`${INPUT_CLS} mt-0.5 w-28`} />
              </label>
            )}
          </div>
        </div>

        <div className="mb-4">
          <label className={LABEL_CLS}>Surcharges de zone (code=montant, séparés par des virgules)</label>
          <p className="text-xs text-gray-400 mb-2">Montant additionnel pour une zone (îles, régions éloignées). Codes de zone : onglet « Tarification ».</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input type="text" value={zoneSurchargesText} onChange={(e) => setZoneSurchargesText(e.target.value)} className={INPUT_CLS} placeholder="IT_SICILY=2" />
            <select value={zoneSurchargeMode} onChange={(e) => setZoneSurchargeMode(e.target.value as 'per_order' | 'per_parcel')} className={`${INPUT_CLS} sm:w-56`} aria-label="Application de la surcharge de zone">
              <option value="per_order">Par commande</option>
              <option value="per_parcel">Par colis</option>
            </select>
          </div>
        </div>

        <div className="mb-4 rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">Aperçu des prix client</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-2xs uppercase text-gray-400">
                  <th className="py-1 pr-3">Poids</th><th className="py-1 pr-3">Colis (kg)</th><th className="py-1 pr-3 text-right">Zones standard</th>
                  {preview[0]?.surchargeZone && <th className="py-1 pr-3 text-right">{preview[0].surchargeZone}</th>}
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={p.weightKg} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1 pr-3 tabular-nums">{kg(p.weightKg)}</td>
                    <td className="py-1 pr-3 text-gray-500">{p.parcels.map((w) => w.toLocaleString('fr-FR')).join(' + ')}</td>
                    <td className="py-1 pr-3 text-right tabular-nums font-medium">{p.standard == null ? <span className="text-gray-400">hors bandes</span> : eur(p.standard)}</td>
                    {p.surchargeZone && <td className="py-1 pr-3 text-right tabular-nums">{p.withSurcharge == null ? '—' : eur(p.withSurcharge)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <button onClick={() => void handleSave()} disabled={saving} className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer et rétrotester'}</button>
      </section>

      {simulating && <p className="text-sm text-gray-400">Calcul du rétrotest…</p>}

      {results && (
        <section className="space-y-4">
          {renderComparison(results)}
          {renderMetrics(
            'scenario',
            'Scénarios synthétiques (laboratoire)',
            results.scenarioWeighted,
            'Coût réel des scénarios mesurés par les campagnes — grille de poids/emballages/destinations testée uniformément, pas la fréquence réelle de vos commandes.',
            results.scenarioSample?.reliability === 'insufficient'
              ? 'Moins de 30 scénarios mesurés : ces chiffres peuvent changer fortement avec quelques mesures de plus.'
              : null,
            renderScenarioSample(results.scenarioSample),
          )}
          {renderMetrics(
            'order',
            'Commandes réelles',
            results.orderWeighted,
            'Ce que vos clients ont réellement payé pour la livraison (devis Packlink TTC + emballage) sur vos commandes livrées en Italie — pas le coût final facturé par Packlink.',
            !results.orderWeightedReliable
              ? 'Échantillon faible (moins de 30 commandes) — interprétez ces chiffres avec prudence.'
              : null,
          )}
          <p className="text-xs text-gray-400">
            Les deux populations ne sont jamais moyennées ensemble : les scénarios synthétiques disent « que se passerait-il sur la gamme de poids/destinations mesurée », les commandes réelles disent « qu&apos;est-ce que cela aurait changé sur ce que vous avez réellement vendu ».
            {' '}Coûts finaux d&apos;expédition vérifiés disponibles : {results.verifiedShipmentCosts ?? 0} — aucun résultat ci-dessus ne représente une facture Packlink payée.
          </p>
        </section>
      )}
    </div>
  );
}
