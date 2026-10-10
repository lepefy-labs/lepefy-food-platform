import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface AdminTab {
  href: string;
  label: ReactNode;
  active: boolean;
  /** Small trailing element (count badge). */
  badge?: ReactNode;
}

/**
 * Section tabs that navigate between sub-pages (one URL per tab). Scrolls
 * horizontally on phones instead of wrapping.
 */
export default function AdminTabs({ tabs, label, className }: { tabs: AdminTab[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn('-mx-3 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:px-0', className)}>
      <ul className="flex min-w-max gap-1 border-b border-a-border">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={cn(
                '-mb-px inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm',
                'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-a-focus',
                tab.active ? 'border-a-brand font-semibold text-a-text' : 'border-transparent text-a-text-2 hover:border-a-border-strong hover:text-a-text',
              )}
            >
              {tab.label}{tab.badge}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
