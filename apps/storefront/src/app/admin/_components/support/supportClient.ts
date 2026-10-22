'use client';

import { SUPPORT_LIMITS } from '@/lib/support/domain';

/** Browser helpers of the Assistance module (no global state, no network on import). */

export function newClientKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

export class SupportRequestError extends Error {
  constructor(message: string, public status: number, public network = false) { super(message); }
}

/** JSON request with the API's French error, or a clear network message. */
export async function supportFetch<T>(url: string, init: { method?: string; body?: unknown; signal?: AbortSignal; form?: FormData } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
      headers: init.form ? undefined : init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: init.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    throw new SupportRequestError('Connexion impossible. Vérifiez le réseau puis réessayez : votre texte est conservé.', 0, true);
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new SupportRequestError(data.error ?? 'L’opération n’a pas abouti. Réessayez.', response.status);
  return data;
}

const RESIZE_ABOVE_BYTES = 3.5 * 1024 * 1024;
const MAX_SIDE = 2400;

/**
 * Large phone photos are reduced on the device (JPEG, longest side 2 400 px)
 * so they fit the 5 MB limit; screenshots usually go as they are.
 */
export async function prepareImage(file: File): Promise<File> {
  if (file.size <= RESIZE_ABOVE_BYTES || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function isImageFile(file: File): boolean {
  return /^image\//.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}

// ─── Draft kept on this device (text only, 24 h) ─────────────────────────────

const DRAFT_KEY = 'lepefy-support-draft';

export interface SupportDraft { text: string; category: string | null; urgent: boolean; savedAt: number }

export function readDraft(): SupportDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as SupportDraft;
    if (!draft || typeof draft.text !== 'string' || Date.now() - draft.savedAt > SUPPORT_LIMITS.draftTtlMs) {
      window.localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function writeDraft(draft: Omit<SupportDraft, 'savedAt'>): void {
  try {
    if (!draft.text.trim()) window.localStorage.removeItem(DRAFT_KEY);
    else window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, text: draft.text.slice(0, SUPPORT_LIMITS.bodyMax), savedAt: Date.now() }));
  } catch { /* per-device convenience */ }
}

export function clearDraft(): void {
  try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* per-device convenience */ }
}
