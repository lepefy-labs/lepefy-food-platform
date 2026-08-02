import type { AmbassadorDiscountType } from '@lepefy/types';

export interface AmbassadorDiscountConfig {
  minPurchaseAmount: number;
  discountType: AmbassadorDiscountType | null;
  discountValue: number | null;
}

/**
 * Funzione pura, riusata sia server-side (POST /api/checkout, fonte di
 * verità per l'importo effettivamente addebitato) sia per il mini-esempio
 * numerico live nel pannello admin (AmbassadorConfigSection) — stessa
 * formula in entrambi i posti, nessun rischio di drift tra anteprima e
 * importo reale.
 */
export function calculateAmbassadorDiscount(subtotal: number, config: AmbassadorDiscountConfig): number {
  if (!config.discountType || config.discountValue == null || config.discountValue <= 0) return 0;
  if (subtotal < config.minPurchaseAmount) return 0;

  const raw = config.discountType === 'PERCENT'
    ? subtotal * (config.discountValue / 100)
    : config.discountValue;

  const capped = Math.min(Math.max(raw, 0), subtotal);
  return parseFloat(capped.toFixed(2));
}
