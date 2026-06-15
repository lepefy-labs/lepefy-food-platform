import Link from 'next/link';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatPrice } from '@/lib/utils/format';
import { AddToCartButton } from '@/components/home/AddToCartButton';

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
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);
  const supabase = createClient();

  // 1. Categorie
  const { data: categoriesRaw } = await supabase
    .from('categories')
    .select('id, name, slug')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true });
  const categories = categoriesRaw ?? [];

  // 2. Prodotti featured
  const { data: featuredRaw } = await supabase
    .from('products')
    .select('id, name, price, image_url, slug, weight_grams, stock')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .eq('featured', true)
    .order('position', { ascending: true })
    .limit(8);
  const featuredProducts: HomeProduct[] = featuredRaw ?? [];

  // 3. Prodotti per categoria (escludi featured)
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

      {/* ── BANNER EMOZIONALE ── */}
      <HeroBanner
        heroImageUrl={tenant.hero_image_url ?? null}
        tagline={tenant.tagline ?? 'Épicerie africaine'}
        primaryColor={tenant.primary_color}
      />

      {/* Contenuto centrato */}
      <div className="max-w-6xl mx-auto w-full">
      {/* ── PRODUITS VEDETTES ── */}
      {featuredProducts.length > 0 && (
        <section>
          <div className="flex items-center justify-between px-4 mb-2 mt-5">
            <h2 className="text-[13px] font-bold text-gray-900">
              Nos produits vedettes
            </h2>
            <Link
              href="/products"
              className="text-[11px] font-medium"
              style={{ color: 'var(--color-primary)' }}
            >
              Voir tout →
            </Link>
          </div>
          <div className="
            flex gap-2.5 overflow-x-auto px-4 pb-3
            [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
            md:grid md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]
            md:overflow-x-visible md:pb-4
          ">
            {featuredProducts.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                currency={tenant.currency}
              />
            ))}
          </div>
        </section>
      )}

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
            <div className="
              flex gap-2.5 overflow-x-auto px-4 pb-3
              [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
              md:grid md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]
              md:overflow-x-visible md:pb-4
            ">
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
      </div>{/* /max-w-6xl */}
    </div>
  );
}

// ── HeroBanner (Server Component interno, non esportato) ──
function HeroBanner({
  heroImageUrl,
  tagline,
  primaryColor: _primaryColor,
}: {
  heroImageUrl: string | null;
  tagline: string;
  primaryColor: string;
}) {
  const darkBg   = '#085041';
  const midBg    = '#0F6E56';
  const accentBg = '#1D9E75';

  return (
    <div
      className="relative overflow-hidden"
      style={{ height: '160px', backgroundColor: darkBg }}
    >
      {/* Immagine di sfondo opzionale */}
      {heroImageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroImageUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(4, 52, 44, 0.72)' }}
          />
        </>
      )}

      {/* Pattern geometrico — visibile solo senza hero_image_url */}
      {!heroImageUrl && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div
            className="absolute rounded-full"
            style={{ width: '220px', height: '220px', top: '-70px', right: '-50px', backgroundColor: midBg, opacity: 0.6 }}
          />
          <div
            className="absolute rounded-full"
            style={{ width: '130px', height: '130px', top: '15px', right: '65px', backgroundColor: accentBg, opacity: 0.35 }}
          />
          <div
            className="absolute rounded-full"
            style={{ width: '90px', height: '90px', bottom: '-25px', right: '18px', backgroundColor: 'var(--color-secondary)', opacity: 0.22 }}
          />
          <div
            className="absolute rounded-full"
            style={{ width: '60px', height: '60px', top: '8px', left: '55px', backgroundColor: 'var(--color-secondary)', opacity: 0.14 }}
          />
        </div>
      )}

      {/* Testo */}
      <div className="absolute inset-0 flex flex-col justify-end px-5 pb-5">
        <div
          className="inline-flex items-center self-start mb-2 px-2 py-0.5 rounded
                     text-[9px] font-semibold tracking-widest uppercase"
          style={{
            backgroundColor: 'rgba(242, 200, 17, 0.18)',
            border: '1px solid rgba(242, 200, 17, 0.38)',
            color: '#F2C811',
          }}
        >
          {tagline}
        </div>
        <h1
          className="text-white font-bold leading-tight"
          style={{ fontSize: '22px' }}
        >
          Les saveurs<br />de chez nous
        </h1>
        <p
          className="mt-1 text-white/60 leading-snug"
          style={{ fontSize: '11px' }}
        >
          Frais · Surgelés · Épices · Livraison Europe
        </p>
      </div>
    </div>
  );
}

// ── ProductCard (Server Component interno, non esportato) ──
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
                 border border-gray-100 bg-white
                 md:w-full md:flex-shrink"
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
