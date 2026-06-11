'use client';

import { useState } from 'react';

export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
      style={
        copied
          ? { borderColor: '#2d6a4f', color: '#2d6a4f', background: '#d8f3dc' }
          : { borderColor: '#E5E7EB', color: '#4B5563', background: '#fff' }
      }
    >
      {copied ? '✓ Copié' : 'Copier'}
    </button>
  );
}
