'use client';

import { IconHelpCircle } from '@tabler/icons-react';
import { cn } from '@/lib/utils/cn';
import { useHelp } from './HelpProvider';

/**
 * Micro-help on a complex field or section: a small « ? » that opens the Help
 * Center directly on the matching guide (never a popup by itself). Renders
 * nothing when the Help Center is not available to this admin, so pages can
 * place it unconditionally. Authorisation stays server-side: if the guide is
 * not published or not allowed, the drawer shows its usual « Guide
 * indisponible » message.
 */
export default function HelpHint({ slug, label, className }: { slug: string; /** What the help is about (« Règles de vente »). */ label: string; className?: string }) {
  const { enabled, open } = useHelp();
  if (!enabled) return null;
  return (
    <button
      type="button"
      onClick={() => open({ slug })}
      aria-label={`Aide : ${label}`}
      title={`Aide : ${label}`}
      className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full text-a-text-3 hover:bg-a-hover hover:text-a-brand-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus', className)}
    >
      <IconHelpCircle size={18} stroke={1.8} aria-hidden="true" />
    </button>
  );
}
