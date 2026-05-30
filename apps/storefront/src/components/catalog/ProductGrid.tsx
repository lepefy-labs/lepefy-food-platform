import type { ProductWithCategory } from '@lepefy/types';
import { ProductCard } from './ProductCard';

export function ProductGrid({ products }: { products: ProductWithCategory[] }) {
  if (products.length === 0) {
    return <div className="text-center py-16 text-gray-500"><p className="text-lg">Aucun produit disponible.</p></div>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {products.map((product) => <ProductCard key={product.id} product={product} />)}
    </div>
  );
}
