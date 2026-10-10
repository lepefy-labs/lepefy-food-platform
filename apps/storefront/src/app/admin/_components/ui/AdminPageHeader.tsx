import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface BreadcrumbItem { label: string; href?: string }

interface AdminPageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Short inline fact next to the title (« 9 actives »). */
  meta?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: BreadcrumbItem[];
  /** Section tabs rendered under the title (AdminTabs). */
  tabs?: ReactNode;
  compact?: boolean;
}

/** The only admin page title block: breadcrumb, title (display face), meta, actions, tabs. */
export default function AdminPageHeader({ title, description, meta, actions, breadcrumb, tabs, compact = false }: AdminPageHeaderProps) {
  return (
    <header className={cn(compact ? 'mb-3' : 'mb-4 sm:mb-5')}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Fil d’Ariane" className="mb-1 text-xs text-a-text-3">
          <ol className="flex flex-wrap items-center gap-1">
            {breadcrumb.map((item, index) => (
              <li key={`${item.label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <span aria-hidden="true">/</span>}
                {item.href ? <Link href={item.href} className="hover:text-a-text hover:underline">{item.label}</Link> : <span>{item.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-display text-xl font-semibold leading-tight tracking-tight text-a-text sm:text-2xl">{title}</h1>
            {meta && <div className="text-sm text-a-text-2">{meta}</div>}
          </div>
          {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-a-text-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-3">{tabs}</div>}
    </header>
  );
}
