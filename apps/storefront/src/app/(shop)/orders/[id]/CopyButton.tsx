'use client';

import { useState } from 'react';
import { IconCheck, IconCopy } from '@tabler/icons-react';

/** Copy the tracking code; the « Copié » state is announced to screen readers. */
export default function CopyButton({ text, label = 'Copier' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers: hidden textarea + execCommand.
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Numéro de suivi copié' : `Copier le numéro de suivi ${text}`}
      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-800 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
    >
      {copied ? <IconCheck size={15} aria-hidden="true" className="text-emerald-700" /> : <IconCopy size={15} aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Copié' : label}</span>
    </button>
  );
}
