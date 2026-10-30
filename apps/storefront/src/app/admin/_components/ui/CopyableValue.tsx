'use client';

import { useEffect, useState } from 'react';
import { IconCheck, IconCopy } from '@tabler/icons-react';

/** Monospace identifier (provider reference, tracking code…) with a copy button and inline feedback. */
export default function CopyableValue({ label, value, className = '', stacked = false }: { label: string; value: string; className?: string; /** Label above a value that wraps (IBAN, references on a phone) and a larger copy target. */ stacked?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try { await navigator.clipboard.writeText(value); setState('copied'); }
    catch { setState('failed'); }
  }

  const feedback = <span role="status" className="sr-only">{state === 'copied' ? `${label} copié` : state === 'failed' ? 'Copie impossible' : ''}</span>;
  const icon = state === 'copied' ? <IconCheck size={stacked ? 16 : 13} aria-hidden="true" className="text-tone-success-fg" /> : <IconCopy size={stacked ? 16 : 13} aria-hidden="true" />;
  const buttonClass = `inline-flex shrink-0 items-center justify-center rounded-md text-a-text-3 hover:bg-a-hover hover:text-a-text-2 focus-visible:outline-2 focus-visible:outline-a-focus ${stacked ? 'h-10 w-10' : 'h-7 w-7'}`;

  if (stacked) {
    return (
      <span className={`flex min-w-0 flex-col gap-0.5 ${className}`}>
        <span className="text-xs text-a-text-3">{label}</span>
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 break-all font-mono text-sm text-a-text">{value}</span>
          <button type="button" onClick={() => void copy()} aria-label={`Copier ${label.toLowerCase()} ${value}`} className={buttonClass}>{icon}</button>
        </span>
        {feedback}
      </span>
    );
  }

  return (
    <span className={`flex min-w-0 items-center gap-1 ${className}`}>
      <span className="shrink-0 text-a-text-3">{label}</span>
      <span className="truncate font-mono text-xs text-a-text-2" title={value}>{value}</span>
      <button type="button" onClick={() => void copy()} aria-label={`Copier ${label.toLowerCase()} ${value}`} className={buttonClass}>{icon}</button>
      {feedback}
    </span>
  );
}
