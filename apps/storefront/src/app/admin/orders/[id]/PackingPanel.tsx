'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCheck, IconPackage, IconSnowflake } from '@tabler/icons-react';

interface Props {
  orderId: string;
  status: string;
  pickingComplete: boolean;
  hasColdChain: boolean;
  estimatedParcels: number | null;
  initialParcelCount: number | null;
  initialColdChecked: boolean;
  initialComplete: boolean;
  /** Without orders.manage the panel only shows the current state. */
  readOnly?: boolean;
}

export default function PackingPanel({
  orderId,
  status,
  pickingComplete,
  hasColdChain,
  estimatedParcels,
  initialParcelCount,
  initialColdChecked,
  initialComplete,
  readOnly = false,
}: Props) {
  const router = useRouter();
  const [parcelCount, setParcelCount] = useState(String(initialParcelCount ?? estimatedParcels ?? 1));
  const [coldChecked, setColdChecked] = useState(initialColdChecked);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(initialComplete);

  if (status !== 'preparing') return null;

  const canComplete = pickingComplete
    && Number.isInteger(Number(parcelCount))
    && Number(parcelCount) >= 1
    && (!hasColdChain || coldChecked);

  async function savePacking() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/packing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parcel_count: Number(parcelCount),
          cold_chain_checked: coldChecked,
        }),
      });
      const payload = await res.json().catch(() => null) as { error?: string; packing?: { complete?: boolean } } | null;
      if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`);
      setComplete(Boolean(payload?.packing?.complete));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’enregistrer l’emballage.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="order-packing" aria-labelledby="order-packing-title" className={`scroll-mt-24 overflow-hidden rounded-2xl border shadow-sm ${complete
      ? 'border-tone-success-border bg-tone-success-bg'
      : 'border-a-border bg-a-brand-soft'
    }`}>
      <div className="flex items-start justify-between gap-3 border-b border-inherit px-4 py-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-a-brand-fg">Emballage</p>
          <h2 id="order-packing-title" className="mt-1 text-base font-semibold text-a-text">Préparer les colis</h2>
        </div>
        {complete && (
          <span className="inline-flex items-center gap-1 rounded-full bg-tone-success-bg px-2 py-1 text-xs font-bold text-tone-success-fg">
            <IconCheck size={12} aria-hidden="true" /> Emballage terminé
          </span>
        )}
      </div>

      <div className="space-y-4 bg-a-surface p-4">
        {!pickingComplete && (
          <div className="rounded-xl border border-tone-warning-border bg-tone-warning-bg p-3 text-xs leading-5 text-tone-warning-fg">
            Terminez d’abord la checklist de préparation : l’emballage ne peut pas être validé avant.
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-a-text-3">Nombre réel de colis</label>
          <div className="flex items-center gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-a-hover text-a-text-2">
              <IconPackage size={19} />
            </span>
            <input
              type="number"
              min={1}
              max={99}
              step={1}
              value={parcelCount}
              onChange={event => {
                setParcelCount(event.target.value);
                setComplete(false);
              }}
              disabled={!pickingComplete || saving || readOnly}
              className="h-11 w-full rounded-xl border border-a-border bg-a-surface px-3 text-sm font-semibold text-a-text focus:outline-none focus:ring-2 focus:ring-a-focus disabled:opacity-50"
            />
          </div>
          {estimatedParcels != null && (
            <p className="mt-1.5 text-xs text-a-text-3">Estimation transport : {estimatedParcels} colis. Saisissez le nombre réellement préparé.</p>
          )}
        </div>

        {hasColdChain && (
          <label className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 ${coldChecked
            ? 'border-tone-info-border bg-tone-info-bg'
            : 'border-a-border bg-a-surface-2'
          }`}>
            <input
              type="checkbox"
              checked={coldChecked}
              onChange={event => {
                setColdChecked(event.target.checked);
                setComplete(false);
              }}
              disabled={!pickingComplete || saving || readOnly}
              className="mt-0.5 h-5 w-5 rounded border-a-border-strong"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-a-text">
                <IconSnowflake size={16} className="text-tone-info-fg" /> Emballage chaîne du froid validé
              </span>
              <span className="mt-1 block text-xs leading-5 text-a-text-3">
                Confirmez que frais/surgelés sont conditionnés avec l’emballage adapté avant fermeture des colis.
              </span>
            </span>
          </label>
        )}

        {!readOnly && <button
          type="button"
          onClick={() => void savePacking()}
          disabled={!canComplete || saving}
          className="min-h-11 w-full rounded-xl bg-a-brand px-4 py-2.5 text-sm font-semibold text-a-on-brand transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : complete ? 'Mettre à jour l’emballage' : 'Valider l’emballage'}
        </button>}

        {error && <p className="text-xs font-medium text-tone-danger-fg" role="alert">{error}</p>}
        {complete && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-tone-success-fg">
            <IconCheck size={14} aria-hidden="true" /> Colis prêts pour l’expédition.
          </p>
        )}
      </div>
    </section>
  );
}
