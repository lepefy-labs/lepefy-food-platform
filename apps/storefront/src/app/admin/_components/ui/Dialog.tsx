'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from '@tabler/icons-react';
import { cn } from '@/lib/utils/cn';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';
export type DialogPlacement = 'center' | 'right' | 'left' | 'bottom' | 'top';

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

const PLACEMENT_CLASS: Record<DialogPlacement, string> = {
  // Bottom sheet on phones, centred card from sm.
  center: 'mb-0 mt-auto w-full max-w-none rounded-t-2xl sm:m-auto sm:w-[calc(100%-2rem)] sm:rounded-xl',
  right: 'ml-auto mr-0 h-[100dvh] max-h-[100dvh] w-full max-w-none rounded-none sm:w-[min(100%,28rem)]',
  left: 'ml-0 mr-auto h-[100dvh] max-h-[100dvh] w-[min(88vw,20rem)] max-w-none rounded-none',
  bottom: 'mb-0 mt-auto w-full max-w-none rounded-t-2xl',
  // Command palette: near the top so results grow downwards.
  top: 'mb-auto mt-2 w-[calc(100%-1rem)] rounded-xl sm:mt-[12vh] sm:w-[calc(100%-2rem)]',
};

export interface DialogProps {
  open: boolean;
  /** Called on Escape, backdrop click and the close button (unless `dismissible` is false). */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Leading icon next to the title. */
  icon?: ReactNode;
  children?: ReactNode;
  /** Action row; rendered right-aligned on desktop, stacked (primary last on top) on phones. */
  footer?: ReactNode;
  size?: DialogSize;
  placement?: DialogPlacement;
  /** false while an action runs: Escape and the backdrop no longer close. */
  dismissible?: boolean;
  /** Hide the × button (e.g. when the footer already has « Fermer »). */
  hideCloseButton?: boolean;
  /** No header/footer chrome: children fill the dialog; `title` stays as the accessible name. */
  bare?: boolean;
  className?: string;
  bodyClassName?: string;
}

/**
 * Admin modal built on the native <dialog> element: showModal() gives the top
 * layer, focus containment, inert background and Escape for free. Rendered in
 * a portal so it is never nested inside a table or a form.
 */
export default function Dialog({
  open, onClose, title, description, icon, children, footer, size = 'md', placement = 'center',
  dismissible = true, hideCloseButton = false, bare = false, className, bodyClassName,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const dismissRef = useRef({ dismissible, onClose });
  dismissRef.current = { dismissible, onClose };

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const previous = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      return () => { document.documentElement.style.overflow = previous; if (dialog.open) dialog.close(); };
    }
    if (!open && dialog.open) dialog.close();
  }, [open, mounted]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (dismissRef.current.dismissible) dismissRef.current.onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // A click whose target is the <dialog> itself landed on the backdrop:
      // the content wrapper below fills the whole element.
      onMouseDown={(event) => { if (event.target === event.currentTarget && dismissible) onClose(); }}
      className={cn(
        'max-h-[calc(100dvh-1rem)] overflow-hidden border border-a-border bg-a-surface p-0 text-a-text shadow-2xl backdrop:bg-black/50',
        PLACEMENT_CLASS[placement],
        (placement === 'center' || placement === 'top') && SIZE_CLASS[size],
        className,
      )}
    >
      {open && bare && (
        <div className="flex max-h-[calc(100dvh-1rem)] flex-col sm:max-h-[76vh]">
          <h2 id={titleId} className="sr-only">{title}</h2>
          {children}
        </div>
      )}
      {open && !bare && (
        <div className={cn('flex flex-col', placement === 'right' || placement === 'left' ? 'h-full' : 'max-h-[calc(100dvh-1rem)]')}>
          <div className="flex items-start gap-3 border-b border-a-border px-5 py-4">
            {icon && <span aria-hidden="true" className="mt-0.5 shrink-0">{icon}</span>}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold text-a-text">{title}</h2>
              {description && <div id={descriptionId} className="mt-1 text-sm leading-6 text-a-text-2">{description}</div>}
            </div>
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                disabled={!dismissible}
                aria-label="Fermer"
                className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-a-text-2 hover:bg-a-hover hover:text-a-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus disabled:opacity-50"
              >
                <IconX size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          {children !== undefined && children !== null && (
            <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4', bodyClassName)}>{children}</div>
          )}
          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-a-border bg-a-surface-2 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>,
    document.body,
  );
}

/** Side panel for quick views and edits; same behaviour as Dialog. */
export function Drawer(props: Omit<DialogProps, 'placement' | 'size'>) {
  return <Dialog {...props} placement="right" />;
}
