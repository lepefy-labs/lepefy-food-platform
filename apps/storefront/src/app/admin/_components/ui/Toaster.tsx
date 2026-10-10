'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { IconAlertOctagon, IconCircleCheck, IconInfoCircle, IconX } from '@tabler/icons-react';
import { cn } from '@/lib/utils/cn';

type ToastTone = 'success' | 'danger' | 'info';
interface ToastInput { title: string; description?: string; action?: { label: string; href: string } }
interface ToastItem extends ToastInput { id: number; tone: ToastTone }

interface ToastApi {
  success: (title: string, options?: Omit<ToastInput, 'title'>) => void;
  error: (title: string, options?: Omit<ToastInput, 'title'>) => void;
  info: (title: string, options?: Omit<ToastInput, 'title'>) => void;
}

const NOOP: ToastApi = { success: () => {}, error: () => {}, info: () => {} };
const ToastContext = createContext<ToastApi>(NOOP);

/** Outcome of an action in one place, for every admin page. */
export function useAdminToast(): ToastApi {
  return useContext(ToastContext);
}

const ICON: Record<ToastTone, typeof IconInfoCircle> = { success: IconCircleCheck, danger: IconAlertOctagon, info: IconInfoCircle };
const ICON_CLASS: Record<ToastTone, string> = { success: 'text-tone-success-solid', danger: 'text-tone-danger-solid', info: 'text-tone-info-solid' };
// Errors stay longer: they usually need reading.
const DURATION: Record<ToastTone, number> = { success: 5000, info: 5000, danger: 9000 };

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const Icon = ICON[item.tone];
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const start = useCallback(() => { timer.current = setTimeout(() => onDismiss(item.id), DURATION[item.tone]); }, [item.id, item.tone, onDismiss]);
  useEffect(() => { start(); return () => clearTimeout(timer.current); }, [start]);
  return (
    <div
      role={item.tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={start}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-[10px] border border-a-border bg-a-surface px-3.5 py-3 text-sm shadow-lg sm:w-[22rem]"
    >
      <Icon size={20} stroke={1.8} aria-hidden="true" className={cn('mt-px shrink-0', ICON_CLASS[item.tone])} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-a-text">{item.title}</p>
        {item.description && <p className="mt-0.5 text-a-text-2">{item.description}</p>}
        {item.action && <Link href={item.action.href} onClick={() => onDismiss(item.id)} className="mt-1 inline-block font-semibold text-a-brand-fg hover:underline">{item.action.label}</Link>}
      </div>
      <button type="button" onClick={() => onDismiss(item.id)} aria-label="Fermer la notification" className="-m-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-a-text-3 hover:bg-a-hover hover:text-a-text">
        <IconX size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Mounted once by the protected admin layout. */
export function AdminToaster({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const push = useCallback((tone: ToastTone, title: string, options?: Omit<ToastInput, 'title'>) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-3), { id, tone, title, ...options }]);
  }, []);
  const api = useMemo<ToastApi>(() => ({
    success: (title, options) => push('success', title, options),
    error: (title, options) => push('danger', title, options),
    info: (title, options) => push('info', title, options),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[80] flex flex-col items-end gap-2 md:bottom-5 md:left-auto md:right-5">
        {items.map((item) => <Toast key={item.id} item={item} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}
