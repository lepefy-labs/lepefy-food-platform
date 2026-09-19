'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconPlus, IconRefresh } from '@tabler/icons-react';
import type { ShippingPackagingProfileRow, ShippingSimulationCampaignRow, ShippingZoneRow } from '@lepefy/types';
import {
  CampaignDestinationPicker,
  emptyCampaignDestination,
  type CampaignDestinationRow,
} from './CampaignDestinationPicker';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';
const DEFAULT_WEIGHTS = '1, 2, 3, 5, 7.5, 9, 9.5, 10, 10.5, 11, 12.5, 14, 14.5, 15, 15.5, 16, 20';
const MAX_CAMPAIGN_SCENARIOS = 2000;

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', queued: 'En file', running: 'En cours',
  completed: 'Terminée', completed_with_errors: 'Terminée avec erreurs', cancelled: 'Annulée',
};
const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500', queued: 'bg-amber-50 text-amber-700', running: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700', completed_with_errors: 'bg-amber-50 text-amber-700', cancelled: 'bg-gray-100 text-gray-400',
};
type CampaignNotice = { tone: 'success' | 'warning'; text: string };

export function CampaignManager({ profiles, zones }: { profiles: ShippingPackagingProfileRow[]; zones: ShippingZoneRow[] }) {
  const [campaigns, setCampaigns] = useState<ShippingSimulationCampaignRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<CampaignNotice | null>(null);
  const [name, setName] = useState('');
  const [weightsInput, setWeightsInput] = useState(DEFAULT_WEIGHTS);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>(profiles.filter((p) => p.active).map((p) => p.id));
  const [destinations, setDestinations] = useState<CampaignDestinationRow[]>([emptyCampaignDestination()]);

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

  const weightsKg = useMemo(
    () => weightsInput.split(',').map((w) => Number(w.trim())).filter((w) => Number.isFinite(w) && w > 0),
    [weightsInput],
  );

  const expandedDestinations = useMemo(() => {
    const unique = new Map<string, { country: string; postalCode: string; zoneCode: string | null; label: string }>();
    for (const destination of destinations) {
      const postalCodes = destination.mode === 'city'
        ? destination.postalCodes
        : [destination.manualPostalCode.trim()].filter(Boolean);

      for (const postalCode of postalCodes) {
        const normalizedPostalCode = postalCode.trim().toUpperCase();
        if (!normalizedPostalCode) continue;
        const key = `${destination.country}|${normalizedPostalCode}`;
        if (unique.has(key)) continue;
        unique.set(key, {
          country: destination.country,
          postalCode: normalizedPostalCode,
          zoneCode: destination.zoneCode,
          label: destination.mode === 'city' && destination.city
            ? `${destination.city} · ${normalizedPostalCode}`
            : `${destination.country} · ${normalizedPostalCode}`,
        });
      }
    }
    return Array.from(unique.values());
  }, [destinations]);

  const scenariosPerPostalCode = weightsKg.length * selectedProfiles.length;
  const scenarioCount = scenariosPerPostalCode * expandedDestinations.length;

  async function processCampaign(id: string, automatic = false) {
    setProcessingId(id);
    if (!automatic) setNotice(null);
    try {
      const res = await fetch(`/api/admin/shipping-simulation-campaigns/${id}/process`, { method: 'POST' });
      const data = await res.json() as {
        error?: string;
        result?: { processed: number; succeeded: number; failed: number; skipped: number };
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
        ? { tone: 'success', text: `Lot immédiat : ${result?.processed ?? 0} scénario(s), ${result?.succeeded ?? 0} réussi(s), ${result?.skipped ?? 0} doublon(s), ${result?.failed ?? 0} échec(s). Le worker poursuivra si nécessaire.` }
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

  async function handleCreate() {
    setError(null);
    setNotice(null);
    if (weightsKg.length === 0) return setError('Indiquez au moins un poids valide.');
    if (selectedProfiles.length === 0) return setError('Sélectionnez au moins un profil d\'emballage.');
    if (expandedDestinations.length === 0) return setError('Sélectionnez au moins une ville ou indiquez un code postal.');
    if (scenarioCount > MAX_CAMPAIGN_SCENARIOS) {
      return setError(`${scenarioCount} scénarios dépassent la limite de ${MAX_CAMPAIGN_SCENARIOS}. Réduisez les poids, profils ou destinations.`);
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/shipping-simulation-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          weightsKg,
          packagingProfileIds: selectedProfiles,
          destinations: expandedDestinations,
        }),
      });
      const data = await res.json() as ShippingSimulationCampaignRow & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Erreur');
      setCreating(false);
      setName('');
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

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Campagnes de simulation</h2>
        <button onClick={() => void loadCampaigns()} className="min-h-8 px-2 py-1.5 text-xs rounded-lg border border-gray-200 flex items-center gap-1 text-gray-500"><IconRefresh size={14} stroke={1.5} />Actualiser</button>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Une ville est déployée sur tous ses codes postaux connus. Chaque CAP reçoit toutes les combinaisons poids × profils ; le worker traite les appels Packlink par petits lots.
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
              <th className="py-2 pr-3">Nom</th><th className="py-2 pr-3">Statut</th><th className="py-2 pr-3">Progression</th><th className="py-2 pr-3">Créée</th><th className="py-2 pr-3 text-right">Actions</th>
            </tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 dark:border-gray-800/60">
                  <td className="py-2.5 pr-3"><Link href={`/admin/livraison/laboratoire/${c.id}`} className="text-[var(--color-primary-dark)] hover:underline">{c.name}</Link></td>
                  <td className="py-2.5 pr-3"><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${STATUS_CLS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>{STATUS_LABEL[c.status] ?? c.status}</span></td>
                  <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-300">{c.completed_scenarios}/{c.total_scenarios}{c.failed_scenarios > 0 && <span className="text-red-500"> · {c.failed_scenarios} échec(s)</span>}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating ? (
        <div className="border border-dashed border-gray-200 rounded-lg p-4 space-y-3">
          {error && <div className="px-3 py-2 rounded-lg text-xs bg-red-50 text-red-700">{error}</div>}
          <div>
            <label className={LABEL_CLS}>Nom (optionnel)</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} placeholder="Ex. Couverture Italie — villes principales" />
          </div>
          <div>
            <label className={LABEL_CLS}>Poids représentatifs (kg, séparés par des virgules)</label>
            <input type="text" value={weightsInput} onChange={(e) => setWeightsInput(e.target.value)} className={INPUT_CLS} />
            <p className="text-xs text-gray-400 mt-1">Ces poids sont testés pour chaque CAP ; gardez une densité accrue autour des seuils 10 kg et 15 kg.</p>
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
                    {p.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className={LABEL_CLS}>Destinations</label>
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
          </div>

          <div className={`rounded-lg px-3 py-2 text-xs ${scenarioCount > MAX_CAMPAIGN_SCENARIOS ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
            <strong>{expandedDestinations.length} CAP</strong> × <strong>{scenariosPerPostalCode} scénario(s) par CAP</strong> = <strong>{scenarioCount} scénario(s)</strong>
            {scenarioCount > MAX_CAMPAIGN_SCENARIOS && <> · limite {MAX_CAMPAIGN_SCENARIOS}</>}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => void handleCreate()} disabled={submitting || scenarioCount === 0 || scenarioCount > MAX_CAMPAIGN_SCENARIOS} className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50">
              {submitting ? 'Lancement…' : 'Lancer la campagne'}
            </button>
            <button onClick={() => setCreating(false)} disabled={submitting} className="min-h-11 px-4 py-2 text-xs rounded-lg border border-gray-200 text-gray-500 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="min-h-11 flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)]"><IconPlus size={14} stroke={1.5} />Nouvelle campagne</button>
      )}
    </section>
  );
}
