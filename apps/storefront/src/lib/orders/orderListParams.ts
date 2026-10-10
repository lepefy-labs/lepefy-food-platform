import type { SupabaseClient } from '@supabase/supabase-js';
import { defineListParams, type ListParamValues, type RawSearchParams } from '@/lib/admin/listParams';
import { DAILY_DIGEST_DEFAULTS, dailyDigestModule } from '@/lib/notifications/dailyDigestConfig';
import { readModuleConfig } from '@/lib/tenantConfig/moduleConfig';
import { managedShippingProviderInfo } from '@/lib/shipping/providers/registry';
import { parseOrderSort, type OperationalThresholds, type OrderSortKey } from './adminOrderOperations';
import { ORDER_VIEWS, type OrderListFilters, type OrderView } from './loadOrderWorkQueue';

export const ORDER_STATUSES = ['new', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled', 'stock_conflict'] as const;
export const ORDER_PAYMENT_METHODS = ['stripe', 'external_link', 'satispay', 'in_store', 'cash', 'manual'] as const;

/** URL state of /admin (orders work queue) and of its CSV export. */
export const ORDER_LIST = defineListParams({
  view: { type: 'enum', values: ORDER_VIEWS.filter(Boolean) },
  status: { type: 'enum', values: ORDER_STATUSES },
  fulfillment: { type: 'enum', values: ['delivery', 'pickup'] },
  payment: { type: 'enum', values: ORDER_PAYMENT_METHODS },
  dateFrom: { type: 'date' },
  dateTo: { type: 'date' },
  q: { type: 'string', maxLength: 120 },
  // Parsed by parseOrderSort (keeps the legacy date_desc… values working).
  sort: { type: 'string', maxLength: 20 },
}, { pageSizes: [25, 50, 100], defaultPageSize: 50 });

export type OrderListValues = ListParamValues<typeof ORDER_LIST.spec>;

/** Same character set the work queue search has always accepted. */
export function sanitizeOrderSearch(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/[^a-zA-Z0-9À-ÿ@._\-# ]/g, '').slice(0, 60);
}

export function parseOrderList(raw: RawSearchParams): { values: OrderListValues; filters: OrderListFilters; sort: OrderSortKey } {
  const values = ORDER_LIST.parse(raw);
  const sort = parseOrderSort(values.sort);
  return {
    values: { ...values, sort: sort === 'priority' ? undefined : sort },
    sort,
    filters: {
      view: (values.view ?? '') as OrderView,
      status: values.status ?? '',
      fulfillment: values.fulfillment ?? '',
      payment: values.payment ?? '',
      dateFrom: values.dateFrom ?? '',
      dateTo: values.dateTo ?? '',
      search: sanitizeOrderSearch(values.q),
    },
  };
}

/** Thresholds of the daily digest (tenant module config) and managed shipping availability. */
export async function loadOrderOperationalContext(db: SupabaseClient, tenant: { id: string; shipping_provider?: string | null }) {
  const digest = await readModuleConfig(db, dailyDigestModule, tenant.id).catch(() => null);
  const config = digest?.status === 'ok' ? digest.config : DAILY_DIGEST_DEFAULTS;
  const thresholds: OperationalThresholds = {
    prepareHours: config.prepare_hours,
    pickupHours: config.pickup_hours,
    trackingStaleHours: config.tracking_stale_hours,
  };
  return { thresholds, managedProviderAvailable: Boolean(managedShippingProviderInfo(tenant.shipping_provider ?? null)) };
}
