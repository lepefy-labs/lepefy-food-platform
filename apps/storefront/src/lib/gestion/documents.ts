import 'server-only';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  DOCUMENTS_BUCKET, DOCUMENT_ENTITY_TYPES, DOCUMENT_MAX_BYTES, DOCUMENT_MIME_TYPES, DOCUMENT_TYPES,
  type DocumentEntityType, type DocumentType,
} from '@/lib/gestion/domain';
import { detectDocumentMime, safeFileName } from '@/lib/gestion/files';

/**
 * Allegati privati Gestion: bucket `business-documents` (privato, nessuna
 * policy storage), percorso `<tenant>/<entità>/<id>/<uuid>-<nome>`.
 * Lettura e scrittura solo tramite queste API autorizzate, mai URL pubblici.
 */

const ENTITY_TABLES: Record<DocumentEntityType, string> = {
  supplier: 'suppliers',
  purchase: 'supplier_purchases',
  receipt: 'supplier_receipts',
  supplier_payment: 'supplier_payments',
};

export function parseEntityType(value: string): DocumentEntityType | null {
  return (DOCUMENT_ENTITY_TYPES as readonly string[]).includes(value) ? value as DocumentEntityType : null;
}

async function entityExists(tenantId: string, entityType: DocumentEntityType, entityId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(entityId)) return false;
  const { data } = await createServiceClient().from(ENTITY_TABLES[entityType]).select('id')
    .eq('tenant_id', tenantId).eq('id', entityId).maybeSingle();
  return Boolean(data);
}

async function audit(tenantId: string, documentId: string, eventType: string, actorId: string | null, metadata: Record<string, unknown>) {
  const { error } = await createServiceClient().rpc('log_business_event', {
    p_tenant_id: tenantId, p_entity_type: 'document', p_entity_id: documentId,
    p_event_type: eventType, p_actor: actorId, p_metadata: metadata,
  });
  if (error) console.error('[gestion] document audit failed:', error.message);
}

export async function listEntityDocuments(tenantId: string, entityType: DocumentEntityType, entityId: string): Promise<NextResponse> {
  if (!(await entityExists(tenantId, entityType, entityId))) return NextResponse.json({ error: 'Élément introuvable.' }, { status: 404 });
  const { data, error } = await createServiceClient().from('business_documents')
    .select('id, document_type, file_name, mime_type, size_bytes, note, created_at')
    .eq('tenant_id', tenantId).eq('entity_type', entityType).eq('entity_id', entityId).is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Lecture des documents impossible.' }, { status: 500 });
  return NextResponse.json({ documents: data ?? [] });
}

export async function uploadEntityDocument(
  tenantId: string, entityType: DocumentEntityType, entityId: string, actorId: string | null, form: FormData,
): Promise<NextResponse> {
  const file = form.get('file');
  const documentType = String(form.get('document_type') ?? '');
  const note = String(form.get('note') ?? '').trim().slice(0, 1000) || null;
  if (!(file instanceof File)) return NextResponse.json({ error: 'Fichier manquant.' }, { status: 400 });
  if (!(DOCUMENT_TYPES as readonly string[]).includes(documentType)) return NextResponse.json({ error: 'Type de document invalide.' }, { status: 400 });
  if (file.size <= 0 || file.size > DOCUMENT_MAX_BYTES) return NextResponse.json({ error: 'Fichier vide ou supérieur à 10 Mo.' }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectDocumentMime(bytes);
  if (!mime || !(DOCUMENT_MIME_TYPES as readonly string[]).includes(mime)) {
    return NextResponse.json({ error: 'Format accepté : PDF, JPEG, PNG ou WebP.' }, { status: 400 });
  }
  if (!(await entityExists(tenantId, entityType, entityId))) return NextResponse.json({ error: 'Élément introuvable.' }, { status: 404 });

  const service = createServiceClient();
  const name = safeFileName(file.name, mime);
  const storagePath = `${tenantId}/${entityType}/${entityId}/${randomUUID()}-${name}`;
  const { error: uploadError } = await service.storage.from(DOCUMENTS_BUCKET)
    .upload(storagePath, bytes, { contentType: mime, upsert: false });
  if (uploadError) {
    console.error('[gestion] document upload failed:', uploadError.message);
    return NextResponse.json({ error: 'Envoi du fichier impossible.' }, { status: 500 });
  }

  const { data, error } = await service.from('business_documents').insert({
    tenant_id: tenantId, entity_type: entityType, entity_id: entityId, document_type: documentType as DocumentType,
    storage_path: storagePath, file_name: name, mime_type: mime, size_bytes: file.size, note,
    uploaded_by_admin_id: actorId,
  }).select('id, document_type, file_name, mime_type, size_bytes, note, created_at').single();
  if (error || !data) {
    await service.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    console.error('[gestion] document insert failed:', error?.message);
    return NextResponse.json({ error: 'Enregistrement du document impossible.' }, { status: 500 });
  }
  await audit(tenantId, data.id, 'document.uploaded', actorId, {
    entity_type: entityType, entity_id: entityId, document_type: documentType, size_bytes: file.size,
  });
  return NextResponse.json({ document: data }, { status: 201 });
}

async function findDocument(tenantId: string, entityType: DocumentEntityType, entityId: string, documentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return null;
  const { data } = await createServiceClient().from('business_documents')
    .select('id, storage_path, file_name, mime_type')
    .eq('tenant_id', tenantId).eq('entity_type', entityType).eq('entity_id', entityId).eq('id', documentId)
    .is('deleted_at', null).maybeSingle();
  return data;
}

export async function downloadEntityDocument(
  tenantId: string, entityType: DocumentEntityType, entityId: string, documentId: string,
): Promise<Response> {
  const document = await findDocument(tenantId, entityType, entityId, documentId);
  if (!document) return NextResponse.json({ error: 'Document introuvable.' }, { status: 404 });
  const { data, error } = await createServiceClient().storage.from(DOCUMENTS_BUCKET).download(document.storage_path);
  if (error || !data) return NextResponse.json({ error: 'Lecture du fichier impossible.' }, { status: 500 });
  return new Response(data, {
    headers: {
      'Content-Type': document.mime_type,
      'Content-Disposition': `inline; filename="${document.file_name.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function deleteEntityDocument(
  tenantId: string, entityType: DocumentEntityType, entityId: string, documentId: string, actorId: string | null,
): Promise<NextResponse> {
  const document = await findDocument(tenantId, entityType, entityId, documentId);
  if (!document) return NextResponse.json({ error: 'Document introuvable.' }, { status: 404 });
  // Suppression logique : le fichier reste en stockage privé pour l'audit.
  const { error } = await createServiceClient().from('business_documents')
    .update({ deleted_at: new Date().toISOString(), deleted_by_admin_id: actorId })
    .eq('tenant_id', tenantId).eq('id', document.id).is('deleted_at', null);
  if (error) return NextResponse.json({ error: 'Suppression impossible.' }, { status: 500 });
  await audit(tenantId, document.id, 'document.deleted', actorId, { entity_type: entityType, entity_id: entityId });
  return NextResponse.json({ ok: true });
}
