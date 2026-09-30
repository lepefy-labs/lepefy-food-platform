'use client';

import { useState } from 'react';
import { IconPackageImport } from '@tabler/icons-react';
import Button from '../../../../_components/ui/Button';
import { formatQuantity, todayIso } from '@/lib/gestion/format';
import { ErrorText, useGestionMutation } from '../../_components/useGestionMutation';
import { INPUT_CLS, LABEL_CLS } from '../../_components/ui';

export interface ReceivableLine {
  id: string;
  description: string;
  linked: boolean;
  ordered: number;
  received: number;
}

/**
 * Réception complète ou partielle. Quantités à 0 par défaut (aucune réception
 * implicite) ; le statut de l'achat est déduit en base des quantités reçues.
 */
export function ReceiptForm({ purchaseId, lines }: { purchaseId: string; lines: ReceivableLine[] }) {
  const { run, pending, error, setError } = useGestionMutation();
  const open = lines.filter((line) => line.ordered > line.received);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState<string | null>(null);

  if (!open.length) return <p className="text-sm text-gray-600 dark:text-gray-300">Toute la marchandise commandée a été reçue.</p>;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setDone(null);
    const items = open.map((line) => ({ purchase_item_id: line.id, quantity: Number(quantities[line.id] || 0) }));
    const invalid = open.find((line) => {
      const quantity = Number(quantities[line.id] || 0);
      return !Number.isInteger(quantity) || quantity < 0 || quantity > line.ordered - line.received;
    });
    if (invalid) { setError(`Quantité invalide pour « ${invalid.description} » (reste ${invalid.ordered - invalid.received}).`); return; }
    if (!items.some((item) => item.quantity > 0)) { setError('Indiquez au moins une quantité reçue.'); return; }
    const result = await run<{ reference: string; created: boolean }>(`/api/admin/gestion/purchases/${purchaseId}/receipts`, {
      body: { items: items.filter((item) => item.quantity > 0), received_at: new Date(`${date}T12:00:00`).toISOString(), notes },
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
        <button type="button" onClick={() => setQuantities(Object.fromEntries(open.map((line) => [line.id, String(line.ordered - line.received)])))}
          className="min-h-11 rounded-lg px-3 text-sm font-medium text-[var(--admin-primary-fg)] hover:bg-[var(--admin-primary-soft)]">
          Tout le reste est reçu
        </button>
      </div>
      <ul className="space-y-2">
        {open.map((line) => (
          <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-gray-900 dark:text-gray-100">{line.description}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Reçu {formatQuantity(line.received)} / {formatQuantity(line.ordered)} • reste {formatQuantity(line.ordered - line.received)}
                {line.linked ? '' : ' • hors catalogue, stock non modifié'}
              </p>
            </div>
            <label>
              <span className="sr-only">Quantité reçue pour {line.description}</span>
              <input inputMode="numeric" className={`${INPUT_CLS} text-right`} value={quantities[line.id] ?? ''} placeholder="0"
                onChange={(event) => setQuantities((prev) => ({ ...prev, [line.id]: event.target.value }))} />
            </label>
          </li>
        ))}
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
