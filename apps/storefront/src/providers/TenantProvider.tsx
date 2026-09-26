'use client';

import { createContext, useContext } from 'react';
import type { PublicTenant } from '@lepefy/types';

// Only the public projection (toPublicTenant) is ever serialized to the client.
const TenantContext = createContext<PublicTenant | null>(null);

export function TenantProvider({ tenant, children }: { tenant: PublicTenant; children: React.ReactNode }) {
  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>;
}

export function useOptionalTenant(): PublicTenant | null {
  return useContext(TenantContext);
}

export function useTenant(): PublicTenant {
  const tenant = useOptionalTenant();
  if (!tenant) throw new Error('useTenant must be used within a TenantProvider');
  return tenant;
}
