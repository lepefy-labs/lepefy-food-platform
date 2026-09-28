import type { ReactNode } from 'react';
import Link from 'next/link';
import { IconChevronLeft } from '@tabler/icons-react';
import { getSettingsSection, type SettingsSectionKey } from './settingsRegistry';
import { SettingsSidebar } from './SettingsSidebar';
import { SettingsIconTile } from './SettingsUi';

interface SettingsPageShellProps {
  sectionKey: SettingsSectionKey;
  description?: string;
  children: ReactNode;
}

/**
 * Layout of every settings detail page: breadcrumb + desktop sub-navigation
 * (lg+) and a dedicated "back to Paramètres" flow below lg.
 */
export function SettingsPageShell({ sectionKey, description, children }: SettingsPageShellProps) {
  const { section, group } = getSettingsSection(sectionKey);
  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <div className="lg:grid lg:grid-cols-[208px_minmax(0,1fr)] lg:gap-8">
        <aside className="hidden lg:block">
          <SettingsSidebar />
        </aside>

        <div className="min-w-0">
          <Link href="/admin/parametres" className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-gray-600 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] dark:text-gray-300 dark:hover:text-white lg:hidden">
            <IconChevronLeft size={18} aria-hidden="true" />Paramètres
          </Link>

          <nav aria-label="Fil d’Ariane" className="mb-2 hidden lg:block">
            <ol className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
              <li><Link href="/admin/parametres" className="rounded hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] dark:hover:text-gray-100">Paramètres</Link></li>
              <li aria-hidden="true">/</li>
              <li>{group.label}</li>
            </ol>
          </nav>

          <header className="mb-6 flex items-start gap-4">
            <SettingsIconTile icon={section.icon} accent={section.accent} size="lg" />
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-gray-950 dark:text-gray-100 sm:text-2xl">{section.title}</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500 dark:text-gray-400">{description ?? section.description}</p>
            </div>
          </header>

          <div className="space-y-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
