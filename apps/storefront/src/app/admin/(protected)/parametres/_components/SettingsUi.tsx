import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';
import type { SettingsAccent, SettingsStatus } from './settingsRegistry';

// Literal class strings (Tailwind JIT): soft tile + saturated icon, per category.
export const ACCENT_TILE_CLS: Record<SettingsAccent, string> = {
  blue: 'bg-blue-100 text-blue-600 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20',
  emerald: 'bg-emerald-100 text-emerald-600 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20',
  fuchsia: 'bg-fuchsia-100 text-fuchsia-600 ring-fuchsia-200/60 dark:bg-fuchsia-500/10 dark:text-fuchsia-300 dark:ring-fuchsia-500/20',
  sky: 'bg-sky-100 text-sky-600 ring-sky-200/60 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20',
  red: 'bg-red-100 text-red-600 ring-red-200/60 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20',
  amber: 'bg-amber-100 text-amber-600 ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20',
  orange: 'bg-orange-100 text-orange-600 ring-orange-200/60 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/20',
  violet: 'bg-violet-100 text-violet-600 ring-violet-200/60 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/20',
  teal: 'bg-teal-100 text-teal-600 ring-teal-200/60 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/20',
};

export const ACCENT_TEXT_CLS: Record<SettingsAccent, string> = {
  blue: 'text-blue-600 dark:text-blue-300',
  emerald: 'text-emerald-600 dark:text-emerald-300',
  fuchsia: 'text-fuchsia-600 dark:text-fuchsia-300',
  sky: 'text-sky-600 dark:text-sky-300',
  red: 'text-red-600 dark:text-red-300',
  amber: 'text-amber-600 dark:text-amber-300',
  orange: 'text-orange-600 dark:text-orange-300',
  violet: 'text-violet-600 dark:text-violet-300',
  teal: 'text-teal-600 dark:text-teal-300',
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
  'min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const SETTINGS_LABEL_CLS = 'mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200';
// Shared Button 'outline' uses the tenant dark colour, unreadable on the dark theme.
export const SETTINGS_OUTLINE_DARK_CLS = 'dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800';
export const SETTINGS_HINT_CLS = 'mt-1.5 text-xs leading-5 text-gray-500 dark:text-gray-400';

const TONE_CLS: Record<SettingsStatus['tone'], { text: string; dot: string }> = {
  ok: { text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  neutral: { text: 'text-gray-600 dark:text-gray-300', dot: 'bg-gray-400' },
  warning: { text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
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
    <section id={id} aria-labelledby={headingId} className="scroll-mt-24 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <header className="flex flex-col gap-2 border-b border-gray-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 dark:border-gray-800">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-gray-950 dark:text-gray-100">{title}</h2>
          {description && <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">{description}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </header>
      <div className="px-4 py-5 sm:px-6">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 bg-gray-50/60 px-4 py-3 sm:px-6 dark:border-gray-800 dark:bg-gray-900/60">{footer}</footer>}
    </section>
  );
}

export function SettingsFeedback({ feedback }: { feedback: { type: 'success' | 'error'; msg: string } | null }) {
  if (!feedback) return null;
  return (
    <p role={feedback.type === 'error' ? 'alert' : 'status'} className={`text-sm font-medium ${feedback.type === 'success' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
      {feedback.msg}
    </p>
  );
}
