'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandTiktok,
  IconBrandX,
  IconBrandYoutube,
  IconCalendarEvent,
  IconCategory,
  IconChevronRight,
  IconCreditCard,
  IconHome,
  IconMapPin,
  IconMessageCircle,
  IconPhoto,
  IconShoppingBag,
  IconTools,
  IconTruckDelivery,
  IconUserCircle,
  IconX,
} from '@tabler/icons-react';
import type { Tenant, TenantSocialLink } from '@lepefy/types';
import { SOCIAL_PLATFORM_REGISTRY } from '@lepefy/types';
import { TenantLogo } from '@/components/branding/TenantLogo';

const SOCIAL_ICONS = {
  IconBrandInstagram,
  IconBrandFacebook,
  IconBrandTiktok,
  IconBrandYoutube,
  IconBrandLinkedin,
  IconBrandX,
};

const ITEM_ICONS = {
  home: IconHome,
  category: IconCategory,
  event: IconCalendarEvent,
  tools: IconTools,
  card: IconCreditCard,
  map: IconMapPin,
  message: IconMessageCircle,
  orders: IconTruckDelivery,
  account: IconUserCircle,
  gallery: IconPhoto,
  shop: IconShoppingBag,
};

export type BrandNavigationIcon = keyof typeof ITEM_ICONS;

export interface BrandNavigationItem {
  href: string;
  label: string;
  icon: BrandNavigationIcon;
  external?: boolean;
  activeWhen?: string[];
}

export interface BrandNavigationSection {
  id: string;
  label: string;
  items: BrandNavigationItem[];
  intro?: {
    title: string;
    text: string;
  };
}

interface BrandNavigationDrawerProps {
  id: string;
  open: boolean;
  onClose: () => void;
  tenant: Tenant;
  sections: BrandNavigationSection[];
  socialLinks?: TenantSocialLink[];
  eyebrow?: string;
  legalBaseUrl?: string;
  showLegal?: boolean;
  side?: 'left' | 'right' | 'responsive';
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/$/, '')}${path}`;
}

export function BrandNavigationDrawer({
  id,
  open,
  onClose,
  tenant,
  sections,
  socialLinks = [],
  eyebrow,
  legalBaseUrl = '',
  showLegal = true,
  side = 'responsive',
}: BrandNavigationDrawerProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  function isItemActive(item: BrandNavigationItem) {
    if (item.external) return false;
    const rules = item.activeWhen ?? [item.href.split('#')[0] || '/'];
    return rules.some((rule) => {
      if (rule === '/') return pathname === '/';
      return pathname === rule || pathname.startsWith(`${rule}/`);
    });
  }

  const panelEdge = side === 'right'
    ? 'right-0'
    : side === 'left'
      ? 'left-0'
      : 'left-0 md:left-auto md:right-0';
  const panelTransform = open
    ? 'translate-x-0'
    : side === 'right'
      ? 'translate-x-full'
      : side === 'left'
        ? '-translate-x-full'
        : '-translate-x-full md:translate-x-full';

  return (
    <div
      className={`fixed inset-0 z-[110] transition duration-200 ${open ? 'pointer-events-auto bg-black/40 opacity-100' : 'pointer-events-none bg-black/0 opacity-0'}`}
      aria-hidden={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navigation"
        className={`absolute inset-y-0 flex w-[86vw] max-w-[360px] flex-col bg-white text-gray-900 shadow-2xl transition-transform duration-200 ease-out md:w-[380px] md:max-w-[380px] ${panelEdge} ${panelTransform}`}
      >
        <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-4">
          <div className="min-w-0 flex-1">
            <TenantLogo
              variant="compact"
              identity={{ name: tenant.name, logo_url: tenant.logo_url }}
              className="h-11 w-[150px] max-w-[55vw]"
            />
            {eyebrow && <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[var(--color-primary)]">{eyebrow}</p>}
            {tenant.tagline && <p className="mt-1 line-clamp-2 max-w-[30ch] text-xs leading-relaxed text-gray-500">{tenant.tagline}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le menu"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <IconX size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {sections.filter((section) => section.items.length > 0).map((section, index) => (
            <section
              key={section.id}
              aria-labelledby={`${id}-${section.id}-title`}
              className={index > 0 ? 'mt-5 border-t border-gray-100 pt-4' : ''}
            >
              <p id={`${id}-${section.id}-title`} className="px-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-gray-400">
                {section.label}
              </p>

              {section.intro && (
                <div className="mb-2 rounded-2xl bg-gray-50 px-3 py-3">
                  <p className="text-sm font-bold text-gray-900">{section.intro.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{section.intro.text}</p>
                </div>
              )}

              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = ITEM_ICONS[item.icon];
                  const active = isItemActive(item);
                  const classes = `group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                    active ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'text-gray-700 hover:bg-gray-50 hover:text-gray-950'
                  }`;
                  const content = (
                    <>
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-white/80' : 'bg-gray-100 text-gray-600 group-hover:bg-white'}`}>
                        <Icon size={19} />
                      </span>
                      <span className="min-w-0 flex-1">{item.label}</span>
                      <IconChevronRight size={17} className="shrink-0 text-gray-400" />
                    </>
                  );

                  if (item.external) {
                    return (
                      <a key={`${section.id}-${item.label}`} href={item.href} target="_blank" rel="noopener noreferrer" onClick={onClose} className={classes}>
                        {content}
                      </a>
                    );
                  }

                  return (
                    <Link
                      key={`${section.id}-${item.label}`}
                      href={item.href}
                      onClick={onClose}
                      className={classes}
                      aria-current={active ? 'page' : undefined}
                    >
                      {content}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}

          {socialLinks.length > 0 && (
            <section aria-labelledby={`${id}-social-title`} className="mt-5 border-t border-gray-100 pt-4">
              <p id={`${id}-social-title`} className="px-3 pb-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-gray-400">Suivez-nous</p>
              <div className="flex flex-wrap gap-2 px-3" aria-label="Réseaux sociaux">
                {socialLinks.map((link) => {
                  const meta = SOCIAL_PLATFORM_REGISTRY[link.platform];
                  const SocialIcon = SOCIAL_ICONS[meta.iconName];
                  return (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={meta.label}
                      onClick={onClose}
                      className="flex h-10 w-10 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      style={{ background: meta.badgeBackground }}
                    >
                      <SocialIcon size={18} stroke={1.6} className="text-white" />
                    </a>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {showLegal && (
          <div className="border-t border-gray-100 px-4 py-3 text-[11px] text-gray-400" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <a href={joinUrl(legalBaseUrl, '/politique-confidentialite')} onClick={onClose} className="hover:text-gray-600">Confidentialité</a>
              <a href={joinUrl(legalBaseUrl, '/conditions-generales-vente')} onClick={onClose} className="hover:text-gray-600">CGV</a>
            </div>
            {tenant.show_powered_by && (
              <p className="mt-1.5">
                Propulsé par{' '}
                <a
                  href="https://www.lepefy.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                >
                  Lepefy Labs
                </a>
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
