'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  IconShoppingBag, IconPackage, IconUsers, IconTag, IconSettings, IconCreditCard,
  IconChevronDown, IconChevronRight, IconSparkles, IconGift, IconPhoto, IconStar,
  IconScan, IconTruck, IconCalendarEvent,
} from '@tabler/icons-react';

interface AdminSidebarProps {
  categories: { id: string; name: string; slug: string }[];
  pendingPaymentsCount?: number;
  pendingEventRequestsCount?: number;
  pendingRentalRequestsCount?: number;
  newInquiriesCount?: number;
  isPlatformOwner?: boolean;
}

export default function AdminSidebar({
  categories,
  pendingPaymentsCount = 0,
  pendingEventRequestsCount = 0,
  pendingRentalRequestsCount = 0,
  newInquiriesCount = 0,
  isPlatformOwner = false,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeCategory = searchParams.get('category');
  const [catalogueOpen, setCatalogueOpen] = useState(pathname.startsWith('/admin/catalogue'));
  const [evenementielOpen, setEvenementielOpen] = useState(pathname.startsWith('/admin/evenementiel'));
  const [parametresOpen, setParametresOpen] = useState(pathname.startsWith('/admin/parametres'));
  const eventAttentionCount = pendingEventRequestsCount + pendingRentalRequestsCount;
  const showEventParentBadge = pendingEventRequestsCount > 0 && pendingRentalRequestsCount > 0;

  function navClass(active: boolean) {
    return active
      ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)] font-medium'
      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5';
  }

  const subClass = (active: boolean) => `flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors ${
    active
      ? 'text-[var(--color-primary-dark)] bg-[var(--color-primary-light)] font-medium'
      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
  }`;

  return (
    <nav className="flex h-full flex-col">
      <p className="mb-2 mt-4 px-3 text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-gray-400">Gestion</p>

      <Link href="/admin" className={`mx-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${pathname === '/admin' ? navClass(true) : navClass(false)}`}>
        <IconShoppingBag size={20} stroke={pathname === '/admin' ? 1.75 : 1.5} />
        <span className="flex-1">Commandes</span>
        {pendingPaymentsCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-300">{pendingPaymentsCount}</span>}
      </Link>

      <button onClick={() => setCatalogueOpen(!catalogueOpen)} className={`mx-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${pathname.startsWith('/admin/catalogue') ? navClass(true) : navClass(false)}`}>
        <IconPackage size={20} stroke={pathname.startsWith('/admin/catalogue') ? 1.75 : 1.5} />
        <span className="flex-1">Catalogue</span>
        {catalogueOpen ? <IconChevronDown size={14} stroke={1.5} /> : <IconChevronRight size={14} stroke={1.5} />}
      </button>
      {catalogueOpen && (
        <div className="mb-1 ml-5 space-y-0.5 border-l border-gray-100 pl-3 dark:border-gray-800">
          <Link href="/admin/catalogue" className={subClass(pathname === '/admin/catalogue' && !activeCategory)}>Tout</Link>
          {categories.map((cat) => <Link key={cat.id} href={`/admin/catalogue?category=${cat.slug}`} className={subClass(activeCategory === cat.slug)}>{cat.name}</Link>)}
        </div>
      )}

      <div className="mx-1 flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-300 dark:text-gray-600">
        <IconUsers size={20} stroke={1.5} /><span className="flex-1">Clients</span><span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Bientôt</span>
      </div>

      <p className="mb-2 mt-5 px-3 text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-gray-400">Boutique</p>
      <div className="mx-1 flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-300 dark:text-gray-600"><IconTag size={20} stroke={1.5} /><span className="flex-1">Promotions</span><span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Bientôt</span></div>
      <Link href="/admin/accueil-slides" className={`mx-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${pathname === '/admin/accueil-slides' ? navClass(true) : navClass(false)}`}><IconPhoto size={20} stroke={1.5} />Slides d&apos;accueil</Link>
      <Link href="/admin/loyalty" className={`mx-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${pathname === '/admin/loyalty' ? navClass(true) : navClass(false)}`}><IconGift size={20} stroke={1.5} />Fidélité & parrainage</Link>
      <Link href="/admin/loyalty/scan" className={`mx-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${pathname === '/admin/loyalty/scan' ? navClass(true) : navClass(false)}`}><IconScan size={20} stroke={1.5} />Scan fidélité</Link>
      <Link href="/admin/livraison" className={`mx-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${pathname === '/admin/livraison' ? navClass(true) : navClass(false)}`}><IconTruck size={20} stroke={1.5} />Livraison</Link>

      <button onClick={() => setEvenementielOpen(!evenementielOpen)} className={`mx-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${pathname.startsWith('/admin/evenementiel') ? navClass(true) : navClass(false)}`}>
        <IconCalendarEvent size={20} stroke={pathname.startsWith('/admin/evenementiel') ? 1.75 : 1.5} />
        <span className="flex-1">Événementiel</span>
        {showEventParentBadge && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-300" title={`${eventAttentionCount} paiements à vérifier dans le module événementiel`} aria-label={`${eventAttentionCount} paiements à vérifier dans le module événementiel`}>{eventAttentionCount}</span>}
        {evenementielOpen ? <IconChevronDown size={13} stroke={1.5} /> : <IconChevronRight size={13} stroke={1.5} />}
      </button>
      {evenementielOpen && (
        <div className="mb-1 ml-5 space-y-0.5 border-l border-gray-100 pl-3 dark:border-gray-800">
          <Link href="/admin/evenementiel" className={subClass(pathname === '/admin/evenementiel')}>Vue d’ensemble</Link>
          <Link href="/admin/evenementiel/evenements" className={subClass(pathname.startsWith('/admin/evenementiel/evenements'))}>
            <span className="flex-1">Événements</span>
            {pendingEventRequestsCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-2xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-300" title={`${pendingEventRequestsCount} paiement${pendingEventRequestsCount > 1 ? 's' : ''} à vérifier`} aria-label={`${pendingEventRequestsCount} paiement${pendingEventRequestsCount > 1 ? 's' : ''} à vérifier`}>{pendingEventRequestsCount}</span>}
          </Link>
          <Link href="/admin/evenementiel/devis" className={subClass(pathname.startsWith('/admin/evenementiel/devis'))}>
            <span className="flex-1">Demandes</span>
            {newInquiriesCount > 0 && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-2xs font-semibold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300" title={`${newInquiriesCount} nouvelle${newInquiriesCount > 1 ? 's' : ''} demande${newInquiriesCount > 1 ? 's' : ''}`} aria-label={`${newInquiriesCount} nouvelle${newInquiriesCount > 1 ? 's' : ''} demande${newInquiriesCount > 1 ? 's' : ''}`}>{newInquiriesCount}</span>}
          </Link>
          <Link href="/admin/evenementiel/reservations-materiel" className={subClass(pathname.startsWith('/admin/evenementiel/reservations-materiel'))}>
            <span className="flex-1">Locations</span>
            {pendingRentalRequestsCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-2xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-300" title={`${pendingRentalRequestsCount} paiement${pendingRentalRequestsCount > 1 ? 's' : ''} à vérifier`} aria-label={`${pendingRentalRequestsCount} paiement${pendingRentalRequestsCount > 1 ? 's' : ''} à vérifier`}>{pendingRentalRequestsCount}</span>}
          </Link>
          <Link href="/admin/evenementiel/contenu" className={subClass(pathname.startsWith('/admin/evenementiel/contenu') || pathname.startsWith('/admin/evenementiel/services') || pathname.startsWith('/admin/evenementiel/galerie'))}>Contenu</Link>
          <Link href="/admin/evenementiel/scan" className={subClass(pathname.startsWith('/admin/evenementiel/scan'))}>Scan</Link>
        </div>
      )}

      <Link href="/admin/ambassadeurs" className={`mx-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${pathname === '/admin/ambassadeurs' ? navClass(true) : navClass(false)}`}><IconStar size={20} stroke={1.5} />Ambassadeurs</Link>

      <button onClick={() => setParametresOpen(!parametresOpen)} className={`mx-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${pathname.startsWith('/admin/parametres') ? navClass(true) : navClass(false)}`}><IconSettings size={20} stroke={1.5} /><span className="flex-1">Paramètres</span>{parametresOpen ? <IconChevronDown size={14} stroke={1.5} /> : <IconChevronRight size={14} stroke={1.5} />}</button>
      {parametresOpen && <div className="mb-1 ml-5 space-y-0.5 border-l border-gray-100 pl-3 dark:border-gray-800"><Link href="/admin/parametres" className={subClass(pathname === '/admin/parametres')}>Général</Link><Link href="/admin/parametres/paiements" className={subClass(pathname === '/admin/parametres/paiements')}>Moyens de paiement</Link></div>}

      <Link href="/admin/ai-lab" className={`mx-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${pathname === '/admin/ai-lab' ? navClass(true) : navClass(false)}`}><IconSparkles size={20} stroke={1.5} />IA — Base de connaissance</Link>
      <p className="mb-2 mt-5 px-3 text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-gray-400">Compte</p>
      <Link href="/admin/billing" className={`mx-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${pathname === '/admin/billing' ? navClass(true) : navClass(false)}`}><IconCreditCard size={20} stroke={1.5} />Abonnement</Link>

      {isPlatformOwner && <><p className="mb-2 mt-5 px-3 text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-gray-400">Plateforme</p><Link href="/admin/team" className={`mx-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${pathname === '/admin/team' ? navClass(true) : navClass(false)}`}><IconUsers size={20} stroke={1.5} />Équipe</Link></>}
    </nav>
  );
}
