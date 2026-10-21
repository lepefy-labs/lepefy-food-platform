import Link from 'next/link';
import { formatNumber } from '@/lib/admin/format';
import { cn } from '@/lib/utils/cn';
import FacetsToggle from '../../_components/data/FacetsToggle';

export const CATALOGUE_FACETS_ID = 'catalogue-facets';

export interface FacetLink { key: string; label: string; href: string; active: boolean; count?: number | null; warn?: boolean; hint?: string }

function FacetSection({ id, title, links }: { id: string; title: string; links: FacetLink[] }) {
  return (
    <nav aria-labelledby={id}>
      <p id={id} className="px-2.5 pb-1 text-xs font-semibold text-a-text-3">{title}</p>
      <ul className="space-y-0.5">
        {links.map((link) => (
          <li key={link.key}>
            <Link href={link.href} scroll={false} aria-current={link.active ? 'true' : undefined}
              className={cn('flex min-h-8 items-center gap-2 rounded-lg px-2.5 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-a-focus',
                link.active ? 'bg-a-selected font-semibold text-a-brand-fg' : 'text-a-text-2 hover:bg-a-hover hover:text-a-text')}>
              <span className="min-w-0 flex-1 truncate">
                {link.label}
                {link.hint && <span className="sr-only"> ({link.hint})</span>}
              </span>
              {link.hint && <span aria-hidden="true" className="shrink-0 rounded bg-a-surface-2 px-1 text-[0.6875rem] text-a-text-3">{link.hint}</span>}
              {link.count != null && (
                <span className={cn('shrink-0 text-xs tabular-nums', link.warn && link.count > 0 ? 'font-semibold text-tone-warning-fg' : 'text-a-text-3')}>{formatNumber(link.count)}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Side column of the catalogue: quick views, highlights and categories as links
 * that keep the other filters. Shown only when the page has room for it (container
 * query, SHELL_CSS) and the viewer has not hidden it; otherwise the same filters
 * live in the FilterBar (views strip + « Filtres » panel).
 */
export default function CatalogueFacets({ views, highlights, categories }: { views: FacetLink[]; highlights: FacetLink[]; categories: FacetLink[] }) {
  return (
    <aside id={CATALOGUE_FACETS_ID} aria-label="Filtres du catalogue" className="admin-facets sticky top-4 max-h-[calc(100vh-2rem)] space-y-4 overflow-y-auto pb-4">
      <div className="-mb-3 flex justify-end">
        <FacetsToggle mode="hide" controls={CATALOGUE_FACETS_ID} />
      </div>
      <FacetSection id="catalogue-facet-views" title="Vues" links={views} />
      <FacetSection id="catalogue-facet-highlights" title="Mise en avant" links={highlights} />
      <FacetSection id="catalogue-facet-categories" title="Catégories" links={categories} />
    </aside>
  );
}
