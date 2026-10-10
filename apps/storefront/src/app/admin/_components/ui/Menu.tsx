'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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

/**
 * Dropdown menu button (WAI-ARIA menu button pattern): Enter/Space/ArrowDown
 * open on the first item, ArrowUp/ArrowDown/Home/End move, Escape and Tab
 * close (Escape returns focus to the trigger), click outside closes.
 */
export default function Menu({ trigger, label, align = 'end', header, children, triggerClassName, menuClassName }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    menuRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
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
    else if (event.key === 'Tab') setOpen(false);
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
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          onKeyDown={move}
          // Selecting an item closes the menu.
          onClick={(event) => { if ((event.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false); }}
          className={cn(
            'absolute z-50 mt-2 min-w-[14rem] rounded-xl border border-a-border bg-a-surface p-1.5 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
            menuClassName,
          )}
        >
          {header && <div className="px-2.5 py-2">{header}</div>}
          {header && <div role="separator" className="my-1 border-t border-a-border" />}
          {children}
        </div>
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
