'use client';

import { useState } from 'react';
import { IconBrandWhatsapp, IconCheck, IconCopy } from '@tabler/icons-react';
import { buildWhatsAppShareUrl } from '@/lib/orders/assisted/assistedOrderPolicy';

/**
 * Copier un lien et le partager manuellement par WhatsApp (wa.me) — aucune
 * API WhatsApp, aucun envoi automatique : l'opérateur choisit la conversation.
 */
export default function ShareLinkActions({
  url,
  message,
  phone,
  copyLabel = 'Copier le lien',
}: {
  url: string;
  message: string;
  phone?: string | null;
  copyLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className="space-y-2">
      <input
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        aria-label="Lien"
        className="h-11 w-full rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-subtle)] px-3 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--admin-border)] bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          {copied ? <IconCheck size={17} className="text-emerald-600" /> : <IconCopy size={17} />}
          {copied ? 'Lien copié' : copyLabel}
        </button>
        <a
          href={buildWhatsAppShareUrl(phone, message)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1FA855] px-3 text-sm font-semibold text-white hover:opacity-90"
        >
          <IconBrandWhatsapp size={18} /> Partager sur WhatsApp
        </a>
      </div>
      {copyFailed && <p className="text-xs text-amber-700">Copie impossible : sélectionnez le lien ci-dessus et copiez-le manuellement.</p>}
    </div>
  );
}
