import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { removePrivate, removeStaleUploads } from './storage';

/**
 * Removes the private files of drafts nobody used (never approved or
 * discarded, idle past the tenant retention; discarded after 7 days), then
 * marks the row purged. Rows are kept: history, costs and quotas stay exact.
 * Published copies are never touched here.
 */
export async function cleanupStudioDrafts(limit = 50): Promise<{ purged: number; uploads: number }> {
  const db = createServiceClient();
  const { data, error } = await db.rpc('studio_cleanup_candidates', { p_limit: limit });
  if (error) {
    console.error('[studio] cleanup candidates failed:', error.code);
    return { purged: 0, uploads: 0 };
  }
  let purged = 0;
  const tenants = new Set<string>();
  for (const row of (data ?? []) as Array<{ out_tenant_id: string; out_asset_id: string; out_paths: string[] }>) {
    tenants.add(row.out_tenant_id);
    try {
      await removePrivate(db, row.out_paths ?? []);
      const { data: marked } = await db.rpc('studio_mark_purged', { p_tenant_id: row.out_tenant_id, p_asset_id: row.out_asset_id });
      if (marked) purged += 1;
    } catch {
      console.warn('[studio] draft not purged', row.out_asset_id);
    }
  }
  // Raw uploads of tenants that used the Studio recently (abandoned before « Créer »).
  const { data: active } = await db.from('studio_assets').select('tenant_id').gte('created_at', new Date(Date.now() - 7 * 86400_000).toISOString()).limit(500);
  for (const row of (active ?? []) as Array<{ tenant_id: string }>) tenants.add(row.tenant_id);
  let uploads = 0;
  for (const tenantId of tenants) uploads += await removeStaleUploads(db, tenantId).catch(() => 0);
  return { purged, uploads };
}
