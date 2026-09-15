'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { IconArrowRight, IconMenu2 } from '@tabler/icons-react';
import type { Tenant, TenantSocialLink } from '@lepefy/types';
import { TenantLogo } from '@/components/branding/TenantLogo';
import { BrandNavigationDrawer, type BrandNavigationSection } from '@/components/layout/BrandNavigationDrawer';

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

export function EventsHeader({ tenant, socialLinks, featuredEventSlug, hasTraiteur, hasLocation, hasGallery }: EventsHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const whatsappHref = tenant.whatsapp_number ? `https://wa.me/${tenant.whatsapp_number.replace(/\D/g, '')}` : null;
  const contactHref = whatsappHref ?? (tenant.legal_email ? `mailto:${tenant.legal_email}` : '/#contact');
  const shopUrl = tenant.storefront_url ?? process.env.NEXT_PUBLIC_APP_URL ?? '/';
  const brandUrl = normalizeExternalUrl(tenant.legal_website);
  const reserveHref = featuredEventSlug ? `/evenements/${featuredEventSlug}` : '/#contact';

  const sections: BrandNavigationSection[] = [
    {
      id: 'events',
      label: 'Explorer',
      items: [
        { href: '/#evenements', label: 'Événements', icon: 'event', activeWhen: ['/', '/evenementiel', '/evenements'] },
        ...(hasGallery ? [{ href: '/#galerie', label: 'Galerie', icon: 'gallery' as const }] : []),
      ],
    },
    {
      id: 'services',
      label: 'Nos services',
      items: [
        ...(hasTraiteur ? [{ href: '/#traiteur', label: 'Traiteur', icon: 'tools' as const, activeWhen: ['/services'] }] : []),
        ...(hasLocation ? [{ href: '/#location', label: 'Location de matériel', icon: 'tools' as const, activeWhen: ['/services'] }] : []),
      ],
    },
    {
      id: 'brand',
      label: tenant.name,
      items: [
        { href: shopUrl, label: 'Boutique', icon: 'shop', external: true },
        { href: `${shopUrl.replace(/\/$/, '')}/card`, label: 'Carte & paiement', icon: 'card', external: true },
        ...(brandUrl ? [{ href: brandUrl, label: `Découvrir ${tenant.name}`, icon: 'home' as const, external: true }] : []),
        ...(tenant.google_maps_url ? [{ href: tenant.google_maps_url, label: 'Nous trouver', icon: 'map' as const, external: true }] : []),
        { href: contactHref, label: 'Nous contacter', icon: 'message', external: /^https?:|^mailto:/.test(contactHref) },
      ],
    },
  ];

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-[100] border-b border-black/5 bg-white/95 text-[var(--color-primary-dark)] shadow-[0_1px_12px_rgba(15,23,42,.05)] backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-[1180px] items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex min-h-11 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]" aria-label={`${tenant.name} Events — accueil`}>
            <TenantLogo variant="header" identity={{ name: tenant.name, logo_url: tenant.logo_url }} priority className="max-h-14 max-w-[170px] sm:max-w-[210px]" fallbackClassName="font-display text-lg font-semibold text-[var(--color-primary-dark)]" />
          </Link>

          <nav className="ml-auto hidden items-center gap-1 lg:flex" aria-label="Navigation événementielle">
            <a href="/#evenements" className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold hover:bg-black/[.04]">Événements</a>
            {hasTraiteur && <a href="/#traiteur" className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold hover:bg-black/[.04]">Traiteur</a>}
            {hasLocation && <a href="/#location" className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold hover:bg-black/[.04]">Location</a>}
            {hasGallery && <a href="/#galerie" className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold hover:bg-black/[.04]">Réalisations</a>}
          </nav>

          <Link href={reserveHref} className="ml-auto hidden min-h-11 items-center gap-2 rounded-full bg-[var(--color-secondary)] px-5 text-sm font-extrabold text-[var(--color-primary-dark)] shadow-sm transition-transform hover:-translate-y-0.5 sm:inline-flex lg:ml-3">
            {featuredEventSlug ? 'Découvrir' : 'Organiser un événement'} <IconArrowRight size={17} />
          </Link>

          <button type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-controls="events-navigation-drawer" aria-label="Ouvrir le menu" className="ml-auto flex size-11 items-center justify-center rounded-full border border-black/10 bg-white text-[var(--color-primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:ml-0 lg:hidden">
            <IconMenu2 size={23} />
          </button>
        </div>
      </header>

      <BrandNavigationDrawer id="events-navigation-drawer" open={menuOpen} onClose={closeMenu} tenant={tenant} eyebrow="Events" sections={sections} socialLinks={socialLinks} legalBaseUrl={shopUrl} side="responsive" />
    </>
  );
}
