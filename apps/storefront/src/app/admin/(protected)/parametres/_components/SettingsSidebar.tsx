'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SETTINGS_GROUPS } from './settingsRegistry';
import { ACCENT_TEXT_CLS } from './SettingsUi';

/** Desktop-only internal navigation of the Settings area (mobile uses the hub list). */
export function SettingsSidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections des paramètres" className="sticky top-[81px]">
      <Link href="/admin/parametres" className="mb-4 flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-a-text hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus">
        Paramètres
      </Link>
      <div className="space-y-5">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.key}>
            <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-a-text-3">{group.label}</p>
            <ul className="space-y-0.5">
              {group.sections.map((section) => {
                const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
                const Icon = section.icon;
                return (
                  <li key={section.key}>
                    <Link
                      href={section.href}
                      aria-current={active ? 'page' : undefined}
                      className={`relative flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus ${active
                        ? 'bg-a-hover font-semibold text-a-text before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-a-brand'
                        : 'text-a-text-2 hover:bg-a-surface-2 hover:text-a-text'}`}
                    >
                      <Icon size={17} stroke={1.7} aria-hidden="true" className={ACCENT_TEXT_CLS[section.accent]} />
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
