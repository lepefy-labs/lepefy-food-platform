import Link from 'next/link';
import { IconCategory, IconEye, IconTag, type Icon } from '@tabler/icons-react';
import { formatNumber } from '@/lib/admin/format';
import { cn } from '@/lib/utils/cn';
import FacetsToggle from '../../_components/data/FacetsToggle';

export const CATALOGUE_FACETS_ID = 'catalogue-facets';

export interface FacetLink {
  key: string; label: string; href: string; active: boolean; count?: number | null; warn?: boolean; hint?: string;
  /** The section's « no filter » entry (Tous / Toutes): selected quietly, and the target of « Effacer ». */
  isDefault?: boolean;
}

function FacetSection({ id, title, icon: SectionIcon, links }: { id: string; title: string; icon: Icon; links: FacetLink[] }) {
  // A section « is open » only when a real filter is applied: that entry gets the solid brand pill,
  // the section a tinted background and an « Effacer » link; the default entry stays quiet.
  const applied = links.find((link) => link.active && !link.isDefault);
  const reset = links.find((link) => link.isDefault);
  return (
    <nav aria-labelledby={id} className={cn('border-t border-a-border px-2 pb-2 pt-3', applied && 'bg-a-brand-soft shadow-[inset_3px_0_0_0_var(--admin-primary)]')}>
      {/* Section title: uppercase, brand colour and icon, so it never reads as one more filter. */}
      <div className="mb-1.5 flex items-center gap-1.5 px-1.5">
        <p id={id} className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-wider text-a-brand-fg">
          <SectionIcon size={14} stroke={2} aria-hidden="true" className="shrink-0" />{title}
          {applied && <span className="sr-only"> : {applied.label}</span>}
        </p>
        {applied && reset && (
          <Link href={reset.href} scroll={false} className="shrink-0 rounded text-xs font-semibold text-a-brand-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
            Effacer<span className="sr-only"> le filtre {title}</span>
          </Link>
        )}
      </div>
      <ul className="space-y-0.5">
        {links.map((link) => {
          const strong = link.active && !link.isDefault;
          return (
            <li key={link.key}>
              <Link href={link.href} scroll={false} aria-current={link.active ? 'true' : undefined}
                className={cn('flex min-h-8 items-center gap-2 rounded-lg px-2.5 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-a-focus',
                  strong ? 'bg-a-brand font-semibold text-a-on-brand shadow-sm'
                    : link.active ? 'font-semibold text-a-text hover:bg-a-hover'
                      : 'text-a-text-2 hover:bg-a-hover hover:text-a-text')}>
                <span className="min-w-0 flex-1 truncate">
                  {link.label}
                  {link.hint && <span className="sr-only"> ({link.hint})</span>}
                </span>
                {link.hint && <span aria-hidden="true" className={cn('shrink-0 rounded px-1 text-[0.6875rem]', strong ? 'bg-white/20' : 'bg-a-surface-2 text-a-text-3')}>{link.hint}</span>}
                {link.count != null && (
                  <span className={cn('shrink-0 text-xs tabular-nums', strong ? 'font-semibold' : link.warn && link.count > 0 ? 'font-semibold text-tone-warning-fg' : 'text-a-text-3')}>{formatNumber(link.count)}</span>
                )}
              </Link>
            </li>
          );
        })}
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
    <aside id={CATALOGUE_FACETS_ID} aria-label="Filtres du catalogue" className="admin-facets sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[10px] border border-a-border bg-a-surface">
      <div className="flex min-h-11 items-center justify-between gap-2 pl-3.5 pr-1.5">
        <p className="text-sm font-semibold text-a-text">Filtres</p>
        <FacetsToggle mode="hide" controls={CATALOGUE_FACETS_ID} />
      </div>
      <FacetSection id="catalogue-facet-views" title="Vues" icon={IconEye} links={views} />
      <FacetSection id="catalogue-facet-highlights" title="Mise en avant" icon={IconTag} links={highlights} />
      <FacetSection id="catalogue-facet-categories" title="Catégories" icon={IconCategory} links={categories} />
    </aside>
  );
}
