'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  IconBrandInstagram,
  IconBrandFacebook,
  IconBrandTiktok,
  IconBrandYoutube,
  IconBrandLinkedin,
  IconBrandX,
} from '@tabler/icons-react';
import { useTenant } from '@/providers/TenantProvider';
import { SOCIAL_PLATFORM_REGISTRY, type TenantSocialLink } from '@lepefy/types';

const SOCIAL_ICONS = {
  IconBrandInstagram,
  IconBrandFacebook,
  IconBrandTiktok,
  IconBrandYoutube,
  IconBrandLinkedin,
  IconBrandX,
};

interface FooterProps {
  socialLinks?: TenantSocialLink[];
  /** La section "Notre origine" est-elle réellement rendue en home ? Sans
   *  ça, "Notre histoire" pointerait vers un anchor inexistant. */
  storyEnabled?: boolean;
}

/**
 * Footer minimal (copyright + "Powered by") — rendu sur toutes les pages.
 * La version étendue à 4 colonnes (Task C) est réservée à la home : sur
 * mobile un footer de navigation lourd fait doublon avec la bottom nav fixe,
 * ça n'a de sens que comme clôture naturelle du scroll en home.
 */
export function Footer({ socialLinks = [], storyEnabled = false }: FooterProps) {
  const tenant   = useTenant();
  const pathname = usePathname();
  const isHome   = pathname === '/';

  if (!isHome) {
    return (
      <footer className="bg-gray-50 border-t border-gray-200 mt-auto">
        <div
          className="max-w-7xl mx-auto px-4 pt-8 text-center text-sm text-gray-500"
          style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <p>© {new Date().getFullYear()} {tenant.name}. Tous droits réservés.</p>
          {tenant.show_powered_by && <PoweredBy />}
        </div>
      </footer>
    );
  }

  const blurb = tenant.tagline || 'Une sélection de produits choisis avec soin.';
  // Seule entrée "À propos" avec une vraie destination : les autres
  // (Nos producteurs, etc.) n'ont pas de page dédiée dans le repo — omises
  // plutôt que de pointer vers du vide.
  const aboutLinks = storyEnabled ? [{ href: '#origine', label: 'Notre histoire' }] : [];

  return (
    <footer className="bg-gray-50 border-t border-gray-200 mt-auto">
      <div className="max-w-6xl mx-auto px-4 pt-10">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-3">
          {/* Marque */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {tenant.logo_url && (
                <Image src={tenant.logo_url} alt={tenant.name} width={28} height={28} className="rounded-sm object-contain" />
              )}
              <span className="font-display font-bold text-gray-900">{tenant.name}</span>
            </div>
            <p className="text-sm text-gray-500 leading-relaxed max-w-[32ch]">{blurb}</p>
          </div>

          {/* À propos — omise si aucune destination réelle */}
          {aboutLinks.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">À propos</h3>
              <ul className="space-y-2">
                {aboutLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-gray-500 hover:text-gray-700">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Réseaux — uniquement les plateformes réellement configurées */}
          {socialLinks.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">Suivez-nous</h3>
              <div className="flex gap-2.5">
                {socialLinks.map((link) => {
                  const meta = SOCIAL_PLATFORM_REGISTRY[link.platform];
                  const Icon = SOCIAL_ICONS[meta.iconName];
                  return (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={meta.label}
                      className="w-9 h-9 rounded-full flex items-center justify-center"
                      style={{ background: meta.badgeBackground }}
                    >
                      <Icon size={18} stroke={1.5} style={{ color: '#ffffff' }} />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div
          className="mt-8 pt-6 border-t border-gray-200 text-center text-sm text-gray-500"
          style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <p>© {new Date().getFullYear()} {tenant.name}. Tous droits réservés.</p>
          {tenant.show_powered_by && <PoweredBy />}
        </div>
      </div>
    </footer>
  );
}

function PoweredBy() {
  return (
    <p className="mt-3 text-xs text-gray-400">
      Propulsé par{' '}
      <span className="font-medium text-gray-500">Lepefy Labs</span>
    </p>
  );
}
