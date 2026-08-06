/**
 * resolveCountryRule.ts
 *
 * Layer di regole commerciali per paese (shipping_country_rules), applicato
 * sopra il costo di spedizione già calcolato da Packlink o dal flat_rate del
 * tenant. Nessuna chiamata di rete qui — pure functions, chiamate da
 * /api/shipping/quote dopo aver caricato le regole dal DB.
 */

export interface ShippingCountryRule {
  countries:            string[];
  free_shipping_above:  number | null;
  flat_rate_override:   number | null;
  discount_type:        'percentage' | 'fixed' | null;
  discount_value:       number | null;
}

export function resolveCountryRule(
  country: string,
  rules: ShippingCountryRule[],
): ShippingCountryRule | null {
  const exact = rules.find(r => !r.countries.includes('*') && r.countries.includes(country));
  if (exact) return exact;
  return rules.find(r => r.countries.includes('*')) ?? null;
}

export function applyCountryRule(
  baseShippingCost: number,
  cartSubtotal: number,
  rule: ShippingCountryRule | null,
): {
  finalCost: number;
  originalCost: number;
  discountApplied: number;
  freeShippingApplied: boolean;
  ruleUsed: boolean;
} {
  if (!rule) {
    return { finalCost: baseShippingCost, originalCost: baseShippingCost, discountApplied: 0, freeShippingApplied: false, ruleUsed: false };
  }

  let cost = rule.flat_rate_override ?? baseShippingCost;
  const originalCost = cost;
  let discountApplied = 0;

  if (rule.discount_type && rule.discount_value) {
    discountApplied = rule.discount_type === 'percentage'
      ? cost * (rule.discount_value / 100)
      : rule.discount_value;
    cost = Math.max(0, cost - discountApplied);
  }

  let freeShippingApplied = false;
  if (rule.free_shipping_above !== null && cartSubtotal >= rule.free_shipping_above) {
    cost = 0;
    freeShippingApplied = true;
  }

  return {
    finalCost: parseFloat(cost.toFixed(2)),
    originalCost: parseFloat(originalCost.toFixed(2)),
    discountApplied: parseFloat(discountApplied.toFixed(2)),
    freeShippingApplied,
    ruleUsed: true,
  };
}
