'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { IconDownload, IconFileTypePdf } from '@tabler/icons-react';
import { ORDER_DOCUMENT_FORMAT_IDS, orderDocumentFormatOptionLabel, type OrderDocumentFormat } from '@/lib/orders/documents/formats';

export interface OrderDocumentsDefaults {
  pickingFormat: OrderDocumentFormat;
  packingSlipEnabled: boolean;
  packingSlipFormat: OrderDocumentFormat;
  /** Migration 145 absente : bon généré sans QR. */
  packingSlipQrUnavailable: boolean;
}

/** Sélecteur de format natif (radios), présélectionné sur le défaut du tenant. */
export function FormatRadios({ name, value, onChange, legend }: { name: string; value: OrderDocumentFormat; onChange: (format: OrderDocumentFormat) => void; legend: string }) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex overflow-hidden rounded-lg border border-[var(--admin-border)]">
        {ORDER_DOCUMENT_FORMAT_IDS.map((format) => (
          <label key={format} className="relative cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--admin-primary)]">
            <input type="radio" name={name} value={format} checked={value === format} onChange={() => onChange(format)} className="peer sr-only" />
            <span className="flex min-h-11 items-center px-3 text-xs font-semibold text-gray-700 peer-checked:bg-gray-900 peer-checked:text-white dark:text-gray-200 dark:peer-checked:bg-gray-100 dark:peer-checked:text-gray-900">
              {orderDocumentFormatOptionLabel(format)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const openCls = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)]';

function DocumentRow({ title, hint, href, initial, name }: { title: string; hint: string; href: string; initial: OrderDocumentFormat; name: string }) {
  const [format, setFormat] = useState<OrderDocumentFormat>(initial);
  const titleId = useId();
  const url = `${href}?format=${format}`;
  return (
    <div role="group" aria-labelledby={titleId} className="space-y-2 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0 dark:border-gray-800">
      <div>
        <p id={titleId} className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      </div>
      <FormatRadios name={name} value={format} onChange={setFormat} legend={`Format — ${title}`} />
      <div className="flex flex-wrap items-center gap-2">
        {/* Navigation HTTP directe vers le PDF serveur : fiable aussi en PWA. */}
        <a href={url} target="_blank" rel="noopener noreferrer" className={`${openCls} bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900`}>
          <IconFileTypePdf size={16} aria-hidden="true" /> Ouvrir le PDF<span className="sr-only"> (nouvel onglet)</span>
        </a>
        <a href={`${url}&download=1`} className={`${openCls} border border-[var(--admin-border)] text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800`}>
          <IconDownload size={16} aria-hidden="true" /> Télécharger
        </a>
      </div>
    </div>
  );
}

export default function OrderDocumentsCard({ orderId, cancelled, defaults }: { orderId: string; cancelled: boolean; defaults: OrderDocumentsDefaults }) {
  if (cancelled) return <p className="text-xs text-gray-500 dark:text-gray-400">Commande annulée : aucun document à imprimer.</p>;
  const base = `/api/admin/orders/${orderId}/documents`;
  return (
    <div className="space-y-3">
      <DocumentRow name={`picking-format-${orderId}`} title="Liste de préparation" hint="Interne · articles, emplacements, emballage." href={`${base}/picking-list`} initial={defaults.pickingFormat} />
      {defaults.packingSlipEnabled ? (
        <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <DocumentRow name={`packing-format-${orderId}`} title="Bon de colis" hint="À glisser dans le colis · récapitulatif client et QR de suivi." href={`${base}/packing-slip`} initial={defaults.packingSlipFormat} />
          {defaults.packingSlipQrUnavailable && <p className="text-xs text-amber-800 dark:text-amber-300">QR indisponible tant que la migration 145 n’est pas appliquée : le bon est généré sans QR.</p>}
        </div>
      ) : (
        <p className="border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          Bon de colis désactivé — <Link href="/admin/parametres/documents" className="font-medium underline underline-offset-2">Paramètres › Documents des commandes</Link>
        </p>
      )}
    </div>
  );
}
