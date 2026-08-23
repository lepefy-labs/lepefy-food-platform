'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  pendingRentalRequestsCount?: number;
  newInquiriesCount?: number;
  isPlatformOwner?: boolean;
}

export default function AdminSidebar({
  pendingPaymentsCount = 0,
  pendingEventRequestsCount = 0,
  pendingRentalRequestsCount = 0,
  newInquiriesCount = 0,
  isPlatformOwner = false,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const [evenementielOpen, setEvenementielOpen] = useState(pathname.startsWith('/admin/evenementiel'));
  const [parametresOpen, setParametresOpen] = useState(pathname.startsWith('/admin/parametres'));
  const eventAttentionCount = pendingEventRequestsCount + pendingRentalRequestsCount;
  const showEventParentBadge = pendingEventRequestsCount > 0 && pendingRentalRequestsCount > 0;

  function navClass(active: boolean) {
    return active
      ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] font-semibold ring-1 ring-[#D9D3FF] shadow-[inset_3px_0_0_var(--admin-primary)]'
      : 'text-gray-600 dark:text-gray-300 hover:bg-white hover:text-gray-950 dark:hover:bg-white/5 dark:hover:text-white';
  }

  const subClass = (active: boolean) => `flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
    active
      ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] font-semibold ring-1 ring-[#E8E4FF]'
      : 'text-gray-500 dark:text-gray-400 hover:bg-white hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200'
  }`;

  const groupLabel = 'mb-2 mt-5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]/60 dark:text-violet-300/60';

  return (
    <nav className="flex h-full flex-col">
      <p className={groupLabel}>Gestion</p>

      <Link href="/admin" className={`mx-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${navClass(pathname === '/admin')}`}>
        <IconShoppingBag size={20} stroke={pathname === '/admin' ? 1.8 : 1.5} />
        <span className="flex-1">Commandes</span>
        {pendingPaymentsCount > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-300">{pendingPaymentsCount}</span>
        )}
      </Link>

      <Link href="/admin/catalogue" className={`mx-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${navClass(pathname.startsWith('/admin/catalogue'))}`}>
        <IconPackage size={20} stroke={pathname.startsWith('/admin/catalogue') ? 1.8 : 1.5} />
        <span className="flex-1">Catalogue</span>
      </Link>

      <div className="mx-1 flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-300 dark:text-gray-600">
        <IconUsers size={20} stroke={1.5} />
        <span className="flex-1">Clients</span>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Bientôt</span>
      </div>

      <p className={groupLabel}>Boutique</p>
      <div className="mx-1 flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-300 dark:text-gray-600">
        <IconTag size={20} stroke={1.5} />
        <span className="flex-1">Promotions</span>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Bientôt</span>
      </div>
      <Link href="/admin/accueil-slides" className={`mx-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${navClass(pathname === '/admin/accueil-slides')}`}><IconPhoto size={20} stroke={1.5} />Slides d&apos;accueil</Link>
      <Link href="/admin/loyalty" className={`mx-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${navClass(pathname === '/admin/loyalty')}`}><IconGift size={20} stroke={1.5} />Fidélité &amp; parrainage</Link>
      <Link href="/admin/loyalty/scan" className={`mx-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${navClass(pathname === '/admin/loyalty/scan')}`}><IconScan size={20} stroke={1.5} />Scan fidélité</Link>
      <Link href="/admin/livraison" className={`mx-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${navClass(pathname.startsWith('/admin/livraison'))}`}><IconTruck size={20} stroke={1.5} />Livraison</Link>

      <button onClick={() => setEvenementielOpen(!evenementielOpen)} className={`mx-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${navClass(pathname.startsWith('/admin/evenementiel'))}`}>
        <IconCalendarEvent size={20} stroke={pathname.startsWith('/admin/evenementiel') ? 1.8 : 1.5} />
        <span className="flex-1">Événementiel</span>
        {showEventParentBadge && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-300" title={`${eventAttentionCount} paiements à vérifier dans le module événementiel`}>{eventAttentionCount}</span>
        )}
        {evenementielOpen ? <IconChevronDown size={13} stroke={1.5} /> : <IconChevronRight size={13} stroke={1.5} />}
      </button>
      {evenementielOpen && (
        <div className="mb-1 ml-5 space-y-0.5 border-l-2 border-[var(--admin-primary-soft)] pl-3">
          <Link href="/admin/evenementiel" className={subClass(pathname === '/admin/evenementiel')}>Vue d’ensemble</Link>
          <Link href="/admin/evenementiel/evenements" className={subClass(pathname.startsWith('/admin/evenementiel/evenements'))}>
            <span className="flex-1">Événements</span>
            {pendingEventRequestsCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-2xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-300">{pendingEventRequestsCount}</span>}
          </Link>
          <Link href="/admin/evenementiel/devis" className={subClass(pathname.startsWith('/admin/evenementiel/devis'))}>
            <span className="flex-1">Demandes</span>
            {newInquiriesCount > 0 && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-2xs font-semibold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">{newInquiriesCount}</span>}
          </Link>
          <Link href="/admin/evenementiel/reservations-materiel" className={subClass(pathname.startsWith('/admin/evenementiel/reservations-materiel'))}>
            <span className="flex-1">Locations</span>
            {pendingRentalRequestsCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-2xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-300">{pendingRentalRequestsCount}</span>}
          </Link>
          <Link href="/admin/evenementiel/contenu" className={subClass(pathname.startsWith('/admin/evenementiel/contenu') || pathname.startsWith('/admin/evenementiel/services') || pathname.startsWith('/admin/evenementiel/galerie'))}>Contenu</Link>
          <Link href="/admin/evenementiel/scan" className={subClass(pathname.startsWith('/admin/evenementiel/scan'))}>Scan</Link>
        </div>
      )}

      <Link href="/admin/ambassadeurs" className={`mx-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${navClass(pathname === '/admin/ambassadeurs')}`}><IconStar size={20} stroke={1.5} />Ambassadeurs</Link>

      <button onClick={() => setParametresOpen(!parametresOpen)} className={`mx-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${navClass(pathname.startsWith('/admin/parametres'))}`}>
        <IconSettings size={20} stroke={1.5} />
        <span className="flex-1">Paramètres</span>
        {parametresOpen ? <IconChevronDown size={14} stroke={1.5} /> : <IconChevronRight size={14} stroke={1.5} />}
      </button>
      {parametresOpen && (
        <div className="mb-1 ml-5 space-y-0.5 border-l-2 border-[var(--admin-primary-soft)] pl-3">
          <Link href="/admin/parametres" className={subClass(pathname === '/admin/parametres')}>Général</Link>
          <Link href="/admin/parametres/paiements" className={subClass(pathname === '/admin/parametres/paiements')}>Moyens de paiement</Link>
        </div>
      )}

      <Link href="/admin/ai-lab" className={`mx-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${navClass(pathname === '/admin/ai-lab')}`}><IconSparkles size={20} stroke={1.5} />IA — Base de connaissance</Link>

      <p className={groupLabel}>Compte</p>
      <Link href="/admin/billing" className={`mx-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${navClass(pathname === '/admin/billing')}`}><IconCreditCard size={20} stroke={1.5} />Abonnement</Link>

      {isPlatformOwner && (
        <>
          <p className={groupLabel}>Plateforme</p>
          <Link href="/admin/team" className={`mx-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${navClass(pathname === '/admin/team')}`}><IconUsers size={20} stroke={1.5} />Équipe</Link>
        </>
      )}
    </nav>
  );
}
