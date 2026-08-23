import type { ReactNode } from 'react';

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}

export default function AdminPageHeader({
  title,
  description,
  meta,
  actions,
  compact = false,
}: AdminPageHeaderProps) {
  return (
    <header className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${compact ? 'mb-4' : 'mb-6'}`}>
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-1 h-7 w-1 shrink-0 rounded-full bg-[var(--admin-primary)] shadow-[0_0_0_4px_var(--admin-primary-soft)]"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight text-gray-950 dark:text-gray-100 sm:text-2xl">
                {title}
              </h1>
              {meta && <div className="text-sm text-gray-400 dark:text-gray-500">{meta}</div>}
            </div>
            {description && (
              <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500 dark:text-gray-400">
                {description}
              </p>
            )}
          </div>
        </div>
      </div>

      {actions && <div className="shrink-0 sm:pl-4">{actions}</div>}
    </header>
  );
}
