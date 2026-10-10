'use client';

import { useState } from 'react';
import { IconFileTypePdf } from '@tabler/icons-react';
import { FormatRadios, type OrderDocumentsDefaults } from '../orders/[id]/OrderDocumentsCard';
import { MAX_BULK_ORDER_DOCUMENTS as MAX_BULK_DOCUMENTS, type OrderDocumentFormat } from '@/lib/orders/documents/formats';
import { cn } from '@/lib/utils/cn';
import Button, { ButtonAnchor } from '../_components/ui/Button';
import Dialog from '../_components/ui/Dialog';
import InlineAlert from '../_components/ui/InlineAlert';

type Kind = 'picking-list' | 'packing-slip';

/**
 * Impression groupée : un seul PDF serveur pour la sélection, une commande par
 * nouvelle page, dans l'ordre de la liste (`orderIds` déjà ordonnés).
 */
export default function BulkDocumentsDialog({ orderIds, defaults, onClose }: { orderIds: string[]; defaults: OrderDocumentsDefaults; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('picking-list');
  const [format, setFormat] = useState<OrderDocumentFormat>(defaults.pickingFormat);
  const tooMany = orderIds.length > MAX_BULK_DOCUMENTS;

  function chooseKind(next: Kind) {
    setKind(next);
    setFormat(next === 'picking-list' ? defaults.pickingFormat : defaults.packingSlipFormat);
  }

  const href = `/api/admin/orders/documents/${kind}?format=${format}&ids=${orderIds.join(',')}`;

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`${orderIds.length} commande${orderIds.length > 1 ? 's' : ''} sélectionnée${orderIds.length > 1 ? 's' : ''}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        {tooMany
          ? <Button disabled><IconFileTypePdf size={16} aria-hidden="true" /> Générer le PDF</Button>
          : <ButtonAnchor variant="primary" href={href} target="_blank" rel="noopener noreferrer" onClick={onClose}>
              <IconFileTypePdf size={16} aria-hidden="true" /> Générer le PDF<span className="sr-only"> (nouvel onglet)</span>
            </ButtonAnchor>}
      </>}
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="text-sm font-semibold text-a-text">Document</legend>
          <div className="mt-2 space-y-2">
            {([['picking-list', 'Listes de préparation'], ['packing-slip', 'Bons de colis']] as const).map(([value, label]) => {
              const disabled = value === 'packing-slip' && !defaults.packingSlipEnabled;
              return (
                <label key={value} className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg border px-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-a-focus',
                  kind === value ? 'border-a-brand bg-a-selected' : 'border-a-border',
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-a-hover',
                )}>
                  <input type="radio" name="bulk-document-kind" value={value} checked={kind === value} disabled={disabled} autoFocus={kind === value} onChange={() => chooseKind(value)} className="h-4 w-4 accent-[var(--admin-primary)]" />
                  <span className="text-sm text-a-text">{label}{disabled && <span className="block text-xs text-a-text-3">Désactivé dans Paramètres › Documents des commandes</span>}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div>
          <p className="mb-2 text-sm font-semibold text-a-text" aria-hidden="true">Format</p>
          <FormatRadios name="bulk-document-format" value={format} onChange={setFormat} legend="Format" />
        </div>
        <p className="text-xs leading-5 text-a-text-3">Un seul PDF, une commande par nouvelle page, dans l’ordre de la liste. {MAX_BULK_DOCUMENTS} commandes au maximum ; les commandes annulées sont ignorées.</p>
        {tooMany && <InlineAlert tone="warning">Sélectionnez {MAX_BULK_DOCUMENTS} commandes au maximum.</InlineAlert>}
      </div>
    </Dialog>
  );
}
