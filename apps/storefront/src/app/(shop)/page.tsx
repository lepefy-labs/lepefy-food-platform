import Link from 'next/link';
import type { Metadata } from 'next';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { ProductCard } from '@/components/catalog/ProductCard';
import { StorySection } from '@/components/home/StorySection';
import { HeroCarousel, type HeroSlideData } from '@/components/home/HeroCarousel';
import { CategoryBlock } from '@/components/home/CategoryBlock';
import { CategoryBlocksRow } from '@/components/home/CategoryBlocksRow';
import { CategoryBlocksGrid } from '@/components/home/CategoryBlocksGrid';
import { SuggestionsRow, type SuggestionProduct } from '@/components/home/SuggestionsRow';

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
  compare_at_price?: number | null;
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

  // 3. Prodotti per categoria (escludi featured) — alimente à la fois le
  // bloc-catégorie (Feature 2, grille 2×2 de 4 images max) et son compteur.
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

  // Compte total réel par catégorie (indépendant de la limite de 4 ci-dessus)
  // — alimente le sous-titre "N produits" du bloc-catégorie.
  const categoryCounts: Record<string, number> = Object.fromEntries(
    await Promise.all(
      categories.map(async (cat) => {
        const { count } = await supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('active', true)
          .eq('category_id', cat.id);
        return [cat.id, count ?? 0] as const;
      }),
    ),
  );

  // Catégories réellement rendables (au moins 1 produit) — calculé une seule
  // fois ici pour piloter à la fois le rendu JSX et la durée de l'autoscroll
  // (Fix 3), sans dupliquer la logique de filtrage dans le JSX.
  const renderableCategories = categories
    .map((cat, index) => ({ cat, index, products: categoryProducts[cat.id] ?? [] }))
    .filter((entry) => entry.products.length > 0);

  // 4. Suggestions (Feature 3) — étiquettes honnêtes uniquement, jamais de
  // personnalisation inventée (pas de login client actif côté storefront).
  const { data: discountCandidatesRaw } = await supabase
    .from('products')
    .select('id, name, price, compare_at_price, image_url, slug, weight_grams, stock, storage_type, category:categories(name)')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .not('compare_at_price', 'is', null)
    .order('position', { ascending: true })
    .limit(50);

  const offerProducts: SuggestionProduct[] = (
    (discountCandidatesRaw as unknown as SuggestionProduct[] | null) ?? []
  )
    .filter(p => p.compare_at_price != null && p.compare_at_price > p.price)
    .slice(0, 6);

  const offerIds = offerProducts.map(p => p.id);
  const excludeForRecent = offerIds.length > 0 ? offerIds : ['00000000-0000-0000-0000-000000000000'];

  const { data: recentRaw } = await supabase
    .from('products')
    .select('id, name, price, compare_at_price, image_url, slug, weight_grams, stock, storage_type, category:categories(name)')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .not('id', 'in', `(${excludeForRecent.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(6);
  const recentProducts: SuggestionProduct[] = (recentRaw as unknown as SuggestionProduct[] | null) ?? [];

  // 5. Hero slides (Feature 1) — fallback obligatoire si le tenant n'a
  // encore configuré aucune slide : l'hero ne doit jamais disparaître.
  const { data: heroSlidesRaw } = await supabase
    .from('tenant_hero_slides')
    .select('id, badge_text, title, subtitle, cta_primary_label, cta_primary_url, cta_secondary_label, cta_secondary_url, background_variant')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('position', { ascending: true });

  const heroSlides: HeroSlideData[] = heroSlidesRaw && heroSlidesRaw.length > 0
    ? (heroSlidesRaw as HeroSlideData[])
    : [
        {
          id: 'fallback',
          badge_text: tenant.tagline ?? 'Épicerie africaine',
          title: "L'épicerie africaine qui a du caractère.",
          subtitle: "Produits frais, surgelés et d'épicerie fine, sélectionnés avec soin et livrés partout en Europe.",
          cta_primary_label: 'Découvrir le catalogue',
          cta_primary_url: '/products',
          cta_secondary_label: storyEnabled ? 'Notre histoire' : null,
          cta_secondary_url: storyEnabled ? '#origine' : null,
          background_variant: 'primary',
        },
      ];

  return (
    <div className="min-h-screen bg-[#f7f9f8]">

      {/* ── HERO CAROUSEL ── */}
      <HeroCarousel slides={heroSlides} />

      {/* Contenuto centrato */}
      <div className="max-w-6xl mx-auto w-full">
      {/* ── PRODUITS VEDETTES — riga singola scrollabile, aucun autoscroll
           (section "en évidence" explorée à la main, à la différence des
           blocs-catégorie ci-dessous). ── */}
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
          <div
            className="
              flex gap-4 overflow-x-auto snap-x snap-mandatory px-4 pb-3
              [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
            "
          >
            {featuredProducts.map(product => (
              <div key={product.id} className="flex-[0_0_42%] sm:flex-[0_0_30%] lg:flex-[0_0_22%] snap-start">
                <ProductCard product={product} variant="grid" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── BLOCS CATÉGORIE — juste après les vedettes (Fix 1). Mobile :
           autoscroll continu (Fix 3, < md). Desktop : grille statique sans
           scroll, tous les blocs visibles (Fix 3, >= md — pas de drag-to-
           scroll souris, un scroll horizontal y serait inatteignable). ── */}
      {renderableCategories.length > 0 && (
        <section>
          <CategoryBlocksRow itemCount={renderableCategories.length}>
            {renderableCategories.map(({ cat, index, products }) => (
              <CategoryBlock
                key={cat.id}
                index={index}
                name={cat.name}
                slug={cat.slug}
                count={categoryCounts[cat.id] ?? products.length}
                products={products}
                primaryColor={tenant.primary_color}
                secondaryColor={tenant.secondary_color}
              />
            ))}
            {renderableCategories.map(({ cat, index, products }) => (
              <CategoryBlock
                key={`${cat.id}-dup`}
                index={index}
                name={cat.name}
                slug={cat.slug}
                count={categoryCounts[cat.id] ?? products.length}
                products={products}
                primaryColor={tenant.primary_color}
                secondaryColor={tenant.secondary_color}
                hiddenFromA11y
              />
            ))}
          </CategoryBlocksRow>

          <CategoryBlocksGrid>
            {renderableCategories.map(({ cat, index, products }) => (
              <CategoryBlock
                key={cat.id}
                index={index}
                name={cat.name}
                slug={cat.slug}
                count={categoryCounts[cat.id] ?? products.length}
                products={products}
                primaryColor={tenant.primary_color}
                secondaryColor={tenant.secondary_color}
              />
            ))}
          </CategoryBlocksGrid>
        </section>
      )}

      {/* ── SUGGESTIONS POUR VOUS ── */}
      <SuggestionsRow label="Offre pour vous" products={offerProducts} currency={tenant.currency} />
      <SuggestionsRow label="Sélection du moment" products={recentProducts} currency={tenant.currency} />

      {/* ── NOTRE ORIGINE ── */}
      <StorySection
        heading={tenant.story_heading}
        text={tenant.story_text}
        imageUrl={tenant.story_image_url}
        productsCount={activeProductsCount ?? 0}
        countriesServed={tenant.countries_served}
      />

      <div className="h-6" />
      </div>{/* /max-w-6xl */}
    </div>
  );
}
