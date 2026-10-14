import { IconSparkles } from '@tabler/icons-react';
import { hasNoveltyBadge, type NoveltyFields } from '@/lib/catalog/novelties';

/**
 * Badge « Nouveau » d'un produit choisi comme nouveauté (migration 156) :
 * mot toujours écrit, jamais la couleur seule. Rien sans `new_until`
 * (vidée par le tick à échéance).
 */
export function NoveltyBadge({ product, className = '', size = 'md' }: {
  product: NoveltyFields;
  className?: string;
  size?: 'sm' | 'md';
}) {
  if (!hasNoveltyBadge(product)) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md bg-violet-700 font-bold leading-tight text-white shadow-sm ${size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-xs sm:text-sm'} ${className}`}>
      <IconSparkles size={size === 'sm' ? 12 : 14} aria-hidden="true" className="shrink-0" />
      Nouveau
    </span>
  );
}
