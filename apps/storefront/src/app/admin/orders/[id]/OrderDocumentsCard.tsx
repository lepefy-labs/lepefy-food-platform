'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { IconDownload, IconFileTypePdf } from '@tabler/icons-react';
import { ORDER_DOCUMENT_FORMATS, ORDER_DOCUMENT_FORMAT_IDS, isOrderDocumentFormat, orderDocumentFormatOptionLabel, type OrderDocumentFormat } from '@/lib/orders/documents/formats';
import { Select } from '../../_components/ui/Form';

export interface OrderDocumentsDefaults {
  pickingFormat: OrderDocumentFormat;
  packingSlipEnabled: boolean;
  packingSlipFormat: OrderDocumentFormat;
  /** Migration 145 absente : bon généré sans QR. */
  packingSlipQrUnavailable: boolean;
}

/**
 * Menu déroulant du format, présélectionné sur le défaut du tenant (A5 par
 * défaut). Les dimensions viennent du registre : jamais de libellé en dur.
 */
export function FormatSelect({ value, onChange, label }: { value: OrderDocumentFormat; onChange: (format: OrderDocumentFormat) => void; label: string }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-a-text-2">{label}</label>
      <Select id={id} value={value} onChange={(e) => { if (isOrderDocumentFormat(e.target.value)) onChange(e.target.value); }} className="w-full max-w-xs text-sm">
        {ORDER_DOCUMENT_FORMAT_IDS.map((format) => (
          <option key={format} value={format}>
            {orderDocumentFormatOptionLabel(format)} · {ORDER_DOCUMENT_FORMATS[format].widthMm} × {ORDER_DOCUMENT_FORMATS[format].heightMm} mm
          </option>
        ))}
      </Select>
    </div>
  );
}

const openCls = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-a-focus';

function DocumentRow({ title, hint, href, initial }: { title: string; hint: string; href: string; initial: OrderDocumentFormat }) {
  const [format, setFormat] = useState<OrderDocumentFormat>(initial);
  const titleId = useId();
  const url = `${href}?format=${format}`;
  return (
    <div role="group" aria-labelledby={titleId} className="space-y-2 border-t border-a-border pt-3 first:border-t-0 first:pt-0">
      <div>
        <p id={titleId} className="text-sm font-semibold text-a-text">{title}</p>
        <p className="text-xs text-a-text-3">{hint}</p>
      </div>
      <FormatSelect value={format} onChange={setFormat} label={`Format — ${title}`} />
      <div className="flex flex-wrap items-center gap-2">
        {/* Navigation HTTP directe vers le PDF serveur : fiable aussi en PWA. */}
        <a href={url} target="_blank" rel="noopener noreferrer" className={`${openCls} bg-a-inverse text-a-on-inverse hover:bg-a-inverse`}>
          <IconFileTypePdf size={16} aria-hidden="true" /> Ouvrir le PDF<span className="sr-only"> (nouvel onglet)</span>
        </a>
        <a href={`${url}&download=1`} className={`${openCls} border border-a-border text-a-text-2 hover:bg-a-surface-2`}>
          <IconDownload size={16} aria-hidden="true" /> Télécharger
        </a>
      </div>
    </div>
  );
}

export default function OrderDocumentsCard({ orderId, cancelled, defaults }: { orderId: string; cancelled: boolean; defaults: OrderDocumentsDefaults }) {
  if (cancelled) return <p className="text-xs text-a-text-3">Commande annulée : aucun document à imprimer.</p>;
  const base = `/api/admin/orders/${orderId}/documents`;
  return (
    <div className="space-y-3">
      <DocumentRow title="Liste de préparation" hint="Interne · articles, emplacements, emballage." href={`${base}/picking-list`} initial={defaults.pickingFormat} />
      {defaults.packingSlipEnabled ? (
        <div className="space-y-2 border-t border-a-border pt-3">
          <DocumentRow title="Bon de colis" hint="À glisser dans le colis · récapitulatif client et QR de suivi." href={`${base}/packing-slip`} initial={defaults.packingSlipFormat} />
          {defaults.packingSlipQrUnavailable && <p className="text-xs text-tone-warning-fg">QR indisponible tant que la migration 145 n’est pas appliquée : le bon est généré sans QR.</p>}
        </div>
      ) : (
        <p className="border-t border-a-border pt-3 text-xs text-a-text-3">
          Bon de colis désactivé — <Link href="/admin/parametres/documents" className="font-medium underline underline-offset-2">Paramètres › Documents des commandes</Link>
        </p>
      )}
    </div>
  );
}
