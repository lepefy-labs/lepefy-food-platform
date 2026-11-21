'use client';

import type { MouseEvent } from 'react';
import type { DecrementPriceRise } from '@/lib/catalog/saleFormats';
import { formatCountOrUnits, type SellingFormat } from '@/lib/storefrontCopy/sellingFormat';
import { decrementPriceRiseLine } from '@/lib/storefrontCopy/saleFormatCopy';

interface FormatPriceRiseNoticeProps {
  rise: DecrementPriceRise | null;
  sellingFormat: SellingFormat;
  currency?: string;
  onKeep: () => void;
  onConfirm: () => void;
  className?: string;
}

/**
 * Avis unique « une unité de moins coûte plus » (fiche à formats, migration
 * 187) : affiché à l'endroit du « − » (card, fiche produit, panier, drawer,
 * confirmation, recherche), AVANT tout changement du panier. Le client garde
 * la quantité actuelle ou confirme la baisse ; rien ne change sans son choix.
 * Les clics ne remontent pas : la card produit est elle-même un lien.
 */
export function FormatPriceRiseNotice({ rise, sellingFormat, currency, onKeep, onConfirm, className = '' }: FormatPriceRiseNoticeProps) {
  if (!rise) return null;
  function handle(event: MouseEvent<HTMLButtonElement>, action: () => void) {
    event.preventDefault();
    event.stopPropagation();
    action();
  }
  return (
    <div role="status" className={`rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-semibold leading-snug text-amber-950 ring-1 ring-amber-200 ${className}`}>
      <p>{decrementPriceRiseLine(rise, sellingFormat, currency)}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        <button type="button" onClick={(event) => handle(event, onKeep)}
          className="inline-flex min-h-9 items-center font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
          Garder {formatCountOrUnits(sellingFormat, rise.fromUnits)}
        </button>
        <button type="button" onClick={(event) => handle(event, onConfirm)}
          className="inline-flex min-h-9 items-center font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
          Passer à {formatCountOrUnits(sellingFormat, rise.units)}
        </button>
      </div>
    </div>
  );
}
