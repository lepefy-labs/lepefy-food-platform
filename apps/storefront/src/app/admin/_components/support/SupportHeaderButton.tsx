'use client';

import { IconLifebuoy } from '@tabler/icons-react';
import Button from '../ui/Button';
import { useSupport } from './SupportProvider';

/**
 * « Assistance » in the admin bar, on every page: opens the quick panel. The
 * dot tells a Lepefy reply is unread (the count is in the menu entry).
 */
export default function SupportHeaderButton() {
  const { enabled, unread, open } = useSupport();
  if (!enabled) return null;
  const label = unread > 0 ? `Assistance — ${unread} réponse${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}` : 'Assistance — signaler un problème ou poser une question';
  return (
    <button type="button" onClick={() => open()} aria-label={label} title={label}
      className="relative flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border border-a-border bg-a-surface px-2 text-sm font-semibold text-a-text hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus sm:px-2.5">
      <IconLifebuoy size={18} stroke={1.8} aria-hidden="true" />
      <span className="hidden sm:inline">Assistance</span>
      {unread > 0 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-a-surface bg-tone-info-solid" />}
    </button>
  );
}

/** « Besoin d'aide avec cette page ? » — small invitation where the admin is stuck (error states). */
export function SupportHint({ category = 'problem', label = 'Signaler ce problème à Lepefy' }: { category?: 'problem' | 'question'; label?: string }) {
  const { enabled, readOnly, open } = useSupport();
  if (!enabled || readOnly) return null;
  return (
    <button type="button" onClick={() => open({ category })}
      className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-a-brand-fg underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
      <IconLifebuoy size={16} aria-hidden="true" />{label}
    </button>
  );
}

/** Opens the panel (« Nouvelle demande », empty state). */
export function SupportOpenButton({ children, className, variant = 'primary' }: { children: React.ReactNode; className?: string; variant?: 'primary' | 'secondary' }) {
  const { enabled, readOnly, open } = useSupport();
  return <Button variant={variant} disabled={!enabled || readOnly} onClick={() => open()} className={className}>{children}</Button>;
}
