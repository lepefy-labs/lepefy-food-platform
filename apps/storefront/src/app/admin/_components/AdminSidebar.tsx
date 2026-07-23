'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  IconShoppingBag,
  IconPackage,
  IconUsers,
  IconTag,
  IconSettings,
  IconCreditCard,
  IconChevronDown,
  IconChevronRight,
  IconSparkles,
} from '@tabler/icons-react';

interface AdminSidebarProps {
  categories: { id: string; name: string; slug: string }[];
}

export default function AdminSidebar({ categories }: AdminSidebarProps) {
  const pathname      = usePathname();
  const searchParams  = useSearchParams();
  const activeCategory = searchParams.get('category');

  const [catalogueOpen, setCatalogueOpen] = useState(
    pathname.startsWith('/admin/catalogue')
  );

  function navClass(active: boolean) {
    return active
      ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)] font-medium'
      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800';
  }

  return (
    <nav className="flex flex-col h-full">

      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase
                    tracking-widest px-3 mb-1 mt-4">
        Gestion
      </p>

      <Link
        href="/admin"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors mx-1 ${
          pathname === '/admin' ? navClass(true) : navClass(false)
        }`}
      >
        <IconShoppingBag
          size={16}
          stroke={pathname === '/admin' ? 2 : 1.5}
        />
        Commandes
      </Link>

      <button
        onClick={() => setCatalogueOpen(!catalogueOpen)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors mx-1 w-full text-left ${
          pathname.startsWith('/admin/catalogue')
            ? navClass(true)
            : navClass(false)
        }`}
      >
        <IconPackage
          size={16}
          stroke={pathname.startsWith('/admin/catalogue') ? 2 : 1.5}
        />
        <span className="flex-1">Catalogue</span>
        {catalogueOpen
          ? <IconChevronDown size={13} stroke={1.5} />
          : <IconChevronRight size={13} stroke={1.5} />
        }
      </button>

      {catalogueOpen && (
        <div className="ml-5 border-l border-gray-100 dark:border-gray-800 pl-3 mb-1 space-y-0.5">
          <Link
            href="/admin/catalogue"
            className={`block py-1.5 px-2 rounded-lg text-xs
                        transition-colors ${
              pathname === '/admin/catalogue' && !activeCategory
                ? 'text-[var(--color-primary-dark)] bg-[var(--color-primary-light)] font-medium'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            Tout
          </Link>

          {categories.map(cat => (
            <Link
              key={cat.id}
              href={`/admin/catalogue?category=${cat.slug}`}
              className={`block py-1.5 px-2 rounded-lg text-xs
                          transition-colors ${
                activeCategory === cat.slug
                  ? 'text-[var(--color-primary-dark)] bg-[var(--color-primary-light)] font-medium'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {cat.name}
            </Link>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg
                      text-sm mx-1 text-gray-300 dark:text-gray-600 cursor-not-allowed">
        <IconUsers size={16} stroke={1.5} />
        <span className="flex-1">Clients</span>
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full
                         bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
          Bientôt
        </span>
      </div>

      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase
                    tracking-widest px-3 mb-1 mt-5">
        Boutique
      </p>

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg
                      text-sm mx-1 text-gray-300 dark:text-gray-600 cursor-not-allowed">
        <IconTag size={16} stroke={1.5} />
        <span className="flex-1">Promotions</span>
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full
                         bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
          Bientôt
        </span>
      </div>

      <Link
        href="/admin/parametres"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors mx-1 ${
          pathname === '/admin/parametres' ? navClass(true) : navClass(false)
        }`}
      >
        <IconSettings
          size={16}
          stroke={pathname === '/admin/parametres' ? 2 : 1.5}
        />
        Paramètres
      </Link>

      <Link
        href="/admin/ai-lab"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors mx-1 ${
          pathname === '/admin/ai-lab' ? navClass(true) : navClass(false)
        }`}
      >
        <IconSparkles
          size={16}
          stroke={pathname === '/admin/ai-lab' ? 2 : 1.5}
        />
        IA — Base de connaissance
      </Link>

      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase
                    tracking-widest px-3 mb-1 mt-5">
        Compte
      </p>

      <Link
        href="/admin/billing"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors mx-1 ${
          pathname === '/admin/billing' ? navClass(true) : navClass(false)
        }`}
      >
        <IconCreditCard
          size={16}
          stroke={pathname === '/admin/billing' ? 2 : 1.5}
        />
        Abonnement
      </Link>

    </nav>
  );
}
