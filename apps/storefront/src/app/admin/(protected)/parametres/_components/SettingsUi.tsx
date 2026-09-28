import type { ReactNode } from 'react';
import type { SettingsStatus } from './settingsRegistry';

export const SETTINGS_INPUT_CLS =
  'min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const SETTINGS_LABEL_CLS = 'mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200';
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
