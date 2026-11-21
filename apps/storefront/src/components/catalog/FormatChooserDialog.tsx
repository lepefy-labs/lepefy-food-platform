'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from '@tabler/icons-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useTenant } from '@/providers/TenantProvider';
import { formatPrice } from '@/lib/utils/format';
import { formatQuantityLabel, type SaleFormatOption } from '@/lib/catalog/saleFormats';
import type { FormatParentForCart } from '@/lib/cart/saleFormatCart';
import { contentLabel, resolveSellingFormat } from '@/lib/storefrontCopy/sellingFormat';
import { SaleFormatPicker } from '@/components/product/SaleFormatPicker';

interface FormatChooserDialogProps {
  open: boolean;
  product: FormatParentForCart & { net_quantity_display?: string | null };
  options: SaleFormatOption[];
  onClose: () => void;
  /**
   * Ajoute le format choisi (unités de base : 1 paquet = 1, lot de 3 = 3) ; le
   * panier recompose ensuite la combinaison la moins chère. true = ajouté.
   */
  onAddUnits: (option: SaleFormatOption) => boolean;
  /** Marge de poids sans hausse de livraison (« Ça rentre dans votre colis ») ; absent = non affiché. */
  shippingHeadroomG?: number | null;
}

/**
 * Sélecteur rapide des formats depuis une card : aucun format présélectionné,
 * le « + » n'ajoute jamais un lot par surprise. Feuille en bas de l'écran sur
 * mobile, fenêtre centrée au-delà ; Échap ferme, Tab reste dans la fenêtre.
 */
export function FormatChooserDialog({ open, product, options, onClose, onAddUnits, shippingHeadroomG }: FormatChooserDialogProps) {
  const { currency } = useTenant();
  const panelRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bouton toujours actif : sans format choisi, il le dit et ramène au choix.
  const [prompt, setPrompt] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (!open) { setSelectedId(null); setPrompt(false); } }, [open]);
  useFocusTrap(panelRef, open, onClose);

  if (!open || !mounted) return null;
  const sellingFormat = resolveSellingFormat(product);
  const selected = options.find((option) => option.id === selectedId) ?? null;

  function add() {
    if (!selected || !selected.purchasable) {
      setPrompt(true);
      panelRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:not([disabled])')?.focus();
      return;
    }
    if (onAddUnits(selected)) onClose();
  }

  return createPortal(
    // Les événements React traversent le portail : la card est un <Link>, d'où stopPropagation.
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-gray-900/40 sm:items-center"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="format-chooser-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:pb-4"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="format-chooser-title" className="text-base font-bold text-gray-950">Choisir le format</h2>
            <p className="truncate text-sm text-gray-700">{product.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100">
            <IconX size={20} aria-hidden="true" />
          </button>
        </div>
        <SaleFormatPicker
          options={options}
          value={selectedId}
          onChange={(id) => { setSelectedId(id); setPrompt(false); }}
          currency={currency}
          baseFormat={sellingFormat}
          unitContent={contentLabel(sellingFormat) ?? product.net_quantity_display ?? null}
          legend="Format"
          compact
          shippingHeadroomG={shippingHeadroomG}
        />
        {prompt && (
          <p role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
            Choisissez d’abord un format ci-dessus.
          </p>
        )}
        <button
          type="button"
          onClick={add}
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-sm font-bold text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {selected
            ? `Ajouter ${formatQuantityLabel(selected.label, selected.minimum)} · ${formatPrice(selected.price * selected.minimum, currency)}`
            : 'Ajouter au panier'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
