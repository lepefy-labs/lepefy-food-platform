import { formatPrice } from '@/lib/utils/format';
import { describePrice, resolveSellingFormat, type SellingFormatSource } from '@/lib/storefrontCopy/sellingFormat';

interface ProductPriceProps {
  price: number;
  currency?: string;
  product: SellingFormatSource;
  compareAtPrice?: number | null;
  /** `card` = carte catalogue, `detail` = fiche produit, `compact` = ligne de panier / suggestions. */
  size?: 'card' | 'detail' | 'compact';
}

/**
 * Prix + format de vente (« 2,50 € le paquet de 500 g »). Le prix de
 * référence (« soit 5,00 € le kilo ») n'apparaît que sur la fiche produit,
 * en petit : les listes restent lisibles et l'information reste disponible.
 * Affichage seulement : le montant reçu est celui du catalogue, inchangé.
 */
export function ProductPrice({ price, currency = 'EUR', product, compareAtPrice = null, size = 'card' }: ProductPriceProps) {
  const display = describePrice(price, resolveSellingFormat(product), currency);
  const hasDiscount = compareAtPrice != null && compareAtPrice > price;
  const detail = size === 'detail';
  const reference = detail ? display.reference : null;
  const sentence = `${display.amount} ${display.unitPhrase}${reference ? `, ${reference}` : ''}`;

  if (size === 'compact') {
    return (
      <p className="text-sm text-gray-900">
        <span className="font-bold">{display.amount}</span>{' '}
        <span className="font-medium text-gray-700">{display.unitPhrase}</span>
        {hasDiscount && <span className="ml-1.5 text-xs text-gray-500 line-through">{formatPrice(compareAtPrice as number, currency)}</span>}
      </p>
    );
  }

  return (
    <div aria-label={sentence}>
      <p aria-hidden="true" className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className={`whitespace-nowrap font-extrabold leading-none tracking-tight text-gray-950 ${detail ? 'text-3xl' : 'text-lg sm:text-xl'}`}>{display.amount}</span>
        <span className={`font-semibold leading-snug text-gray-700 ${detail ? 'text-base' : 'text-[13px] sm:text-sm'}`}>{display.unitPhrase}</span>
        {hasDiscount && <span className={`whitespace-nowrap font-medium text-gray-600 line-through ${detail ? 'text-lg' : 'text-sm'}`}>{formatPrice(compareAtPrice as number, currency)}</span>}
      </p>
      {reference && <p aria-hidden="true" className="mt-1 text-xs text-gray-500">{reference}</p>}
    </div>
  );
}
