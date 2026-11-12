'use client';

import { createClient } from '@/lib/supabase/client';
import { STUDIO_LIMITS, STUDIO_PRIVATE_BUCKET } from '@/lib/studio/domain';

/** Longest edge sent from the phone (the server keeps 2048 px at most). */
const UPLOAD_EDGE = STUDIO_LIMITS.maxStoredEdge;

export const ACCEPTED_PHOTO_TYPES = 'image/jpeg,image/png,image/webp';

export function newRequestKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Downscales a phone photo before upload (mobile data, EXIF rotation applied
 * by the browser). Falls back to the original file when the browser cannot.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, UPLOAD_EDGE / bitmap.width, UPLOAD_EDGE / bitmap.height);
      if (scale === 1 && file.size <= 4 * 1024 * 1024 && file.type === 'image/jpeg') return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      return blob ?? file;
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

/** Signed upload straight to the private bucket; returns the stored path. */
export async function uploadPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Format non pris en charge : choisissez une photo JPEG, PNG ou WebP.');
  }
  const blob = await preparePhoto(file);
  if (blob.size > STUDIO_LIMITS.uploadBytes) throw new Error('Photo trop lourde (15 Mo au maximum).');
  const response = await fetch('/api/admin/studio/uploads', { method: 'POST' });
  const json = await response.json().catch(() => ({})) as { path?: string; token?: string; error?: string };
  if (!response.ok || !json.path || !json.token) throw new Error(json.error ?? 'Envoi de la photo impossible. Réessayez.');
  const { error } = await createClient().storage.from(STUDIO_PRIVATE_BUCKET)
    .uploadToSignedUrl(json.path, json.token, blob, { contentType: blob.type || 'image/jpeg' });
  if (error) throw new Error('Envoi de la photo interrompu. Vérifiez le réseau puis réessayez.');
  return json.path;
}

/**
 * Starts the job now. `keepalive` lets the request finish if the page is
 * closed; the n8n tick takes over anyway if it never arrives.
 */
export function startJob(jobId: string): void {
  try {
    void fetch(`/api/admin/studio/jobs/${jobId}/run`, { method: 'POST', keepalive: true }).catch(() => undefined);
  } catch {
    /* the tick will run it */
  }
}
