'use client';

import Link from 'next/link';
import { IconChevronRight, IconShoppingBag } from '@tabler/icons-react';
import { LepefyImage } from '@/components/images/LepefyImage';
import { ProductPrice } from '@/components/catalog/ProductPrice';
import { FulfillmentPolicyChip } from '@/components/catalog/FulfillmentPolicyChip';
import { normalizeFulfillmentPolicy } from '@/lib/fulfillment/fulfillmentPolicy';
import type { CardShowcaseProduct } from '@/lib/card/getCardShowcaseProducts';

type Lang = 'fr' | 'it';

const COPY = {
  fr: {
    title: 'Nos produits en vedette', cta: 'Voir la boutique', promo: 'Promo', featured: 'En vedette',
    minimum: (n: number) => `Minimum ${n}`, emptyTitle: 'Notre boutique en ligne', emptyText: 'Commandez nos produits depuis votre téléphone.',
    comingSoon: 'Boutique en ligne bientôt disponible',
  },
  it: {
    title: 'I nostri prodotti in evidenza', cta: 'Vedi il negozio', promo: 'Promo', featured: 'In evidenza',
    minimum: (n: number) => `Minimo ${n}`, emptyTitle: 'Il nostro negozio online', emptyText: 'Ordina i nostri prodotti dal telefono.',
    comingSoon: 'Negozio online in arrivo',
  },
} as const;

interface CardShowcaseProps {
  lang: Lang;
  products: CardShowcaseProduct[];
  storefrontReady: boolean;
  tagline: string | null;
  currency: string;
  primaryColor: string;
}

/**
 * Vitrine sous la zone paiement : un ou deux vrais produits choisis côté
 * serveur (getCardShowcaseProducts). Pas d'ajout rapide : minimum, pas et
 * groupes combinables se règlent sur la fiche produit, que la carte ouvre.
 */
export function CardShowcase({ lang, products, storefrontReady, tagline, currency, primaryColor }: CardShowcaseProps) {
  const t = COPY[lang];
  if (!storefrontReady) {
    return (
      <p className="flex min-h-12 items-center gap-3 rounded-2xl bg-white px-4 text-sm font-medium text-gray-700 ring-1 ring-black/[0.04]">
        <IconShoppingBag size={20} aria-hidden="true" style={{ color: primaryColor }} />{t.comingSoon}
      </p>
    );
  }
  const shopLink = (
    <Link
      href="/"
      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border-2 bg-white px-3.5 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{ borderColor: primaryColor, color: '#111827', '--tw-ring-color': primaryColor } as React.CSSProperties}
    >
      {t.cta}<IconChevronRight size={18} aria-hidden="true" />
    </Link>
  );

  if (products.length === 0) {
    return (
      <section aria-labelledby="card-showcase-title" className="flex items-center gap-3 rounded-3xl bg-white p-4 shadow-[0_1px_2px_rgba(17,24,39,0.06)] ring-1 ring-black/[0.04]">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white" style={{ backgroundColor: primaryColor }}><IconShoppingBag size={24} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="card-showcase-title" className="font-extrabold text-gray-900" style={{ fontFamily: 'var(--font-card-heading)' }}>{t.emptyTitle}</h2>
          <p className="text-sm text-gray-700">{t.emptyText}</p>
        </div>
        {shopLink}
      </section>
    );
  }

  return (
    <section aria-labelledby="card-showcase-title" className="rounded-3xl bg-white p-4 shadow-[0_1px_2px_rgba(17,24,39,0.06)] ring-1 ring-black/[0.04] sm:p-5">
      <div className="mb-3.5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="card-showcase-title" className="min-w-0 text-xl font-extrabold leading-tight text-gray-900 sm:text-2xl" style={{ fontFamily: 'var(--font-card-heading)' }}>{t.title}</h2>
          {shopLink}
        </div>
        {tagline && <p className="mt-1 text-sm leading-snug text-gray-700">{tagline}</p>}
      </div>
      <ul className={`grid gap-3 ${products.length > 1 ? 'grid-cols-2' : 'grid-cols-1 min-[420px]:grid-cols-2'}`}>
        {products.map((product) => {
          const promo = product.reason === 'promo';
          const policy = normalizeFulfillmentPolicy(product.fulfillment_policy);
          return (
            <li key={product.id} className="min-w-0">
              <Link
                href={`/products/${product.slug}`}
                className="group block h-full overflow-hidden rounded-2xl border border-gray-200 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
              >
                <div className="relative aspect-square overflow-hidden bg-gray-100">
                  <LepefyImage
                    src={product.image_url}
                    variant="catalog"
                    alt={product.name}
                    fill
                    sizes="(min-width: 1024px) 280px, (min-width: 420px) 45vw, 92vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                  {product.reason !== 'available' && (
                    <span className={`absolute left-2 top-2 rounded-full px-2.5 py-1 text-xs font-extrabold shadow-sm ${promo ? 'bg-red-700 text-white' : 'bg-amber-300 text-gray-900'}`}>
                      {promo ? t.promo : t.featured}
                    </span>
                  )}
                </div>
                <div className="p-2.5 sm:p-3">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900">{product.name}</p>
                  <div className="mt-1.5">
                    <ProductPrice price={product.price} currency={currency} product={product} compareAtPrice={promo ? product.compare_at_price : null} />
                  </div>
                  {(product.min_order_quantity > 1 || policy !== 'delivery_or_pickup') && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {product.min_order_quantity > 1 && (
                        <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-900">{t.minimum(product.min_order_quantity)}</span>
                      )}
                      {policy !== 'delivery_or_pickup' && <FulfillmentPolicyChip policy={policy} />}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
