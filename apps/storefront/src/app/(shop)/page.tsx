import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Chloé Food ETS — Boutique africaine à Reggio Emilia',
  description: 'Produits africains frais, surgelés et épicerie fine. Livraison en Europe.',
};

export default async function HomePage() {
  const slug = process.env.TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createClient();

  const { data: featuredData } = await supabase
    .from('products')
    .select('id, name, price, image_url, slug')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .eq('featured', true)
    .order('position')
    .limit(4);

  const featured = featuredData ?? [];

  const { data: categoryData } = await supabase
    .from('categories')
    .select('id, name, slug')
    .eq('tenant_id', tenant.id)
    .order('position');

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
            <p className="text-xs text-gray-300 mt-0.5">{tenant.city}{tenant.country ? `, ${tenant.country}` : ''}</p>
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
      {featured.length > 0 && (
        <section className="mt-2">
          <h2 className="font-bold text-base mb-3 px-4">Nos produits vedettes</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4">
            {featured.map((product) => (
              <Link key={product.id} href={`/products/${product.slug}`} className="block">
                <div className="aspect-square rounded-xl overflow-hidden bg-[#E1F5EE]">
                  {product.image_url ? (
                    <Image
                      src={product.image_url}
                      alt={product.name}
                      width={300}
                      height={300}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-[#E1F5EE]" />
                  )}
                </div>
                <p className="text-xs font-medium line-clamp-2 mt-2 text-gray-800">{product.name}</p>
                <p className="text-sm font-bold text-[#1D9E75] mt-0.5">
                  {(product.price / 100).toFixed(2)} €
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Categories */}
      {categories.length > 0 && (
        <section className="mt-6">
          <h2 className="font-bold text-base mb-3 px-4">Nos catégories</h2>
          <div className="flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-hide">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/products?category=${encodeURIComponent(cat.slug)}`}
                className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium bg-[#E1F5EE] text-[#0F6E56] border border-[#1D9E75]/20 whitespace-nowrap"
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
