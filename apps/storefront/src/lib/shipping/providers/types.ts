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

/** Provider-neutral draft request built from a Lepefy order; never contains secrets. */
export interface ProviderShipmentDraftInput {
  /** Deterministic Lepefy reference sent to the provider (e.g. LEPEFY-3F2A91C0). */
  orderReference: string;
  recipient: {
    firstName: string;
    lastName: string | null;
    street1: string;
    street2: string | null;
    postalCode: string;
    city: string;
    /** ISO 3166-1 alpha-2. */
    country: string;
    phone: string;
    email: string | null;
  };
  /** Weight in kg, dimensions in cm. */
  parcels: { weightKg: number; lengthCm: number; widthCm: number; heightCm: number }[];
  /** Short goods description (no personal data). */
  content: string;
  /** Declared goods value (order subtotal), never the customer shipping price. */
  contentValue: number;
  currency: string;
}

export interface ProviderShipmentDraftResult {
  provider: string;
  providerReference: string;
  providerStatus?: string | null;
  createdAt: string;
}

export interface ShippingProviderAdapter {
  key: string;
  displayName: string;
  capabilities: {
    providerReference: boolean;
    trackingTimeline: boolean;
    trackingUrl: boolean;
    webhooks: boolean;
    /** Can create an unpurchased shipment draft from a Lepefy order. */
    createDraft: boolean;
  };
  resolveShipment(context: ShippingProviderContext, providerReference: string): Promise<ProviderShipmentSnapshot>;
  /** Required when capabilities.createDraft; creates a draft only (never purchases). */
  createShipmentDraft?(context: ShippingProviderContext, input: ProviderShipmentDraftInput): Promise<ProviderShipmentDraftResult>;
}

export class ShippingProviderError extends Error {
  constructor(public readonly code: string) { super(code); }
}

/**
 * Classified draft-creation failures. `ambiguous_creation` and
 * `provider_timeout` mean the provider may have created the draft: never
 * retried automatically.
 */
export type ShipmentDraftErrorCode =
  | 'missing_configuration' | 'invalid_recipient' | 'invalid_parcel'
  | 'provider_timeout' | 'provider_unavailable' | 'provider_rejected'
  | 'invalid_provider_response' | 'ambiguous_creation';

export class ShipmentDraftError extends Error {
  constructor(public readonly code: ShipmentDraftErrorCode) { super(code); }
}
