'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Customer list sort, kept in the query string ("last_activity" is the default and omitted). */
export function ClientsSortSelect({ value, options }: { value: string; options: Array<{ key: string; label: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'last_activity') params.delete('sort'); else params.set('sort', next);
    params.delete('direction');
    params.delete('page');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <label className="flex shrink-0 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <span>Tri</span>
      <select value={value} onChange={(event) => change(event.target.value)}
        className="h-10 rounded-xl border border-[var(--admin-border)] bg-white px-2.5 text-xs font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100">
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
    </label>
  );
}
