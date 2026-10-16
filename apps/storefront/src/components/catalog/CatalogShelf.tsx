import Link from 'next/link';
import { shopLinkPrefetch } from '@/lib/storefront/linkPrefetch';
import { ProductCard, type ProductCardProduct } from './ProductCard';

const TONES = {
  promo: {
    button: 'border-red-700 bg-red-50 text-red-800 hover:bg-red-100 focus-visible:ring-red-700',
    count: 'bg-red-700 text-white',
  },
  novelty: {
    button: 'border-violet-700 bg-violet-50 text-violet-800 hover:bg-violet-100 focus-visible:ring-violet-700',
    count: 'bg-violet-700 text-white',
  },
} as const;

interface CatalogShelfProps {
  id: string;
  title: string;
  icon: string;
  tone: keyof typeof TONES;
  /** Vue complète (`/?promo=1`, `/?new=1`) ; absent = pas de bouton « Tout voir ». */
  href?: string;
  /** Total de la vue complète (pas seulement les cartes du bloc). */
  count?: number;
  /** Nom lu par les lecteurs d'écran : « Tout voir les promos (7) ». */
  allLabel?: string;
  products: ProductCardProduct[];
  /** Transmis aux cartes (le panier n'ouvre pas la confirmation d'ajout). */
  confirmOnAdd?: boolean;
  className?: string;
}

/**
 * Bloc horizontal du catalogue non filtré (« Nos promos », « Nouveautés »)
 * avec son bouton « Tout voir » : même forme que les anciens accès de l'en-tête
 * (bord et texte de la couleur du bloc, total dans la pastille). Rien sans produit.
 */
export function CatalogShelf({ id, title, icon, tone, href, count = 0, allLabel, products, confirmOnAdd, className = 'mt-5' }: CatalogShelfProps) {
  if (products.length === 0) return null;
  const colors = TONES[tone];
  return (
    <section aria-labelledby={`${id}-title`} className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="font-display text-xl font-bold text-gray-900"><span aria-hidden="true">{icon} </span>{title}</h2>
        {href && <Link
          href={href}
          prefetch={shopLinkPrefetch(href)}
          aria-label={`${allLabel} (${count})`}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border-2 px-4 text-sm font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none ${colors.button}`}
        >
          <span aria-hidden="true">{icon}</span> Tout voir
          <span aria-hidden="true" className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${colors.count}`}>{count}</span>
        </Link>}
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:gap-4">
        {products.map((product) => (
          <li key={product.id} className="w-[44vw] max-w-[220px] shrink-0 snap-start sm:w-[30vw]">
            <ProductCard product={product} compactMobile confirmOnAdd={confirmOnAdd} />
          </li>
        ))}
      </ul>
    </section>
  );
}
