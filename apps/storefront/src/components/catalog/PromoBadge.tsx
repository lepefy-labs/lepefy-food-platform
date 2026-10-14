import { IconFlame } from '@tabler/icons-react';
import { promotionDiscountPercent, type PromotionPriceFields } from '@/lib/catalog/promotions';

/**
 * Badge « Promo −14 % » : le mot « Promo » est toujours écrit, la couleur
 * n'est jamais la seule information. Rien n'est rendu sans promotion valide.
 */
export function PromoBadge({ product, className = '', size = 'md' }: {
  product: PromotionPriceFields;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const percent = promotionDiscountPercent(product);
  if (percent == null) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md bg-red-700 font-bold leading-tight text-white shadow-sm ${size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-xs sm:text-sm'} ${className}`}>
      <IconFlame size={size === 'sm' ? 12 : 14} aria-hidden="true" className="shrink-0" />
      Promo −{percent} %
    </span>
  );
}
