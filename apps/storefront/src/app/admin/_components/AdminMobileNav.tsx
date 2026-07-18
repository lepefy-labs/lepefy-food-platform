'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { IconMenu2, IconX } from '@tabler/icons-react';
import AdminSidebar from './AdminSidebar';

interface AdminMobileNavProps {
  categories: { id: string; name: string; slug: string }[];
}

export default function AdminMobileNav({ categories }: AdminMobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Ferme le tiroir dès qu'on navigue vers une nouvelle page — pas à chaque
  // clic à l'intérieur (le sous-menu Catalogue se déplie sans changer de route).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Ouvrir le menu"
        className="md:hidden p-2 -ml-2 rounded-lg text-gray-500 dark:text-gray-400
                   hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <IconMenu2 size={20} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu d'administration"
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 max-w-[80vw] bg-white dark:bg-gray-900
                          shadow-xl overflow-y-auto">
            <div className="flex items-center justify-between px-3 py-3 border-b
                            border-gray-100 dark:border-gray-800">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400
                               uppercase tracking-wide">
                Menu
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <IconX size={16} />
              </button>
            </div>
            <AdminSidebar categories={categories} />
          </div>
        </div>
      )}
    </>
  );
}
