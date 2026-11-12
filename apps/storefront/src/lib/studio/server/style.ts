import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudioStyleView } from '../domain';
import { DEFAULT_STUDIO_STYLE, parseStudioStyle } from '../style';

interface StyleRow { id: string; version: number; instructions: unknown; note: string | null; created_at: string }

function toView(row: StyleRow): StudioStyleView {
  const parsed = parseStudioStyle(row.instructions);
  return {
    id: row.id, version: row.version, note: row.note, createdAt: row.created_at,
    instructions: parsed ?? DEFAULT_STUDIO_STYLE,
    isDefault: !parsed,
  };
}

export async function activeStyle(db: SupabaseClient, tenantId: string): Promise<StudioStyleView | null> {
  const { data, error } = await db.from('studio_style_versions').select('id, version, instructions, note, created_at')
    .eq('tenant_id', tenantId).eq('status', 'active').maybeSingle();
  if (error) throw error;
  return data ? toView(data as StyleRow) : null;
}

/**
 * Active style, created as version 1 from the default (runbook) the first time
 * the shop uses the Studio. Two concurrent first uses: the loser re-reads.
 */
export async function ensureActiveStyle(db: SupabaseClient, tenantId: string, adminId: string | null): Promise<StudioStyleView> {
  const current = await activeStyle(db, tenantId);
  if (current) return current;
  const { error } = await db.rpc('studio_publish_style', {
    p_tenant_id: tenantId, p_instructions: DEFAULT_STUDIO_STYLE, p_note: 'Style par défaut Lepefy', p_admin_id: adminId, p_expected_version: 0,
  });
  if (error && !/studio_style_changed|duplicate/.test(error.message)) throw error;
  const created = await activeStyle(db, tenantId);
  if (!created) throw new Error('studio_style_changed');
  return created;
}

export async function styleById(db: SupabaseClient, tenantId: string, id: string): Promise<StudioStyleView | null> {
  const { data } = await db.from('studio_style_versions').select('id, version, instructions, note, created_at')
    .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  return data ? toView(data as StyleRow) : null;
}

export async function styleHistory(db: SupabaseClient, tenantId: string): Promise<StudioStyleView[]> {
  const { data } = await db.from('studio_style_versions').select('id, version, instructions, note, created_at')
    .eq('tenant_id', tenantId).order('version', { ascending: false }).limit(20);
  return ((data ?? []) as StyleRow[]).map(toView);
}
