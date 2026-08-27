'use client';

import { createContext, useContext } from 'react';
import type { Tenant } from '@lepefy/types';

const TenantContext = createContext<Tenant | null>(null);

export function TenantProvider({ tenant, children }: { tenant: Tenant; children: React.ReactNode }) {
  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>;
}

export function useOptionalTenant(): Tenant | null {
  return useContext(TenantContext);
}

export function useTenant(): Tenant {
  const tenant = useOptionalTenant();
  if (!tenant) throw new Error('useTenant must be used within a TenantProvider');
  return tenant;
}
