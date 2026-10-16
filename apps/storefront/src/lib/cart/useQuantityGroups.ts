'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { PublicQuantityGroup } from '@/app/api/quantity-groups/route';
import { ERROR_COPY } from '@/lib/storefrontCopy/copy';
import { createQuantityGroupsStore, IDLE_QUANTITY_GROUPS, readQuantityGroupsResponse } from '@/lib/cart/quantityGroupsStore';

export interface QuantityGroupsLoadState {
  groups: PublicQuantityGroup[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// One shared entry per tenant (the deployment's tenant; the API resolves it
// server-side and the URL is same-origin, so another tenant never shares it).
const SCOPE = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'default';

const store = createQuantityGroupsStore({
  fetcher: () => fetch('/api/quantity-groups').then(readQuantityGroupsResponse),
  errorMessage: ERROR_COPY.quantityRulesUnavailable,
});

const subscribe = (listener: () => void) => store.subscribe(SCOPE, listener);
const getSnapshot = () => store.getSnapshot(SCOPE);
const getServerSnapshot = () => IDLE_QUANTITY_GROUPS;

/**
 * Never mistake "not loaded" or an API failure for an empty rule set.
 * The cart remains readable, but checkout buttons fail closed until verified.
 *
 * `enabled: false` reads the shared state without requesting it: components
 * that are mounted everywhere (cart drawer, Nala) load the rules only once
 * they are actually shown.
 */
export function useQuantityGroups({ enabled = true }: { enabled?: boolean } = {}): QuantityGroupsLoadState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (enabled) void store.ensure(SCOPE);
  }, [enabled]);

  const reload = useCallback(() => { void store.invalidate(SCOPE); }, []);

  return {
    groups: snapshot.groups,
    loading: snapshot.status === 'idle' || snapshot.status === 'loading',
    error: snapshot.error,
    reload,
  };
}
