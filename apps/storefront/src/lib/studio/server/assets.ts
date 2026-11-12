import 'server-only';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminAccessContext } from '@/lib/auth/adminRbac';
import { canAdmin } from '@/lib/auth/adminRbac';
import { recordAuditEvent } from '@/lib/audit/recordAuditEvent';
import {
  STUDIO_LIMITS,
  type StudioAssetDetail,
  type StudioAssetStatus,
  type StudioAssetSummary,
  type StudioLibraryView,
  type StudioOrigin,
  type StudioQuotaView,
  type StudioRevisionStatus,
  type StudioUsageStatus,
} from '../domain';
import { destinationManageHref, studioDestination, type StudioDestinationKey } from '../destinations';
import { jobErrorMessage, quotaView, viewStatuses } from '../rules';
import { adoptUpload, signedUrls } from './storage';
import { ensureActiveStyle } from './style';

// ─── Quota ────────────────────────────────────────────────────────────────────

export async function studioQuota(db: SupabaseClient, tenantId: string): Promise<StudioQuotaView> {
  const { data } = await db.rpc('studio_usage_summary', { p_tenant_id: tenantId });
  return quotaView(((data ?? []) as Array<Record<string, number | string | null>>)[0] ?? null);
}

// ─── Creation ─────────────────────────────────────────────────────────────────

export interface CreateAssetInput {
  origin: StudioOrigin;
  title: string;
  request: string | null;
  uploadPath: string | null;
  requestKey: string;
}

export async function createStudioAsset(
  db: SupabaseClient, tenantId: string, access: AdminAccessContext, input: CreateAssetInput,
): Promise<{ assetId: string; jobId: string; created: boolean }> {
  const style = await ensureActiveStyle(db, tenantId, access.userId);
  let source: Awaited<ReturnType<typeof adoptUpload>> | null = null;

  // Replay of the same request: the upload was already adopted, nothing to redo.
  const findExisting = async () => (await db.from('studio_assets').select('id').eq('tenant_id', tenantId).eq('request_key', input.requestKey).maybeSingle()).data;
  let existing = await findExisting();
  if (!existing && input.origin === 'photo') {
    if (!input.uploadPath) throw new Error('studio_invalid_request');
    try {
      source = await adoptUpload(db, { tenantId, adminId: access.userId, uploadPath: input.uploadPath, key: input.requestKey });
    } catch (error) {
      // A concurrent identical request adopted the upload first: answer as its replay.
      existing = await findExisting();
      if (!existing) throw error;
    }
  }

  const call = () => db.rpc('studio_create_asset', {
    p_tenant_id: tenantId, p_origin: input.origin, p_title: input.title, p_request_text: input.request,
    p_source_path: source?.path ?? (existing ? `tenants/${tenantId}/assets/${input.requestKey}/source.jpg` : null),
    p_source_mime: source ? 'image/jpeg' : null, p_source_width: source?.width ?? null, p_source_height: source?.height ?? null,
    p_source_bytes: source?.bytes.byteLength ?? null, p_style_version_id: style.id, p_admin_id: access.userId, p_request_key: input.requestKey,
  });
  let { data, error } = await call();
  // Two identical requests raced past the replay check: the loser hits the unique key, then replays.
  if (error?.code === '23505') ({ data, error } = await call());
  if (error) throw error;
  const row = ((data ?? []) as Array<{ out_asset_id: string; out_job_id: string; out_created: boolean }>)[0];
  if (!row) throw new Error('studio_invalid_request');
  if (row.out_created) {
    await recordAuditEvent({
      tenantId, eventType: 'studio.asset.created', actor: access, resourceType: 'studio_asset', resourceId: row.out_asset_id,
      resourceLabel: input.title, metadata: { origin: input.origin, style_version: style.version }, eventKey: 'studio-created:' + row.out_asset_id,
    });
  }
  return { assetId: row.out_asset_id, jobId: row.out_job_id, created: row.out_created };
}

export async function requestCorrection(
  db: SupabaseClient, tenantId: string, access: AdminAccessContext,
  input: { assetId: string; baseRevisionId: string; request: string; requestKey: string },
): Promise<{ jobId: string }> {
  const style = await ensureActiveStyle(db, tenantId, access.userId);
  const call = () => db.rpc('studio_request_correction', {
    p_tenant_id: tenantId, p_asset_id: input.assetId, p_base_revision_id: input.baseRevisionId, p_request_text: input.request,
    p_style_version_id: style.id, p_admin_id: access.userId, p_request_key: input.requestKey,
  });
  let { data, error } = await call();
  if (error?.code === '23505') ({ data, error } = await call());
  if (error) throw error;
  const row = ((data ?? []) as Array<{ out_job_id: string }>)[0];
  if (!row) throw new Error('studio_invalid_request');
  return { jobId: row.out_job_id };
}

export async function retryRevision(db: SupabaseClient, tenantId: string, revisionId: string): Promise<{ jobId: string }> {
  const { data, error } = await db.rpc('studio_retry_revision', { p_tenant_id: tenantId, p_revision_id: revisionId });
  if (error) throw error;
  return { jobId: String(data) };
}

export async function decideAsset(
  db: SupabaseClient, tenantId: string, access: AdminAccessContext,
  input: { assetId: string; action: 'approve' | 'discard' | 'archive' | 'restore' | 'rename'; revisionId?: string | null; title?: string | null },
): Promise<StudioAssetStatus> {
  const { data, error } = await db.rpc('studio_decide_asset', {
    p_tenant_id: tenantId, p_asset_id: input.assetId, p_action: input.action, p_revision_id: input.revisionId ?? null, p_title: input.title ?? null,
  });
  if (error) throw error;
  if (input.action === 'approve' || input.action === 'discard') {
    await recordAuditEvent({
      tenantId, eventType: input.action === 'approve' ? 'studio.asset.approved' : 'studio.asset.discarded', actor: access,
      resourceType: 'studio_asset', resourceId: input.assetId, metadata: input.revisionId ? { revision_id: input.revisionId } : {},
    });
  }
  return data as StudioAssetStatus;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

interface AssetRow {
  id: string; title: string; origin: StudioOrigin; status: StudioAssetStatus; ambiance_only: boolean; request_text: string | null;
  source_path: string | null; source_width: number | null; source_height: number | null; approved_revision_id: string | null;
  created_at: string; updated_at: string;
}
interface RevisionRow {
  id: string; asset_id: string; revision_no: number; status: StudioRevisionStatus; request_text: string | null; storage_path: string | null;
  width: number | null; height: number | null; style_version: number; provider: string | null; model: string | null;
  error_code: string | null; created_at: string; completed_at: string | null;
}

export async function activeUsageCounts(db: SupabaseClient, tenantId: string, assetIds?: string[]): Promise<Map<string, number>> {
  let query = db.from('studio_usages').select('asset_id').eq('tenant_id', tenantId).in('status', ['active', 'publishing']).limit(5000);
  if (assetIds) query = query.in('asset_id', assetIds.length ? assetIds : ['00000000-0000-0000-0000-000000000000']);
  const { data } = await query;
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ asset_id: string }>) counts.set(row.asset_id, (counts.get(row.asset_id) ?? 0) + 1);
  return counts;
}

export async function listStudioAssets(
  db: SupabaseClient, tenantId: string, params: { view: StudioLibraryView; q?: string; page: number },
): Promise<{ items: StudioAssetSummary[]; total: number; page: number; counts: Record<'review' | 'processing', number> }> {
  const size = STUDIO_LIMITS.pageSize;
  let query = db.from('studio_assets')
    .select('id, title, origin, status, ambiance_only, approved_revision_id, created_at, updated_at', { count: 'exact' })
    .eq('tenant_id', tenantId).is('purged_at', null).in('status', viewStatuses(params.view));
  if (params.view === 'pretes' || params.view === 'utilisees') {
    const used = [...(await activeUsageCounts(db, tenantId)).keys()];
    if (params.view === 'utilisees') query = query.in('id', used.length ? used : ['00000000-0000-0000-0000-000000000000']);
    else if (used.length) query = query.not('id', 'in', `(${used.join(',')})`);
  }
  if (params.q) query = query.ilike('title', `%${params.q.replace(/[%_\\]/g, (c) => '\\' + c)}%`);
  const from = Math.max(0, (params.page - 1) * size);
  const { data, count, error } = await query.order('updated_at', { ascending: false }).range(from, from + size - 1);
  if (error) throw error;
  const rows = (data ?? []) as Array<Pick<AssetRow, 'id' | 'title' | 'origin' | 'status' | 'ambiance_only' | 'approved_revision_id' | 'created_at' | 'updated_at'>>;
  const ids = rows.map((row) => row.id);

  const [{ data: revisions }, usageCounts, review, processing] = await Promise.all([
    ids.length
      ? db.from('studio_revisions').select('id, asset_id, revision_no, storage_path').eq('tenant_id', tenantId).in('asset_id', ids).eq('status', 'succeeded')
      : Promise.resolve({ data: [] }),
    activeUsageCounts(db, tenantId, ids),
    db.from('studio_assets').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('purged_at', null).eq('status', 'review'),
    db.from('studio_assets').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('purged_at', null).in('status', ['processing', 'failed']),
  ]);
  const thumbPath = new Map<string, string>();
  const byAsset = new Map<string, Array<{ id: string; revision_no: number; storage_path: string | null }>>();
  for (const rev of (revisions ?? []) as Array<{ id: string; asset_id: string; revision_no: number; storage_path: string | null }>) {
    byAsset.set(rev.asset_id, [...(byAsset.get(rev.asset_id) ?? []), rev]);
  }
  for (const row of rows) {
    const list = byAsset.get(row.id) ?? [];
    const chosen = list.find((rev) => rev.id === row.approved_revision_id) ?? list.sort((a, b) => b.revision_no - a.revision_no)[0];
    if (chosen?.storage_path) thumbPath.set(row.id, chosen.storage_path);
  }
  const urls = await signedUrls(db, [...thumbPath.values()]);
  return {
    items: rows.map((row) => ({
      id: row.id, title: row.title, origin: row.origin, status: row.status, ambianceOnly: row.ambiance_only,
      activeUsages: usageCounts.get(row.id) ?? 0, thumbnailUrl: urls.get(thumbPath.get(row.id) ?? '') ?? null,
      updatedAt: row.updated_at, createdAt: row.created_at,
    })),
    total: count ?? 0,
    page: params.page,
    counts: { review: review.count ?? 0, processing: processing.count ?? 0 },
  };
}

export async function getStudioAsset(db: SupabaseClient, tenantId: string, assetId: string, access: AdminAccessContext): Promise<StudioAssetDetail | null> {
  const { data: asset } = await db.from('studio_assets')
    .select('id, title, origin, status, ambiance_only, request_text, source_path, source_width, source_height, approved_revision_id, created_at, updated_at')
    .eq('tenant_id', tenantId).eq('id', assetId).is('purged_at', null).maybeSingle();
  if (!asset) return null;
  const row = asset as AssetRow;
  const [{ data: revisions }, { data: usages }, { data: jobs }] = await Promise.all([
    db.from('studio_revisions')
      .select('id, asset_id, revision_no, status, request_text, storage_path, width, height, style_version, provider, model, error_code, created_at, completed_at')
      .eq('tenant_id', tenantId).eq('asset_id', assetId).order('revision_no', { ascending: true }),
    db.from('studio_usages').select('id, destination_key, target_id, target_label, status, public_url, created_at, removed_at')
      .eq('tenant_id', tenantId).eq('asset_id', assetId).in('status', ['active', 'publishing', 'removed']).order('created_at', { ascending: false }).limit(50),
    db.from('studio_jobs').select('id').eq('tenant_id', tenantId).eq('asset_id', assetId).in('status', ['queued', 'running']).limit(1),
  ]);
  const revisionRows = (revisions ?? []) as RevisionRow[];
  const urls = await signedUrls(db, [row.source_path ?? '', ...revisionRows.map((rev) => rev.storage_path ?? '')]);
  return {
    id: row.id, title: row.title, origin: row.origin, status: row.status, ambianceOnly: row.ambiance_only, requestText: row.request_text,
    sourceUrl: row.source_path ? urls.get(row.source_path) ?? null : null, sourceWidth: row.source_width, sourceHeight: row.source_height,
    approvedRevisionId: row.approved_revision_id,
    revisions: revisionRows.map((rev) => ({
      id: rev.id, revisionNo: rev.revision_no, status: rev.status, requestText: rev.request_text,
      imageUrl: rev.storage_path ? urls.get(rev.storage_path) ?? null : null, width: rev.width, height: rev.height,
      styleVersion: rev.style_version, provider: rev.provider, model: rev.model, errorCode: rev.error_code,
      errorMessage: rev.status === 'failed' ? jobErrorMessage(rev.error_code) : null, createdAt: rev.created_at, completedAt: rev.completed_at,
    })),
    usages: ((usages ?? []) as Array<{ id: string; destination_key: string; target_id: string; target_label: string | null; status: StudioUsageStatus; public_url: string | null; created_at: string; removed_at: string | null }>)
      .map((usage) => {
        const destination = studioDestination(usage.destination_key);
        return {
          id: usage.id, destinationKey: usage.destination_key, destinationLabel: destination?.label ?? usage.destination_key,
          targetId: usage.target_id, targetLabel: usage.target_label, status: usage.status, publicUrl: usage.public_url,
          manageHref: destination ? destinationManageHref(destination.key as StudioDestinationKey, usage.target_id) : null,
          createdAt: usage.created_at, removedAt: usage.removed_at,
          canRemove: usage.status === 'active' && Boolean(destination) && canAdmin(access, destination!.permission),
        };
      }),
    busy: (jobs ?? []).length > 0,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export const newRequestKey = () => randomUUID().replace(/-/g, '');
