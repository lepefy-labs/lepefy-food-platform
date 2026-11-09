'use client';

import { useState } from 'react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import Button from '../../../_components/ui/Button';
import InlineAlert from '../../../_components/ui/InlineAlert';
import { Panel } from '../../../_components/ui/Panel';
import { Input, hintClasses, labelClasses } from '../../../_components/ui/Form';
import { useAdminMutation } from '../../../_components/ui/useAdminMutation';
import type { PackagingWeightBand } from '@/lib/shipping/packagingWeight';

interface Row { key: number; maxKg: string; addedKg: string }

const toKg = (grams: number) => String(grams / 1000).replace('.', ',');
const toGrams = (kg: string): number | null => {
  const value = Number(kg.trim().replace(',', '.'));
  return kg.trim() === '' || !Number.isFinite(value) ? null : Math.round(value * 1000);
};
const label = (grams: number) => `${(grams / 1000).toLocaleString('fr-FR')} kg`;

export function PackagingWeightBandsSection({ initial, canManage, migrationReady }: {
  initial: PackagingWeightBand[]; canManage: boolean; migrationReady: boolean;
}) {
  const [nextKey, setNextKey] = useState(initial.length);
  const [rows, setRows] = useState<Row[]>(initial.map((band, key) => ({
    key, maxKg: band.maxWeightGInclusive === null ? '' : toKg(band.maxWeightGInclusive), addedKg: toKg(band.addedWeightG),
  })));
  const [formError, setFormError] = useState<string | null>(null);
  const mutation = useAdminMutation();
  const disabled = !canManage || !migrationReady || mutation.pending;

  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  function addBand() {
    // La tranche ouverte reste en dernier : la nouvelle limite s'insère avant elle.
    setRows((list) => (list.length === 0
      ? [{ key: nextKey, maxKg: '', addedKg: '' }]
      : [...list.slice(0, -1), { key: nextKey, maxKg: '', addedKg: '' }, list[list.length - 1]!]));
    setNextKey((key) => key + 1);
  }

  async function save() {
    let previous = 0;
    const bands: Array<{ maxWeightG: number | null; addedWeightG: number }> = [];
    for (const [index, row] of rows.entries()) {
      const isLast = index === rows.length - 1;
      const added = toGrams(row.addedKg);
      const max = isLast ? null : toGrams(row.maxKg);
      if (added === null || added < 0) { setFormError('Indiquez le poids ajouté de chaque tranche.'); return; }
      if (!isLast && (max === null || max <= previous)) { setFormError('Les limites de poids doivent être croissantes.'); return; }
      bands.push({ maxWeightG: max, addedWeightG: added });
      previous = max ?? previous;
    }
    setFormError(null);
    await mutation.run('/api/admin/shipping-packaging-weight', {
      method: 'PUT', body: { bands }, successMessage: 'Poids d’emballage enregistré.', errorToast: true,
    });
  }

  let from = 0;
  return (
    <Panel
      className="mb-4"
      title="Poids d’emballage"
      description="Ajouté au poids net total de la commande pour le poids envoyé au transporteur. Il augmente les frais de livraison uniquement sans forfait ; le prix du forfait, le nombre de colis et le carton suggéré restent calculés sur le poids net. Remplace la tare des cartons."
    >
      <div className="space-y-3">
        {!migrationReady && (
          <InlineAlert tone="warning" title="Configuration indisponible">
            La migration 180 n’est pas encore appliquée : ce réglage ne peut pas être enregistré.
          </InlineAlert>
        )}
        {rows.length === 0 && <p className="text-sm text-a-text-3">Aucune tranche : le poids envoyé au transporteur utilise la tare de chaque carton.</p>}
        {formError && <p role="alert" className="text-sm text-tone-danger-fg">{formError}</p>}
        <ul className="space-y-2">
          {rows.map((row, index) => {
            const isLast = index === rows.length - 1;
            const start = from;
            if (!isLast) from = toGrams(row.maxKg) ?? from;
            return (
              <li key={row.key} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                {isLast ? (
                  <p className="flex min-h-11 items-center text-sm text-a-text">{rows.length === 1 ? 'Toutes les commandes' : `Au-delà de ${label(start)}`}</p>
                ) : (
                  <div>
                    <label className={labelClasses} htmlFor={`band-max-${row.key}`}>Au-delà de {label(start)}, jusqu’à (kg)</label>
                    <Input id={`band-max-${row.key}`} inputMode="decimal" disabled={disabled} value={row.maxKg} onChange={(e) => update(row.key, { maxKg: e.target.value })} />
                  </div>
                )}
                <div>
                  <label className={labelClasses} htmlFor={`band-added-${row.key}`}>Poids ajouté (kg)</label>
                  <Input id={`band-added-${row.key}`} inputMode="decimal" disabled={disabled} value={row.addedKg} onChange={(e) => update(row.key, { addedKg: e.target.value })} />
                </div>
                <button
                  type="button" disabled={disabled} onClick={() => setRows((list) => list.filter((item) => item.key !== row.key))}
                  aria-label={`Supprimer la tranche ${index + 1}`}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-a-border text-tone-danger-fg disabled:opacity-50"
                >
                  <IconTrash size={16} stroke={1.5} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        <p className={hintClasses}>Une limite appartient à sa tranche : 5 kg exactement utilise la tranche « jusqu’à 5 kg ». Tout supprimer puis enregistrer désactive ce réglage.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled} onClick={addBand} className="flex min-h-11 items-center gap-1.5 rounded-lg border border-a-border px-3 text-sm disabled:opacity-50">
            <IconPlus size={16} stroke={1.5} aria-hidden="true" />Ajouter une tranche
          </button>
          <Button disabled={disabled} onClick={() => void save()}>{mutation.pending ? 'Enregistrement…' : 'Enregistrer'}</Button>
        </div>
      </div>
    </Panel>
  );
}
