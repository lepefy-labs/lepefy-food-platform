'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { IconMenu2, IconX } from '@tabler/icons-react';
import type { AdminWorkspace } from '@/lib/admin/workspace';
import AdminSidebar from './AdminSidebar';

interface AdminMobileNavProps {
  categories: { id: string; name: string; slug: string }[];
  workspace?: AdminWorkspace;
  isPlatformOwner?: boolean;
  pendingPaymentsCount?: number;
  pendingEventRequestsCount?: number;
  pendingRentalRequestsCount?: number;
  newInquiriesCount?: number;
}

export default function AdminMobileNav({ categories, workspace = 'shop', isPlatformOwner = false, pendingPaymentsCount = 0, pendingEventRequestsCount = 0, pendingRentalRequestsCount = 0, newInquiriesCount = 0 }: AdminMobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown); };
  }, [open]);

  const drawer = open ? (
    <div className="fixed inset-0 z-[70] h-[100dvh] md:hidden" role="dialog" aria-modal="true" aria-label="Menu d'administration">
      <button type="button" aria-label="Fermer le menu" className="absolute inset-0 h-full w-full bg-gray-950/45 backdrop-blur-[1px]" onClick={() => setOpen(false)} />
      <div className="absolute inset-y-0 left-0 flex h-[100dvh] w-72 max-w-[86vw] flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex min-h-[57px] shrink-0 items-center justify-between border-b border-[var(--admin-border)] px-4 dark:border-gray-800">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]/70">{workspace === 'events' ? 'Événementiel' : 'Boutique'}</p><p className="mt-0.5 text-xs text-gray-400">Workspace Lepefy</p></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)]"><IconX size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <AdminSidebar categories={categories} workspace={workspace} pendingPaymentsCount={pendingPaymentsCount} pendingEventRequestsCount={pendingEventRequestsCount} pendingRentalRequestsCount={pendingRentalRequestsCount} newInquiriesCount={newInquiriesCount} isPlatformOwner={isPlatformOwner} />
        </div>
      </div>
    </div>
  ) : null;

  return <><button type="button" onClick={() => setOpen(true)} aria-label="Ouvrir le menu" aria-expanded={open} className="-ml-2 rounded-xl p-2 text-gray-500 hover:bg-[var(--admin-primary-soft)] hover:text-[var(--admin-primary-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)] md:hidden"><IconMenu2 size={20} /></button>{drawer && createPortal(drawer, document.body)}</>;
}
