'use client';

import Image from 'next/image';
import Link from 'next/link';
import { IconShoppingBag, IconShoppingCart } from '@tabler/icons-react';
import { useTenant } from '@/providers/TenantProvider';
import { formatPrice } from '@/lib/utils/format';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';
import { useQuickAdd } from '@/components/catalog/useQuickAdd';

export function GoodiesHero({ product }: { product: ProductCardProduct & { description?: string | null } }) {
  const { currency } = useTenant();
  const { addToCart, added, outOfStock } = useQuickAdd(product);
  return (
    <section aria-label="Produit phare" className="relative grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden rounded-2xl bg-[var(--color-primary-light)] sm:rounded-3xl">
      <div className="relative z-10 flex min-w-0 flex-col items-start p-4 pr-0 sm:p-8 lg:p-10">
        <span className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-primary)] sm:text-xs">Produit phare</span>
        <h2 className="mt-3 break-words text-xl font-bold leading-tight text-[color:color-mix(in_srgb,var(--color-secondary)_35%,black)] sm:text-3xl">
          <Link href={`/products/${product.slug}?from=gadgets`} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">{product.name}</Link>
        </h2>
        {product.description && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-gray-600 sm:text-base">{product.description}</p>}
        <p className="mb-3 mt-4 whitespace-nowrap text-xl font-bold text-gray-900 sm:text-2xl">{formatPrice(product.price, currency)}</p>
        <button type="button" onClick={addToCart} disabled={outOfStock} className="mt-auto flex min-h-11 max-w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:opacity-50 sm:px-5 sm:text-sm">
          <IconShoppingCart size={17} className="shrink-0" aria-hidden="true" />
          <span aria-live="polite">{outOfStock ? 'Épuisé' : added ? 'Ajouté au panier' : 'Ajouter au panier'}</span>
        </button>
      </div>
      <Link href={`/products/${product.slug}?from=gadgets`} aria-label={product.name} className="relative m-2 min-h-[250px] min-w-0 sm:m-4 sm:min-h-[320px]">
        {product.image_url ? <Image src={product.image_url} alt={product.name} fill priority sizes="(max-width: 640px) 45vw, 50vw" className="object-contain p-1 sm:p-4" /> : <div className="flex h-full items-center justify-center text-[var(--color-primary)]/40"><IconShoppingBag size={80} stroke={1} aria-hidden="true" /></div>}
      </Link>
    </section>
  );
}
