'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconPlus, IconRefresh } from '@tabler/icons-react';
import type {
  ShippingPackagingProfileRow,
  ShippingScenarioDestination,
  ShippingScenarioMatrix,
  ShippingSimulationCampaignRow,
  ShippingZoneRow,
} from '@lepefy/types';
import {
  CampaignDestinationPicker,
  emptyCampaignDestination,
  type CampaignDestinationRow,
} from './CampaignDestinationPicker';
import { ZoneSentinelPicker } from './ZoneSentinelPicker';
import { MAX_CAMPAIGN_SCENARIOS, splitDestinationsForLimit } from '@/lib/shipping/intelligence/scenarioMatrix';
import { parseManualWeights, weightsForProfile } from '@/lib/shipping/intelligence/weightPresets';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

type UiSamplingMode = 'initial' | 'deep' | 'manual';

const SAMPLING_MODES: Array<{ value: UiSamplingMode; title: string; description: string }> = [
  {
    value: 'initial',
    title: 'Couverture initiale',
    description: '≈ 6 poids par profil : 1 kg, 3 kg, mi-capacité, juste avant / juste après le passage à 2 colis, 2 colis pleins.',
  },
  {
    value: 'deep',
    title: 'Analyse approfondie',
    description: 'Points denses autour des paliers transporteur (1, 2, 3, 5, 10, 20 kg) et des seuils 1×, 2×, 3× la capacité du profil. Coût API élevé.',
  },
  {
    value: 'manual',
    title: 'Poids manuels',
    description: 'Vos propres poids, appliqués à chaque profil sélectionné.',
  },
];

const MODE_LABEL: Record<string, string> = {
  initial: 'Couverture initiale', deep: 'Analyse approfondie', manual: 'Poids manuels', resample: 'Remesure',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', queued: 'En file', running: 'En cours',
  completed: 'Terminée', completed_with_errors: 'Terminée avec erreurs', cancelled: 'Annulée',
};
const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500', queued: 'bg-amber-50 text-amber-700', running: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700', completed_with_errors: 'bg-amber-50 text-amber-700', cancelled: 'bg-gray-100 text-gray-400',
};
type CampaignNotice = { tone: 'success' | 'warning'; text: string };

function formatKg(value: number): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

export function CampaignManager({ profiles, zones }: { profiles: ShippingPackagingProfileRow[]; zones: ShippingZoneRow[] }) {
  const [campaigns, setCampaigns] = useState<ShippingSimulationCampaignRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<CampaignNotice | null>(null);
  const [name, setName] = useState('');
  const [samplingMode, setSamplingMode] = useState<UiSamplingMode>('initial');
  const [weightsInput, setWeightsInput] = useState('');
  const [confirmDeep, setConfirmDeep] = useState(false);
  const [launchedParts, setLaunchedParts] = useState<number[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>(profiles.filter((p) => p.active).map((p) => p.id));
  const [destinations, setDestinations] = useState<CampaignDestinationRow[]>([emptyCampaignDestination()]);
  const [destinationMode, setDestinationMode] = useState<'postal' | 'zone_sentinels'>('postal');
  const [zoneDestinations, setZoneDestinations] = useState<ShippingScenarioDestination[]>([]);
  const [sentinelsPerZone, setSentinelsPerZone] = useState(2);
  const handleZoneDestinations = useCallback((next: ShippingScenarioDestination[], perZone: number) => {
    setZoneDestinations(next);
    setSentinelsPerZone(perZone);
  }, []);

  async function loadCampaigns() {
    setLoadingList(true);
    try {
      const res = await fetch('/api/admin/shipping-simulation-campaigns');
      const data = await res.json();
      if (res.ok) setCampaigns(data as ShippingSimulationCampaignRow[]);
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => { void loadCampaigns(); }, []);

  const manualWeights = useMemo(() => parseManualWeights(weightsInput), [weightsInput]);

  // Aperçu client — le serveur recalcule les préréglages depuis les profils
  // du tenant, c'est lui qui fait foi.
  const weightsByProfile = useMemo(() => profiles
    .filter((p) => selectedProfiles.includes(p.id))
    .map((p) => ({
      profile: p,
      weights: samplingMode === 'manual' ? manualWeights : weightsForProfile(samplingMode, p.max_weight_g),
    })), [manualWeights, profiles, samplingMode, selectedProfiles]);

  const cityDestinations = useMemo(() => {
    const unique = new Map<string, ShippingScenarioDestination>();
    for (const destination of destinations) {
      const postalCodes = destination.mode === 'city'
        ? destination.postalCodes
        : [destination.manualPostalCode.trim()].filter(Boolean);

      for (const postalCode of postalCodes) {
        // Chaîne conservée telle quelle (zéros initiaux significatifs).
        const normalizedPostalCode = postalCode.trim().toUpperCase();
        if (!normalizedPostalCode) continue;
        const key = `${destination.country}|${normalizedPostalCode}`;
        if (unique.has(key)) continue;
        const isCity = destination.mode === 'city' && Boolean(destination.city);
        unique.set(key, {
          country: destination.country,
          postalCode: normalizedPostalCode,
          zoneCode: destination.zoneCode,
          label: isCity ? `${destination.city} · ${normalizedPostalCode}` : `${destination.country} · ${normalizedPostalCode}`,
          ...(isCity ? {
            city: destination.city,
            adminCode1: destination.adminCode1,
            adminCode2: destination.adminCode2,
            adminName: destination.stateName || undefined,
          } : {}),
        });
      }
    }
    return Array.from(unique.values());
  }, [destinations]);

  const expandedDestinations = destinationMode === 'zone_sentinels' ? zoneDestinations : cityDestinations;

  const scenariosPerPostalCode = weightsByProfile.reduce((sum, entry) => sum + entry.weights.length, 0);
  const scenarioCount = scenariosPerPostalCode * expandedDestinations.length;
  const overLimit = scenarioCount > MAX_CAMPAIGN_SCENARIOS;
  const parts = useMemo(
    () => (overLimit ? splitDestinationsForLimit(expandedDestinations, scenariosPerPostalCode) : []),
    [expandedDestinations, overLimit, scenariosPerPostalCode],
  );
  const initialPreviewCount = useMemo(() => profiles
    .filter((p) => selectedProfiles.includes(p.id))
    .reduce((sum, p) => sum + weightsForProfile('initial', p.max_weight_g).length, 0) * expandedDestinations.length,
  [expandedDestinations.length, profiles, selectedProfiles]);

  useEffect(() => { setLaunchedParts([]); }, [expandedDestinations, samplingMode, selectedProfiles, weightsInput]);

  function changeMode(mode: UiSamplingMode) {
    if (mode === 'manual' && !weightsInput.trim()) {
      const union = Array.from(new Set(weightsByProfile.flatMap((e) => e.weights))).sort((a, b) => a - b);
      setWeightsInput(union.join(', '));
    }
    if (mode !== 'deep') setConfirmDeep(false);
    setSamplingMode(mode);
  }

  async function processCampaign(id: string, automatic = false) {
    setProcessingId(id);
    if (!automatic) setNotice(null);
    try {
      const res = await fetch(`/api/admin/shipping-simulation-campaigns/${id}/process`, { method: 'POST' });
      const data = await res.json() as {
        error?: string;
        result?: { processed: number; succeeded: number; failed: number; skipped: number; rejected?: number };
      };
      if (!res.ok) {
        if (res.status === 429) {
          setNotice({ tone: 'warning', text: 'Un lot vient déjà d’être lancé. Le worker automatique reste actif.' });
          return;
        }
        throw new Error(data.error ?? 'Erreur');
      }
      const result = data.result;
      setNotice((result?.processed ?? 0) > 0
        ? { tone: 'success', text: `Lot immédiat : ${result?.processed ?? 0} scénario(s) — ${result?.succeeded ?? 0} nouveau(x) devis Packlink, ${result?.skipped ?? 0} réemploi(s) de devis identique, ${result?.rejected ?? 0} sans devis exploitable (CAP refusé, aucun service éligible…), ${result?.failed ?? 0} incident(s). Le worker poursuivra si nécessaire.` }
        : { tone: 'warning', text: 'Aucun scénario pris dans ce lot ; le worker automatique reste actif.' });
    } catch {
      setNotice({
        tone: 'warning',
        text: automatic
          ? 'La campagne est créée et reste en file. Le worker automatique prendra le relais.'
          : 'Impossible de lancer ce lot immédiatement. Le worker automatique reste actif.',
      });
    } finally {
      setProcessingId(null);
      await loadCampaigns();
    }
  }

  function validateForm(): string | null {
    if (selectedProfiles.length === 0) return 'Sélectionnez au moins un profil d\'emballage.';
    if (samplingMode === 'manual' && manualWeights.length === 0) return 'Indiquez au moins un poids valide.';
    if (weightsByProfile.some((e) => e.weights.length === 0)) return 'Un profil sélectionné ne produit aucun poids valide.';
    if (expandedDestinations.length === 0) return 'Sélectionnez au moins une ville ou indiquez un code postal.';
    if (samplingMode === 'deep' && !confirmDeep) return 'Confirmez le volume d’appels Packlink de l’analyse approfondie.';
    return null;
  }

  async function createCampaign(subset: ShippingScenarioDestination[], part?: { index: number; count: number }) {
    setError(null);
    setNotice(null);
    const formError = validateForm();
    if (formError) return setError(formError);
    if (subset.length * scenariosPerPostalCode > MAX_CAMPAIGN_SCENARIOS) {
      return setError(`${subset.length * scenariosPerPostalCode} scénarios dépassent la limite de ${MAX_CAMPAIGN_SCENARIOS}.`);
    }

    setSubmitting(true);
    try {
      const baseName = name.trim() || `Campagne ${new Date().toLocaleDateString('fr-FR')}`;
      const res = await fetch('/api/admin/shipping-simulation-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: part ? `${baseName} (partie ${part.index}/${part.count})` : baseName,
          samplingMode,
          confirmDeepAnalysis: samplingMode === 'deep' ? confirmDeep : undefined,
          weightsKg: samplingMode === 'manual' ? manualWeights : undefined,
          packagingProfileIds: selectedProfiles,
          destinations: subset,
          part,
          destinationMode,
          sentinelsPerZone: destinationMode === 'zone_sentinels' ? sentinelsPerZone : undefined,
        }),
      });
      const data = await res.json() as ShippingSimulationCampaignRow & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Erreur');
      if (part) {
        setLaunchedParts((prev) => [...prev, part.index]);
      } else {
        setCreating(false);
        setName('');
      }
      await loadCampaigns();
      void processCampaign(data.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création de la campagne.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    await fetch(`/api/admin/shipping-simulation-campaigns/${id}/cancel`, { method: 'POST' });
    await loadCampaigns();
  }

  const overflowExplanation = weightsByProfile
    .map((e) => `${e.profile.name} : ${e.weights.length} poids`)
    .join(' + ');

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Campagnes de simulation</h2>
        <button onClick={() => void loadCampaigns()} className="min-h-8 px-2 py-1.5 text-xs rounded-lg border border-gray-200 flex items-center gap-1 text-gray-500"><IconRefresh size={14} stroke={1.5} />Actualiser</button>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Chaque CAP est une destination distincte. Un scénario n&apos;est couvert que par un devis de SON CAP et de sa configuration de colis exacte — nouvel appel Packlink, ou réemploi d&apos;un devis strictement identique encore frais.
      </p>

      {notice && <div className={`mb-4 px-3 py-2 rounded-lg text-xs border ${notice.tone === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>{notice.text}</div>}

      {loadingList ? (
        <p className="text-sm text-gray-400 mb-4">Chargement…</p>
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-gray-400 mb-4">Aucune campagne encore lancée.</p>
      ) : (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-2xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
              <th className="py-2 pr-3">Nom</th><th className="py-2 pr-3">Statut</th><th className="py-2 pr-3">Traités</th><th className="py-2 pr-3">Créée</th><th className="py-2 pr-3 text-right">Actions</th>
            </tr></thead>
            <tbody>
              {campaigns.map((c) => {
                const matrix = c.scenario_matrix as ShippingScenarioMatrix | null;
                const mode = matrix?.samplingMode;
                return (
                  <tr key={c.id} className="border-b border-gray-50 dark:border-gray-800/60">
                    <td className="py-2.5 pr-3">
                      <Link href={`/admin/livraison/laboratoire/${c.id}`} className="text-[var(--color-primary-dark)] hover:underline">{c.name}</Link>
                      {mode && <span className="block text-2xs text-gray-400">{MODE_LABEL[mode] ?? mode}{matrix?.destinationMode === 'zone_sentinels' ? ' · CAP témoins par zone' : ''}</span>}
                    </td>
                    <td className="py-2.5 pr-3"><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${STATUS_CLS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>{STATUS_LABEL[c.status] ?? c.status}</span></td>
                    <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-300" title="Scénarios traités (nouveaux devis + réemplois) / total. La couverture vérifiée par CAP est dans le détail.">
                      {c.completed_scenarios}/{c.total_scenarios}{c.failed_scenarios > 0 && <span className="text-red-500"> · {c.failed_scenarios} échec(s)</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-gray-400">{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                    <td className="py-2.5 pr-3 text-right">
                      {(c.status === 'queued' || c.status === 'running') && (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button onClick={() => void processCampaign(c.id)} disabled={processingId !== null} className="min-h-8 px-3 py-1.5 text-xs rounded-lg border border-[var(--color-primary)] text-[var(--color-primary-dark)] disabled:opacity-50">
                            {processingId === c.id ? 'Traitement…' : 'Traiter maintenant'}
                          </button>
                          <button onClick={() => void handleCancel(c.id)} disabled={processingId === c.id} className="min-h-8 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-red-600 disabled:opacity-50">Annuler</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating ? (
        <div className="border border-dashed border-gray-200 rounded-lg p-4 space-y-4">
          {error && <div className="px-3 py-2 rounded-lg text-xs bg-red-50 text-red-700">{error}</div>}
          <div>
            <label className={LABEL_CLS}>Nom (optionnel)</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} placeholder="Ex. Couverture Italie — villes principales" />
          </div>

          <div>
            <label className={LABEL_CLS}>Profils d&apos;emballage</label>
            {profiles.length === 0 ? (
              <p className="text-xs text-amber-600">Aucun profil actif — configurez-en dans « Emballages ».</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {profiles.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-sm text-gray-600">
                    <input type="checkbox" checked={selectedProfiles.includes(p.id)} onChange={() => setSelectedProfiles((prev) => prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id])} />
                    {p.name} <span className="text-2xs text-gray-400">({formatKg(p.max_weight_g / 1000)} kg max)</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className={LABEL_CLS}>Échantillonnage des poids</label>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Mode d'échantillonnage">
              {SAMPLING_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  role="radio"
                  aria-checked={samplingMode === mode.value}
                  onClick={() => changeMode(mode.value)}
                  className={`rounded-lg border p-3 text-left transition-colors ${samplingMode === mode.value ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <span className="block text-sm font-semibold text-gray-900">{mode.title}</span>
                  <span className="mt-0.5 block text-2xs text-gray-500">{mode.description}</span>
                </button>
              ))}
            </div>

            {samplingMode === 'manual' ? (
              <div className="mt-2">
                <input type="text" value={weightsInput} onChange={(e) => setWeightsInput(e.target.value)} className={INPUT_CLS} placeholder="Ex. 1, 3, 7.5, 14.5, 15.5, 30" aria-label="Poids manuels (kg)" />
                <p className="text-xs text-gray-400 mt-1">Poids en kg séparés par des virgules (point décimal), testés pour chaque profil et chaque CAP.</p>
              </div>
            ) : (
              <ul className="mt-2 space-y-1">
                {weightsByProfile.map((entry) => (
                  <li key={entry.profile.id} className="text-xs text-gray-600">
                    <span className="font-medium">{entry.profile.name}</span> — {entry.weights.length} poids : {entry.weights.map(formatKg).join(' · ')} kg
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className={LABEL_CLS}>Destinations</label>
            <div className="mb-2 inline-flex rounded-lg border border-gray-200 p-0.5" role="tablist" aria-label="Type de destinations">
              {([['postal', 'Par ville ou CAP'], ['zone_sentinels', 'Par zone (CAP témoins)']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={destinationMode === value}
                  onClick={() => setDestinationMode(value)}
                  className={`min-h-9 px-3 py-1 text-xs rounded-md ${destinationMode === value ? 'bg-[var(--color-primary)] text-white' : 'text-gray-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {destinationMode === 'zone_sentinels' ? (
              <ZoneSentinelPicker zones={zones} onChange={handleZoneDestinations} />
            ) : (<>
            <div className="space-y-2">
              {destinations.map((destination, index) => (
                <CampaignDestinationPicker
                  key={index}
                  value={destination}
                  zones={zones}
                  onChange={(next) => setDestinations((prev) => prev.map((item, i) => i === index ? next : item))}
                  onRemove={destinations.length > 1 ? () => setDestinations((prev) => prev.filter((_, i) => i !== index)) : undefined}
                />
              ))}
            </div>
            <button type="button" onClick={() => setDestinations((prev) => [...prev, emptyCampaignDestination()])} className="mt-2 text-xs text-[var(--color-primary-dark)] flex items-center gap-1">
              <IconPlus size={13} stroke={1.5} />Ajouter une ville
            </button>
            </>)}
          </div>

          <div className={`rounded-lg px-3 py-2 text-xs ${overLimit ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
            <strong>{expandedDestinations.length} CAP</strong> × <strong>{scenariosPerPostalCode} scénario(s) par CAP</strong>
            {weightsByProfile.length > 0 && <> ({overflowExplanation})</>} = <strong>{scenarioCount} scénario(s)</strong>
            <span className="block mt-0.5 text-2xs opacity-80">Au plus {scenarioCount} appel(s) Packlink : un devis identique encore frais est réemployé sans nouvel appel.</span>
          </div>

          {overLimit && (
            <div className="rounded-lg border border-red-200 p-3 space-y-2">
              <p className="text-xs text-red-700">
                Limite d&apos;une campagne : {MAX_CAMPAIGN_SCENARIOS} scénarios. Le dépassement vient de {expandedDestinations.length} CAP × {scenariosPerPostalCode} scénarios par CAP. Aucun CAP ni profil n&apos;est retiré automatiquement.
              </p>
              <div className="flex flex-wrap gap-2">
                {samplingMode !== 'initial' && (
                  <button type="button" onClick={() => changeMode('initial')} className="min-h-10 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700">
                    Passer en Couverture initiale ({initialPreviewCount} scénarios)
                  </button>
                )}
              </div>
              {parts.length > 0 ? (
                <div>
                  <p className="text-xs text-gray-600 mb-1.5">Découpage déterministe par CAP (triés), en {parts.length} campagnes à lancer une par une :</p>
                  <ul className="space-y-1.5">
                    {parts.map((part, i) => {
                      const partIndex = i + 1;
                      const launched = launchedParts.includes(partIndex);
                      return (
                        <li key={partIndex} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-50 px-2.5 py-1.5 text-xs">
                          <span>
                            Partie {partIndex}/{parts.length} — {part.length} CAP ({part[0]?.postalCode} → {part[part.length - 1]?.postalCode}) · {part.length * scenariosPerPostalCode} scénarios
                          </span>
                          <button
                            type="button"
                            disabled={submitting || launched}
                            onClick={() => void createCampaign(part, { index: partIndex, count: parts.length })}
                            className="min-h-9 px-3 py-1 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary-dark)] disabled:opacity-50"
                          >
                            {launched ? 'Lancée' : `Lancer la partie ${partIndex}`}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-gray-600">Un seul CAP dépasse déjà la limite : réduisez les poids ou les profils.</p>
              )}
            </div>
          )}

          {samplingMode === 'deep' && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <input type="checkbox" checked={confirmDeep} onChange={(e) => setConfirmDeep(e.target.checked)} className="mt-0.5" />
              <span>Je confirme lancer une analyse approfondie : jusqu&apos;à {Math.min(scenarioCount, MAX_CAMPAIGN_SCENARIOS)} appel(s) Packlink par campagne.</span>
            </label>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={() => void createCampaign(expandedDestinations)} disabled={submitting || scenarioCount === 0 || overLimit || (samplingMode === 'deep' && !confirmDeep)} className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50">
              {submitting ? 'Lancement…' : 'Lancer la campagne'}
            </button>
            <button onClick={() => setCreating(false)} disabled={submitting} className="min-h-11 px-4 py-2 text-xs rounded-lg border border-gray-200 text-gray-500 disabled:opacity-50">Fermer</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="min-h-11 flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)]"><IconPlus size={14} stroke={1.5} />Nouvelle campagne</button>
      )}
    </section>
  );
}
