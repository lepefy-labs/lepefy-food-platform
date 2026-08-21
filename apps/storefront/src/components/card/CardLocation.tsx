'use client';

import { IconExternalLink, IconMapPin } from '@tabler/icons-react';

type Lang = 'fr' | 'it';

const COPY = {
  fr: {
    title: 'Nous trouver',
    action: 'Itinéraire',
    generic: 'Ouvrir notre adresse sur Google Maps',
  },
  it: {
    title: 'Dove trovarci',
    action: 'Indicazioni',
    generic: 'Apri la nostra posizione su Google Maps',
  },
} as const;

interface CardLocationProps {
  address: string | null;
  googleMapsUrl: string | null;
  lang: Lang;
  primaryColor: string;
  secondaryColor: string;
}

export function CardLocation({ address, googleMapsUrl, lang, primaryColor, secondaryColor }: CardLocationProps) {
  if (!address && !googleMapsUrl) return null;

  const t = COPY[lang];
  const content = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gray-50" style={{ color: primaryColor }}>
        <IconMapPin size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold uppercase tracking-wide text-gray-500">{t.title}</span>
        <span className="mt-1 block break-words text-sm font-medium leading-5 text-gray-800">
          {address ?? t.generic}
        </span>
        {googleMapsUrl && (
          <span className="mt-2 inline-flex items-center gap-1 text-sm font-bold" style={{ color: primaryColor }}>
            {t.action} <span aria-hidden>→</span>
          </span>
        )}
      </span>
      {googleMapsUrl && <IconExternalLink aria-hidden size={16} className="mt-1 shrink-0 text-gray-400" />}
    </>
  );

  if (!googleMapsUrl) {
    return (
      <div className="flex items-start gap-3 border-t border-gray-100 px-4 py-3.5">
        {content}
      </div>
    );
  }

  return (
    <a
      href={googleMapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="relative flex min-h-14 items-start gap-3 border-t border-gray-100 px-4 py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset"
      style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
      aria-label={`${t.title}: ${address ?? t.generic}. ${t.action}`}
    >
      <span aria-hidden className="absolute bottom-0 left-4 top-0 w-0.5 rounded-full opacity-70" style={{ backgroundColor: secondaryColor }} />
      {content}
    </a>
  );
}
