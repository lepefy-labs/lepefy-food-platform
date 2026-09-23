'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconRefreshDot } from '@tabler/icons-react';
import { MAX_CAMPAIGN_SCENARIOS } from '@/lib/shipping/intelligence/scenarioMatrix';
import { ERROR_REASONS } from '@/lib/shipping/intelligence/campaignErrorReasons';
import type { ErrorBreakdownEntry } from '@/lib/shipping/intelligence/campaignCoverage';

/**
 * Remesure explicite des scénarios sans devis valide. Jamais automatique :
 * l'admin voit le volume, confirme, puis une campagne dédiée est créée en file
 * (le worker réemploiera un devis identique frais avant tout appel Packlink).
 */
export function ResampleCampaignButton({
  campaignId,
  candidates,
  breakdown,
  disabled,
}: {
  campaignId: string;
  candidates: number;
  breakdown: ErrorBreakdownEntry[];
  disabled: boolean;
}) {
  const included = breakdown.filter((e) => e.resample);
  const excluded = breakdown.filter((e) => !e.resample);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; scenarios: number; deferred: number; profileMissing: number } | null>(null);

  if (candidates === 0) {
    return <p className="text-xs text-green-700">Aucun scénario à remesurer.</p>;
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/shipping-simulation-campaigns/${campaignId}/resample`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json() as { error?: string; campaign?: { id: string }; scenarios?: number; deferred?: number; profileMissing?: number };
      if (!res.ok || !data.campaign) throw new Error(data.error ?? 'Erreur');
      setCreated({ id: data.campaign.id, scenarios: data.scenarios ?? 0, deferred: data.deferred ?? 0, profileMissing: data.profileMissing ?? 0 });
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création de la remesure.');
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
        Campagne de remesure créée : {created.scenarios} scénario(s) en file.
        {created.deferred > 0 && <> {created.deferred} scénario(s) au-delà de la limite restent à remesurer ensuite.</>}
        {created.profileMissing > 0 && <> {created.profileMissing} scénario(s) ignoré(s) : profil d&apos;emballage supprimé.</>}
        {' '}<Link href={`/admin/livraison/laboratoire/${created.id}`} className="underline">Ouvrir</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={disabled}
          className="min-h-10 inline-flex items-center gap-1.5 self-start px-3 py-1.5 text-xs rounded-lg border border-[var(--color-primary)] text-[var(--color-primary-dark)] disabled:opacity-50"
        >
          <IconRefreshDot size={14} stroke={1.5} />
          Remesurer {candidates} scénario(s)
        </button>
      ) : (
        <div className="rounded-lg border border-gray-200 p-3 text-xs space-y-2">
          <p className="text-gray-700">
            Créer une campagne de remesure pour {Math.min(candidates, MAX_CAMPAIGN_SCENARIOS)} scénario(s).
            Jusqu&apos;à {Math.min(candidates, MAX_CAMPAIGN_SCENARIOS)} appel(s) Packlink ; un devis identique encore frais sera réemployé sans appel, et un CAP refusé par Packlink est arrêté après deux poids.
          </p>
          <ul className="space-y-0.5">
            {included.map((e) => (
              <li key={e.code} className="text-gray-700">✓ {ERROR_REASONS[e.code].label} — {e.scenarios} scénario(s), {e.postalCodes.length} CAP</li>
            ))}
            {excluded.map((e) => (
              <li key={e.code} className="text-gray-400">✕ {ERROR_REASONS[e.code].label} — {e.scenarios} scénario(s) exclus (refus déterministe)</li>
            ))}
          </ul>
          {candidates > MAX_CAMPAIGN_SCENARIOS && (
            <p className="text-amber-700">Au-delà de {MAX_CAMPAIGN_SCENARIOS}, les scénarios restants (ordre déterministe) resteront à remesurer ensuite.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void submit()} disabled={submitting} className="min-h-10 px-3 py-1.5 rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50">
              {submitting ? 'Création…' : 'Confirmer la remesure'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={submitting} className="min-h-10 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500">Annuler</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
