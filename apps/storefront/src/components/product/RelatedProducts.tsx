import { ProductCard, type ProductCardProduct } from '@/components/catalog/ProductCard';

/**
 * Sezione "Produits similaires" sotto la scheda prodotto. Riceve i prodotti
 * già selezionati/ordinati dal Server Component chiamante (page.tsx) —
 * questo componente resta puramente presentazionale, coerente con ProductCard.
 */
export function RelatedProducts({ products }: { products: ProductCardProduct[] }) {
  if (products.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="font-display text-lg font-bold text-gray-900 mb-4">Vous aimerez aussi</h2>
      <div className="
        flex gap-3 overflow-x-auto pb-3
        [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
        md:grid md:grid-cols-4 md:overflow-x-visible md:pb-0
      ">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} variant="shelf" />
        ))}
      </div>
    </section>
  );
}
