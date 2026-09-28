'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SETTINGS_GROUPS } from './settingsRegistry';

/** Desktop-only internal navigation of the Settings area (mobile uses the hub list). */
export function SettingsSidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections des paramètres" className="sticky top-[81px]">
      <Link href="/admin/parametres" className="mb-4 flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-gray-950 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] dark:text-gray-100 dark:hover:bg-white/5">
        Paramètres
      </Link>
      <div className="space-y-5">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.key}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">{group.label}</p>
            <ul className="space-y-0.5">
              {group.sections.map((section) => {
                const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
                const Icon = section.icon;
                return (
                  <li key={section.key}>
                    <Link
                      href={section.href}
                      aria-current={active ? 'page' : undefined}
                      className={`relative flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] ${active
                        ? 'bg-gray-100 font-semibold text-gray-950 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--admin-primary)] dark:bg-white/10 dark:text-white'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white'}`}
                    >
                      <Icon size={17} stroke={1.7} aria-hidden="true" className={active ? 'text-[var(--admin-primary-fg)] dark:text-violet-300' : 'text-gray-400'} />
                      {section.navLabel}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
