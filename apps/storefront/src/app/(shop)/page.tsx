import Link from 'next/link';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatPrice } from '@/lib/utils/format';
import { AddToCartButton } from '@/components/home/AddToCartButton';
import { FeaturedProducts } from '@/components/home/FeaturedProducts';

export const metadata: Metadata = {
  title: 'Accueil',
  description: 'Épicerie africaine en ligne — frais, surgelés et épicerie fine. Livraison en Europe.',
};

export type HomeProduct = {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  slug: string;
  weight_grams: number | null;
  stock: number | null;
};

export default async function HomePage() {
  const slug    = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant  = await getTenant(slug);
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
  const featuredProducts: HomeProduct[] = featuredRaw ?? [];

  const featuredIds = featuredProducts.map(p => p.id);
  const excludeIds  = featuredIds.length > 0
    ? featuredIds
    : ['00000000-0000-0000-0000-000000000000'];

  const categoryProducts: Record<string, HomeProduct[]> = {};
  for (const cat of categories) {
    const { data: catRaw } = await supabase
      .from('products')
      .select('id, name, price, image_url, slug, weight_grams, stock')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .eq('category_id', cat.id)
      .not('id', 'in', `(${excludeIds.join(',')})`)
      .order('position', { ascending: true })
      .limit(4);
    if (catRaw && catRaw.length > 0) {
      categoryProducts[cat.id] = catRaw;
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f9f8]">

      {/* ── HERO COMPATTO ── */}
      <section className="bg-gradient-to-br from-[#f0faf6] to-[#eaf4fd] px-4 pt-4 pb-0">
        <div className="flex items-center gap-3">
          {tenant.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenant.logo_url}
              alt={tenant.name}
              className="w-11 h-11 rounded-full object-cover shrink-0
                         border-2 border-white shadow-sm"
            />
          ) : (
            <div
              className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center
                         bg-white border-2 border-white shadow-sm text-lg font-bold"
              style={{ color: 'var(--color-primary)' }}
            >
              {tenant.name.charAt(0)}
            </div>
          )}
          <div>
            <h1 className="text-[15px] font-semibold leading-tight"
                style={{ color: 'var(--color-primary)' }}>
              Les saveurs de chez nous
            </h1>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {tenant.name}
              {tenant.city ? ` · ${tenant.city}` : ''}
            </p>
          </div>
        </div>

        <div className="mt-3 pb-4">
          <FeaturedProducts
            products={featuredProducts}
            currency={tenant.currency}
          />
        </div>
      </section>

      {/* ── SEZIONI PER CATEGORIA ── */}
      {categories.map(cat => {
        const products = categoryProducts[cat.id];
        if (!products || products.length === 0) return null;
        return (
          <section key={cat.id}>
            <div className="flex items-center justify-between px-4 mb-2 mt-5">
              <h2 className="text-[13px] font-bold text-gray-900">{cat.name}</h2>
              <Link
                href={`/products?category=${cat.slug}`}
                className="text-[11px] font-medium"
                style={{ color: 'var(--color-primary)' }}
              >
                Voir tout →
              </Link>
            </div>
            <div className="flex gap-2.5 overflow-x-auto px-4 pb-3
                            [&::-webkit-scrollbar]:hidden
                            [-ms-overflow-style:none]
                            [scrollbar-width:none]">
              {products.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  currency={tenant.currency}
                />
              ))}
            </div>
          </section>
        );
      })}

      <div className="h-6" />
    </div>
  );
}

function ProductCard({
  product,
  currency,
}: {
  product: HomeProduct;
  currency: string;
}) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="relative block flex-shrink-0 w-36 rounded-xl overflow-hidden
                 border border-gray-100 bg-white"
    >
      <div className="aspect-square bg-[#E1F5EE] overflow-hidden">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
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
      <div className="px-2 pt-1 pb-6">
        <p className="text-xs font-medium line-clamp-2 text-gray-900">
          {product.name}
        </p>
        <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--color-primary)' }}>
          {formatPrice(product.price, currency)}
        </p>
      </div>
      <AddToCartButton product={product} />
    </Link>
  );
}
