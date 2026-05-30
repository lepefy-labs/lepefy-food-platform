'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Category } from '@lepefy/types';
import { cn } from '@/lib/utils/cn';

interface CategoryFilterProps { categories: Category[]; activeSlug?: string; }

export function CategoryFilter({ categories, activeSlug }: CategoryFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleSelect(slug: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (slug) params.set('category', slug); else params.delete('category');
    router.push(`/products?${params.toString()}`);
  }

  return (
    <div className="flex gap-2 flex-wrap mb-6">
      <button onClick={() => handleSelect(null)}
        className={cn('px-4 py-2 rounded-full text-sm font-medium border transition-colors', !activeSlug ? 'border-transparent text-white' : 'border-gray-300 text-gray-700 hover:border-gray-400')}
        style={!activeSlug ? { backgroundColor: 'var(--color-primary)' } : undefined}>
        Tout
      </button>
      {categories.map((cat) => (
        <button key={cat.id} onClick={() => handleSelect(cat.slug)}
          className={cn('px-4 py-2 rounded-full text-sm font-medium border transition-colors', activeSlug === cat.slug ? 'border-transparent text-white' : 'border-gray-300 text-gray-700 hover:border-gray-400')}
          style={activeSlug === cat.slug ? { backgroundColor: 'var(--color-primary)' } : undefined}>
          {cat.name}
        </button>
      ))}
    </div>
  );
}
