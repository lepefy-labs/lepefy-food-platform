'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconShoppingBag,
  IconChartBar,
  IconPackage,
  IconUsers,
  IconTag,
  IconSettings,
  IconCreditCard,
  IconSparkles,
  IconGift,
  IconPhoto,
  IconStar,
  IconScan,
  IconTruck,
  IconCalendarEvent,
  IconBell,
  IconFileInvoice,
  IconToolsKitchen2,
  IconBriefcase,
} from '@tabler/icons-react';
import type { AdminWorkspace } from '@/lib/admin/workspace';

interface AdminSidebarProps {
  categories: { id: string; name: string; slug: string }[];
  workspace?: AdminWorkspace;
  permissions?: string[];
  pendingPaymentsCount?: number;
  pendingEventRequestsCount?: number;
  pendingRentalRequestsCount?: number;
  newInquiriesCount?: number;
  isPlatformOwner?: boolean;
}

export default function AdminSidebar({
  workspace = 'shop',
  permissions = [],
  pendingPaymentsCount = 0,
  pendingEventRequestsCount = 0,
  pendingRentalRequestsCount = 0,
  newInquiriesCount = 0,
  isPlatformOwner = false,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const has = (permission: string) => isPlatformOwner || permissions.includes('*') || permissions.includes(permission);

  function navClass(active: boolean) {
    return active
      ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] font-semibold ring-1 ring-[#D9D3FF] shadow-[inset_3px_0_0_var(--admin-primary)]'
      : 'text-gray-600 dark:text-gray-300 hover:bg-white hover:text-gray-950 dark:hover:bg-white/5 dark:hover:text-white';
  }

  const groupLabel = 'mb-2 mt-5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]/60 dark:text-violet-300/60';
  const linkClass = (active: boolean) => `mx-1 flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all ${navClass(active)}`;
  const shopVisible = ['orders.view','catalog.view','loyalty.scan','shipping.view','loyalty.manage','growth.manage','ai_knowledge.manage','ai_usage.view'].some(has);
  const eventsVisible = ['events.view','event_reservations.view','event_payments.view','event_content.manage','scan.access'].some(has);
  const commonVisible = ['tenant_settings.view','billing.view','ai_usage.view'].some(has);

  return (
    <nav className="flex h-full flex-col pb-3">
      {workspace === 'shop' && shopVisible ? (
        <>
          <p className={groupLabel}>Boutique</p>
          {has('orders.view') && <Link href="/admin" className={linkClass(pathname === '/admin')}><IconShoppingBag size={20} /><span className="flex-1">Commandes</span>{pendingPaymentsCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">{pendingPaymentsCount}</span>}</Link>}
          {has('orders.view') && <Link href="/admin/checkout-funnel" className={linkClass(pathname === '/admin/checkout-funnel')}><IconChartBar size={20} />Funnel checkout</Link>}
          {has('catalog.view') && <Link href="/admin/catalogue" className={linkClass(pathname.startsWith('/admin/catalogue'))}><IconPackage size={20} />Catalogue</Link>}
          {has('orders.view') && <div className="mx-1 flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-sm text-gray-300 dark:text-gray-600"><IconUsers size={20} /><span className="flex-1">Clients</span><span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">Bientôt</span></div>}
          {has('growth.manage') && <div className="mx-1 flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-sm text-gray-300 dark:text-gray-600"><IconTag size={20} /><span className="flex-1">Promotions</span><span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">Bientôt</span></div>}
          {has('catalog.manage') && <Link href="/admin/accueil-slides" className={linkClass(pathname === '/admin/accueil-slides')}><IconPhoto size={20} />Slides d&apos;accueil</Link>}

          {(has('loyalty.scan') || has('shipping.view')) && <p className={groupLabel}>Opérations</p>}
          {has('loyalty.scan') && <Link href="/admin/loyalty/scan" className={linkClass(pathname === '/admin/loyalty/scan')}><IconScan size={20} />Scan fidélité</Link>}
          {has('shipping.view') && <Link href="/admin/livraison" className={linkClass(pathname.startsWith('/admin/livraison'))}><IconTruck size={20} />Livraison</Link>}

          {(has('loyalty.manage') || has('growth.manage') || has('ai_knowledge.manage') || has('ai_usage.view')) && <p className={groupLabel}>Croissance</p>}
          {has('loyalty.manage') && <Link href="/admin/loyalty" className={linkClass(pathname === '/admin/loyalty')}><IconGift size={20} />Fidélité &amp; parrainage</Link>}
          {has('growth.manage') && <Link href="/admin/ambassadeurs" className={linkClass(pathname === '/admin/ambassadeurs')}><IconStar size={20} />Ambassadeurs</Link>}
          {has('ai_usage.view') && <Link href="/admin/nala-analytics" className={linkClass(pathname.startsWith('/admin/nala-analytics'))}><IconSparkles size={20} />Nala Analytics</Link>}
          {has('ai_knowledge.manage') && <Link href="/admin/ai-lab" className={linkClass(pathname === '/admin/ai-lab')}><IconSparkles size={20} />IA — Base de connaissance</Link>}
        </>
      ) : workspace === 'events' && eventsVisible ? (
        <>
          {(has('events.view') || has('event_reservations.view') || has('event_payments.view') || has('event_content.manage')) && <p className={groupLabel}>Événementiel</p>}
          {has('events.view') && <Link href="/admin" className={linkClass(pathname === '/admin' || pathname === '/admin/evenementiel')}><IconCalendarEvent size={20} />Vue d’ensemble</Link>}
          {has('events.view') && <Link href="/admin/evenementiel/evenements" className={linkClass(pathname.startsWith('/admin/evenementiel/evenements'))}><IconCalendarEvent size={20} />Événements</Link>}
          {(has('event_reservations.view') || has('event_payments.view')) && <Link href="/admin/evenementiel/reservations" className={linkClass(pathname.startsWith('/admin/evenementiel/reservations') || pathname.startsWith('/admin/evenementiel/paiements-en-attente'))}><IconFileInvoice size={20} /><span className="flex-1">Réservations / Paiements</span>{pendingEventRequestsCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">{pendingEventRequestsCount}</span>}</Link>}
          {has('events.view') && <Link href="/admin/evenementiel/devis" className={linkClass(pathname.startsWith('/admin/evenementiel/devis'))}><IconBriefcase size={20} /><span className="flex-1">Demandes traiteur</span>{newInquiriesCount > 0 && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-800">{newInquiriesCount}</span>}</Link>}
          {has('events.view') && <Link href="/admin/evenementiel/reservations-materiel" className={linkClass(pathname.startsWith('/admin/evenementiel/reservations-materiel'))}><IconToolsKitchen2 size={20} /><span className="flex-1">Locations</span>{pendingRentalRequestsCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">{pendingRentalRequestsCount}</span>}</Link>}
          {has('event_content.manage') && <Link href="/admin/evenementiel/contenu" className={linkClass(pathname.startsWith('/admin/evenementiel/contenu') || pathname.startsWith('/admin/evenementiel/services') || pathname.startsWith('/admin/evenementiel/galerie'))}><IconPhoto size={20} />Galerie / Contenu</Link>}

          {has('scan.access') && <><p className={groupLabel}>Service sur place</p><Link href="/scan" className={`${linkClass(pathname === '/scan')} border border-violet-200 bg-violet-50/70 text-violet-800 hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/20 dark:text-violet-200`}><IconScan size={20} />Service repas / Scan</Link></>}
        </>
      ) : null}

      {commonVisible && <p className={groupLabel}>Commun</p>}
      {has('tenant_settings.view') && <Link href="/admin/parametres" className={linkClass(pathname.startsWith('/admin/parametres'))}><IconSettings size={20} />Paramètres</Link>}
      {has('billing.view') && <Link href="/admin/billing" className={linkClass(pathname === '/admin/billing')}><IconCreditCard size={20} />Abonnement</Link>}
      {has('ai_usage.view') && <Link href="/admin/ai-usage" className={linkClass(pathname === '/admin/ai-usage')}><IconChartBar size={20} />Utilisation IA</Link>}

      {isPlatformOwner && (
        <>
          <p className={groupLabel}>Plateforme</p>
          <Link href="/admin/platform" className={linkClass(pathname === '/admin/platform')}><IconSettings size={20} />Console Lepefy</Link>
          <Link href="/admin/team" className={linkClass(pathname === '/admin/team')}><IconUsers size={20} />Utilisateurs</Link>
          <Link href="/admin/platform/prospects" className={linkClass(pathname.startsWith('/admin/platform/prospects'))}><IconBriefcase size={20} />Prospects</Link>
          <Link href="/admin/platform/access" className={linkClass(pathname.startsWith('/admin/platform/access'))}><IconUsers size={20} />Rôles &amp; permissions</Link>
          <Link href="/admin/platform/ai-routing" className={linkClass(pathname.startsWith('/admin/platform/ai-routing'))}><IconSparkles size={20} />Routage IA</Link>
          <Link href="/admin/platform/ai-usage" className={linkClass(pathname.startsWith('/admin/platform/ai-usage'))}><IconSparkles size={20} />Coûts IA</Link>
          <Link href="/admin/platform/notifications" className={linkClass(pathname.startsWith('/admin/platform/notifications'))}><IconBell size={20} />Tests notifications</Link>
        </>
      )}
    </nav>
  );
}
