export function calculateCartTotal(subtotal: number, shippingCost: number | null): number {
  return subtotal + (shippingCost ?? 0);
}

export function canProceedToCheckout(
  itemCount: number,
  fulfillmentType: 'delivery' | 'pickup',
  shippingCost: number | null,
): boolean {
  return itemCount > 0 && (fulfillmentType === 'pickup' || shippingCost !== null);
}

export function shouldShowMobileCartStickyCta(itemCount: number): boolean {
  return itemCount > 0;
}
