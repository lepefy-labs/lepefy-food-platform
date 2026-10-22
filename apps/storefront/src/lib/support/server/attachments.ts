import 'server-only';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { SUPPORT_ATTACHMENTS_BUCKET, SUPPORT_LIMITS } from '../domain';
import { checkSupportImage, SUPPORT_IMAGE_EXTENSION } from '../files';
import { isUuid } from '../rules';

/**
 * Screenshots: private bucket `support-attachments` (no storage policy), path
 * `<tenant>/<uuid>.<ext>`. An upload is « staged » (no message yet) until the
 * message that carries it is saved by the 163 RPC, which only accepts the
 * uploader's own files of the same tenant from the last 24 h.
 */

const SIGNED_URL_SECONDS = 60;

export async function uploadSupportAttachment(input: {
  tenantId: string;
  adminId: string;
  uploaderType: 'tenant' | 'lepefy';
  file: FormDataEntryValue | null;
}): Promise<NextResponse> {
  const { file } = input;
  if (!(file instanceof File)) return NextResponse.json({ error: 'Aucune image reçue.' }, { status: 400 });
  if (file.size > SUPPORT_LIMITS.attachmentBytes) return NextResponse.json({ error: 'Image trop lourde : 5 Mo au maximum.' }, { status: 413 });

  const db = createServiceClient();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await db.from('support_attachments').select('id', { count: 'exact', head: true })
    .eq('uploaded_by_admin_id', input.adminId).gte('created_at', since);
  if (countError) {
    console.error('[support] upload quota unavailable:', countError.code);
    return NextResponse.json({ error: 'Envoi de l’image impossible pour le moment.' }, { status: 503 });
  }
  if ((count ?? 0) >= SUPPORT_LIMITS.uploadsPerHour) {
    return NextResponse.json({ error: 'Beaucoup d’images en peu de temps : réessayez dans quelques minutes.' }, { status: 429 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkSupportImage(bytes);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const storagePath = `${input.tenantId}/${randomUUID()}.${SUPPORT_IMAGE_EXTENSION[check.mime]}`;
  const { error: uploadError } = await db.storage.from(SUPPORT_ATTACHMENTS_BUCKET)
    .upload(storagePath, bytes, { contentType: check.mime, upsert: false, cacheControl: '3600' });
  if (uploadError) {
    console.error('[support] upload failed:', uploadError.message.slice(0, 120));
    return NextResponse.json({ error: 'Envoi de l’image impossible. Réessayez.' }, { status: 502 });
  }
  const { data, error } = await db.from('support_attachments').insert({
    tenant_id: input.tenantId,
    uploaded_by_admin_id: input.adminId,
    uploader_type: input.uploaderType,
    storage_path: storagePath,
    mime_type: check.mime,
    size_bytes: bytes.byteLength,
    width: check.width,
    height: check.height,
  }).select('id, mime_type, width, height').single();
  if (error || !data) {
    await db.storage.from(SUPPORT_ATTACHMENTS_BUCKET).remove([storagePath]);
    console.error('[support] attachment row failed:', error?.code);
    return NextResponse.json({ error: 'Envoi de l’image impossible. Réessayez.' }, { status: 500 });
  }
  return NextResponse.json({ attachment: data }, { status: 201 });
}

/** Removes an upload that was never sent (the uploader's own, same tenant). */
export async function deleteStagedAttachment(tenantId: string, adminId: string, attachmentId: string): Promise<NextResponse> {
  if (!isUuid(attachmentId)) return NextResponse.json({ error: 'Image introuvable.' }, { status: 404 });
  const db = createServiceClient();
  const { data, error } = await db.from('support_attachments').delete()
    .eq('id', attachmentId).eq('tenant_id', tenantId).eq('uploaded_by_admin_id', adminId).is('message_id', null)
    .select('storage_path');
  if (error) return NextResponse.json({ error: 'Suppression impossible.' }, { status: 500 });
  const paths = ((data ?? []) as Array<{ storage_path: string }>).map((row) => row.storage_path);
  if (paths.length) await db.storage.from(SUPPORT_ATTACHMENTS_BUCKET).remove(paths);
  return NextResponse.json({ ok: true });
}

/**
 * Redirect to a 60 s signed URL after the caller's checks. `scope` decides
 * what may be read: the shop only its own tenant's non-internal files of a
 * visible request (or its own staged uploads); Lepefy every file.
 */
export async function attachmentRedirect(
  attachmentId: string,
  scope: { kind: 'tenant'; tenantId: string; adminId: string } | { kind: 'lepefy'; adminId: string },
): Promise<Response> {
  const notFound = NextResponse.json({ error: 'Image introuvable.' }, { status: 404 });
  if (!isUuid(attachmentId)) return notFound;
  const db = createServiceClient();
  const { data } = await db.from('support_attachments')
    .select('id, tenant_id, ticket_id, message_id, internal, storage_path, uploaded_by_admin_id')
    .eq('id', attachmentId).maybeSingle();
  const row = data as { tenant_id: string; ticket_id: string | null; message_id: string | null; internal: boolean; storage_path: string; uploaded_by_admin_id: string | null } | null;
  if (!row) return notFound;
  if (scope.kind === 'tenant') {
    if (row.tenant_id !== scope.tenantId || row.internal) return notFound;
    if (!row.message_id) {
      if (row.uploaded_by_admin_id !== scope.adminId) return notFound;
    } else {
      const { data: ticket } = await db.from('support_tickets').select('id')
        .eq('id', row.ticket_id!).eq('tenant_id', scope.tenantId).eq('visible_to_tenant', true).maybeSingle();
      if (!ticket) return notFound;
    }
  }
  const { data: signed, error } = await db.storage.from(SUPPORT_ATTACHMENTS_BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
  if (error || !signed?.signedUrl) return NextResponse.json({ error: 'Image indisponible pour le moment.' }, { status: 502 });
  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
