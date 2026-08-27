'use client';
import Link from 'next/link';
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
import { TenantLogo } from '@/components/branding/TenantLogo';

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
  storyEnabled?: boolean;
}

export function Footer({ socialLinks = [], storyEnabled = false }: FooterProps) {
  const tenant = useTenant();
  const pathname = usePathname();
  const isHome = pathname === '/';

  if (!isHome) {
    return (
      <footer className="bg-gray-50 border-t border-gray-200 mt-auto">
        <div
          className="max-w-7xl mx-auto px-4 pt-8 text-center text-sm text-gray-500"
          style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <p>© {new Date().getFullYear()} {tenant.name}. Tous droits réservés.</p>
          <p className="mt-2 space-x-3">
            <Link href="/politique-confidentialite" className="text-gray-400 hover:text-gray-600 underline">
              Politique de confidentialité
            </Link>
            <Link href="/conditions-generales-vente" className="text-gray-400 hover:text-gray-600 underline">
              Conditions générales de vente
            </Link>
          </p>
          {tenant.show_powered_by && <PoweredBy />}
        </div>
      </footer>
    );
  }

  const blurb = tenant.tagline || 'Une sélection de produits choisis avec soin.';
  const aboutLinks = storyEnabled ? [{ href: '#origine', label: 'Notre histoire' }] : [];

  return (
    <footer className="bg-gray-50 border-t border-gray-200 mt-auto">
      <div className="max-w-6xl mx-auto px-4 pt-10">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-3">
          <div>
            <div className="mb-3">
              <TenantLogo variant="compact" className="h-12 w-[140px] max-w-[52vw]" />
            </div>
            <p className="text-sm text-gray-500 leading-relaxed max-w-[32ch]">{blurb}</p>
          </div>

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
          <p className="mt-2 space-x-3">
            <Link href="/politique-confidentialite" className="text-gray-400 hover:text-gray-600 underline">
              Politique de confidentialité
            </Link>
            <Link href="/conditions-generales-vente" className="text-gray-400 hover:text-gray-600 underline">
              Conditions générales de vente
            </Link>
          </p>
          {tenant.show_powered_by && <PoweredBy />}
        </div>
      </div>
    </footer>
  );
}

function PoweredBy() {
  return (
    <p className="mt-3 text-xs text-gray-400">
      Propulsé par <span className="font-medium text-gray-500">Lepefy Labs</span>
    </p>
  );
}
