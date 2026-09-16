import { packlinkAdapter } from './packlink';
import type { ShippingProviderAdapter } from './types';

const adapters: ReadonlyMap<string, ShippingProviderAdapter> = new Map([[packlinkAdapter.key, packlinkAdapter]]);
export function getShippingProvider(key: string | null | undefined): ShippingProviderAdapter | null {
  return key ? adapters.get(key) ?? null : null;
}
export function managedShippingProviderKeys(): string[] {
  return [...adapters.values()].filter(adapter => adapter.capabilities.providerReference).map(adapter => adapter.key);
}
/** Safe serializable metadata; client code must not import server adapters. */
export function managedShippingProviderInfo(key: string | null | undefined): { key: string; displayName: string } | null {
  const adapter = getShippingProvider(key);
  return adapter?.capabilities.providerReference ? { key: adapter.key, displayName: adapter.displayName } : null;
}
