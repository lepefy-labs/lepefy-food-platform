export interface SplitPoolConfig {
  poolAmount: number | null;
  ambassadorPercent: number | null;
}

export interface SplitPoolAmounts {
  ambassadorAmount: number;
  referredDiscount: number;
}

/**
 * Funzione pura, riusata sia server-side (resolveCheckoutAmbassadorDiscount,
 * per il lato sconto dell'invitato — la stessa formula lato ambassador è
 * reimplementata in SQL in process_ambassador_commission_atomic, 051) sia
 * per il mini-esempio numerico live nel pannello admin
 * (AmbassadorConfigSection) — stessa formula in tutti i posti.
 */
export function calculateSplitPoolAmounts(config: SplitPoolConfig): SplitPoolAmounts {
  const { poolAmount, ambassadorPercent } = config;
  if (poolAmount == null || poolAmount <= 0 || ambassadorPercent == null) {
    return { ambassadorAmount: 0, referredDiscount: 0 };
  }

  const clampedPercent = Math.min(Math.max(ambassadorPercent, 0), 100);
  const ambassadorAmount = parseFloat((poolAmount * clampedPercent / 100).toFixed(2));
  const referredDiscount = parseFloat((poolAmount * (100 - clampedPercent) / 100).toFixed(2));

  return { ambassadorAmount, referredDiscount };
}
