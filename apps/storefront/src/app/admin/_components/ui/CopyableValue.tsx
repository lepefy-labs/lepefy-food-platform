'use client';

import { useEffect, useState } from 'react';
import { IconCheck, IconCopy } from '@tabler/icons-react';

/** Monospace identifier (provider reference, tracking code…) with a copy button and inline feedback. */
export default function CopyableValue({ label, value, className = '' }: { label: string; value: string; className?: string }) {
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

  return (
    <span className={`flex min-w-0 items-center gap-1 ${className}`}>
      <span className="shrink-0 text-a-text-3">{label}</span>
      <span className="truncate font-mono text-xs text-a-text-2" title={value}>{value}</span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copier ${label.toLowerCase()} ${value}`}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-a-text-3 hover:bg-a-hover hover:text-a-text-2 focus-visible:outline-2 focus-visible:outline-a-focus"
      >
        {state === 'copied' ? <IconCheck size={13} aria-hidden="true" className="text-tone-success-fg" /> : <IconCopy size={13} aria-hidden="true" />}
      </button>
      <span role="status" className="sr-only">{state === 'copied' ? `${label} copié` : state === 'failed' ? 'Copie impossible' : ''}</span>
    </span>
  );
}
