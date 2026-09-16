import { packlinkShippingAdapter } from './packlink';
import type { ShippingIntegrationAdapter } from './types';

const ADAPTERS = new Map<string, ShippingIntegrationAdapter>([
  [packlinkShippingAdapter.key, packlinkShippingAdapter],
]);

export function getShippingIntegrationAdapter(provider: string | null | undefined) {
  if (!provider) return null;
  return ADAPTERS.get(provider.trim().toLowerCase()) ?? null;
}

export function hasShippingIntegrationAdapter(provider: string | null | undefined) {
  return getShippingIntegrationAdapter(provider) !== null;
}
