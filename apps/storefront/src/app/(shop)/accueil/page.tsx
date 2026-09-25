import Link from 'next/link';
import type { Metadata } from 'next';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { ProductCard } from '@/components/catalog/ProductCard';
import { PRODUCT_CARD_SELECT } from '@/lib/catalog/productCardSelect';
import { StorySection } from '@/components/home/StorySection';
import { HeroCarousel, type HeroSlideData } from '@/components/home/HeroCarousel';
import { CategoryBlock } from '@/components/home/CategoryBlock';
import { CategoryBlocksRow } from '@/components/home/CategoryBlocksRow';
import { CategoryBlocksGrid } from '@/components/home/CategoryBlocksGrid';
import { SuggestionsRow, type SuggestionProduct } from '@/components/home/SuggestionsRow';
import { formatDate, formatPrice } from '@/lib/utils/format';
import type { EventRow, ServiceOffering } from '@lepefy/types';

export const metadata: Metadata = {
  title: 'Découvrir',
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
  min_order_quantity: number;
  order_quantity_step: number;
};

const HERO_LIMIT = 5;
const EDITORIAL_IMAGES = [
  '/images/hero/chloe-spices.webp',
  '/images/hero/chloe-fresh-produce.webp',
  '/images/hero/chloe-traiteur.webp',
] as const;

function eventHref(slug: string) {
  const host = process.env.NEXT_PUBLIC_EVENTS_SUBDOMAIN;
  return host ? `https://${host}/evenements/${slug}` : `/evenementiel/evenements/${slug}`;
}

function serviceHref(slug: string) {
  const host = process.env.NEXT_PUBLIC_EVENTS_SUBDOMAIN;
  return host ? `https://${host}/services/${slug}` : `/evenementiel/services/${slug}`;
}

function heroProducts(products: SuggestionProduct[], currency: string) {
  return products
    .filter((product): product is SuggestionProduct & { image_url: string } => Boolean(product.image_url))
    .slice(0, 3)
    .map((product) => ({
      id: product.id,
      name: product.name,
      slug: product.slug,
      image_url: product.image_url,
      price_label: formatPrice(product.price, currency),
      compare_at_price_label: product.compare_at_price != null && product.compare_at_price > product.price
        ? formatPrice(product.compare_at_price, currency)
        : null,
    }));
}

export default async function HomePage() {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);
  const supabase = createPublicClient();

  // Ces lectures ne dépendent que de tenant.id — aucune ne dépend du
  // résultat d'une autre, elles partent toutes en parallèle.
  const [
    { data: categoriesRaw },
    { data: featuredRaw },
    { count: activeProductsCount },
    { data: discountCandidatesRaw },
    { data: heroSlidesRaw, error: heroSlidesError },
    nextEventResult,
    servicesResult,
  ] = await Promise.all([
    // 1. Categorie
    supabase
      .from('categories')
      .select('id, name, slug')
      .eq('tenant_id', tenant.id)
      .order('position', { ascending: true }),
    // 2. Prodotti featured
    supabase
      .from('products')
      .select(PRODUCT_CARD_SELECT)
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .eq('featured', true)
      .order('position', { ascending: true })
      .limit(8),
    // 2bis. Compte réel de produits actifs — alimente la statistique "Notre
    // origine" (Task B) : jamais un nombre codé en dur, toujours la vraie
    // cardinalité au moment du rendu.
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('active', true),
    // 4. Suggestions (Feature 3) — étiquettes honnêtes uniquement, jamais de
    // personnalisation inventée (pas de login client actif côté storefront).
    supabase
      .from('products')
      .select(PRODUCT_CARD_SELECT)
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .not('compare_at_price', 'is', null)
      .order('position', { ascending: true })
      .limit(50),
    // 5. Hero slides (Feature 1) — fallback obligatoire si le tenant n'a
    // encore configuré aucune slide : l'hero ne doit jamais disparaître.
    supabase
      .from('tenant_hero_slides')
      .select('id, badge_text, title, subtitle, cta_primary_label, cta_primary_url, cta_secondary_label, cta_secondary_url, image_url, background_variant')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .order('position', { ascending: true }),
    tenant.events_enabled
      ? supabase.from('events')
          .select('id, slug, title, subtitle, date_start, location, banner_image_url')
          .eq('tenant_id', tenant.id)
          .eq('status', 'published')
          .gte('date_start', new Date().toISOString())
          .order('date_start', { ascending: true })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    tenant.services_enabled
      ? supabase.from('service_offerings')
          .select('id, slug, type, title, description, cover_image_url, active, sort_order')
          .eq('tenant_id', tenant.id)
          .eq('active', true)
          .in('type', ['traiteur', 'location_materiel'])
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  const categories = categoriesRaw ?? [];
  const featuredProducts: HomeProduct[] = (featuredRaw as unknown as HomeProduct[] | null) ?? [];

  const storyEnabled = Boolean(tenant.story_heading && tenant.story_text);

  // 3. Prodotti per categoria (escludi featured) — alimente à la fois le
  // bloc-catégorie (Feature 2, grille 2×2 de 4 images max) et son compteur.
  const featuredIds = featuredProducts.map(p => p.id);
  const excludeIds  = featuredIds.length > 0
    ? featuredIds
    : ['00000000-0000-0000-0000-000000000000'];

  const offerProducts: SuggestionProduct[] = (
    (discountCandidatesRaw as unknown as SuggestionProduct[] | null) ?? []
  )
    .filter(p => p.compare_at_price != null && p.compare_at_price > p.price)
    .slice(0, 6);
  const offerIds = offerProducts.map(p => p.id);
  const excludeForRecent = offerIds.length > 0 ? offerIds : ['00000000-0000-0000-0000-000000000000'];

  // categoryProducts, categoryCounts et recentRaw sont mutuellement
  // indépendants (aucun ne dépend du résultat d'un autre) — un seul
  // Promise.all au lieu de 3 étapes séquentielles.
  const [categoryProductsEntries, categoryCountsEntries, { data: recentRaw }] = await Promise.all([
    Promise.all(
      categories.map(async (cat) => {
        const { data: catRaw } = await supabase
          .from('products')
          .select(PRODUCT_CARD_SELECT)
          .eq('tenant_id', tenant.id)
          .eq('active', true)
          .eq('category_id', cat.id)
          .not('id', 'in', `(${excludeIds.join(',')})`)
          .order('position', { ascending: true })
          .limit(4);
        return [cat.id, (catRaw as unknown as HomeProduct[] | null) ?? []] as const;
      }),
    ),
    // Compte total réel par catégorie (indépendant de la limite de 4
    // ci-dessus) — alimente le sous-titre "N produits" du bloc-catégorie.
    Promise.all(
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
    supabase
      .from('products')
      .select(PRODUCT_CARD_SELECT)
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .not('id', 'in', `(${excludeForRecent.join(',')})`)
      .order('created_at', { ascending: false })
      .limit(6),
  ]);
  const categoryProducts: Record<string, HomeProduct[]> = Object.fromEntries(categoryProductsEntries);
  const categoryCounts: Record<string, number> = Object.fromEntries(categoryCountsEntries);
  const recentProducts: SuggestionProduct[] = (recentRaw as unknown as SuggestionProduct[] | null) ?? [];

  // Catégories réellement rendables (au moins 1 produit) — calculé une seule
  // fois ici pour piloter à la fois le rendu JSX et la durée de l'autoscroll
  // (Fix 3), sans dupliquer la logique de filtrage dans le JSX.
  const renderableCategories = categories
    .map((cat, index) => ({ cat, index, products: categoryProducts[cat.id] ?? [] }))
    .filter((entry) => entry.products.length > 0);

  // 4bis. Contenus événementiels réels. Les images restent la source des
  // modules concernés : banner_image_url pour l'événement et cover_image_url
  // pour les services. En leur absence, la slide garde le gradient tenant :
  // aucune image éditoriale n'est substituée à un contenu métier.
  const nextEvent = nextEventResult.data as Pick<EventRow, 'id' | 'slug' | 'title' | 'subtitle' | 'date_start' | 'location' | 'banner_image_url'> | null;
  const activeServices = (servicesResult.data ?? []) as Pick<ServiceOffering, 'id' | 'slug' | 'type' | 'title' | 'description' | 'cover_image_url' | 'active' | 'sort_order'>[];

  // A deployment may precede the additive database migration. Keep existing
  // editorial slides visible while the new nullable column is being applied.
  const editorialRows = heroSlidesError?.code === '42703'
    ? (await supabase.from('tenant_hero_slides')
        .select('id, badge_text, title, subtitle, cta_primary_label, cta_primary_url, cta_secondary_label, cta_secondary_url, background_variant')
        .eq('tenant_id', tenant.id)
        .eq('active', true)
        .order('position', { ascending: true })).data
    : heroSlidesRaw;

  const editorialImage = (index: number) => slug === 'chloefood'
    ? EDITORIAL_IMAGES[index % EDITORIAL_IMAGES.length] ?? EDITORIAL_IMAGES[0]
    : null;

  const editorialSlides: HeroSlideData[] = editorialRows && editorialRows.length > 0
    ? (editorialRows as HeroSlideData[]).map((slide, index) => ({
        ...slide,
        kind: 'editorial',
        image_url: slide.image_url || editorialImage(index),
      }))
    : [
        {
          id: 'fallback-spices',
          badge_text: tenant.tagline ?? 'Épicerie africaine',
          title: "L'épicerie africaine qui a du caractère.",
          subtitle: "Produits frais, surgelés et d'épicerie fine, sélectionnés avec soin et livrés partout en Europe.",
          cta_primary_label: 'Découvrir le catalogue',
          cta_primary_url: '/',
          cta_secondary_label: storyEnabled ? 'Notre histoire' : null,
          cta_secondary_url: storyEnabled ? '#origine' : null,
          image_url: editorialImage(0),
          background_variant: 'primary',
          kind: 'editorial',
        },
        {
          id: 'fallback-fresh',
          badge_text: 'Fraîcheur & sélection',
          title: 'Des produits qui donnent envie de cuisiner.',
          subtitle: 'Légumes, racines et essentiels choisis pour retrouver les saveurs de chez nous.',
          cta_primary_label: 'Voir le catalogue',
          cta_primary_url: '/',
          cta_secondary_label: null,
          cta_secondary_url: null,
          image_url: editorialImage(1),
          background_variant: 'primary',
          kind: 'editorial',
        },
        {
          id: 'fallback-table',
          badge_text: 'Les saveurs de chez nous',
          title: 'De bons produits, de beaux moments à partager.',
          subtitle: 'Retrouvez les essentiels qui font vivre une cuisine généreuse au quotidien.',
          cta_primary_label: 'Explorer le catalogue',
          cta_primary_url: '/',
          cta_secondary_label: null,
          cta_secondary_url: null,
          image_url: editorialImage(2),
          background_variant: 'primary',
          kind: 'editorial',
        },
      ];

  const dynamicSlides: HeroSlideData[] = [];

  if (nextEvent) {
    dynamicSlides.push({
      id: `event-${nextEvent.id}`,
      badge_text: 'Prochain événement',
      title: nextEvent.title,
      subtitle: nextEvent.subtitle ?? 'Retrouvez-nous pour un prochain rendez-vous gourmand et convivial.',
      meta: [formatDate(nextEvent.date_start), nextEvent.location].filter(Boolean).join(' · '),
      cta_primary_label: "Découvrir l'événement",
      cta_primary_url: eventHref(nextEvent.slug),
      cta_secondary_label: null,
      cta_secondary_url: null,
      image_url: nextEvent.banner_image_url,
      background_variant: 'accent',
      kind: 'event',
    });
  }

  const offerHeroProducts = heroProducts(offerProducts, tenant.currency);
  if (offerHeroProducts.length > 0) {
    dynamicSlides.push({
      id: 'offers-live',
      badge_text: 'Offres du moment',
      title: 'De belles saveurs à prix doux.',
      subtitle: 'Une sélection réellement remisée, mise à jour automatiquement depuis le catalogue.',
      cta_primary_label: 'Voir les offres',
      cta_primary_url: '/accueil#offres',
      cta_secondary_label: null,
      cta_secondary_url: null,
      image_url: null,
      background_variant: 'accent',
      kind: 'offers',
      products: offerHeroProducts,
    });
  }

  for (const type of ['traiteur', 'location_materiel'] as const) {
    const service = activeServices.find((candidate) => candidate.type === type);
    if (!service) continue;
    const isCatering = service.type === 'traiteur';
    dynamicSlides.push({
      id: `service-${service.id}`,
      badge_text: isCatering ? 'Service traiteur' : 'Location de matériel',
      title: service.title,
      subtitle: service.description ?? (isCatering
        ? 'Des plats généreux et une prestation pensée pour vos invités.'
        : 'Tout le matériel nécessaire pour recevoir simplement et avec style.'),
      cta_primary_label: isCatering ? 'Découvrir le traiteur' : 'Découvrir la location',
      cta_primary_url: serviceHref(service.slug),
      cta_secondary_label: null,
      cta_secondary_url: null,
      image_url: service.cover_image_url,
      background_variant: 'primary',
      kind: 'service',
    });
  }

  const recentHeroProducts = heroProducts(recentProducts, tenant.currency);
  if (recentHeroProducts.length > 0) {
    dynamicSlides.push({
      id: 'new-arrivals-live',
      badge_text: 'Nouveautés',
      title: 'Tout juste arrivés en boutique.',
      subtitle: `Découvrez les derniers produits ajoutés au catalogue ${tenant.name}.`,
      cta_primary_label: 'Voir les nouveautés',
      cta_primary_url: '/accueil#nouveautes',
      cta_secondary_label: null,
      cta_secondary_url: null,
      image_url: null,
      background_variant: 'primary',
      kind: 'new-arrivals',
      products: recentHeroProducts,
    });
  }

  const heroSlides = [
    ...dynamicSlides.slice(0, HERO_LIMIT - 1),
    ...editorialSlides.slice(0, HERO_LIMIT - Math.min(dynamicSlides.length, HERO_LIMIT - 1)),
  ];

  return (
    <div className="min-h-screen bg-[#f7f9f8]">

      {/* ── HERO CAROUSEL ── */}
      <HeroCarousel slides={heroSlides} />

      {/* Contenuto centrato */}
      <div className="max-w-6xl mx-auto w-full">
      {/* ── PRODUITS VEDETTES — mobile (< md) : riga singola scrollabile,
           aucun autoscroll (section "en évidence" explorée à la main).
           Desktop (>= md) : grille statique multi-ligne, tous les produits
           visibles — même raisonnement que les blocs-catégorie (pas de
           drag-to-scroll souris, un scroll horizontal y serait inatteignable). ── */}
      {featuredProducts.length > 0 && (
        <section>
          <div className="flex items-center justify-between px-4 mb-2 mt-5">
            <h2 className="font-display text-sm font-bold text-gray-900">
              Nos produits vedettes
            </h2>
            <Link
              href="/"
              className="text-2xs font-medium"
              style={{ color: 'var(--color-primary)' }}
            >
              Voir tout →
            </Link>
          </div>

          <div
            className="
              flex gap-4 overflow-x-auto snap-x snap-mandatory px-4 pb-3 md:hidden
              [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
            "
          >
            {featuredProducts.map(product => (
              <div key={product.id} className="flex-[0_0_42%] sm:flex-[0_0_30%] snap-start">
                <ProductCard product={product} variant="grid" />
              </div>
            ))}
          </div>

          <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 gap-4 px-4 pb-3">
            {featuredProducts.map(product => (
              <ProductCard key={product.id} product={product} variant="grid" />
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
      <SuggestionsRow id="offres" label="Offre pour vous" products={offerProducts} currency={tenant.currency} />
      <SuggestionsRow id="nouveautes" label="Sélection du moment" products={recentProducts} currency={tenant.currency} />

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
