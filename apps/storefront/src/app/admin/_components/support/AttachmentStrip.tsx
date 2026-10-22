'use client';

import { useId, useRef } from 'react';
import { IconAlertTriangle, IconPhotoPlus, IconRefresh, IconX } from '@tabler/icons-react';
import { SUPPORT_LIMITS } from '@/lib/support/domain';
import { cn } from '@/lib/utils/cn';
import type { useSupportUploads } from './useSupportUploads';

type Uploads = ReturnType<typeof useSupportUploads>;

/**
 * Thumbnails of the screenshots being added (preview, progress, error with
 * retry, removal) and the « Ajouter une capture » button: gallery or camera on
 * a phone, file picker on a computer. Paste and drop are handled by the form.
 */
export default function AttachmentStrip({ uploads, compact = false, disabled = false }: { uploads: Uploads; compact?: boolean; disabled?: boolean }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const full = uploads.uploads.length >= SUPPORT_LIMITS.attachmentsPerMessage;
  const size = compact ? 'h-14 w-14' : 'h-16 w-16';

  return (
    <div className="space-y-1.5">
      <ul className="flex flex-wrap items-center gap-2" aria-label="Captures jointes">
        {uploads.uploads.map((upload) => (
          <li key={upload.localId} className={cn('relative shrink-0 overflow-visible rounded-lg border border-a-border bg-a-surface-2', size)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={upload.previewUrl} alt={upload.name} className={cn('h-full w-full rounded-lg object-cover', upload.status !== 'ready' && 'opacity-60')} />
            {upload.status === 'uploading' && (
              <span className="absolute inset-0 flex items-center justify-center" aria-label="Envoi de l’image en cours">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-a-border-strong border-t-a-brand motion-reduce:animate-none" />
              </span>
            )}
            {upload.status === 'error' && (
              <button type="button" onClick={() => uploads.retry(upload.localId)} title={upload.error}
                className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-tone-danger-bg text-xs font-semibold text-tone-danger-fg">
                <IconRefresh size={16} aria-hidden="true" />Réessayer
              </button>
            )}
            <button type="button" onClick={() => uploads.remove(upload.localId)} aria-label={`Retirer ${upload.name}`}
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-a-surface bg-a-inverse text-a-on-inverse shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
              <IconX size={13} aria-hidden="true" />
            </button>
          </li>
        ))}
        {!full && (
          <li>
            <label htmlFor={inputId}
              className={cn('flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-a-field bg-a-surface text-xs font-semibold text-a-text-2 hover:bg-a-hover focus-within:outline focus-within:outline-2 focus-within:outline-a-focus',
                compact ? 'h-14 w-14' : 'h-16 min-w-16 px-2', disabled && 'pointer-events-none opacity-50')}>
              <IconPhotoPlus size={20} aria-hidden="true" />
              {!compact && <span>Capture</span>}
              <span className="sr-only">Ajouter une capture d’écran ou une photo</span>
            </label>
            <input ref={inputRef} id={inputId} type="file" accept="image/png,image/jpeg,image/webp,image/*" multiple className="sr-only" disabled={disabled}
              onChange={(event) => { uploads.add(event.target.files); if (inputRef.current) inputRef.current.value = ''; }} />
          </li>
        )}
      </ul>
      {uploads.notice && <p className="flex items-center gap-1.5 text-xs text-tone-warning-fg"><IconAlertTriangle size={14} aria-hidden="true" />{uploads.notice}</p>}
      {uploads.failed && <p className="text-xs text-tone-danger-fg" role="alert">Une image n’a pas pu être envoyée : réessayez ou retirez-la.</p>}
    </div>
  );
}
