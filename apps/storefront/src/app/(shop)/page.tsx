import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { ProductCard } from '@/components/catalog/ProductCard';

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
              <ProductCard key={product.id} product={product} variant="shelf" />
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
                <ProductCard key={product.id} product={product} variant="shelf" />
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
  primaryColor,
}: {
  heroImageUrl: string | null;
  tagline: string;
  primaryColor: string;
}) {
  // `--hero-primary` expose la couleur du tenant reçue en prop aux enfants ;
  // le fallback var(--color-primary) couvre le cas où le composant serait
  // rendu hors du contexte de tenant CSS vars injecté par le layout racine.
  const heroVars = { '--hero-primary': primaryColor } as CSSProperties;

  return (
    <div
      className="relative overflow-hidden"
      style={{ height: '160px', backgroundColor: 'var(--color-primary-dark)', ...heroVars }}
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
            style={{ backgroundColor: 'var(--color-primary-dark)', opacity: 0.72 }}
          />
        </>
      )}

      {/* Pattern geometrico — visibile solo senza hero_image_url */}
      {!heroImageUrl && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div
            className="absolute rounded-full"
            style={{ width: '220px', height: '220px', top: '-70px', right: '-50px', backgroundColor: 'var(--hero-primary, var(--color-primary))', opacity: 0.6 }}
          />
          <div
            className="absolute rounded-full"
            style={{ width: '130px', height: '130px', top: '15px', right: '65px', backgroundColor: 'var(--hero-primary, var(--color-primary))', opacity: 0.35 }}
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
