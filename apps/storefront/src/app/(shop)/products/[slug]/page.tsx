import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { createPublicClient } from '@/lib/supabase/public';
import { ProductDetail } from '@/components/product/ProductDetail';
import type { ProductWithCategory } from '@lepefy/types';

// ISR : ni cette page ni generateMetadata ne lisent de donnée personnalisée
// (pas de panier/session ici — ProductDetail lit le panier côté client via
// Zustand/localStorage). Stock et prix peuvent donc rester à 5 minutes de
// fraîcheur ; le re-contrôle réel se fait au checkout (cf. résumé du prompt).
export const revalidate = 300;

interface ProductPageProps { params: { slug: string } }

export async function generateStaticParams() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  try {
    const supabase = createPublicClient();
    const tenant = await getTenant(tenantSlug);
    const { data } = await supabase
      .from('products')
      .select('slug')
      .eq('tenant_id', tenant.id)
      .eq('active', true);
    return (data ?? []).map((p) => ({ slug: p.slug }));
  } catch (err) {
    // Vérifié empiriquement : une erreur non interceptée ici (Supabase
    // inatteignable pendant le build, tenant introuvable, etc.) fait
    // échouer TOUT `next build` — pas seulement cette page — ce qui
    // bloquerait un déploiement Vercel entier. On retombe sur [] : aucune
    // page pré-générée, mais dynamicParams reste true par défaut, donc
    // chaque /products/[slug] est quand même généré à la demande via l'ISR
    // (revalidate = 300) au premier accès.
    console.error('[products/[slug]] generateStaticParams a échoué, repli sur ISR à la demande :', err);
    return [];
  }
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createPublicClient();
  const { data } = await supabase.from('products').select('name, description')
    .eq('slug', params.slug).eq('tenant_id', tenant.id).single();
  if (!data) return {};
  return { title: data.name, description: data.description ?? undefined };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createPublicClient();

  const { data: product } = await supabase
    .from('products')
    .select(`
      id, name, slug, price, compare_at_price, image_url,
      weight_grams, stock, storage_type,
      description, descriptions,
      category:categories(name)
    `)
    .eq('slug', params.slug).eq('tenant_id', tenant.id).eq('active', true).single();

  if (!product) notFound();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <ProductDetail product={product as unknown as ProductWithCategory} />
    </div>
  );
}
