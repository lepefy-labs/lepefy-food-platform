import Image from 'next/image';
import Link from 'next/link';
import { formatPrice } from '@/lib/utils/format';
import type { HomeProduct } from '@/app/(shop)/accueil/page';

export interface SuggestionProduct extends HomeProduct {
  compare_at_price: number | null;
}

interface SuggestionsRowProps {
  label: string;
  products: SuggestionProduct[];
  currency: string;
}

/**
 * Ligne "Suggestions pour vous" (Feature 3, cycle redesign home) — étiquettes
 * honnêtes uniquement : pas de personnalisation inventée (pas de login client
 * actif côté storefront aujourd'hui). Le badge de réduction ne s'affiche que
 * si compare_at_price > price est réellement vrai en base, jamais un
 * pourcentage arbitraire. Se masque entièrement si vide, même pattern que
 * "Notre origine".
 */
export function SuggestionsRow({ label, products, currency }: SuggestionsRowProps) {
  if (products.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between px-4 mb-2 mt-5">
        <h2 className="font-display text-sm font-bold text-gray-900">{label}</h2>
      </div>
      <div
        className="
          flex gap-2.5 overflow-x-auto px-4 pb-3
          [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
        "
      >
        {products.map((product) => {
          const hasDiscount = product.compare_at_price != null && product.compare_at_price > product.price;
          const discountPct = hasDiscount
            ? Math.round((1 - product.price / (product.compare_at_price as number)) * 100)
            : null;

          return (
            <Link
              key={product.id}
              href={`/products/${product.slug}`}
              className="relative flex-none w-[140px] bg-white rounded-lg border border-gray-100 shadow-card p-2"
            >
              {discountPct !== null && discountPct > 0 && (
                <span
                  className="absolute top-1.5 left-1.5 z-10 text-2xs font-bold text-white rounded-full px-1.5 py-0.5"
                  style={{ backgroundColor: 'var(--status-danger-fg)' }}
                >
                  -{discountPct}%
                </span>
              )}
              <div className="aspect-square bg-primary-light rounded-md overflow-hidden relative mb-2">
                {product.image_url && (
                  <Image src={product.image_url} alt={product.name} fill className="object-cover" sizes="140px" />
                )}
              </div>
              <p className="text-xs font-medium line-clamp-2 text-gray-900">{product.name}</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-sm" style={{ color: 'var(--color-primary)', fontWeight: 800 }}>
                  {formatPrice(product.price, currency)}
                </span>
                {hasDiscount && (
                  <span className="text-2xs text-gray-400 line-through">
                    {formatPrice(product.compare_at_price as number, currency)}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
