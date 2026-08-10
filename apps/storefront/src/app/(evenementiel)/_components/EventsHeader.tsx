import Link from 'next/link';
import Image from 'next/image';
import type { Tenant } from '@lepefy/types';

// Header dédié à la vetrina Événementiel — PAS le Header boutique
// (components/layout/Header.tsx, Catalogue/Panier/Compte), volontairement
// absent de ce groupe de routes (voir (evenementiel)/layout.tsx). Barre
// fixe blanche ~76px, logo tenant lu dynamiquement (jamais un asset
// statique), nav simple + CTA — même structure que le header du mockup
// validé (Maquette_Evenementiel_ChloeFood.html, .site-header).
export function EventsHeader({ tenant }: { tenant: Tenant }) {
  return (
    <header className="fixed top-0 left-0 right-0 z-[100] h-[76px] bg-white/[.97] backdrop-blur-sm shadow-[0_1px_3px_rgba(17,24,39,0.08)]">
      <div className="max-w-[1120px] h-full mx-auto px-6 flex items-center justify-between">
        <Link href="/evenementiel" className="flex items-center shrink-0">
          {tenant.logo_url ? (
            <Image
              src={tenant.logo_url}
              alt={tenant.name}
              width={160}
              height={56}
              className="h-10 sm:h-14 w-auto object-contain"
              priority
            />
          ) : (
            <span className="font-display text-lg font-bold text-gray-900">{tenant.name}</span>
          )}
        </Link>

        <nav className="flex items-center gap-4 sm:gap-7">
          <a href="/evenementiel#evenements" className="hidden sm:inline text-sm font-semibold text-gray-900 hover:text-[var(--color-primary)] transition-colors">
            Événements
          </a>
          <a href="/evenementiel#services" className="hidden sm:inline text-sm font-semibold text-gray-900 hover:text-[var(--color-primary)] transition-colors">
            Services
          </a>
          <a href="/evenementiel#galerie" className="hidden sm:inline text-sm font-semibold text-gray-900 hover:text-[var(--color-primary)] transition-colors">
            Galerie
          </a>
          <a
            href="/evenementiel#evenements"
            className="text-sm font-semibold px-5 py-2.5 rounded-[10px] transition-transform hover:-translate-y-0.5"
            style={{ backgroundColor: 'var(--color-secondary)', color: 'var(--color-primary-dark)' }}
          >
            Calendrier événement
          </a>
        </nav>
      </div>
    </header>
  );
}
