'use client';

import { useState } from 'react';
import { IconPhotoOff } from '@tabler/icons-react';

/**
 * Screenshot of a conversation, loaded through the authorized route (short
 * signed URL). The header size reserves the space; a click opens it full size.
 */
export default function SupportImage({ src, width, height, label }: { src: string; width: number | null; height: number | null; label: string }) {
  const [failed, setFailed] = useState(false);
  const ratio = width && height ? `${width} / ${height}` : '4 / 3';
  if (failed) {
    return (
      <span className="flex h-20 w-32 flex-col items-center justify-center gap-1 rounded-lg border border-a-border bg-a-surface-2 text-xs text-a-text-3">
        <IconPhotoOff size={18} aria-hidden="true" />Image indisponible
      </span>
    );
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block w-40 max-w-full overflow-hidden rounded-lg border border-a-border bg-a-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus sm:w-48"
      style={{ aspectRatio: ratio, maxHeight: '16rem' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
    </a>
  );
}
