'use client';

import { createContext, useContext } from 'react';

const ProductImageDeliveryContext = createContext(false);

export function ProductImageDeliveryProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <ProductImageDeliveryContext.Provider value={enabled}>{children}</ProductImageDeliveryContext.Provider>;
}

export function useProductImageDelivery() {
  return useContext(ProductImageDeliveryContext);
}
