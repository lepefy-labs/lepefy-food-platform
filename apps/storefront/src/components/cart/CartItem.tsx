import Image from 'next/image';
import type { CartItem as CartItemType } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';
import { deriveCartItemState } from '@/lib/cart/cartItemState';
import { CartQuantityControl } from './CartQuantityControl';

interface CartItemProps {
  item: CartItemType;
  currency?: string;
  unavailableProductIds: string[];
  pendingProductIds: Set<string>;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onRemove: (productId: string) => void;
  variant?: 'drawer' | 'page';
}

// Même petite fonction que ProductCard.tsx (non exportée là-bas) — dupliquée
// plutôt que de toucher ProductCard pour exporter 3 lignes, cf. audit
// "POTENTIAL REGRESSIONS" : un composant catalogue en plus modifié pour un
// gain DRY marginal n'en valait pas le risque.
function formatWeightLabel(grams: number | null): string | null {
  if (!grams) return null;
  return grams >= 1000 ? `${+(grams / 1000).toFixed(2)}kg` : `${grams}g`;
}

const STATE_BADGE: Record<'unavailable' | 'out_of_stock', string> = {
  unavailable:  'Indisponible',
  out_of_stock: 'Épuisé',
};

export function CartItem({
  item,
  currency,
  unavailableProductIds,
  pendingProductIds,
  onIncrement,
  onDecrement,
  onRemove,
  variant = 'drawer',
}: CartItemProps) {
  const { product, quantity } = item;
  const state = deriveCartItemState({
    productId: product.id,
    stock: product.stock,
    unavailableProductIds,
    pendingProductIds,
  });
  const blocked = state === 'unavailable' || state === 'out_of_stock';
  const weightLabel = formatWeightLabel(product.weight_grams);
  const lineTotal = product.price * quantity;

  const isPage = variant === 'page';

  return (
    <li className={`flex gap-4 border-b border-gray-100 last:border-0 ${isPage ? 'py-5 sm:py-6' : 'py-4'}`}>
      <div className={`${isPage ? 'w-20 h-20 sm:w-24 sm:h-24' : 'w-16 h-16'} rounded-2xl overflow-hidden flex-shrink-0 bg-gray-50 relative`}>
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes={isPage ? '(min-width: 640px) 96px, 80px' : '64px'}
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`${isPage ? 'text-base' : 'text-sm'} font-semibold leading-snug line-clamp-2`}>{product.name}</p>
        </div>

        <div className="flex items-center gap-1.5 mt-0.5">
          {weightLabel && <span className="text-xs text-gray-400">{weightLabel}</span>}
          {(state === 'unavailable' || state === 'out_of_stock') && (
            <span className="text-xs font-medium text-red-700 bg-red-50 rounded-full px-2 py-0.5">
              {isPage ? 'Produit actuellement indisponible' : STATE_BADGE[state]}
            </span>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-0.5">
          {formatPrice(product.price, currency)} / unité
        </p>

        <div className={`flex items-center justify-between gap-3 ${isPage ? 'mt-3 flex-wrap' : 'mt-2'}`}>
          <div className="flex items-center gap-1.5">
            <CartQuantityControl
              quantity={quantity}
              max={Math.max(product.stock, 0)}
              productName={product.name}
              disabled={blocked}
              onIncrement={() => onIncrement(product.id)}
              onDecrement={() => onDecrement(product.id)}
            />
            {/* Indicateur "pending sync" — un point discret, jamais un texte
                technique ("Syncing…", "Mutation pending…", cf. §9/§10). Le
                contrôle reste pleinement interactif : la sync est en tâche de
                fond, elle ne doit jamais ralentir l'utilisateur. */}
            {state === 'pending' && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
          </div>
          {/* aria-live discret : le total de ligne change avec la quantité,
              utile en lecteur d'écran sans devenir bavard (pas de "syncing"
              ni de jargon interne, cf. §9/§19). */}
          <span className={`${isPage ? 'text-base sm:text-lg' : 'text-sm'} font-bold tabular-nums`} aria-live="polite">
            {formatPrice(lineTotal, currency)}
          </span>
        </div>

        <button
          type="button"
          onClick={() => onRemove(product.id)}
          className="-ml-2 mt-1 inline-flex min-h-11 items-center rounded px-2 text-xs text-gray-500 underline underline-offset-2 transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Retirer
        </button>
      </div>
    </li>
  );
}
