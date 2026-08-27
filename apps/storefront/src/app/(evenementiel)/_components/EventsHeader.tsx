import Link from 'next/link';
import { IconCalendarEvent, IconMenu2 } from '@tabler/icons-react';
import type { Tenant } from '@lepefy/types';
import { TenantLogo } from '@/components/branding/TenantLogo';

export function EventsHeader({ tenant }: { tenant: Tenant }) {
  return (
    <header className="fixed inset-x-0 top-0 z-[100] border-b border-white/10 bg-[var(--color-primary-dark)] text-white shadow-sm">
      <div className="mx-auto flex h-20 max-w-[1180px] items-center justify-between gap-1.5 px-3 sm:gap-4 sm:px-6">
        <Link
          href="/evenementiel"
          className="flex min-h-11 min-w-0 shrink items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-secondary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-primary-dark)]"
          aria-label={`${tenant.name} — accueil événementiel`}
        >
          <TenantLogo
            variant="header"
            identity={{ name: tenant.name, logo_url: tenant.logo_url }}
            priority
            className="max-w-[150px] sm:max-w-[220px]"
            fallbackClassName="truncate font-display text-base font-semibold leading-tight text-white sm:text-lg"
          />
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Navigation événementielle">
          {[
            ['Événements', '/evenementiel#evenements'],
            ['Traiteur', '/evenementiel#traiteur'],
            ['Location', '/evenementiel#location'],
            ['Contact', '/evenementiel#contact'],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-secondary)]"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <a
            href="/evenementiel#evenements"
            className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12px] font-bold shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:gap-2 sm:px-4 sm:text-sm"
            style={{ backgroundColor: 'var(--color-secondary)', color: 'var(--color-primary-dark)' }}
          >
            Voir les dates <IconCalendarEvent size={16} className="shrink-0 sm:size-[17px]" />
          </a>

          <details className="group relative lg:hidden">
            <summary
              className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg border border-white/20 text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-secondary)] [&::-webkit-details-marker]:hidden"
              aria-label="Ouvrir la navigation"
            >
              <IconMenu2 size={22} />
            </summary>
            <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl border border-black/5 bg-white p-2 text-gray-900 shadow-xl">
              {[
                ['Événements', '/evenementiel#evenements'],
                ['Traiteur', '/evenementiel#traiteur'],
                ['Location de matériel', '/evenementiel#location'],
                ['Contact', '/evenementiel#contact'],
              ].map(([label, href]) => (
                <a key={label} href={href} className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold hover:bg-[#f6f2ea]">
                  {label}
                </a>
              ))}
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
