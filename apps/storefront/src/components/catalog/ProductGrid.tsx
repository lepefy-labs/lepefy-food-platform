import type { ProductWithCategory } from '@lepefy/types';
import { ProductCard } from './ProductCard';

export function ProductGrid({ products }: { products: ProductWithCategory[] }) {
  if (products.length === 0) {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="text-6xl mb-4">🔍</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Aucun produit disponible</h2>
        <p className="text-gray-500 text-sm">Essayez une autre catégorie ou modifiez votre recherche.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {products.map((product) => <ProductCard key={product.id} product={product} />)}
    </div>
  );
}
