import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/utils/format';
import { AddToCartButton } from '@/components/home/AddToCartButton';

export const metadata: Metadata = {
  title: 'Chloé Food ETS — Boutique africaine à Reggio Emilia',
  description: 'Produits africains frais, surgelés et épicerie fine. Livraison en Europe.',
};

export default async function HomePage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createClient();

  const { data: featuredRaw } = await supabase
    .from('products')
    .select('id, name, price, image_url, slug, category_id, weight_grams, stock')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .eq('featured', true)
    .order('position', { ascending: true })
    .limit(8);

  const featuredList = featuredRaw ?? [];
  let displayProducts = featuredList.slice(0, 4);

  if (displayProducts.length < 4) {
    const needed = 4 - displayProducts.length;
    const usedIds = featuredList.map((p) => p.id);

    const { data: categories } = await supabase
      .from('categories')
      .select('id, name, slug')
      .eq('tenant_id', tenant.id)
      .order('position', { ascending: true });

    const fallback: typeof featuredList = [];

    for (const cat of categories ?? []) {
      if (fallback.length >= needed) break;

      const excludeIds = [...usedIds, ...fallback.map((p) => p.id)];
      const notInList =
        excludeIds.length > 0
          ? excludeIds
          : ['00000000-0000-0000-0000-000000000000'];

      const { data: pick } = await supabase
        .from('products')
        .select('id, name, price, image_url, slug, category_id, weight_grams, stock')
        .eq('tenant_id', tenant.id)
        .eq('active', true)
        .eq('category_id', cat.id)
        .not('id', 'in', `(${notInList.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(1);

      const first = pick?.[0];
      if (first) fallback.push(first);
    }

    displayProducts = [...featuredList, ...fallback].slice(0, 4);
  }

  const { data: categoryData } = await supabase
    .from('categories')
    .select('id, name, slug, image_url')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true });

  const categories = categoryData ?? [];

  return (
    <div className="pb-4">
      {/* Hero */}
      <section className="bg-gradient-to-br from-[#f0faf6] to-[#eaf4fd] px-4 pt-8 pb-6 text-center flex flex-col items-center gap-3">
        {tenant.logo_url ? (
          <Image
            src={tenant.logo_url}
            alt={tenant.name}
            width={80}
            height={80}
            className="rounded-full object-cover shadow-[0_6px_24px_rgba(29,158,117,0.22)]"
          />
        ) : (
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-[0_6px_24px_rgba(29,158,117,0.22)]"
            style={{ background: '#1D9E75' }}
          >
            {tenant.name.charAt(0)}
          </div>
        )}
        <div>
          <h1 className="font-bold text-2xl text-[#1D9E75]">{tenant.name}</h1>
          <p className="italic text-gray-400 text-sm mt-1">Les saveurs de chez nous</p>
          {tenant.city && (
            <p className="text-xs text-gray-300 mt-0.5">
              {tenant.city}
              {tenant.country ? `, ${tenant.country}` : ''}
            </p>
          )}
        </div>
      </section>

      {/* Shipping banner */}
      <div className="mx-4 my-4 rounded-xl bg-[#1D9E75] text-white p-4">
        <p className="font-medium text-sm">🚚 Livraison en Europe</p>
        <p className="text-xs text-white/80 mt-1">
          Frais, surgelés et épicerie fine — directement chez vous
        </p>
      </div>

      {/* Featured products */}
      {displayProducts.length > 0 && (
        <section className="mt-2">
          <h2 className="font-bold text-base mb-3 px-4">Nos produits vedettes</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4">
            {displayProducts.map((product) => (
              <Link
                key={product.id}
                href={`/products/${product.slug}`}
                className="block rounded-xl overflow-hidden border border-gray-200 hover:border-gray-300 transition-all relative group"
              >
                <div className="aspect-square bg-[#E1F5EE] relative overflow-hidden">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-3xl">🛒</span>
                    </div>
                  )}
                </div>
                <div className="p-2 pb-8 relative">
                  <p className="text-xs font-medium line-clamp-2 text-gray-900">
                    {product.name}
                  </p>
                  <p className="text-sm font-bold text-[#1D9E75] mt-1">
                    {formatPrice(product.price, 'EUR')}
                  </p>
                </div>
                <AddToCartButton product={product} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Categories */}
      {categories.length > 0 && (
        <section className="mt-6">
          <h2 className="font-bold text-base mb-3 px-4">Nos catégories</h2>
          <div className="flex gap-2 overflow-x-auto px-4 pb-2 [&::-webkit-scrollbar]:hidden">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/products?category=${cat.slug}`}
                className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium bg-[#E1F5EE] text-[#0F6E56] border border-[#1D9E75]/20"
              >
                {cat.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
