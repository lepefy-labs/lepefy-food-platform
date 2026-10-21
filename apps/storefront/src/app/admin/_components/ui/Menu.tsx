'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

interface MenuProps {
  /** Content of the trigger button. */
  trigger: ReactNode;
  /** Accessible name of the trigger when its content is not explicit text. */
  label?: string;
  align?: 'start' | 'end';
  /** Optional non-interactive block at the top (account name, workspace). */
  header?: ReactNode;
  children: ReactNode;
  triggerClassName?: string;
  menuClassName?: string;
}

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';
/** Gap between the trigger and the menu, and minimum margin to the viewport edges. */
const GAP = 8;

/**
 * Dropdown menu button (WAI-ARIA menu button pattern): Enter/Space/ArrowDown
 * open on the first item, ArrowUp/ArrowDown/Home/End move, Escape and Tab
 * close (Escape returns focus to the trigger), click outside closes.
 * The menu is portaled with fixed coordinates, so a scrolling or clipped parent
 * (table wrapper, card) never cuts it; it opens upwards when there is no room below.
 */
export default function Menu({ trigger, label, align = 'end', header, children, triggerClassName, menuClassName }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState<CSSProperties | null>(null);

  // Placed before paint: below the trigger, or above it when the viewport is too short.
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const height = menu.offsetHeight;
      const below = window.innerHeight - trigger.bottom - GAP;
      const top = below >= height || trigger.top - GAP < height
        ? Math.min(trigger.bottom + GAP, Math.max(GAP, window.innerHeight - height - GAP))
        : trigger.top - GAP - height;
      setPosition(align === 'end'
        ? { top, right: Math.max(GAP, document.documentElement.clientWidth - trigger.right) }
        : { top, left: Math.max(GAP, trigger.left) });
    };
    place();
    // A scroll would leave the menu away from its trigger: close it, like a native select.
    const close = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', close, true); };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    menuRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus({ preventScroll: true });
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focus = (next: number) => { event.preventDefault(); items[(next + items.length) % items.length]?.focus(); };
    if (event.key === 'ArrowDown') focus(index + 1);
    else if (event.key === 'ArrowUp') focus(index - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(items.length - 1);
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    // The menu lives at the end of <body>: Tab closes it and returns to the trigger.
    else if (event.key === 'Tab') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } }}
        className={cn('flex items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus', triggerClassName)}
      >
        {trigger}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          onKeyDown={move}
          // Selecting an item closes the menu.
          onClick={(event) => { if ((event.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false); }}
          style={position ?? { top: 0, left: 0, opacity: 0 }}
          className={cn(
            'fixed z-50 max-h-[calc(100dvh-1rem)] min-w-[14rem] overflow-y-auto rounded-xl border border-a-border bg-a-surface p-1.5 shadow-lg',
            menuClassName,
          )}
        >
          {header && <div className="px-2.5 py-2">{header}</div>}
          {header && <div role="separator" className="my-1 border-t border-a-border" />}
          {children}
        </div>,
        // Inside a modal <dialog> (top layer) the menu must stay in it to be visible.
        triggerRef.current?.closest('dialog') ?? document.body,
      )}
    </div>
  );
}

const ITEM_CLASS = 'flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-a-text hover:bg-a-hover focus:bg-a-hover focus:outline-none';

export function MenuLink({ href, children, active = false, external = false }: { href: string; children: ReactNode; active?: boolean; external?: boolean }) {
  const className = cn(ITEM_CLASS, active && 'bg-a-selected font-semibold text-a-brand-fg');
  // Workspace switches cross hosts: a plain anchor reloads the other app.
  return external
    ? <a role="menuitem" href={href} aria-current={active ? 'true' : undefined} className={className}>{children}</a>
    : <Link role="menuitem" href={href} aria-current={active ? 'true' : undefined} className={className}>{children}</Link>;
}

export function MenuButton({ onSelect, children, tone }: { onSelect: () => void; children: ReactNode; tone?: 'danger' }) {
  return <button type="button" role="menuitem" onClick={onSelect} className={cn(ITEM_CLASS, tone === 'danger' && 'text-tone-danger-fg')}>{children}</button>;
}
