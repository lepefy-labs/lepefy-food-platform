'use client';

import Link from 'next/link';
import { IconMaximize } from '@tabler/icons-react';

interface LoyaltyCardWidgetProps {
  tenantName: string;
  fullName: string | null;
  confirmedPoints: number;
  cardNumberDisplay: string | null;
  barcodeSvg: string | null;
  textColor: string;
}

const pointsFormatter = new Intl.NumberFormat('fr-FR');

/**
 * Widget "tessera fisica" — sostituisce la banda punti generica. Un solo
 * elemento con `overflow-hidden` + background multi-gradient direttamente
 * sulla box (niente layer decorativo assoluto separato): se il contenuto
 * richiedesse più altezza dell'aspect-ratio target su schermi molto stretti,
 * il gradiente continua comunque a coprire l'intera box reale — nessuna
 * "cucitura" visibile tra sfondo e contenuto (vedi rapport final).
 *
 * cardTextColor è calcolato lato server (contrastRatio, lib/utils/color.ts —
 * stesso pattern già usato da CategoryBlock) e passato già risolto: nessun
 * calcolo di contrasto lato client qui.
 */
export function LoyaltyCardWidget({
  tenantName, fullName, confirmedPoints, cardNumberDisplay, barcodeSvg, textColor,
}: LoyaltyCardWidgetProps) {
  const mutedOpacity = textColor === '#ffffff' ? 0.78 : 0.62;

  return (
    <Link
      href="/compte/carte-fidelite"
      aria-label={`Voir ma carte de fidélité ${tenantName} en grand`}
      className="group block w-full rounded-3xl overflow-hidden relative transition-all duration-150 ease-out hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.98] active:shadow-md"
      style={{
        aspectRatio: '1.586',
        background: `
          linear-gradient(115deg,
            color-mix(in srgb, white 25%, transparent) 0%,
            transparent 32%,
            transparent 68%,
            color-mix(in srgb, black 10%, transparent) 100%),
          linear-gradient(135deg,
            color-mix(in srgb, var(--color-primary) 85%, white) 0%,
            var(--color-primary) 48%,
            color-mix(in srgb, var(--color-primary) 78%, black) 100%)
        `,
        boxShadow: '0 8px 20px -6px color-mix(in srgb, var(--color-primary) 45%, transparent)',
        color: textColor,
      }}
    >
      <div className="relative h-full flex flex-col p-3.5 sm:p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ opacity: mutedOpacity }}>
            {tenantName}
          </span>
          <span
            className="flex items-center gap-1 text-[10px] font-medium shrink-0"
            style={{ opacity: mutedOpacity }}
          >
            <IconMaximize size={12} stroke={2} />
            <span className="hidden sm:inline">Toucher pour agrandir</span>
          </span>
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pb-2.5">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-wide mb-0.5" style={{ opacity: mutedOpacity }}>
              Membre
            </div>
            <div
              className="font-display font-semibold uppercase truncate"
              style={{ letterSpacing: '0.05em', fontSize: 'clamp(12px, 3.6vw, 15px)' }}
            >
              {fullName || 'Client'}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[9px] uppercase tracking-wide mb-0.5" style={{ opacity: mutedOpacity }}>
              Points
            </div>
            <div className="font-extrabold leading-none" style={{ fontSize: 'clamp(17px, 5vw, 21px)' }}>
              {pointsFormatter.format(confirmedPoints)}
            </div>
          </div>
        </div>

        {barcodeSvg && (
          <div className="rounded-lg bg-white px-2 py-1 flex flex-col items-center gap-0.5">
            <div
              className="w-full [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: barcodeSvg }}
            />
            {cardNumberDisplay && (
              <span className="font-mono text-[9px] text-gray-500 tracking-widest">
                {cardNumberDisplay}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
