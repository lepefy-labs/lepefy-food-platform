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
      <span className="shrink-0 text-gray-400">{label}</span>
      <span className="truncate font-mono text-[11px] text-gray-700 dark:text-gray-300" title={value}>{value}</span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copier ${label.toLowerCase()} ${value}`}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] dark:hover:bg-gray-800"
      >
        {state === 'copied' ? <IconCheck size={13} aria-hidden="true" className="text-emerald-600" /> : <IconCopy size={13} aria-hidden="true" />}
      </button>
      <span role="status" className="sr-only">{state === 'copied' ? `${label} copié` : state === 'failed' ? 'Copie impossible' : ''}</span>
    </span>
  );
}
