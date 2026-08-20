'use client';

import { CategoryBlock } from '@/components/home/CategoryBlock';
import type { Category } from '@lepefy/types';

interface CatalogCategoryRowProps {
  categories: Category[];
  activeSlug?: string;
  onSelect: (slug: string | null) => void;
}

export function CatalogCategoryRow({ categories, activeSlug, onSelect }: CatalogCategoryRowProps) {
  return (
    <section aria-labelledby="catalog-univers-heading" className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="catalog-univers-heading" className="font-display text-lg font-bold text-gray-900">Nos univers</h2>
        {activeSlug && (
          <button type="button" onClick={() => onSelect(null)} className="rounded-md px-2 py-1 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={{ color: 'var(--color-primary)', '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}>
            Tout voir
          </button>
        )}
      </div>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-0.5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-4 md:overflow-visible md:snap-none md:pb-0 lg:grid-cols-6" aria-label="Catégories de produits">
        {categories.map((category, index) => (
          <CategoryBlock key={category.id} variant="catalog" index={index} name={category.name} slug={category.slug} count={0} products={[]} imageUrl={category.image_url} primaryColor="var(--color-primary)" secondaryColor="var(--color-secondary)" active={activeSlug === category.slug} onSelect={() => onSelect(category.slug)} />
        ))}
      </div>
    </section>
  );
}
