'use client';

import { useState, type ReactNode } from 'react';
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

interface ScenarioSample {
  offersRead: number; executions: number; scenarios: number; alternativeOffersExcluded: number;
  olderExecutionsExcluded: number; postalCodes: number; zones: number; countries: number;
  topPostalCodeShare: number; reliability: 'insufficient' | 'limited' | 'indicative'; truncated: boolean;
}

interface BacktestResults {
  scenarioWeighted: BacktestMetrics;
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
  const [results, setResults] = useState<BacktestResults | null>(null);

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

  function renderMetrics(population: Population, label: string, metrics: BacktestMetrics, subtitle: string, warn?: string | null, extra?: ReactNode) {
    // Vocabulaire distinct par population : un scénario synthétique n'est pas
    // une commande, et un devis Packlink n'est pas une facture payée.
    const unit = population === 'scenario' ? 'scénario' : 'commande';
    const unitPlural = population === 'scenario' ? 'scénarios' : 'commandes';
    const costLabel = population === 'scenario' ? 'Devis Packlink moyen' : 'Devis Packlink moyen (à la commande)';
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
            <div><p className="text-2xs text-gray-400" title={`Montant moyen des devis Packlink (base + taxes) sur ces ${unitPlural} — un devis, pas une facture`}>{costLabel}</p><p className="font-medium">{metrics.avgProviderCost?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400" title={`La moitié des ${unitPlural} ont un devis inférieur, l'autre moitié supérieur`}>Médiane</p><p className="font-medium">{metrics.medianProviderCost?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400" title={`90 % des ${unitPlural} ont un devis inférieur à ce montant`}>P90 (cas cher, 1 sur 10)</p><p className="font-medium">{metrics.p90ProviderCost?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400" title={`95 % des ${unitPlural} ont un devis inférieur à ce montant`}>P95 (cas très cher, 1 sur 20)</p><p className="font-medium">{metrics.p95ProviderCost?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400" title="Prix client (bandes ci-dessus) moins devis Packlink, en moyenne">Marge moyenne</p><p className={`font-medium ${((metrics.avgMargin ?? 0) < 0) ? 'text-red-600' : 'text-green-600'}`}>{metrics.avgMargin?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400" title={population === 'scenario' ? 'Part des scénarios de la grille synthétique où ce forfait serait inférieur au devis — pas une part de vos commandes réelles' : 'Part des commandes où ce forfait aurait été inférieur au devis Packlink enregistré'}>% de {unitPlural} à perte</p><p className="font-medium">{metrics.negativeMarginPct}%</p></div>
            <div><p className="text-2xs text-gray-400" title={`La pire perte sur un(e) seul(e) ${unit} de cet échantillon`}>Pire perte (1 {unit})</p><p className="font-medium text-red-600">{metrics.maxLoss?.toFixed(2)} €</p></div>
            <div><p className="text-2xs text-gray-400" title={population === 'scenario' ? 'Somme des marges sur les scénarios mesurés — dépend de la grille testée, pas un résultat financier' : 'Somme des marges si ce forfait avait été appliqué à ces commandes'}>Marge cumulée sur l&apos;échantillon</p><p className="font-medium">{metrics.aggregateMargin?.toFixed(2)} €</p></div>
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
          Une observation par scénario (service éligible au coût base + taxes le plus bas, devis le plus récent).
          {" "}{sample.alternativeOffersExcluded} offre(s) alternative(s) et {sample.olderExecutionsExcluded} devis plus ancien(s) du même scénario non comptés comme échantillons.
          {sample.topPostalCodeShare > 0.5 && <> Plus de la moitié des scénarios concernent un seul CAP : ne pas extrapoler à une couverture nationale.</>}
          {sample.truncated && <> Jeu de données tronqué au volume maximal lu : résultats partiels.</>}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold mb-2">À quoi sert cet écran ?</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
          Le Laboratoire (via ses campagnes) interroge automatiquement Packlink PRO sur des combinaisons poids × emballage × destination
          pour construire une base de devis provider, sans intervention manuelle. Ici, vous testez un <b>forfait client</b> (ex. « 10,50 € jusqu&apos;à 10 kg »)
          contre cette base : le rétrotest estime la marge par rapport à ces devis (pas à des factures payées), avant d&apos;activer quoi que ce soit en caisse.
        </p>
        <p className="text-xs text-gray-400">
          Rien ici n&apos;affecte le prix payé par vos clients — un brouillon reste un brouillon tant qu&apos;il n&apos;est pas explicitement activé (fonctionnalité future, hors périmètre actuel).
        </p>
      </section>

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
          <p className="text-xs text-gray-400 mb-2">Le prix que <b>le client</b> paierait pour une commande dont le poids tombe dans cette tranche — pas le coût Packlink. Ex. « 0 à 10 = 10,50 € » : un client de 8 kg paie 10,50 €.</p>
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
          <p className="text-xs text-gray-400 mb-2">Montant additionnel facturé au client pour une zone donnée (ex. îles, régions éloignées) — s&apos;ajoute au prix de la bande de poids. Les codes de zone viennent de l&apos;onglet « Tarification ».</p>
          <input type="text" value={zoneSurchargesText} onChange={(e) => setZoneSurchargesText(e.target.value)} className={INPUT_CLS} placeholder="IT_SICILY=2" />
        </div>

        <button onClick={() => void handleSave()} disabled={saving} className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer et rétrotester'}</button>
      </section>

      {simulating && <p className="text-sm text-gray-400">Calcul du rétrotest…</p>}

      {results && (
        <section className="space-y-4">
          {renderMetrics(
            'scenario',
            'Scénarios synthétiques (laboratoire)',
            results.scenarioWeighted,
            'Devis Packlink obtenus par les campagnes et tests rapides — grille de poids/emballages/destinations testée uniformément, pas la fréquence réelle de vos commandes.',
            results.scenarioSample?.reliability === 'insufficient'
              ? 'Moins de 30 scénarios mesurés : ces chiffres peuvent changer fortement avec quelques mesures de plus.'
              : null,
            renderScenarioSample(results.scenarioSample),
          )}
          {renderMetrics(
            'order',
            'Commandes réelles',
            results.orderWeighted,
            'Devis Packlink enregistrés au moment de vos commandes livrées — reflète la distribution réelle de poids/destinations, mais pas le coût final facturé.',
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
