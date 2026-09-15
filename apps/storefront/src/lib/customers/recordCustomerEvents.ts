import { createServiceClient } from '@/lib/supabase/server';
import { CRM_ATTRIBUTION_WINDOW_DAYS } from '@/lib/admin/crm';

type CustomerEventType =
  | 'customer_created' | 'account_linked' | 'order_completed' | 'product_purchased'
  | 'category_purchased' | 'loyalty_points_earned' | 'loyalty_points_redeemed'
  | 'in_store_purchase' | 'event_reserved' | 'event_attended'
  | 'marketing_consent_granted' | 'marketing_consent_revoked';

export interface CustomerEventInput {
  tenantId: string;
  customerId: string;
  eventType: CustomerEventType;
  source: string;
  entityType?: string;
  entityId?: string | null;
  eventKey?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export async function recordCustomerEvents(events: CustomerEventInput[]): Promise<void> {
  if (events.length === 0) return;
  const { error } = await createServiceClient().from('customer_events').upsert(events.map((event) => ({
    tenant_id: event.tenantId,
    customer_id: event.customerId,
    event_type: event.eventType,
    source: event.source,
    entity_type: event.entityType ?? null,
    entity_id: event.entityId ?? null,
    event_key: event.eventKey ?? null,
    metadata: event.metadata ?? {},
    occurred_at: event.occurredAt ?? new Date().toISOString(),
  })), { onConflict: 'tenant_id,event_key', ignoreDuplicates: true });
  if (error) console.warn('[customer-events] append failed:', error.message);
}

export async function recordOrderCustomerEvents(input: {
  tenantId: string;
  customerId: string | null;
  orderId: string;
  total: number;
  source: string;
  items: Array<{ productId?: string | null; name: string; quantity: number; subtotal?: number }>;
}) {
  if (!input.customerId) return;
  await recordCustomerEvents([
    {
      tenantId: input.tenantId, customerId: input.customerId, eventType: 'order_completed',
      source: input.source, entityType: 'order', entityId: input.orderId,
      eventKey: `order_completed:${input.orderId}`, metadata: { total: input.total },
    },
    ...input.items.map((item, index) => ({
      tenantId: input.tenantId, customerId: input.customerId!, eventType: 'product_purchased' as const,
      source: input.source, entityType: 'product', entityId: item.productId ?? null,
      eventKey: `product_purchased:${input.orderId}:${item.productId ?? index}`,
      metadata: { order_id: input.orderId, name: item.name, quantity: item.quantity, subtotal: item.subtotal ?? null },
    })),
  ]);

  // Simple first-touch conversion attribution: most recent eligible campaign
  // delivery/click for the same customer inside the centralized window.
  const supabase = createServiceClient();
  const since = new Date(Date.now() - CRM_ATTRIBUTION_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: recipient } = await supabase.from('marketing_campaign_recipients')
    .select('id,campaign_id').eq('tenant_id', input.tenantId).eq('customer_id', input.customerId)
    .in('status', ['sent','delivered','opened','clicked']).gte('sent_at', since)
    .is('converted_at', null).order('clicked_at', { ascending: false, nullsFirst: false })
    .order('sent_at', { ascending: false }).limit(1).maybeSingle();
  if (recipient) {
    const convertedAt = new Date().toISOString();
    const { data: updated } = await supabase.from('marketing_campaign_recipients').update({
      status: 'converted', converted_at: convertedAt, conversion_order_id: input.orderId,
      conversion_revenue: input.total,
    }).eq('tenant_id', input.tenantId).eq('id', recipient.id).is('converted_at', null).select('id').maybeSingle();
    if (updated) await supabase.from('marketing_campaign_events').upsert({
      tenant_id: input.tenantId, campaign_id: recipient.campaign_id, recipient_id: recipient.id,
      event_type: 'converted', provider_event_id: `conversion:${input.orderId}`,
      metadata: { order_id: input.orderId, revenue: input.total, attribution_window_days: CRM_ATTRIBUTION_WINDOW_DAYS },
      occurred_at: convertedAt,
    }, { onConflict: 'tenant_id,provider_event_id', ignoreDuplicates: true });
  }
}
