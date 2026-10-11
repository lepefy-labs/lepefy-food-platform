'use client';

import { forwardRef } from 'react';
import { IconAlertCircle } from '@tabler/icons-react';
import { ERROR_SUMMARY_LEAD, missingFieldsTitle } from '@/lib/storefrontCopy/copy';

export interface ErrorSummaryItem {
  /** id du champ à atteindre. */
  fieldId: string;
  label: string;
}

/**
 * Résumé des erreurs après l'envoi : reçoit le focus (tabIndex -1), chaque
 * libellé amène au champ concerné. Les messages détaillés restent sous les champs.
 */
export const ErrorSummary = forwardRef<HTMLDivElement, { items: ErrorSummaryItem[]; title?: string }>(function ErrorSummary(
  { items, title },
  ref,
) {
  if (items.length === 0) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="rounded-xl border-2 px-4 py-3 text-sm focus:outline-none focus-visible:ring-4"
      style={{ borderColor: 'var(--field-danger)', backgroundColor: 'var(--field-danger-bg)', color: '#7A271A' }}
    >
      <p className="flex items-center gap-2 font-bold" style={{ color: 'var(--field-danger)' }}>
        <IconAlertCircle size={18} aria-hidden="true" />
        {title ?? missingFieldsTitle(items.length)}
      </p>
      <p className="mt-1">
        {ERROR_SUMMARY_LEAD}{' '}
        {items.map((item, index) => (
          <span key={item.fieldId}>
            <button
              type="button"
              className="min-h-8 font-semibold underline underline-offset-2"
              style={{ color: 'var(--field-danger)' }}
              onClick={() => {
                const field = document.getElementById(item.fieldId);
                field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                field?.focus({ preventScroll: true });
              }}
            >
              {item.label}
            </button>
            {index < items.length - 1 ? ', ' : '.'}
          </span>
        ))}
      </p>
    </div>
  );
});
