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
        className="h-11 w-full rounded-xl border border-a-border bg-a-surface-2 px-3 font-mono text-xs text-a-text-2"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-a-border bg-a-surface px-3 text-sm font-semibold text-a-text hover:bg-a-surface-2"
        >
          {copied ? <IconCheck size={17} className="text-tone-success-fg" /> : <IconCopy size={17} />}
          {copied ? 'Lien copié' : copyLabel}
        </button>
        <a
          href={buildWhatsAppShareUrl(phone, message)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-tone-success-solid px-3 text-sm font-semibold text-white hover:bg-tone-success-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tone-success-solid focus-visible:ring-offset-2"
        >
          <IconBrandWhatsapp size={18} /> Partager sur WhatsApp
        </a>
      </div>
      {copyFailed && <p className="text-xs text-tone-warning-fg">Copie impossible : sélectionnez le lien ci-dessus et copiez-le manuellement.</p>}
    </div>
  );
}
