'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IconPlus, IconRefresh } from '@tabler/icons-react';
import type { ShippingPackagingProfileRow, ShippingSimulationCampaignRow, ShippingZoneRow } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

const DEFAULT_WEIGHTS = '1, 2, 3, 5, 7.5, 9, 9.5, 10, 10.5, 11, 12.5, 14, 14.5, 15, 15.5, 16, 20';
const COUNTRIES = [
  { value: 'IT', label: 'Italie' },
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'DE', label: 'Allemagne' },
  { value: 'CH', label: 'Suisse' },
];

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', queued: 'En file', running: 'En cours',
  completed: 'Terminée', completed_with_errors: 'Terminée avec erreurs', cancelled: 'Annulée',
};
const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500', queued: 'bg-amber-50 text-amber-700', running: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700', completed_with_errors: 'bg-amber-50 text-amber-700', cancelled: 'bg-gray-100 text-gray-400',
};

interface DestinationRow { country: string; postalCode: string; zoneCode: string | null }

export function CampaignManager({ profiles, zones }: { profiles: ShippingPackagingProfileRow[]; zones: ShippingZoneRow[] }) {
  const [campaigns, setCampaigns] = useState<ShippingSimulationCampaignRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [weightsInput, setWeightsInput] = useState(DEFAULT_WEIGHTS);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>(profiles.filter((p) => p.active).map((p) => p.id));
  const [destinations, setDestinations] = useState<DestinationRow[]>([{ country: 'IT', postalCode: '', zoneCode: null }]);

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

  function updateDestination(index: number, patch: Partial<DestinationRow>) {
    setDestinations((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  async function handleCreate() {
    setError(null);
    const weightsKg = weightsInput.split(',').map((w) => Number(w.trim())).filter((w) => Number.isFinite(w) && w > 0);
    if (weightsKg.length === 0) { setError('Indiquez au moins un poids valide.'); return; }
    if (selectedProfiles.length === 0) { setError('Sélectionnez au moins un profil d\'emballage.'); return; }
    const validDestinations = destinations.filter((d) => d.postalCode.trim());
    if (validDestinations.length === 0) { setError('Indiquez au moins une destination (code postal).'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/shipping-simulation-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          weightsKg,
          packagingProfileIds: selectedProfiles,
          destinations: validDestinations.map((d) => ({ country: d.country, postalCode: d.postalCode.trim(), zoneCode: d.zoneCode })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      setCreating(false);
      setName('');
      await loadCampaigns();
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

  const scenarioCount = weightsInput.split(',').map((w) => w.trim()).filter(Boolean).length
    * selectedProfiles.length
    * destinations.filter((d) => d.postalCode.trim()).length;

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Campagnes de simulation</h2>
        <button onClick={() => void loadCampaigns()} className="min-h-8 px-2 py-1.5 text-xs rounded-lg border border-gray-200 flex items-center gap-1 text-gray-500"><IconRefresh size={14} stroke={1.5} />Actualiser</button>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Traitées par lots bornés (2 requêtes Packlink simultanées maximum, toutes les 5 minutes) — jamais en rafale. Les scénarios déjà couverts par une observation récente ne redemandent pas Packlink.
      </p>

      {loadingList ? (
        <p className="text-sm text-gray-400 mb-4">Chargement…</p>
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-gray-400 mb-4">Aucune campagne encore lancée.</p>
      ) : (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-2xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                <th className="py-2 pr-3">Nom</th><th className="py-2 pr-3">Statut</th><th className="py-2 pr-3">Progression</th><th className="py-2 pr-3">Créée</th><th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 dark:border-gray-800/60">
                  <td className="py-2.5 pr-3"><Link href={`/admin/livraison/laboratoire/${c.id}`} className="text-[var(--color-primary-dark)] hover:underline">{c.name}</Link></td>
                  <td className="py-2.5 pr-3"><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${STATUS_CLS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>{STATUS_LABEL[c.status] ?? c.status}</span></td>
                  <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-300">{c.completed_scenarios}/{c.total_scenarios}{c.failed_scenarios > 0 && <span className="text-red-500"> · {c.failed_scenarios} échec(s)</span>}</td>
                  <td className="py-2.5 pr-3 text-gray-400">{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="py-2.5 pr-3 text-right">
                    {(c.status === 'queued' || c.status === 'running') && (
                      <button onClick={() => void handleCancel(c.id)} className="min-h-8 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-red-600">Annuler</button>
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
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} placeholder="Ex. Comparaison boîtes IT/FR" />
          </div>
          <div>
            <label className={LABEL_CLS}>Poids représentatifs (kg, séparés par des virgules)</label>
            <input type="text" value={weightsInput} onChange={(e) => setWeightsInput(e.target.value)} className={INPUT_CLS} />
            <p className="text-xs text-gray-400 mt-1">Densité accrue autour des seuils suspectés (10 kg, 15 kg) recommandée.</p>
          </div>
          <div>
            <label className={LABEL_CLS}>Profils d&apos;emballage</label>
            {profiles.length === 0 ? (
              <p className="text-xs text-amber-600">Aucun profil actif — configurez-en dans l&apos;onglet « Emballages ».</p>
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
              {destinations.map((d, i) => (
                <div key={i} className="flex gap-2">
                  <select value={d.country} onChange={(e) => updateDestination(i, { country: e.target.value })} className={`${INPUT_CLS} w-32`}>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <input type="text" value={d.postalCode} onChange={(e) => updateDestination(i, { postalCode: e.target.value })} placeholder="Code postal" className={INPUT_CLS} />
                  <select value={d.zoneCode ?? ''} onChange={(e) => updateDestination(i, { zoneCode: e.target.value || null })} className={`${INPUT_CLS} w-40`}>
                    <option value="">Zone (auto)</option>
                    {zones.filter((z) => z.country === d.country).map((z) => <option key={z.id} value={z.code}>{z.code}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <button onClick={() => setDestinations((prev) => [...prev, { country: 'IT', postalCode: '', zoneCode: null }])} className="mt-2 text-xs text-[var(--color-primary-dark)] flex items-center gap-1"><IconPlus size={13} stroke={1.5} />Ajouter une destination</button>
          </div>
          <p className="text-xs text-gray-500">≈ {scenarioCount} scénario(s) au total.</p>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => void handleCreate()} disabled={submitting} className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50">{submitting ? 'Lancement…' : 'Lancer la campagne'}</button>
            <button onClick={() => setCreating(false)} disabled={submitting} className="min-h-11 px-4 py-2 text-xs rounded-lg border border-gray-200 text-gray-500 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="min-h-11 flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)]"><IconPlus size={14} stroke={1.5} />Nouvelle campagne</button>
      )}
    </section>
  );
}
