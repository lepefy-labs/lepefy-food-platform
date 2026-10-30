'use client';

import { IconHelpCircle } from '@tabler/icons-react';
import { useHelp } from './HelpProvider';

/** « Aide » in the admin bar: opens the contextual help panel (never automatic). */
export default function HelpHeaderButton() {
  const { enabled, open } = useHelp();
  if (!enabled) return null;
  return (
    <button type="button" onClick={() => open()} aria-label="Aide — guides pour cette page" title="Aide — guides pour cette page"
      className="relative flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border border-a-border bg-a-surface px-2 text-sm font-semibold text-a-text hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus sm:px-2.5">
      <IconHelpCircle size={18} stroke={1.8} aria-hidden="true" />
      <span className="hidden sm:inline">Aide</span>
    </button>
  );
}
