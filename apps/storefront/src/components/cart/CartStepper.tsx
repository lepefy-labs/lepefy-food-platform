'use client';

import type { MouseEvent } from 'react';
import { IconMinus, IconPlus, IconTrash } from '@tabler/icons-react';
import { useTenant } from '@/providers/TenantProvider';
import { readableOn } from '@/lib/utils/color';

interface CartStepperProps {
  quantity: number;
  productName: string;
  /** Le «−» retire la ligne : icône corbeille et libellé « Retirer ». */
  removesOnDecrement: boolean;
  canIncrement: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  disabled?: boolean;
  /**
   * `card` = pleine largeur sous une carte produit ; `line` = boutons ronds
   * d'une ligne du drawer ; `panel` = bloc encadré (fiche produit, confirmation) ;
   * `cart` = card de la page panier.
   */
  variant?: 'card' | 'line' | 'panel' | 'cart';
  /** Texte visible sous le nombre (variant `card`), ex. « dans le panier ». */
  caption?: string;
  /** Préfixe lu par les lecteurs d'écran avant le nombre. */
  valuePrefix?: string;
  valueTestId?: string;
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1';

/**
 * Contrôle +/− unique des quantités du panier. Toujours des cibles de 44 px,
 * jamais une quantité hors règle : les transitions viennent du store
 * (`stepPurchaseQuantity`), ce composant ne fait qu'afficher et relayer.
 * Les clics ne remontent pas : la card produit est elle-même un lien.
 */
export function CartStepper({
  quantity,
  productName,
  removesOnDecrement,
  canIncrement,
  onIncrement,
  onDecrement,
  disabled = false,
  variant = 'line',
  caption,
  valuePrefix = 'Quantité dans le panier : ',
  valueTestId,
}: CartStepperProps) {
  const decrementLabel = removesOnDecrement ? `Retirer ${productName} du panier` : `Diminuer la quantité de ${productName}`;
  const incrementLabel = `Augmenter la quantité de ${productName}`;
  const plusDisabled = disabled || !canIncrement;
  const onPrimary = readableOn(useTenant().primary_color);

  function handle(event: MouseEvent<HTMLButtonElement>, action: () => void) {
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  const minusIcon = removesOnDecrement
    ? <IconTrash size={variant === 'line' ? 17 : 19} aria-hidden="true" />
    : <IconMinus size={variant === 'line' ? 17 : 20} aria-hidden="true" />;
  const value = (
    <span aria-live="polite" aria-atomic="true" data-testid={valueTestId} className="tabular-nums">
      <span className="sr-only">{valuePrefix}</span>{quantity}
    </span>
  );

  if (variant === 'card') {
    return (
      <div role="group" aria-label={`Quantité de ${productName}`}
        className="grid min-h-11 w-full grid-cols-[44px_minmax(0,1fr)_44px] items-center overflow-hidden rounded-lg border-2 border-[var(--color-primary)] bg-white text-[var(--color-primary)]">
        <button type="button" onClick={(e) => handle(e, onDecrement)} disabled={disabled} aria-label={decrementLabel}
          className={`flex h-11 w-11 items-center justify-center hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 ${removesOnDecrement ? 'text-red-700' : ''} ${focusRing}`}>
          {minusIcon}
        </button>
        <span className="min-w-0 text-center leading-tight">
          <span className="block text-base font-extrabold">{value}</span>
          {caption && <span aria-hidden="true" className="block truncate text-xs font-semibold text-gray-700">{caption}</span>}
        </span>
        <button type="button" onClick={(e) => handle(e, onIncrement)} disabled={plusDisabled} aria-label={incrementLabel}
          className={`flex h-11 w-11 items-center justify-center hover:bg-gray-50 active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 ${focusRing}`}>
          <IconPlus size={20} aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (variant === 'cart') {
    // Panier : «−» neutre, corbeille rouge au minimum (même taille : aucun
    // décalage), «+» dans la couleur du tenant avec un texte lisible dessus.
    return (
      <div role="group" aria-label={`Quantité de ${productName}`} className="inline-flex items-center gap-1 rounded-full bg-gray-100 p-0.5">
        <button type="button" onClick={(e) => handle(e, onDecrement)} disabled={disabled} aria-label={decrementLabel}
          title={removesOnDecrement ? 'Retirer du panier' : undefined}
          className={`flex h-11 w-11 items-center justify-center rounded-full bg-white ring-1 transition-[background-color,transform] active:scale-95 disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100 ${removesOnDecrement ? 'text-red-700 ring-red-200 hover:bg-red-50' : 'text-gray-800 ring-gray-300 hover:bg-gray-50'} ${focusRing}`}>
          {removesOnDecrement ? <IconTrash size={19} aria-hidden="true" /> : <IconMinus size={19} aria-hidden="true" />}
        </button>
        <span className="min-w-9 px-0.5 text-center text-base font-bold text-gray-950">{value}</span>
        <button type="button" onClick={(e) => handle(e, onIncrement)} disabled={plusDisabled} aria-label={incrementLabel}
          className={`flex h-11 w-11 items-center justify-center rounded-full transition-[filter,transform] hover:brightness-95 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 motion-reduce:transition-none motion-reduce:active:scale-100 ${focusRing}`}
          style={plusDisabled ? undefined : { backgroundColor: 'var(--color-primary)', color: onPrimary }}>
          <IconPlus size={19} aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (variant === 'panel') {
    return (
      <div role="group" aria-label={`Quantité de ${productName}`}
        className="inline-flex h-12 items-center rounded-lg border border-gray-400 bg-white text-gray-900">
        <button type="button" onClick={(e) => handle(e, onDecrement)} disabled={disabled} aria-label={decrementLabel}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-l-lg hover:bg-gray-50 disabled:text-gray-400 ${removesOnDecrement ? 'text-red-700' : ''} ${focusRing}`}>
          {minusIcon}
        </button>
        <span className="flex h-12 min-w-12 items-center justify-center border-x border-gray-400 px-2 text-base font-semibold">{value}</span>
        <button type="button" onClick={(e) => handle(e, onIncrement)} disabled={plusDisabled} aria-label={incrementLabel}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-r-lg hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${focusRing}`}>
          <IconPlus size={20} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div role="group" aria-label={`Quantité de ${productName}`} className="flex items-center gap-1">
      <button type="button" onClick={(e) => handle(e, onDecrement)} disabled={disabled} aria-label={decrementLabel}
        className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors hover:bg-gray-50 active:bg-gray-100 disabled:opacity-30 ${removesOnDecrement ? 'border-red-200 text-red-700' : 'border-gray-300 text-gray-700'} ${focusRing}`}>
        {minusIcon}
      </button>
      <span className="min-w-7 text-center text-sm font-semibold">{value}</span>
      <button type="button" onClick={(e) => handle(e, onIncrement)} disabled={plusDisabled} aria-label={incrementLabel}
        className={`flex h-11 w-11 items-center justify-center rounded-full border border-gray-300 text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 ${focusRing}`}>
        <IconPlus size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
