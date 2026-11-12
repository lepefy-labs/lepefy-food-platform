import 'server-only';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tenant } from '@lepefy/types';
import { canAdmin, type AdminAccessContext } from '@/lib/auth/adminRbac';
import { recordAuditEvent } from '@/lib/audit/recordAuditEvent';
import type { StudioCrop } from '../domain';
import { studioDestination, type StudioDestinationDefinition, type StudioDestinationKey } from '../destinations';
import { aspectValue, cropToPixels, sanitizeCrop } from '../rules';
import { downloadPrivate } from './storage';
import { removePublic, STUDIO_DESTINATION_IMPLS, verifyPublicCopy, type StoredCopy } from './destinations';

/**
 * Promotion of an approved image to a destination:
 *   reserve usage (idempotent) → copy into the slot's public folder → verify
 *   the copy → compare-and-set the slot reference → finish usage.
 * Any failure before the reference update removes the copy: nothing public
 * exists for a usage that did not complete. Previously published images are
 * never reprocessed.
 */

class StudioError extends Error {}
const fail = (code: string): never => { throw new StudioError(code); };

export function destinationFor(access: AdminAccessContext, tenant: Tenant, key: string): StudioDestinationDefinition {
  const destination = studioDestination(key) ?? fail('studio_unknown_destination');
  if (destination.events && !tenant.events_enabled) fail('studio_events_disabled');
  if (!canAdmin(access, destination.permission)) fail('studio_forbidden_destination');
  return destination;
}

/** Destinations the admin may use (registry ∩ permissions ∩ modules). */
export function availableDestinations(access: AdminAccessContext, tenant: Tenant): StudioDestinationDefinition[] {
  return ([] as StudioDestinationDefinition[]).concat(
    ...(['product', 'hero_slide', 'category', 'story', 'card_hero', 'event_banner', 'service_cover', 'rental_item', 'event_gallery'] as StudioDestinationKey[])
      .map((key) => studioDestination(key))
      .filter((d): d is StudioDestinationDefinition => Boolean(d) && (!d!.events || tenant.events_enabled) && canAdmin(access, d!.permission)),
  );
}

/** Image bytes ready for the slot: crop to its format, at most its edge, WebP. */
export async function prepareForDestination(
  source: Buffer, destination: StudioDestinationDefinition, crop: StudioCrop | null,
): Promise<{ bytes: Buffer; width: number; height: number; crop: StudioCrop }> {
  const image = sharp(source, { failOn: 'error' }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const ratio = aspectValue(destination.aspect);
  const safeCrop = sanitizeCrop(crop, width, height, ratio);
  const rect = cropToPixels(safeCrop, width, height);
  if (rect.width < destination.minWidth && width >= destination.minWidth) fail('studio_image_too_small');
  const { data, info } = await image.extract(rect)
    .resize(destination.maxEdge, destination.maxEdge, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  if (info.width < Math.min(destination.minWidth, 320)) fail('studio_image_too_small');
  return { bytes: data, width: info.width, height: info.height, crop: safeCrop };
}

export interface PublishInput {
  assetId: string;
  destinationKey: string;
  targetId: string;
  crop: StudioCrop | null;
  asCover: boolean;
  confirmAmbiance: boolean;
  requestKey: string;
}

export async function publishStudioImage(
  db: SupabaseClient, tenant: Tenant, access: AdminAccessContext, input: PublishInput,
): Promise<{ usageId: string; publicUrl: string; replay: boolean }> {
  const destination = destinationFor(access, tenant, input.destinationKey);
  const impl = STUDIO_DESTINATION_IMPLS[destination.key];

  const { data: asset } = await db.from('studio_assets').select('id, title, status, ambiance_only, approved_revision_id')
    .eq('tenant_id', tenant.id).eq('id', input.assetId).is('purged_at', null).maybeSingle();
  if (!asset) fail('studio_not_found');
  if (asset!.ambiance_only && destination.confirmAmbiance && !input.confirmAmbiance) fail('studio_ambiance_confirmation');
  const target = await impl.target(db, tenant, input.targetId);
  if (!target) fail('studio_target_missing');

  const { data: begun, error: beginError } = await db.rpc('studio_begin_usage', {
    p_tenant_id: tenant.id, p_asset_id: input.assetId, p_destination_key: destination.key, p_target_id: input.targetId,
    p_target_label: target!.label, p_crop: input.crop, p_admin_id: access.userId, p_request_key: input.requestKey,
  });
  if (beginError) throw beginError;
  const usage = ((begun ?? []) as Array<{ out_usage_id: string; out_revision_id: string; out_status: string; out_created: boolean }>)[0];
  if (!usage) fail('studio_publish_failed');
  if (usage!.out_status === 'active') {
    const { data: done } = await db.from('studio_usages').select('public_url').eq('id', usage!.out_usage_id).maybeSingle();
    return { usageId: usage!.out_usage_id, publicUrl: done?.public_url ?? '', replay: true };
  }
  if (usage!.out_status !== 'publishing') fail('studio_publish_failed');

  const { data: revision } = await db.from('studio_revisions').select('storage_path')
    .eq('tenant_id', tenant.id).eq('id', usage!.out_revision_id).maybeSingle();
  let copy: StoredCopy | null = null;
  let aborted = false;
  const abort = async (code: string): Promise<never> => {
    aborted = true;
    if (copy) await removePublic(db, copy.paths).catch(() => undefined);
    await db.rpc('studio_finish_usage', { p_tenant_id: tenant.id, p_usage_id: usage!.out_usage_id, p_success: false, p_public_url: null, p_storage_paths: [] });
    return fail(code);
  };

  try {
    if (!revision?.storage_path) return await abort('studio_publish_failed');
    const prepared = await prepareForDestination(await downloadPrivate(db, revision.storage_path), destination, input.crop);
    copy = await impl.store(db, tenant, input.targetId, prepared.bytes);
    if (!(await verifyPublicCopy(db, copy.paths))) return await abort('studio_publish_failed');
    const outcome = await impl.attach(db, tenant, input.targetId, copy, { asCover: input.asCover });
    if (outcome === 'conflict') return await abort('studio_target_conflict');
    if (outcome === 'full') return await abort('studio_gallery_full');
    if (outcome === 'missing') return await abort('studio_target_missing');
  } catch (error) {
    if (aborted) throw error;
    if (error instanceof StudioError) return await abort(error.message);
    console.error('[studio] publish failed', { tenant: tenant.id, destination: destination.key, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return await abort('studio_publish_failed');
  }

  const { error: finishError } = await db.rpc('studio_finish_usage', {
    p_tenant_id: tenant.id, p_usage_id: usage!.out_usage_id, p_success: true, p_public_url: copy!.publicUrl, p_storage_paths: copy!.paths,
  });
  if (finishError) console.error('[studio] usage not finalised (slot already updated):', finishError.code);

  // A replaced slot: the previous Studio image there is no longer used.
  if (destination.mode === 'replace') await retireReplacedUsages(db, tenant, access, destination.key, input.targetId, usage!.out_usage_id);
  await impl.revalidate(db, tenant, input.targetId);
  await recordAuditEvent({
    tenantId: tenant.id, eventType: 'studio.usage.published', actor: access, resourceType: 'studio_asset', resourceId: input.assetId,
    resourceLabel: asset!.title, metadata: { destination: destination.key, target_id: input.targetId, target: target!.label },
    eventKey: 'studio-usage:' + usage!.out_usage_id,
  });
  return { usageId: usage!.out_usage_id, publicUrl: copy!.publicUrl, replay: false };
}

async function retireReplacedUsages(db: SupabaseClient, tenant: Tenant, access: AdminAccessContext, key: StudioDestinationKey, targetId: string, keepId: string) {
  const { data } = await db.from('studio_usages').select('id').eq('tenant_id', tenant.id).eq('destination_key', key)
    .eq('target_id', targetId).eq('status', 'active').neq('id', keepId);
  for (const row of (data ?? []) as Array<{ id: string }>) {
    const { data: ended } = await db.rpc('studio_end_usage', { p_tenant_id: tenant.id, p_usage_id: row.id, p_reason: 'replaced', p_admin_id: access.userId });
    const result = ((ended ?? []) as Array<{ out_storage_paths: string[]; out_changed: boolean }>)[0];
    if (result?.out_changed && STUDIO_DESTINATION_IMPLS[key].deleteCopy) await removePublic(db, result.out_storage_paths).catch(() => undefined);
  }
}

export async function removeStudioUsage(
  db: SupabaseClient, tenant: Tenant, access: AdminAccessContext, usageId: string,
): Promise<{ detached: boolean }> {
  const { data: usage } = await db.from('studio_usages').select('id, asset_id, destination_key, target_id, target_label, status, public_url')
    .eq('tenant_id', tenant.id).eq('id', usageId).maybeSingle();
  if (!usage) fail('studio_not_found');
  if (usage!.status !== 'active') return { detached: false };
  const destination = destinationFor(access, tenant, usage!.destination_key);
  const impl = STUDIO_DESTINATION_IMPLS[destination.key];
  const detached = usage!.public_url ? await impl.detach(db, tenant, usage!.target_id, usage!.public_url) : false;
  const { data: ended, error } = await db.rpc('studio_end_usage', {
    p_tenant_id: tenant.id, p_usage_id: usageId, p_reason: detached ? 'removed' : 'target_changed', p_admin_id: access.userId,
  });
  if (error) throw error;
  const result = ((ended ?? []) as Array<{ out_storage_paths: string[]; out_changed: boolean }>)[0];
  // The copy belonged to this slot only: once detached nothing else points to it.
  if (result?.out_changed && impl.deleteCopy) await removePublic(db, result.out_storage_paths).catch(() => undefined);
  await impl.revalidate(db, tenant, usage!.target_id);
  await recordAuditEvent({
    tenantId: tenant.id, eventType: 'studio.usage.removed', actor: access, resourceType: 'studio_asset', resourceId: usage!.asset_id,
    metadata: { destination: destination.key, target_id: usage!.target_id, target: usage!.target_label, detached },
  });
  return { detached };
}

export { StudioError };
