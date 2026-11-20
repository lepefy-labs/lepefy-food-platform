'use client';

import Link from 'next/link';
import { IconPhoto } from '@tabler/icons-react';
import { LepefyImage } from '@/components/images/LepefyImage';
import { formatPrice } from '@/lib/utils/format';
import { formatCount, resolveSellingFormat, unitPhrase } from '@/lib/storefrontCopy/sellingFormat';
import { bundleCaption, cheaperWithMoreLine, saleFormatOfferLine } from '@/lib/storefrontCopy/saleFormatCopy';
import { cheaperWithMoreUnits } from '@/lib/catalog/saleFormats';
import { setFormatUnits, useFormatUnits } from '@/lib/cart/useFormatUnits';
import type { CartFormatGroup } from '@/lib/cart/useCartFormatGroups';
import { CartStepper } from './CartStepper';

interface CartFormatGroupItemProps {
  group: CartFormatGroup;
  currency?: string;
  variant?: 'page' | 'drawer';
  /**
   * Dernière unité retirée : passe par le retrait habituel (annulation 5 s).
   * Reçoit l'id de la seule ligne restante (le format de base).
   */
  onRemoveLast: (productId: string) => void;
}

/**
 * Une fiche à plusieurs formats affichée comme une seule ligne du panier
 * (migration 187, regroupement automatique) : compteur en unités de base,
 * composition réelle sous le prix (« dont 1 lot de 3 paquets · −0,50 € »).
 * Les lignes réelles (lot × n, paquet × m) restent celles du panier et de la
 * commande ; ce composant ne fait que les présenter et les recomposer.
 */
export function CartFormatGroupItem({ group, currency, variant = 'page', onRemoveLast }: CartFormatGroupItemProps) {
  const { parent, options } = group;
  const control = useFormatUnits(parent, options);
  const sellingFormat = resolveSellingFormat(parent);
  const base = options.find((option) => option.isBase);
  const offer = saleFormatOfferLine(options, currency);
  const caption = bundleCaption(control.current, options, sellingFormat, currency);
  const total = control.current?.total ?? 0;
  const overStock = control.units > control.maxUnits;
  // Une unité de moins peut coûter plus (49 paquets > 50) : on le dit, le client choisit.
  const cheaper = !overStock && control.current ? cheaperWithMoreUnits(control.units, total, options, control.maxUnits) : null;
  const href = `/products/${parent.slug}`;
  const priceLine = [
    base ? `${formatPrice(base.price, currency)} ${sellingFormat.unit && !sellingFormat.unit.byWeight ? unitPhrase(sellingFormat) : "l'unité"}` : null,
    offer,
  ].filter(Boolean).join(' · ');

  function decrement() {
    if (control.units === 1 && base) { onRemoveLast(base.id); return; }
    control.decrement();
  }

  const stepper = (
    <CartStepper
      variant={variant === 'page' ? 'cart' : 'line'}
      quantity={control.units}
      productName={parent.name}
      removesOnDecrement={control.removesOnDecrement}
      canIncrement={control.canIncrement}
      onIncrement={control.increment}
      onDecrement={decrement}
    />
  );
  const composition = caption !== 'dans le panier' && (
    <p aria-live="polite" className={`mt-1 text-xs font-semibold leading-snug ${control.current && control.current.savings > 0 ? 'text-green-800' : 'text-gray-700'}`}>{caption}</p>
  );
  const stockNotice = overStock && (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold leading-snug text-amber-900" role="status">
      <span>Il n’en reste que {formatCount(sellingFormat, control.maxUnits)}.</span>
      {control.maxUnits > 0 && (
        <button type="button" onClick={() => setFormatUnits(parent, options, control.maxUnits)} className="inline-flex min-h-9 items-center font-bold underline underline-offset-2">
          Passer à {formatCount(sellingFormat, control.maxUnits)}
        </button>
      )}
    </p>
  );

  const cheaperNotice = cheaper && (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 rounded-lg bg-green-50 px-2 py-1 text-xs font-semibold leading-snug text-green-900" role="status">
      <span>{cheaperWithMoreLine(cheaper, total, sellingFormat, currency)}.</span>
      <button type="button" onClick={() => setFormatUnits(parent, options, cheaper.units)} className="inline-flex min-h-9 items-center font-bold underline underline-offset-2">
        Passer à {formatCount(sellingFormat, cheaper.units)}
      </button>
    </p>
  );

  if (variant === 'drawer') {
    return (
      <li className="flex gap-4 border-b border-gray-100 py-4 last:border-0">
        <div className="pointer-events-none relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl bg-gray-50 shadow-sm ring-1 ring-black/5">
          {parent.image_url
            ? <LepefyImage src={parent.image_url} variant="thumbnail" alt={parent.name} fill sizes="64px" className="object-cover" />
            : <IconPhoto size={26} stroke={1.5} aria-hidden="true" className="absolute inset-0 m-auto text-gray-300" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-bold leading-snug text-gray-950">{parent.name}</p>
          <p className="mt-1 text-xs text-gray-700">{priceLine}</p>
          {composition}
          {cheaperNotice}
          {stockNotice}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {stepper}
            <span className="rounded-lg bg-white/80 px-2 py-1 text-sm font-bold tabular-nums ring-1 ring-black/5" aria-live="polite">{formatPrice(total, currency)}</span>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-4">
      <div className="flex gap-3 sm:gap-4">
        <Link href={href} tabIndex={-1} aria-hidden="true" className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5 sm:h-20 sm:w-20">
          {parent.image_url
            ? <LepefyImage src={parent.image_url} variant="thumbnail" alt="" fill sizes="(min-width: 640px) 80px, 72px" className="object-cover" />
            : <IconPhoto size={26} stroke={1.5} aria-hidden="true" className="absolute inset-0 m-auto text-gray-300" />}
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={href} className="block break-words text-[15px] font-bold leading-snug text-gray-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:text-base">
            {parent.name}
          </Link>
          <p className="mt-0.5 text-sm leading-snug text-gray-700">{formatCount(sellingFormat, control.units)} · {priceLine}</p>
          {composition}
          {cheaperNotice}
          {stockNotice}
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-gray-100 pt-2.5">
        {stepper}
        <p className="text-right leading-tight">
          <span className="block text-xs font-medium text-gray-600">Total</span>
          <span className="text-lg font-extrabold tabular-nums text-gray-950">{formatPrice(total, currency)}</span>
        </p>
      </div>
    </li>
  );
}
