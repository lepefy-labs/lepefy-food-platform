'use client';

import { IconMapPin, IconNavigation } from '@tabler/icons-react';

type Lang = 'fr' | 'it';

const COPY = {
  fr: {
    title: 'Nous trouver',
    action: 'Itinéraire',
    generic: 'Ouvrir notre adresse sur Google Maps',
    aria: 'Ouvrir l’itinéraire vers notre établissement',
  },
  it: {
    title: 'Dove trovarci',
    action: 'Indicazioni',
    generic: 'Apri la nostra posizione su Google Maps',
    aria: 'Apri le indicazioni per raggiungere il nostro negozio',
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
  const displayAddress = address ?? t.generic;

  if (!googleMapsUrl) {
    return (
      <div className="flex items-start gap-3 border-t border-gray-100 px-4 py-3.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gray-50"
          style={{ color: primaryColor }}
          aria-hidden
        >
          <IconMapPin size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold uppercase tracking-wide text-gray-500">{t.title}</span>
          <span className="mt-1 block break-words text-sm font-medium leading-5 text-gray-800">{displayAddress}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 px-3.5 py-3.5">
      <div className="mb-3 flex items-start gap-3 px-0.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gray-50"
          style={{ color: primaryColor }}
          aria-hidden
        >
          <IconMapPin size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold uppercase tracking-wide text-gray-500">{t.title}</span>
          <span className="mt-1 block break-words text-sm font-semibold leading-5 text-gray-800">{displayAddress}</span>
        </span>
      </div>

      <a
        href={googleMapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${t.aria}: ${displayAddress}`}
        className="group relative block min-h-[132px] overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
      >
        <span
          aria-hidden
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage: [
              'linear-gradient(28deg, transparent 0 42%, rgba(255,255,255,.92) 42% 48%, transparent 48% 100%)',
              'linear-gradient(118deg, transparent 0 54%, rgba(255,255,255,.82) 54% 60%, transparent 60% 100%)',
              'linear-gradient(90deg, rgba(17,24,39,.045) 1px, transparent 1px)',
              'linear-gradient(rgba(17,24,39,.045) 1px, transparent 1px)',
            ].join(','),
            backgroundSize: 'auto, auto, 28px 28px, 28px 28px',
          }}
        />

        <span
          aria-hidden
          className="absolute -left-6 top-8 h-4 w-[72%] rotate-[12deg] rounded-full opacity-25"
          style={{ backgroundColor: secondaryColor }}
        />
        <span
          aria-hidden
          className="absolute right-8 top-[-18px] h-28 w-4 rotate-[34deg] rounded-full opacity-15"
          style={{ backgroundColor: primaryColor }}
        />
        <span
          aria-hidden
          className="absolute bottom-7 left-[42%] h-16 w-3 -rotate-[48deg] rounded-full opacity-20"
          style={{ backgroundColor: secondaryColor }}
        />

        <span
          aria-hidden
          className="absolute left-[56%] top-[44%] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-white bg-white shadow-sm"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full text-white" style={{ backgroundColor: primaryColor }}>
            <IconMapPin size={18} stroke={2.2} />
          </span>
        </span>

        <span className="absolute bottom-3 right-3 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/95 px-3.5 text-sm font-bold shadow-sm ring-1 ring-black/5 backdrop-blur-sm transition-transform group-hover:-translate-y-0.5" style={{ color: primaryColor }}>
          <IconNavigation size={16} stroke={2.2} aria-hidden />
          {t.action}
        </span>
      </a>
    </div>
  );
}
