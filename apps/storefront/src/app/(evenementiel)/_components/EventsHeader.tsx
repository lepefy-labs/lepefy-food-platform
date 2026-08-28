'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { IconCalendarEvent, IconMenu2, IconMessageCircle } from '@tabler/icons-react';
import type { Tenant, TenantSocialLink } from '@lepefy/types';
import { TenantLogo } from '@/components/branding/TenantLogo';
import {
  BrandNavigationDrawer,
  type BrandNavigationSection,
} from '@/components/layout/BrandNavigationDrawer';

interface EventsHeaderProps {
  tenant: Tenant;
  socialLinks: TenantSocialLink[];
  featuredEventSlug: string | null;
  hasTraiteur: boolean;
  hasLocation: boolean;
  hasGallery: boolean;
}

function normalizeExternalUrl(value: string | null | undefined) {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function EventsHeader({
  tenant,
  socialLinks,
  featuredEventSlug,
  hasTraiteur,
  hasLocation,
  hasGallery,
}: EventsHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const whatsappHref = tenant.whatsapp_number
    ? `https://wa.me/${tenant.whatsapp_number.replace(/\D/g, '')}`
    : null;
  const contactHref = whatsappHref
    ?? (tenant.legal_email ? `mailto:${tenant.legal_email}` : '/#contact');
  const shopUrl = tenant.storefront_url ?? process.env.NEXT_PUBLIC_APP_URL ?? '/';
  const brandUrl = normalizeExternalUrl(tenant.legal_website);
  const reserveHref = featuredEventSlug ? `/evenements/${featuredEventSlug}` : '/#contact';

  const eventItems: BrandNavigationSection['items'] = [
    { href: '/#evenements', label: 'Événements', icon: 'event', activeWhen: ['/', '/evenementiel', '/evenements'] },
    ...(hasGallery ? [{ href: '/#galerie', label: 'Galerie', icon: 'gallery' as const }] : []),
  ];

  const serviceItems: BrandNavigationSection['items'] = [
    ...(hasTraiteur ? [{ href: '/#traiteur', label: 'Traiteur', icon: 'tools' as const, activeWhen: ['/services'] }] : []),
    ...(hasLocation ? [{ href: '/#location', label: 'Location de matériel', icon: 'tools' as const, activeWhen: ['/services'] }] : []),
  ];

  const brandItems: BrandNavigationSection['items'] = [
    { href: shopUrl, label: 'Boutique', icon: 'shop', external: true },
    { href: `${shopUrl.replace(/\/$/, '')}/card`, label: 'Carte & paiement', icon: 'card', external: true },
    ...(brandUrl ? [{ href: brandUrl, label: `Découvrir ${tenant.name}`, icon: 'home' as const, external: true }] : []),
    ...(tenant.google_maps_url ? [{ href: tenant.google_maps_url, label: 'Nous trouver', icon: 'map' as const, external: true }] : []),
    ...(contactHref ? [{ href: contactHref, label: 'Nous contacter', icon: 'message' as const, external: /^https?:|^mailto:/.test(contactHref) }] : []),
  ];

  const sections: BrandNavigationSection[] = [
    { id: 'events', label: 'Explorer', items: eventItems },
    { id: 'services', label: 'Nos services', items: serviceItems },
    { id: 'brand', label: tenant.name, items: brandItems },
  ];

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-[100] border-b border-white/10 bg-[var(--color-primary-dark)] text-white shadow-sm">
        <div className="relative mx-auto flex h-20 max-w-[1180px] items-center justify-between gap-2 px-3 sm:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-controls="events-navigation-drawer"
            aria-label="Ouvrir le menu"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-white/20 text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-secondary)] lg:order-last"
          >
            <IconMenu2 size={22} />
          </button>

          <Link
            href="/"
            className="absolute left-1/2 flex min-h-11 -translate-x-1/2 flex-col items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-secondary)] lg:static lg:translate-x-0 lg:items-start"
            aria-label={`${tenant.name} Events — accueil`}
          >
            <TenantLogo
              variant="header"
              identity={{ name: tenant.name, logo_url: tenant.logo_url }}
              priority
              className="max-w-[135px] sm:max-w-[180px]"
              fallbackClassName="truncate font-display text-base font-semibold leading-tight text-white sm:text-lg"
            />
            <span className="mt-[-4px] text-[9px] font-extrabold uppercase tracking-[0.24em] text-[var(--color-secondary)]">Events</span>
          </Link>

          <nav className="hidden items-center gap-0.5 lg:ml-auto lg:flex" aria-label="Navigation événementielle">
            <a href="/#evenements" className="inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-secondary)]">
              Événements
            </a>
            {hasTraiteur && (
              <a href="/#traiteur" className="inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-secondary)]">
                Traiteur
              </a>
            )}
            {hasLocation && (
              <a href="/#location" className="inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-secondary)]">
                Location
              </a>
            )}
            <a href="/#contact" className="inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-secondary)]">
              Contact
            </a>
          </nav>

          <Link
            href={reserveHref}
            className="ml-auto inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12px] font-bold shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:text-sm lg:ml-2"
            style={{ backgroundColor: 'var(--color-secondary)', color: 'var(--color-primary-dark)' }}
          >
            {featuredEventSlug ? (
              <>Réserver <IconCalendarEvent size={16} className="shrink-0" /></>
            ) : (
              <>Contact <IconMessageCircle size={16} className="shrink-0" /></>
            )}
          </Link>
        </div>
      </header>

      <BrandNavigationDrawer
        id="events-navigation-drawer"
        open={menuOpen}
        onClose={closeMenu}
        tenant={tenant}
        eyebrow="Events"
        sections={sections}
        socialLinks={socialLinks}
        legalBaseUrl={shopUrl}
        side="responsive"
      />
    </>
  );
}
