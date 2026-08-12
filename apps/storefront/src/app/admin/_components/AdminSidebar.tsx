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
  IconGift,
  IconPhoto,
  IconStar,
  IconScan,
  IconTruck,
  IconCalendarEvent,
} from '@tabler/icons-react';

interface AdminSidebarProps {
  categories: { id: string; name: string; slug: string }[];
  pendingPaymentsCount?: number;
  pendingEventRequestsCount?: number;
}

export default function AdminSidebar({ categories, pendingPaymentsCount = 0, pendingEventRequestsCount = 0 }: AdminSidebarProps) {
  const pathname      = usePathname();
  const searchParams  = useSearchParams();
  const activeCategory = searchParams.get('category');

  const [catalogueOpen, setCatalogueOpen] = useState(
    pathname.startsWith('/admin/catalogue')
  );

  const [evenementielOpen, setEvenementielOpen] = useState(
    pathname.startsWith('/admin/evenementiel')
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
        <span className="flex-1">Commandes</span>
        {pendingPaymentsCount > 0 && (
          <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full
                           bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">
            {pendingPaymentsCount}
          </span>
        )}
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
        href="/admin/accueil-slides"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors mx-1 ${
          pathname === '/admin/accueil-slides' ? navClass(true) : navClass(false)
        }`}
      >
        <IconPhoto
          size={16}
          stroke={pathname === '/admin/accueil-slides' ? 2 : 1.5}
        />
        Slides d&apos;accueil
      </Link>

      <Link
        href="/admin/loyalty"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors mx-1 ${
          pathname === '/admin/loyalty' ? navClass(true) : navClass(false)
        }`}
      >
        <IconGift
          size={16}
          stroke={pathname === '/admin/loyalty' ? 2 : 1.5}
        />
        Fidélité & parrainage
      </Link>

      <Link
        href="/admin/loyalty/scan"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors mx-1 ${
          pathname === '/admin/loyalty/scan' ? navClass(true) : navClass(false)
        }`}
      >
        <IconScan
          size={16}
          stroke={pathname === '/admin/loyalty/scan' ? 2 : 1.5}
        />
        Scan fidélité
      </Link>

      <Link
        href="/admin/livraison"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors mx-1 ${
          pathname === '/admin/livraison' ? navClass(true) : navClass(false)
        }`}
      >
        <IconTruck
          size={16}
          stroke={pathname === '/admin/livraison' ? 2 : 1.5}
        />
        Livraison
      </Link>

      <button
        onClick={() => setEvenementielOpen(!evenementielOpen)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors mx-1 w-full text-left ${
          pathname.startsWith('/admin/evenementiel')
            ? navClass(true)
            : navClass(false)
        }`}
      >
        <IconCalendarEvent
          size={16}
          stroke={pathname.startsWith('/admin/evenementiel') ? 2 : 1.5}
        />
        <span className="flex-1">Événementiel</span>
        {evenementielOpen
          ? <IconChevronDown size={13} stroke={1.5} />
          : <IconChevronRight size={13} stroke={1.5} />
        }
      </button>

      {evenementielOpen && (
        <div className="ml-5 border-l border-gray-100 dark:border-gray-800 pl-3 mb-1 space-y-0.5">
          {[
            { href: '/admin/evenementiel/evenements', label: 'Événements', badge: pendingEventRequestsCount },
            { href: '/admin/evenementiel/scan', label: 'Scan' },
            { href: '/admin/evenementiel/services', label: 'Services' },
            { href: '/admin/evenementiel/devis', label: 'Demandes de devis' },
            { href: '/admin/evenementiel/reservations-materiel', label: 'Réservations matériel' },
            { href: '/admin/evenementiel/galerie', label: 'Galerie' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-1.5 py-1.5 px-2 rounded-lg text-xs
                          transition-colors ${
                pathname === item.href || pathname.startsWith(`${item.href}/`)
                  ? 'text-[var(--color-primary-dark)] bg-[var(--color-primary-light)] font-medium'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <span className="flex-1">{item.label}</span>
              {!!item.badge && (
                <span className="text-2xs font-semibold px-1.5 py-0.5 rounded-full
                                 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">
                  {item.badge}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      <Link
        href="/admin/ambassadeurs"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors mx-1 ${
          pathname === '/admin/ambassadeurs' ? navClass(true) : navClass(false)
        }`}
      >
        <IconStar
          size={16}
          stroke={pathname === '/admin/ambassadeurs' ? 2 : 1.5}
        />
        Ambassadeurs
      </Link>

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
