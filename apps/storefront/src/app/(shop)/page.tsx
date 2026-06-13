import type { Metadata } from 'next';
import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/utils/format';
import { AddToCartButton } from '@/components/home/AddToCartButton';

export const metadata: Metadata = {
  title: 'Chloé Food ETS — Boutique africaine à Reggio Emilia',
  description: 'Produits africains frais, surgelés et épicerie fine. Livraison en Europe.',
};

type Product = {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  slug: string;
  weight_grams: number | null;
  stock: number | null;
};

function ProductCard({ product, currency }: { product: Product; currency: string }) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="relative block flex-shrink-0 w-36 md:w-auto md:flex-shrink rounded-xl overflow-hidden border border-gray-100 bg-white"
    >
      <div className="aspect-square bg-[#E1F5EE] overflow-hidden">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-3xl">🛒</span>
          </div>
        )}
      </div>
      <div className="px-2 pt-1 pb-6">
        <p className="text-xs font-medium line-clamp-2 text-gray-900">{product.name}</p>
        <p className="text-sm font-bold text-[#1D9E75] mt-0.5">
          {formatPrice(product.price, currency)}
        </p>
      </div>
      <AddToCartButton product={product} />
    </Link>
  );
}

export default async function HomePage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createClient();

  const { data: categoriesRaw } = await supabase
    .from('categories')
    .select('id, name, slug')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true });

  const categories = categoriesRaw ?? [];

  const { data: featuredRaw } = await supabase
    .from('products')
    .select('id, name, price, image_url, slug, weight_grams, stock')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .eq('featured', true)
    .order('position', { ascending: true })
    .limit(8);

  const featuredProducts: Product[] = featuredRaw ?? [];

  const featuredIds = featuredProducts.map((p) => p.id);
  const excludeIds =
    featuredIds.length > 0 ? featuredIds : ['00000000-0000-0000-0000-000000000000'];

  const categoryProducts: Record<string, Product[]> = {};

  for (const cat of categories) {
    const { data: catProducts } = await supabase
      .from('products')
      .select('id, name, price, image_url, slug, weight_grams, stock')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .eq('category_id', cat.id)
      .not('id', 'in', `(${excludeIds.join(',')})`)
      .order('position', { ascending: true })
      .limit(4);

    if (catProducts && catProducts.length > 0) {
      categoryProducts[cat.id] = catProducts;
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f9f8]">
      {/* Hero */}
      <section className="bg-gradient-to-br from-[#f0faf6] to-[#eaf4fd] px-4 pt-8 pb-6 text-center">
        {tenant.logo_url && (
          <img
            src={tenant.logo_url}
            alt={tenant.name}
            className="w-20 h-20 rounded-full object-cover mx-auto mb-3 shadow-[0_6px_24px_rgba(29,158,117,0.22)]"
          />
        )}
        <h1 className="text-2xl font-bold text-[#1D9E75]">{tenant.name}</h1>
        <p className="text-sm text-gray-400 italic mt-1">Les saveurs de chez nous</p>
        {tenant.city && (
          <p className="text-xs text-gray-300 mt-1">
            {tenant.city}
            {tenant.country ? `, ${tenant.country}` : ''}
          </p>
        )}
      </section>

      {/* Banner spedizione */}
      <div className="mx-4 mt-4 rounded-xl bg-[#1D9E75] text-white p-4">
        <p className="font-medium text-sm">🚚 Livraison en Europe</p>
        <p className="text-xs text-white/80 mt-1">
          Frais, surgelés et épicerie fine — directement chez vous
        </p>
      </div>

      {/* Produits vedettes */}
      {featuredProducts.length > 0 && (
        <section>
          <div className="flex items-center justify-between px-4 mb-2 mt-6">
            <h2 className="text-base font-bold text-gray-900">Nos produits vedettes</h2>
            <Link href="/products" className="text-sm font-medium text-[#1D9E75]">
              Voir tout →
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto px-4 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {featuredProducts.map((product) => (
              <ProductCard key={product.id} product={product} currency={tenant.currency} />
            ))}
          </div>
        </section>
      )}

      {/* Sezione per categoria */}
      {categories.map((cat) => {
        const products = categoryProducts[cat.id];
        if (!products || products.length === 0) return null;
        return (
          <section key={cat.id}>
            <div className="flex items-center justify-between px-4 mb-2 mt-6">
              <h2 className="text-base font-bold text-gray-900">{cat.name}</h2>
              <Link
                href={`/products?category=${cat.slug}`}
                className="text-sm font-medium text-[#1D9E75]"
              >
                Voir tout →
              </Link>
            </div>
            <div className="flex gap-3 overflow-x-auto px-4 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] md:grid md:grid-cols-4 md:overflow-x-visible">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} currency={tenant.currency} />
              ))}
            </div>
          </section>
        );
      })}

      <div className="h-6" />
    </div>
  );
}
