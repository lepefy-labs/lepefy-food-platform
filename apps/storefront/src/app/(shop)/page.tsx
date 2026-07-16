import Link from 'next/link';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { ProductCard } from '@/components/catalog/ProductCard';
import { ShopTag } from '@/components/ui/ShopTag';

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
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  category: { name: string } | null;
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
    .select('id, name, price, image_url, slug, weight_grams, stock, storage_type, category:categories(name)')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .eq('featured', true)
    .order('position', { ascending: true })
    .limit(8);
  const featuredProducts: HomeProduct[] = (featuredRaw as unknown as HomeProduct[] | null) ?? [];

  // 3. Prodotti per categoria (escludi featured)
  const featuredIds = featuredProducts.map(p => p.id);
  const excludeIds  = featuredIds.length > 0
    ? featuredIds
    : ['00000000-0000-0000-0000-000000000000'];

  const categoryProducts: Record<string, HomeProduct[]> = {};
  for (const cat of categories) {
    const { data: catRaw } = await supabase
      .from('products')
      .select('id, name, price, image_url, slug, weight_grams, stock, storage_type, category:categories(name)')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .eq('category_id', cat.id)
      .not('id', 'in', `(${excludeIds.join(',')})`)
      .order('position', { ascending: true })
      .limit(4);
    if (catRaw && catRaw.length > 0) {
      categoryProducts[cat.id] = catRaw as unknown as HomeProduct[];
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f9f8]">

      {/* ── BANNER EMOZIONALE ── */}
      <HeroBanner
        heroImageUrl={tenant.hero_image_url ?? null}
        tagline={tenant.tagline ?? 'Épicerie africaine'}
        primaryColor={tenant.primary_color}
        previewProducts={featuredProducts}
      />

      {/* Contenuto centrato */}
      <div className="max-w-6xl mx-auto w-full">
      {/* ── PRODUITS VEDETTES ── */}
      {featuredProducts.length > 0 && (
        <section>
          <div className="flex items-center justify-between px-4 mb-2 mt-5">
            <h2 className="font-display text-sm font-bold text-gray-900">
              Nos produits vedettes
            </h2>
            <Link
              href="/products"
              className="text-2xs font-medium"
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
              <h2 className="font-display text-sm font-bold text-gray-900">{cat.name}</h2>
              <Link
                href={`/products?category=${cat.slug}`}
                className="text-2xs font-medium"
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

// ── Pattern décoratif "anneau tribal" — triangles répétés, blanc à faible
//    opacité sur var(--color-primary). Généré en CSS/SVG, aucune image
//    raster. Décision de plateforme (comme le choix de forme du ShopTag),
//    pas une réplique pixel du logo d'un tenant précis. ──
function HeroTrianglePattern({ patternId }: { patternId: string }) {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id={patternId} width="11" height="9.5" patternUnits="userSpaceOnUse">
          <polygon points="5.5,0.5 10.5,9 0.5,9" fill="white" fillOpacity="0.5" />
        </pattern>
      </defs>
      <rect width="100" height="100" fill="var(--hero-primary, var(--color-primary))" />
      <rect width="100" height="100" fill={`url(#${patternId})`} />
    </svg>
  );
}

// ── HeroBanner (Server Component interno, non esportato) ──
function HeroBanner({
  heroImageUrl,
  tagline,
  primaryColor,
  previewProducts,
}: {
  heroImageUrl: string | null;
  tagline: string;
  primaryColor: string;
  previewProducts: HomeProduct[];
}) {
  // `--hero-primary` expose la couleur du tenant reçue en prop aux enfants ;
  // le fallback var(--color-primary) couvre le cas où le composant serait
  // rendu hors du contexte de tenant CSS vars injecté par le layout racine.
  const heroVars = { '--hero-primary': primaryColor } as CSSProperties;
  const preview = previewProducts.slice(0, 3);

  return (
    <div
      className="relative overflow-hidden min-h-[160px] md:min-h-[280px]"
      style={{ backgroundColor: 'var(--color-primary-dark)', ...heroVars }}
    >
      {/* Immagine di sfondo opzionale */}
      {heroImageUrl && (
        <>
          <Image
            src={heroImageUrl}
            alt=""
            aria-hidden="true"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div
            className="absolute inset-0"
            style={{ backgroundColor: 'var(--color-primary-dark)', opacity: 0.72 }}
          />
        </>
      )}

      {/* Pattern décoratif — visible uniquement sans hero_image_url */}
      {!heroImageUrl && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute rounded-full overflow-hidden" style={{ width: 260, height: 260, top: -90, right: -70, opacity: 0.6 }}>
            <HeroTrianglePattern patternId="heroTrianglesLg" />
          </div>
          <div className="absolute rounded-full overflow-hidden" style={{ width: 110, height: 110, bottom: -30, right: 20, opacity: 0.35 }}>
            <HeroTrianglePattern patternId="heroTrianglesSm" />
          </div>
          <div
            className="absolute rounded-full"
            style={{ width: 60, height: 60, top: 8, left: 55, backgroundColor: 'var(--color-secondary)', opacity: 0.14 }}
          />
        </div>
      )}

      {/* Contenu — deux colonnes sur desktop, empilé sur mobile */}
      <div className="relative z-10 px-5 py-6 md:px-10 md:py-10 md:flex md:items-center md:gap-10 md:max-w-6xl md:mx-auto">
        <div className="md:flex-1">
          <ShopTag className="mb-2">{tagline}</ShopTag>
          <h1 className="font-display text-white font-bold leading-tight text-2xl md:text-4xl">
            Les saveurs<br />de chez nous
          </h1>
          <p className="mt-1 text-white/60 leading-snug text-2xs md:text-sm md:mt-3">
            Frais · Surgelés · Épices · Livraison Europe
          </p>
          <Link
            href="/products"
            className="hidden md:inline-flex mt-6 items-center gap-1.5 bg-white rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:scale-105"
            style={{ color: 'var(--color-primary)' }}
          >
            Voir le catalogue →
          </Link>
        </div>

        {/* Mini-preview prodotti reali — solo desktop */}
        {preview.length > 0 && (
          <div className="hidden md:block md:flex-1 relative h-40">
            {preview.map((product, i) => (
              <div
                key={product.id}
                className="absolute top-1/2 w-28 aspect-square rounded-lg overflow-hidden border-4 border-white shadow-card bg-white"
                style={{
                  left: `calc(50% + ${i * 34}px)`,
                  transform: `translate(-50%, -50%) rotate(${(i - 1) * 8}deg)`,
                  zIndex: preview.length - i,
                }}
              >
                {product.image_url ? (
                  <Image src={product.image_url} alt={product.name} fill className="object-cover" sizes="112px" />
                ) : (
                  <div className="w-full h-full bg-primary-light" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
