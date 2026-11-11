import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SHOP_TIME_ZONE } from '@/lib/time/shopTime';
import { normalizeSalesStatistics, type SalesStatistics, type StatisticsQuery, type StatisticsRange } from './salesStatistics';

async function readRange(supabase: SupabaseClient, tenantId: string, range: StatisticsRange, bucket: StatisticsQuery['bucket']): Promise<SalesStatistics> {
  const { data, error } = await supabase.rpc('admin_sales_statistics', {
    p_tenant_id: tenantId,
    p_from: range.fromIso,
    p_to: range.toIso,
    p_bucket: bucket,
    p_time_zone: SHOP_TIME_ZONE,
  });
  if (error) throw new Error(`admin_sales_statistics: ${error.code ?? ''} ${error.message}`);
  return normalizeSalesStatistics(data);
}

/**
 * Current period and, when compared, the previous one: two aggregated RPC
 * calls (service role, tenant from the server). No order row reaches Node.
 */
export async function loadSalesStatistics(supabase: SupabaseClient, tenantId: string, query: StatisticsQuery): Promise<{ current: SalesStatistics; previous: SalesStatistics | null }> {
  const [current, previous] = await Promise.all([
    readRange(supabase, tenantId, query.range, query.bucket),
    query.compare ? readRange(supabase, tenantId, query.previous, query.bucket) : Promise.resolve(null),
  ]);
  return { current, previous };
}
