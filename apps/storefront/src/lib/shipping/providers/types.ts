import type { NormalizedShipmentStatus, ShipmentTrackingEvent } from '@lepefy/types';

export type { NormalizedShipmentStatus, ShipmentTrackingEvent };

/** Server-only context; never pass this object to client components. */
export interface ShippingProviderContext {
  tenantId: string;
  /** Tenant-owned server configuration; adapter alone interprets its credentials. */
  tenant: Readonly<Record<string, unknown>>;
}

export interface ProviderShipmentSnapshot {
  provider: string;
  providerReference: string;
  carrier: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  estimatedDeliveryAt: string | null;
  providerStatus: string | null;
  normalizedStatus: NormalizedShipmentStatus;
  events: ShipmentTrackingEvent[];
}

export interface ShippingProviderAdapter {
  key: string;
  displayName: string;
  capabilities: {
    providerReference: boolean;
    trackingTimeline: boolean;
    trackingUrl: boolean;
    webhooks: boolean;
  };
  resolveShipment(context: ShippingProviderContext, providerReference: string): Promise<ProviderShipmentSnapshot>;
}

export class ShippingProviderError extends Error {
  constructor(public readonly code: string) { super(code); }
}
