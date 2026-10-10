import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';
import type { SettingsAccent, SettingsStatus } from './settingsRegistry';

// Literal class strings (Tailwind JIT): soft tile + saturated icon, per category.
export const ACCENT_TILE_CLS: Record<SettingsAccent, string> = {
  blue: 'bg-tone-info-bg text-tone-info-fg ring-tone-info-border',
  emerald: 'bg-tone-success-bg text-tone-success-fg ring-tone-success-border',
  fuchsia: 'bg-a-brand-soft text-a-brand-fg ring-a-border',
  sky: 'bg-tone-info-bg text-tone-info-fg ring-tone-info-border',
  red: 'bg-tone-danger-bg text-tone-danger-fg ring-tone-danger-border',
  amber: 'bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-border',
  orange: 'bg-tone-urgent-bg text-tone-urgent-fg ring-tone-urgent-border',
  violet: 'bg-a-brand-soft text-a-brand-fg ring-a-border',
  teal: 'bg-tone-success-bg text-tone-success-fg ring-tone-success-border',
};

export const ACCENT_TEXT_CLS: Record<SettingsAccent, string> = {
  blue: 'text-tone-info-fg',
  emerald: 'text-tone-success-fg',
  fuchsia: 'text-a-brand-fg',
  sky: 'text-tone-info-fg',
  red: 'text-tone-danger-fg',
  amber: 'text-tone-warning-fg',
  orange: 'text-tone-urgent-fg',
  violet: 'text-a-brand-fg',
  teal: 'text-tone-success-fg',
};

export function SettingsIconTile({ icon: TileIcon, accent, size = 'md' }: { icon: Icon; accent: SettingsAccent; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-2xl' : size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-11 w-11 rounded-xl';
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center ring-1 ${box} ${ACCENT_TILE_CLS[accent]}`}>
      <TileIcon size={size === 'lg' ? 24 : size === 'sm' ? 17 : 22} stroke={1.8} />
    </span>
  );
}

export const SETTINGS_INPUT_CLS =
  'min-h-11 w-full rounded-lg border border-a-border bg-a-surface px-3 py-2.5 text-sm text-a-text shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-a-focus disabled:cursor-not-allowed disabled:opacity-60';
export const SETTINGS_LABEL_CLS = 'mb-1.5 block text-sm font-medium text-a-text-2';
// Shared Button 'outline' uses the tenant dark colour, unreadable on the dark theme.
export const SETTINGS_OUTLINE_DARK_CLS = '';
export const SETTINGS_HINT_CLS = 'mt-1.5 text-xs leading-5 text-a-text-3';

const TONE_CLS: Record<SettingsStatus['tone'], { text: string; dot: string }> = {
  ok: { text: 'text-tone-success-fg', dot: 'bg-tone-success-solid' },
  neutral: { text: 'text-a-text-2', dot: 'bg-tone-neutral-solid' },
  warning: { text: 'text-tone-warning-fg', dot: 'bg-tone-warning-solid' },
};

/** Status is conveyed by its text; the dot only reinforces it. */
export function SettingsStatusBadge({ status }: { status: SettingsStatus }) {
  const tone = TONE_CLS[status.tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone.text}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
      {status.label}
    </span>
  );
}

interface SettingsPanelProps {
  id?: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

/** Neutral white section used by every settings detail page. */
export function SettingsPanel({ id, title, description, aside, footer, children }: SettingsPanelProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-24 overflow-hidden rounded-2xl border border-a-border bg-a-surface">
      <header className="flex flex-col gap-2 border-b border-a-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-a-text">{title}</h2>
          {description && <p className="mt-1 text-sm leading-6 text-a-text-3">{description}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </header>
      <div className="px-4 py-5 sm:px-6">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-a-border bg-a-surface-2 px-4 py-3 sm:px-6">{footer}</footer>}
    </section>
  );
}

export function SettingsFeedback({ feedback }: { feedback: { type: 'success' | 'error'; msg: string } | null }) {
  if (!feedback) return null;
  return (
    <p role={feedback.type === 'error' ? 'alert' : 'status'} className={`text-sm font-medium ${feedback.type === 'success' ? 'text-tone-success-fg' : 'text-tone-danger-fg'}`}>
      {feedback.msg}
    </p>
  );
}
