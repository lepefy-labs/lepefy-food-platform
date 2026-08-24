'use client';

import { useEffect, useId } from 'react';
import { IconAlertTriangle, IconX } from '@tabler/icons-react';

export default function ConfirmActionModal({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !loading) onCancel();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onCancel();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${destructive ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}`}>
            <IconAlertTriangle size={18} stroke={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-gray-950 dark:text-gray-100">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="Fermer"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-dark)] disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            <IconX size={17} />
          </button>
        </div>

        <div className="px-5 py-4">
          <p id={descriptionId} className="text-sm leading-6 text-gray-600 dark:text-gray-300">{description}</p>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-5 py-4 sm:flex-row sm:justify-end dark:border-gray-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${destructive ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-600' : 'bg-[var(--color-primary-dark)] hover:opacity-90 focus-visible:ring-[var(--color-primary-dark)]'}`}
          >
            {loading ? 'Traitement…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
