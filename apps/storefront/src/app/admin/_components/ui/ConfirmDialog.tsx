'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { IconAlertTriangle } from '@tabler/icons-react';
import { cn } from '@/lib/utils/cn';
import Button from './Button';
import Dialog from './Dialog';
import { ErrorText } from './InlineAlert';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, in plain words (amount, stock, reversibility). */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive or irreversible action: red confirm button and warning icon. */
  destructive?: boolean;
  loading?: boolean;
  /** Extra condition that blocks the confirm button (offline, missing input…). */
  confirmDisabled?: boolean;
  /** Error from the last attempt, shown above the buttons. */
  error?: string | null;
  /** Ask for a reason; its value is passed to onConfirm. */
  reason?: { label: string; placeholder?: string; required?: boolean; maxLength?: number };
  children?: ReactNode;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}

/** The only admin confirmation: replaces native browser confirmations and ad hoc modals. */
export default function ConfirmDialog({
  open, title, description, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', destructive = false,
  loading = false, confirmDisabled = false, error, reason, children, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const [reasonText, setReasonText] = useState('');
  const reasonId = useId();
  useEffect(() => { if (!open) setReasonText(''); }, [open]);
  const reasonMissing = Boolean(reason?.required) && reasonText.trim().length === 0;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      dismissible={!loading}
      size="sm"
      title={title}
      description={description}
      icon={destructive ? (
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-tone-danger-bg text-tone-danger-fg"><IconAlertTriangle size={18} stroke={1.8} /></span>
      ) : undefined}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            loading={loading}
            disabled={reasonMissing || confirmDisabled}
            onClick={() => onConfirm(reason ? reasonText.trim() : undefined)}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      {(reason || children || error) ? (
        <div className="space-y-3">
          {children}
          {reason && (
            <div>
              <label htmlFor={reasonId} className="mb-1.5 block text-sm font-semibold text-a-text">
                {reason.label}{reason.required ? '' : ' (facultatif)'}
              </label>
              <textarea
                id={reasonId}
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
                placeholder={reason.placeholder}
                maxLength={reason.maxLength ?? 500}
                rows={3}
                className={cn('w-full rounded-lg border border-a-border-strong bg-a-surface px-3 py-2 text-sm text-a-text placeholder:text-a-text-3',
                  'focus:outline focus:outline-2 focus:outline-a-focus')}
              />
            </div>
          )}
          <ErrorText message={error} />
        </div>
      ) : null}
    </Dialog>
  );
}

export interface ConfirmRequest {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * Promise-based confirmation for existing async handlers:
 *   const [ask, confirmDialog] = useConfirm();
 *   if (!(await ask({ title: 'Supprimer… ?', destructive: true }))) return;
 * and render {confirmDialog} once in the component.
 */
export function useConfirm(): [(request: ConfirmRequest) => Promise<boolean>, ReactNode] {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const ask = useCallback((next: ConfirmRequest) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setRequest(next);
  }), []);
  const settle = (value: boolean) => { resolver.current?.(value); resolver.current = null; setRequest(null); };
  const dialog = (
    <ConfirmDialog
      open={request !== null}
      title={request?.title ?? ''}
      description={request?.description}
      confirmLabel={request?.confirmLabel}
      cancelLabel={request?.cancelLabel}
      destructive={request?.destructive}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
  return [ask, dialog];
}

/**
 * Unsaved changes: warns on tab close (native prompt) and intercepts in-app
 * links with a ConfirmDialog, then navigates if the user leaves anyway.
 * Render the returned element once.
 */
export function useUnsavedChangesGuard(dirty: boolean, description = 'Vos modifications seront perdues.'): ReactNode {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download') || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || /^(mailto|tel|sms):/.test(href)) return;
      event.preventDefault();
      event.stopPropagation();
      void ask({ title: 'Quitter sans enregistrer ?', description, confirmLabel: 'Quitter la page', cancelLabel: 'Rester', destructive: true })
        .then((leave) => {
          if (!leave) return;
          window.removeEventListener('beforeunload', beforeUnload);
          if (/^https?:\/\//.test(href) && new URL(href).origin !== window.location.origin) window.location.assign(href);
          else router.push(href);
        });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', onClick, true); };
  }, [dirty, description, ask, router]);
  return dialog;
}
