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
      setError(err instanceof Error ? err.message : 'Impossible d’enregistrer le packing.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`overflow-hidden rounded-2xl border shadow-sm ${complete
      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20'
      : 'border-violet-200 bg-violet-50/50 dark:border-violet-900 dark:bg-violet-950/20'
    }`}>
      <div className="flex items-start justify-between gap-3 border-b border-inherit px-4 py-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">Packing & expédition</p>
          <h2 className="mt-1 text-base font-semibold text-gray-950 dark:text-gray-100">Préparer les colis</h2>
        </div>
        {complete && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <IconCheck size={12} /> Packing terminé
          </span>
        )}
      </div>

      <div className="space-y-4 bg-white p-4 dark:bg-gray-900">
        {!pickingComplete && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Terminez d’abord la checklist de préparation. Le packing ne peut pas être validé tant que le picking est incomplet.
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Nombre réel de colis</label>
          <div className="flex items-center gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
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
              disabled={!pickingComplete || saving}
              className="h-11 w-full rounded-xl border border-[var(--admin-border)] bg-white px-3 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)] disabled:opacity-50 dark:bg-gray-950 dark:text-gray-100"
            />
          </div>
          {estimatedParcels != null && (
            <p className="mt-1.5 text-[11px] text-gray-400">Estimation transport : {estimatedParcels} colis. Saisissez le nombre réellement préparé.</p>
          )}
        </div>

        {hasColdChain && (
          <label className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 ${coldChecked
            ? 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30'
            : 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950/40'
          }`}>
            <input
              type="checkbox"
              checked={coldChecked}
              onChange={event => {
                setColdChecked(event.target.checked);
                setComplete(false);
              }}
              disabled={!pickingComplete || saving}
              className="mt-0.5 h-5 w-5 rounded border-gray-300"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
                <IconSnowflake size={16} className="text-sky-600" /> Emballage chaîne du froid validé
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                Confirmez que frais/surgelés sont conditionnés avec l’emballage adapté avant fermeture des colis.
              </span>
            </span>
          </label>
        )}

        <button
          type="button"
          onClick={() => void savePacking()}
          disabled={!canComplete || saving}
          className="min-h-11 w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : complete ? 'Mettre à jour le packing' : 'Valider le packing'}
        </button>

        {error && <p className="text-xs font-medium text-red-600" role="alert">{error}</p>}
        {complete && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <IconCheck size={14} /> Colis prêts. Renseignez le tracking puis expédiez la commande.
          </p>
        )}
      </div>
    </section>
  );
}
