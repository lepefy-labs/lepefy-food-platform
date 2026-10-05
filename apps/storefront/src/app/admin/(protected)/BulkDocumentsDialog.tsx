'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { IconFileTypePdf, IconX } from '@tabler/icons-react';
import { FormatRadios, type OrderDocumentsDefaults } from '../orders/[id]/OrderDocumentsCard';
import { MAX_BULK_ORDER_DOCUMENTS as MAX_BULK_DOCUMENTS, type OrderDocumentFormat } from '@/lib/orders/documents/formats';

type Kind = 'picking-list' | 'packing-slip';

/**
 * Impression groupée : un seul PDF serveur pour la sélection, une commande par
 * nouvelle page, dans l'ordre de la liste (`orderIds` déjà ordonnés).
 */
export default function BulkDocumentsDialog({ orderIds, defaults, onClose }: { orderIds: string[]; defaults: OrderDocumentsDefaults; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('picking-list');
  const [format, setFormat] = useState<OrderDocumentFormat>(defaults.pickingFormat);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const tooMany = orderIds.length > MAX_BULK_DOCUMENTS;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
    return () => { document.body.style.overflow = previous; };
  }, []);

  function chooseKind(next: Kind) {
    setKind(next);
    setFormat(next === 'picking-list' ? defaults.pickingFormat : defaults.packingSlipFormat);
  }

  const href = `/api/admin/orders/documents/${kind}?format=${format}&ids=${orderIds.join(',')}`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h2 id={titleId} className="text-base font-semibold">{orderIds.length} commande{orderIds.length > 1 ? 's' : ''} sélectionnée{orderIds.length > 1 ? 's' : ''}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] dark:hover:bg-gray-800"><IconX size={17} aria-hidden="true" /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <fieldset>
            <legend className="text-sm font-semibold">Document</legend>
            <div className="mt-2 space-y-2">
              {([['picking-list', 'Listes de préparation'], ['packing-slip', 'Bons de colis']] as const).map(([value, label]) => {
                const disabled = value === 'packing-slip' && !defaults.packingSlipEnabled;
                return <label key={value} className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--admin-primary)] ${kind === value ? 'border-gray-900 bg-gray-50 dark:border-gray-100 dark:bg-gray-800' : 'border-gray-200 dark:border-gray-700'} ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
                  <input type="radio" name="bulk-document-kind" value={value} checked={kind === value} disabled={disabled} onChange={() => chooseKind(value)} className="h-4 w-4 accent-[var(--admin-primary)]" />
                  <span className="text-sm">{label}{disabled && <span className="block text-xs text-gray-500">Désactivé dans Paramètres › Documents des commandes</span>}</span>
                </label>;
              })}
            </div>
          </fieldset>
          <div>
            <p className="mb-2 text-sm font-semibold" aria-hidden="true">Format</p>
            <FormatRadios name="bulk-document-format" value={format} onChange={setFormat} legend="Format" />
          </div>
          <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">Un seul PDF, une commande par nouvelle page, dans l’ordre de la liste. {MAX_BULK_DOCUMENTS} commandes au maximum ; les commandes annulées sont ignorées.</p>
          {tooMany && <p role="alert" className="rounded-lg bg-amber-50 p-2 text-xs font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Sélectionnez {MAX_BULK_DOCUMENTS} commandes au maximum.</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-5 py-4 sm:flex-row sm:justify-end dark:border-gray-800">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-gray-200 px-4 text-sm font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Annuler</button>
          {tooMany
            ? <span aria-disabled="true" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gray-300 px-4 text-sm font-semibold text-gray-600"><IconFileTypePdf size={16} aria-hidden="true" /> Générer le PDF</span>
            : <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClose} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800 focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] dark:bg-gray-100 dark:text-gray-900">
                <IconFileTypePdf size={16} aria-hidden="true" /> Générer le PDF<span className="sr-only"> (nouvel onglet)</span>
              </a>}
        </div>
      </div>
    </div>
  );
}
