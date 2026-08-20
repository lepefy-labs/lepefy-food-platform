import type { ProductWithCategory } from '@lepefy/types';
import { ProductCard } from './ProductCard';

/** Placeholder animé — même gabarit (image + 2 lignes) et mêmes tokens
 *  radius que la ProductCard réelle, pour que le passage skeleton → contenu
 *  ne "saute" pas visuellement. */
function ProductCardSkeleton() {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 animate-pulse">
      <div className="aspect-square bg-gray-100" />
      <div className="p-3 space-y-2">
        <div className="h-3.5 bg-gray-100 rounded-sm w-full" />
        <div className="h-3.5 bg-gray-100 rounded-sm w-2/3" />
      </div>
    </div>
  );
}

interface ProductGridProps {
  products: ProductWithCategory[];
  /** Affiche des skeletons à la place des produits (chargement en cours). */
  loading?: boolean;
}

export function ProductGrid({ products, loading = false }: ProductGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
      </div>
    );
  }
  if (products.length === 0) {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center px-4 py-16 text-center">
        <svg className="mb-4 h-10 w-10 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Aucun produit trouvé</h2>
        <p className="text-gray-500 text-sm">Effacez la recherche ou choisissez un autre univers.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {products.map((product) => <ProductCard key={product.id} product={product} />)}
    </div>
  );
}
