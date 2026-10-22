'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SUPPORT_LIMITS } from '@/lib/support/domain';
import { isImageFile, prepareImage, supportFetch } from './supportClient';

export interface SupportUpload {
  localId: string;
  previewUrl: string;
  name: string;
  status: 'uploading' | 'ready' | 'error';
  id?: string;
  error?: string;
  file: File;
}

/**
 * Screenshots added before sending: uploaded at once (staged on the server),
 * previewed locally, removable, retried on error. `endpoint` is the shop or
 * the console upload route; `extra` adds form fields (console: tenantId).
 */
export function useSupportUploads(endpoint: string, extra?: Record<string, string>) {
  const [uploads, setUploads] = useState<SupportUpload[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const urls = useRef(new Set<string>());
  const extraRef = useRef(extra);
  extraRef.current = extra;
  const countRef = useRef(0);
  countRef.current = uploads.length;

  useEffect(() => () => { urls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

  const send = useCallback(async (upload: SupportUpload) => {
    setUploads((list) => list.map((item) => (item.localId === upload.localId ? { ...item, status: 'uploading', error: undefined } : item)));
    try {
      const form = new FormData();
      form.set('file', await prepareImage(upload.file));
      for (const [key, value] of Object.entries(extraRef.current ?? {})) form.set(key, value);
      const data = await supportFetch<{ attachment: { id: string } }>(endpoint, { form });
      setUploads((list) => list.map((item) => (item.localId === upload.localId ? { ...item, status: 'ready', id: data.attachment.id } : item)));
    } catch (error) {
      setUploads((list) => list.map((item) => (item.localId === upload.localId ? { ...item, status: 'error', error: (error as Error).message } : item)));
    }
  }, [endpoint]);

  const add = useCallback((files: FileList | File[] | null | undefined) => {
    const images = Array.from(files ?? []).filter(isImageFile);
    if (!images.length) {
      if (files && Array.from(files).length) setNotice('Seules les images (captures, photos) peuvent être jointes.');
      return;
    }
    const room = SUPPORT_LIMITS.attachmentsPerMessage - countRef.current;
    setNotice(images.length > room ? 'Cinq captures au maximum par message.' : null);
    if (room <= 0) return;
    const added: SupportUpload[] = images.slice(0, room).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      urls.current.add(previewUrl);
      return { localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, previewUrl, name: file.name || 'capture', status: 'uploading', file };
    });
    countRef.current += added.length;
    setUploads((list) => [...list, ...added]);
    added.forEach((upload) => { void send(upload); });
  }, [send]);

  const remove = useCallback((localId: string) => {
    setUploads((list) => {
      const target = list.find((item) => item.localId === localId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        urls.current.delete(target.previewUrl);
        // Best effort: an unsent upload left on the server expires after 24 h anyway.
        if (target.id) void fetch(`${endpoint}/${target.id}`, { method: 'DELETE' }).catch(() => {});
      }
      return list.filter((item) => item.localId !== localId);
    });
    setNotice(null);
  }, [endpoint]);

  const retry = useCallback((localId: string) => {
    const target = uploads.find((item) => item.localId === localId);
    if (target) void send(target);
  }, [uploads, send]);

  /** After a successful send: the files now belong to the message. */
  const reset = useCallback(() => {
    setUploads((list) => { list.forEach((item) => { URL.revokeObjectURL(item.previewUrl); urls.current.delete(item.previewUrl); }); return []; });
    setNotice(null);
  }, []);

  return {
    uploads,
    notice,
    add,
    remove,
    retry,
    reset,
    readyIds: uploads.filter((item) => item.status === 'ready' && item.id).map((item) => item.id!),
    busy: uploads.some((item) => item.status === 'uploading'),
    failed: uploads.some((item) => item.status === 'error'),
  };
}
