'use client';

import { useState } from 'react';
import { IconPackageImport } from '@tabler/icons-react';
import Button from '../../../../_components/ui/Button';
import { PURCHASE_UNIT_LABELS, type PurchaseUnit } from '@/lib/gestion/domain';
import { formatQuantityWithUnit, formatStockUnits, todayIso } from '@/lib/gestion/format';
import { parseConversion, parseQuantity, quantityToString, remainingQuantity, stockUnitsFor } from '@/lib/gestion/quantity';
import { ErrorText, useGestionMutation } from '../../_components/useGestionMutation';
import { INPUT_CLS, LABEL_CLS } from '../../_components/ui';

export interface ReceivableLine {
  id: string;
  description: string;
  linked: boolean;
  /** Quantités en unité d'achat (3 décimales au plus). */
  ordered: number;
  received: number;
  unit: PurchaseUnit;
  conversion: number | null;
}

/**
 * Réception complète ou partielle, quantités décimales. Arithmétique exacte
 * (entiers BigInt en millièmes) : « Tout le reste est reçu » ne produit jamais
 * d'erreur flottante. Le serveur reste l'autorité (refus si conversion non entière).
 */
export function ReceiptForm({ purchaseId, lines }: { purchaseId: string; lines: ReceivableLine[] }) {
  const { run, pending, error, setError } = useGestionMutation();
  const rows = lines.map((line) => {
    const ordered = parseQuantity(line.ordered) ?? BigInt(0);
    const received = parseQuantity(line.received) ?? BigInt(0);
    return { ...line, orderedScaled: ordered, receivedScaled: received, remaining: remainingQuantity(ordered, received) };
  });
  const open = rows.filter((row) => row.remaining > BigInt(0));
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState<string | null>(null);

  if (!open.length) return <p className="text-sm text-gray-600 dark:text-gray-300">Toute la marchandise commandée a été reçue.</p>;

  function impact(row: (typeof open)[number]): { text: string; invalid: boolean } | null {
    const raw = quantities[row.id];
    if (!raw) return null;
    const quantity = parseQuantity(raw);
    if (quantity === null) return { text: 'Quantité invalide (3 décimales au plus).', invalid: true };
    if (quantity > row.remaining) return { text: `Au plus ${formatQuantityWithUnit(quantityToString(row.remaining), row.unit)}.`, invalid: true };
    if (!row.linked) return { text: 'Stock non modifié (hors catalogue).', invalid: false };
    const conversion = parseConversion(row.conversion ?? 1) ?? BigInt(0);
    const result = stockUnitsFor(quantity, conversion);
    return result.exact
      ? { text: `Stock ajouté : +${formatStockUnits(Number(result.units))}`, invalid: false }
      : { text: 'Ne donne pas un nombre entier d\'unités de stock : réception refusée.', invalid: true };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setDone(null);
    const items: { purchase_item_id: string; quantity: string }[] = [];
    for (const row of open) {
      const raw = quantities[row.id];
      if (!raw) continue;
      const quantity = parseQuantity(raw);
      if (quantity === null || quantity > row.remaining) {
        setError(`Quantité invalide pour « ${row.description} » (reste ${formatQuantityWithUnit(quantityToString(row.remaining), row.unit)}).`);
        return;
      }
      if (quantity > BigInt(0)) items.push({ purchase_item_id: row.id, quantity: quantityToString(quantity) });
    }
    if (!items.length) { setError('Indiquez au moins une quantité reçue.'); return; }
    const result = await run<{ reference: string; created: boolean }>(`/api/admin/gestion/purchases/${purchaseId}/receipts`, {
      body: { items, received_at: new Date(`${date}T12:00:00`).toISOString(), notes },
      withKey: true,
    });
    if (result) {
      setQuantities({});
      setNotes('');
      setDone(result.created ? `Réception ${result.reference} enregistrée. Le stock des produits liés a été mis à jour.` : `Réception ${result.reference} déjà enregistrée.`);
    }
  }

  return (
    <form id="reception" onSubmit={submit} className="scroll-mt-24 space-y-3 rounded-xl border border-gray-200 p-3 sm:p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Enregistrer une réception</p>
        <button type="button" onClick={() => setQuantities(Object.fromEntries(open.map((row) => [row.id, quantityToString(row.remaining).replace('.', ',')])))}
          className="min-h-11 rounded-lg px-3 text-sm font-medium text-[var(--admin-primary-fg)] hover:bg-[var(--admin-primary-soft)]">
          Tout le reste est reçu
        </button>
      </div>
      <ul className="space-y-3">
        {open.map((row) => {
          const preview = impact(row);
          return (
            <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-start gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-gray-900 dark:text-gray-100">{row.description}</p>
                <dl className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500 dark:text-gray-400">
                  <div><dt className="inline">Commandé </dt><dd className="inline">{formatQuantityWithUnit(row.ordered, row.unit)}</dd></div>
                  <div><dt className="inline">Déjà reçu </dt><dd className="inline">{formatQuantityWithUnit(row.received, row.unit)}</dd></div>
                  <div><dt className="inline">Reste </dt><dd className="inline">{formatQuantityWithUnit(quantityToString(row.remaining), row.unit)}</dd></div>
                </dl>
                {preview && <p className={`mt-0.5 text-xs ${preview.invalid ? 'font-medium text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{preview.text}</p>}
              </div>
              <label>
                <span className="sr-only">Quantité reçue pour {row.description}</span>
                <div className="flex items-center gap-1.5">
                  <input inputMode="decimal" className={`${INPUT_CLS} text-right`} value={quantities[row.id] ?? ''} placeholder="0"
                    onChange={(event) => setQuantities((prev) => ({ ...prev, [row.id]: event.target.value }))} />
                  <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{PURCHASE_UNIT_LABELS[row.unit]}</span>
                </div>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL_CLS}>Date de réception</span>
          <input type="date" className={INPUT_CLS} value={date} max={todayIso()} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="block">
          <span className={LABEL_CLS}>Note (écarts, casse…)</span>
          <input className={INPUT_CLS} value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </div>
      <ErrorText message={error} />
      {done && <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{done}</p>}
      <Button type="submit" loading={pending} className="min-h-11"><IconPackageImport size={16} aria-hidden="true" />Enregistrer la réception</Button>
    </form>
  );
}
