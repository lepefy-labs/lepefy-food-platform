import type { Metadata } from 'next';
import Link from 'next/link';
import { IconShoppingBag } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient } from '@/lib/supabase/server';
import { parsePageParam, PRODUCTS_PAGE_SIZE } from '@/lib/catalog/pagination';
import { ProductCard, type ProductCardProduct } from '@/components/catalog/ProductCard';
import { GoodiesHero } from '@/components/goodies/GoodiesHero';
import type { Category } from '@lepefy/types';

type GoodiesProduct = ProductCardProduct & { description: string | null };

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return { title: 'Goodies', description: `Découvrez les goodies et objets aux couleurs de ${tenant.name}.`, alternates: { canonical: '/gadgets' } };
}

export default async function GoodiesPage({ searchParams }: { searchParams: { category?: string; page?: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createClient();
  const { data: categoryRows, error: categoryError } = await supabase
    .from('categories').select('*').eq('tenant_id', tenant.id)
    .eq('catalog_scope', 'gadgets').order('position').order('id');
  if (categoryError) throw new Error('Impossible de charger les catégories Goodies.');
  const categories = (categoryRows ?? []) as Category[];
  const selected = categories.find(category => category.slug === searchParams.category);
  const page = parsePageParam(searchParams.page);

  function merchandiseQuery() {
    return supabase.from('products')
      .select('id, name, slug, price, compare_at_price, image_url, weight_grams, stock, storage_type, description, category:categories!inner(name)', { count: 'exact' })
      .eq('tenant_id', tenant.id).eq('active', true)
      .eq('category.tenant_id', tenant.id).eq('category.catalog_scope', 'gadgets');
  }
  let productsQuery = merchandiseQuery();
  if (searchParams.category) {
    // Unknown or foreign category slugs cannot broaden the requested scope.
    productsQuery = productsQuery.in('category_id', selected ? [selected.id] : []);
  }
  const [productsResult, featuredResult] = await Promise.all([
    productsQuery.order('position').order('id').range(0, page * PRODUCTS_PAGE_SIZE - 1),
    merchandiseQuery().order('featured', { ascending: false }).order('position').order('id').limit(1),
  ]);
  if (productsResult.error || featuredResult.error) throw new Error('Impossible de charger les goodies.');
  const products = (productsResult.data ?? []) as unknown as GoodiesProduct[];
  const featured = (featuredResult.data?.[0] ?? null) as unknown as GoodiesProduct | null;
  const count = productsResult.count ?? 0;
  const nextParams = new URLSearchParams({ page: String(page + 1) });
  if (searchParams.category) nextParams.set('category', searchParams.category);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8">
      <header className="mb-5 max-w-2xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">Goodies</p>
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-[color:color-mix(in_srgb,var(--color-secondary)_35%,black)] sm:text-4xl">Les goodies de {tenant.name}</h1>
        <p className="mt-2 text-sm text-gray-600 sm:text-base">Emportez un peu de {tenant.name} avec vous !</p>
      </header>

      {featured ? <GoodiesHero product={featured} /> : (
        <section className="rounded-3xl bg-[var(--color-primary-light)] px-5 py-12 text-center sm:py-16">
          <IconShoppingBag size={48} stroke={1.3} className="mx-auto mb-4 text-[var(--color-primary)]" aria-hidden="true" />
          <h2 className="text-xl font-bold text-gray-900">Les goodies arrivent bientôt</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-gray-600">De nouveaux objets aux couleurs de {tenant.name} seront bientôt disponibles.</p>
          <Link href="/" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-white px-5 text-sm font-semibold text-[var(--color-primary)]">Découvrir le catalogue</Link>
        </section>
      )}

      {categories.length > 0 && <nav aria-label="Catégories Goodies" className="my-4 flex max-w-full gap-2 overflow-x-auto py-1 sm:flex-wrap sm:overflow-visible">
        {[{ id: 'all', name: 'Tous', slug: '' }, ...categories].map(category => {
          const active = category.slug === (searchParams.category ?? '');
          return <Link key={category.id} href={category.slug ? `/gadgets?category=${encodeURIComponent(category.slug)}` : '/gadgets'} aria-current={active ? 'page' : undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${active ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <IconShoppingBag size={18} stroke={1.5} aria-hidden="true" />{category.name}
          </Link>;
        })}
      </nav>}

      {featured && <section className="mt-5" aria-labelledby="goodies-products-heading">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="goodies-products-heading" className="text-lg font-bold text-gray-900">Tous nos goodies</h2>
          <span className="shrink-0 text-xs text-gray-500">{count} produit{count === 1 ? '' : 's'}</span>
        </div>
        {products.length > 0 ? <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
          {products.map(product => <ProductCard key={product.id} product={product} catalogScope="gadgets" compactMobile />)}
        </div> : <div className="rounded-2xl bg-gray-50 p-8 text-center text-sm text-gray-600">
          <p>Aucun goodie disponible dans cette catégorie pour le moment.</p>
          <Link href="/gadgets" className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--color-primary)]">Voir tous les goodies</Link>
        </div>}
        {page * PRODUCTS_PAGE_SIZE < count && <div className="mt-6 text-center"><Link href={`/gadgets?${nextParams.toString()}`} scroll={false} className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 px-6 text-sm font-semibold">Charger plus</Link></div>}
      </section>}
    </div>
  );
}
