'use client';

import { IconBuildingBank, IconCreditCard, IconWallet } from '@tabler/icons-react';
import { PaymentBrandMark } from './CardPaymentBrands';
import type { CardPaymentTile, CardPaymentTileSpan } from '@/lib/card/cardPaymentTiles';
import { darkenHex, lightenHex, readableForeground } from '@/lib/card/cardTheme';
import { hexToRgba } from '@/lib/card/methodColor';

type Lang = 'fr' | 'it';

const COPY = {
  fr: {
    title: 'Choisissez votre moyen de paiement', card: 'Carte', bank: 'Virement bancaire',
    cardLabel: 'Payer par carte (Visa, Mastercard)', bankLabel: 'Payer par virement bancaire', payWith: (x: string) => `Payer avec ${x}`,
  },
  it: {
    title: 'Scegli il metodo di pagamento', card: 'Carta', bank: 'Bonifico bancario',
    cardLabel: 'Paga con carta (Visa, Mastercard)', bankLabel: 'Paga con bonifico bancario', payWith: (x: string) => `Paga con ${x}`,
  },
} as const;

const SPAN_CLASS: Record<CardPaymentTileSpan, string> = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3', 4: 'col-span-4' };

const BRAND_NAMES = { apple_pay: 'Apple Pay', paypal: 'PayPal', satispay: 'Satispay', revolut: 'Revolut' } as const;

/**
 * Grille de la hero /card : une tuile par moyen proposé (lib/card/cardPaymentTiles.ts),
 * 4 colonnes logiques, chaque tuile ouvre directement son écran. Surfaces
 * dérivées de la couleur du tenant : « Carte » pleine (action principale), les
 * autres en verre clair teinté pour garder les logos d'origine lisibles.
 */
export function CardPaymentMethodGrid({ tiles, lang, primaryColor, onSelect }: {
  tiles: CardPaymentTile[]; lang: Lang; primaryColor: string; onSelect: (methodId: string) => void;
}) {
  const t = COPY[lang];
  if (tiles.length === 0) return null;
  const cardForeground = readableForeground(primaryColor);
  const glass = hexToRgba(lightenHex(primaryColor, 0.9), 0.94);
  const ink = darkenHex(primaryColor, 0.45);

  return (
    <section aria-labelledby="card-pay-methods" className="lg:max-w-md">
      <h2 id="card-pay-methods" className="sr-only">{t.title}</h2>
      <ul className="grid grid-cols-4 gap-1.5 min-[360px]:gap-2">
        {tiles.map((tile) => {
          const isCard = tile.kind === 'card';
          const label = tile.kind === 'card' ? t.cardLabel
            : tile.kind === 'bank_transfer' ? t.bankLabel
            : t.payWith(tile.kind === 'other' ? (tile.label ?? '') : BRAND_NAMES[tile.kind]);
          return (
            <li key={tile.methodId} className={`${SPAN_CLASS[tile.span]} flex`}>
              <button
                type="button"
                onClick={() => onSelect(tile.methodId)}
                aria-label={label}
                className={`flex min-h-14 w-full min-w-0 items-center justify-center rounded-[15px] border px-1 py-2 backdrop-blur-md transition-[transform,box-shadow] duration-150 [container-type:inline-size] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/90 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 ${isCard ? 'shadow-[0_10px_24px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.35)] hover:shadow-[0_14px_28px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.35)]' : 'shadow-[0_6px_16px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.8)] hover:shadow-[0_10px_22px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.8)]'}`}
                style={isCard
                  ? { background: `linear-gradient(135deg, ${primaryColor} 0%, ${darkenHex(primaryColor, 0.25)} 100%)`, borderColor: 'rgba(255,255,255,0.4)', color: cardForeground }
                  : { backgroundColor: glass, borderColor: 'rgba(255,255,255,0.7)', color: '#111827' }}
              >
                {tile.kind === 'card' ? (
                  <span aria-hidden="true" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-1.5">
                    <span className="inline-flex items-center gap-1.5 text-base font-extrabold" style={{ fontFamily: 'var(--font-card-heading)' }}>
                      <IconCreditCard size={20} className="shrink-0" />{t.card}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-1 shadow-sm">
                      <PaymentBrandMark brand="visa" size="sm" /><PaymentBrandMark brand="mastercard" size="sm" />
                    </span>
                  </span>
                ) : tile.kind === 'bank_transfer' ? (
                  <span aria-hidden="true" className="flex items-center justify-center gap-1.5 px-1 text-left text-sm font-bold leading-tight">
                    <IconBuildingBank size={20} className="shrink-0" style={{ color: ink }} />{t.bank}
                  </span>
                ) : tile.kind === 'other' ? (
                  <span aria-hidden="true" className="flex min-w-0 items-center justify-center gap-1.5 px-1 text-sm font-bold leading-tight">
                    <IconWallet size={20} className="shrink-0" style={{ color: ink }} /><span className="line-clamp-2 break-words">{tile.label}</span>
                  </span>
                ) : (
                  <span aria-hidden="true" className="flex items-center justify-center"><PaymentBrandMark brand={tile.kind} size="tile" /></span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
