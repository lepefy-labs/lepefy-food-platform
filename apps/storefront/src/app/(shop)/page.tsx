import Link from 'next/link';
import Image from 'next/image';
import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatPrice } from '@/lib/utils/format';
import { ProductCard } from '@/components/catalog/ProductCard';
import { ShopTag } from '@/components/ui/ShopTag';
import { StorySection } from '@/components/home/StorySection';

export const metadata: Metadata = {
  title: 'Accueil',
  description: 'Épicerie africaine en ligne — frais, surgelés et épicerie fine. Livraison en Europe.',
};

// ISR : tenant, catégories et produits vedettes ne sont jamais personnalisés
// (le panier reste 100% client, Zustand/localStorage — rien à isoler ici).
export const revalidate = 300;

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
  const supabase = createPublicClient();

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

  // 2bis. Compte réel de produits actifs — alimente la statistique "Notre
  // origine" (Task B) : jamais un nombre codé en dur, toujours la vraie
  // cardinalité au moment du rendu.
  const { count: activeProductsCount } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('active', true);

  const storyEnabled = Boolean(tenant.story_heading && tenant.story_text);

  // 3. Prodotti per categoria (escludi featured)
  const featuredIds = featuredProducts.map(p => p.id);
  const excludeIds  = featuredIds.length > 0
    ? featuredIds
    : ['00000000-0000-0000-0000-000000000000'];

  const categoryProducts: Record<string, HomeProduct[]> = Object.fromEntries(
    await Promise.all(
      categories.map(async (cat) => {
        const { data: catRaw } = await supabase
          .from('products')
          .select('id, name, price, image_url, slug, weight_grams, stock, storage_type, category:categories(name)')
          .eq('tenant_id', tenant.id)
          .eq('active', true)
          .eq('category_id', cat.id)
          .not('id', 'in', `(${excludeIds.join(',')})`)
          .order('position', { ascending: true })
          .limit(4);
        return [cat.id, (catRaw as unknown as HomeProduct[] | null) ?? []] as const;
      }),
    ),
  );

  return (
    <div className="min-h-screen bg-[#f7f9f8]">

      {/* ── BANNER EMOZIONALE ── */}
      <HeroBanner
        heroImageUrl={tenant.hero_image_url ?? null}
        tagline={tenant.tagline ?? 'Épicerie africaine'}
        primaryColor={tenant.primary_color}
        previewProducts={featuredProducts}
        currency={tenant.currency}
        storyEnabled={storyEnabled}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 px-4 pb-3">
            {featuredProducts.map(product => (
              <ProductCard key={product.id} product={product} variant="grid" />
            ))}
          </div>
        </section>
      )}

      {/* ── NOTRE ORIGINE ── */}
      <StorySection
        heading={tenant.story_heading}
        text={tenant.story_text}
        imageUrl={tenant.story_image_url}
        productsCount={activeProductsCount ?? 0}
        countriesServed={tenant.countries_served}
      />

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

// Emoji plutôt qu'icônes SVG monochromes pour les deux premiers badges —
// décision de plateforme inversée (voir LEPEFY_PROJECT_CONTEXT.md §12).
// "Sélection artisanale" garde son SVG en forme de blason : c'est un élément
// de branding graphique fidèle au mockup, pas une icône fonctionnelle 1:1.
const TRUST_ROW: { icon: ReactNode; label: string }[] = [
  {
    label: 'Livraison Europe',
    icon: <span aria-hidden="true">🚚</span>,
  },
  {
    label: 'Frais & surgelés',
    icon: <span aria-hidden="true">❄️</span>,
  },
  {
    label: 'Sélection artisanale',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 3 7v10l9 5 9-5V7z" />
      </svg>
    ),
  },
];

// ── HeroBanner (Server Component interno, non esportato) ──
function HeroBanner({
  heroImageUrl,
  tagline,
  primaryColor,
  previewProducts,
  currency,
  storyEnabled,
}: {
  heroImageUrl: string | null;
  tagline: string;
  primaryColor: string;
  previewProducts: HomeProduct[];
  currency: string;
  storyEnabled: boolean;
}) {
  // `--hero-primary` expose la couleur du tenant reçue en prop aux enfants ;
  // le fallback var(--color-primary) couvre le cas où le composant serait
  // rendu hors du contexte de tenant CSS vars injecté par le layout racine.
  const heroVars = { '--hero-primary': primaryColor } as CSSProperties;
  // Le mockup approuvé montre 2 mini-previews produit, pas 3.
  const preview = previewProducts.slice(0, 2);

  return (
    <div
      className="relative overflow-hidden"
      style={{
        backgroundImage: 'linear-gradient(180deg, var(--color-primary-dark), var(--hero-primary, var(--color-primary)))',
        ...heroVars,
      }}
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

      {/* Contenu — deux colonnes sur desktop, empilé sur mobile (comme le mockup) */}
      <div className="relative z-10 px-5 py-8 md:px-10 md:py-12 grid gap-8 md:grid-cols-[1.1fr_0.9fr] md:items-center md:max-w-6xl md:mx-auto">
        <div>
          <ShopTag className="mb-3">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 3 7v10l9 5 9-5V7z" />
            </svg>
            {tagline}
          </ShopTag>
          <h1 className="font-display text-white font-bold leading-tight text-2xl md:text-4xl">
            L&apos;épicerie africaine<br />qui a du caractère.
          </h1>
          <p className="mt-2 text-white/85 leading-snug text-sm max-w-[38ch]">
            Produits frais, surgelés et d&apos;épicerie fine, sélectionnés avec soin et livrés partout en Europe.
          </p>
          <div className="flex flex-wrap gap-2.5 mt-5">
            <Link
              href="/products"
              className="inline-flex items-center gap-1.5 bg-white rounded-md px-5 py-3 text-sm font-bold transition-transform hover:scale-105"
              style={{ color: 'var(--color-primary-dark)' }}
            >
              Découvrir le catalogue
            </Link>
            {/* N'existe que si la section "Notre origine" est réellement rendue
                (tenant.story_heading + story_text remplis) — jamais un lien
                vers un anchor inexistant. */}
            {storyEnabled && (
              <Link
                href="#origine"
                className="inline-flex items-center gap-1.5 rounded-md px-5 py-3 text-sm font-semibold text-white border-2 border-white/45 transition-colors hover:border-white/70"
              >
                Notre histoire
              </Link>
            )}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 mt-6">
            {TRUST_ROW.map(item => (
              <div key={item.label} className="flex items-center gap-1.5 text-white/90 text-xs font-semibold">
                <span className="w-4 h-4 shrink-0 flex items-center justify-center text-sm leading-none">{item.icon}</span>
                {item.label}
              </div>
            ))}
          </div>
        </div>

        {/* Mini-preview prodotti reali — dati veri, jamais de placeholder statique */}
        {preview.length > 0 && (
          <div className="flex gap-3.5">
            {preview.map((product, i) => (
              <Link
                key={product.id}
                href={`/products/${product.slug}`}
                className={`flex-1 bg-white rounded-lg shadow-card p-3 transition-transform hover:scale-[1.02] hover:shadow-lg ${
                  i === 0 ? 'rotate-[-3deg]' : 'rotate-[2deg]'
                }`}
              >
                <div className="aspect-square bg-primary-light rounded-md overflow-hidden relative mb-2.5">
                  {product.image_url && (
                    <Image src={product.image_url} alt={product.name} fill className="object-cover" sizes="180px" />
                  )}
                </div>
                <p className="text-xs font-semibold text-gray-900 line-clamp-1">{product.name}</p>
                <p
                  className="text-xs font-bold mt-0.5"
                  style={{ color: 'var(--color-primary-dark)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatPrice(product.price, currency)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
