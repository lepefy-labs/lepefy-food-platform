export type ShippingIntegrationState =
  | 'pending'
  | 'ready'
  | 'in_transit'
  | 'delivered'
  | 'exception'
  | 'unknown';

export interface ShippingTrackingEvent {
  timestamp: number | null;
  description: string;
  statusCode: string;
}

export interface ShippingIntegrationSnapshot {
  provider: string;
  reference: string;
  state: ShippingIntegrationState;
  providerStatus: string | null;
  carrier: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  estimatedDeliveryDate: string | null;
  labelUrls: string[];
  events: ShippingTrackingEvent[];
  syncedAt: string;
  syncBlockedReason?: string | null;
}

export interface ShippingProviderContext {
  tenantId: string;
  provider: string;
  packlinkApiKey?: string | null;
}

export interface ShippingIntegrationAdapter {
  key: string;
  fetchShipment(
    reference: string,
    context: ShippingProviderContext,
  ): Promise<ShippingIntegrationSnapshot>;
}

export interface ShippingDetailsWithIntegration extends Record<string, unknown> {
  integration?: ShippingIntegrationSnapshot;
}
