'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconPackage } from '@tabler/icons-react';

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="w-56 bg-white border-r border-gray-200 px-3 py-4 shrink-0 hidden md:block">
      <a
        href="/admin"
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span>📦</span> Commandes
      </a>
      <Link
        href="/admin/catalogue"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors mt-1 ${
          pathname.startsWith('/admin/catalogue')
            ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        <IconPackage
          size={18}
          stroke={pathname.startsWith('/admin/catalogue') ? 2 : 1.5}
        />
        Catalogue
      </Link>
      <a
        href="/admin/billing"
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors mt-1"
      >
        <span>💳</span> Abonnement
      </a>
    </nav>
  );
}
