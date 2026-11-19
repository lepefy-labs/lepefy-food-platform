'use client';

import { useId } from 'react';
import type { SaleFormatOption } from '@/lib/catalog/saleFormats';
import { formatPrice } from '@/lib/utils/format';
import type { SellingFormat } from '@/lib/storefrontCopy/sellingFormat';
import { saleFormatSavingsLine, saleFormatUnitPriceLine } from '@/lib/storefrontCopy/saleFormatCopy';

interface SaleFormatPickerProps {
  options: SaleFormatOption[];
  /** null = aucun format choisi (jamais de présélection). */
  value: string | null;
  onChange: (id: string) => void;
  currency: string;
  /** Format de vente de la fiche (unité de base), pour le prix unitaire et l'économie. */
  baseFormat: SellingFormat;
  /** Contenu d'une unité de base (« 500 g »), affiché sous chaque format. */
  unitContent: string | null;
  legend?: string;
  compact?: boolean;
}

/**
 * Choix explicite du format de vente (fiche produit et sélecteur rapide de la
 * card). Boutons radio natifs : flèches, Espace et lecteurs d'écran sans code
 * en plus. Un format épuisé reste visible mais désactivé.
 */
export function SaleFormatPicker({ options, value, onChange, currency, baseFormat, unitContent, legend = 'Format', compact = false }: SaleFormatPickerProps) {
  const name = useId();
  return (
    <fieldset className="grid gap-2">
      <legend className={`mb-1 font-bold text-gray-900 ${compact ? 'text-sm' : 'text-base'}`}>{legend}</legend>
      {options.map((option) => {
        const checked = value === option.id;
        const disabled = !option.purchasable;
        const content = option.units > 1 && unitContent ? `${option.units} × ${unitContent}` : unitContent;
        const unitLine = saleFormatUnitPriceLine(option, baseFormat, currency);
        const savings = saleFormatSavingsLine(option, baseFormat, currency);
        return (
          <label
            key={option.id}
            className={`grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border-2 px-3 py-2.5 transition-colors motion-reduce:transition-none has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
              disabled
                ? 'cursor-not-allowed border-dashed border-gray-300 bg-gray-50 text-gray-600'
                : checked ? 'bg-white' : 'border-gray-300 bg-white hover:border-gray-400'
            }`}
            style={checked && !disabled ? { borderColor: 'var(--color-primary)', backgroundColor: 'color-mix(in srgb, var(--color-primary) 7%, white)' } : undefined}
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(option.id)}
              className="h-5 w-5 shrink-0"
              style={{ accentColor: 'var(--color-primary)' }}
            />
            <span className="min-w-0">
              <span className={`block font-bold leading-snug ${compact ? 'text-sm' : 'text-[15px]'}`}>{option.label}</span>
              {(content || unitLine) && (
                <span className="block text-xs leading-snug text-gray-700">{[content, unitLine].filter(Boolean).join(' · ')}</span>
              )}
              {disabled ? (
                <span className="mt-1 inline-block rounded-md bg-gray-200 px-1.5 py-0.5 text-xs font-bold text-gray-800">Épuisé pour ce format</span>
              ) : savings ? (
                <span className="mt-1 inline-block rounded-md bg-green-100 px-1.5 py-0.5 text-xs font-bold leading-snug text-green-900">{savings}</span>
              ) : null}
            </span>
            <span className="text-right">
              <span className={`block font-extrabold tabular-nums text-gray-950 ${compact ? 'text-sm' : 'text-base'}`}>{formatPrice(option.price, currency)}</span>
              {option.compareAtPrice != null && option.compareAtPrice > option.price && (
                <span className="block text-xs text-gray-600 line-through tabular-nums">{formatPrice(option.compareAtPrice, currency)}</span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
