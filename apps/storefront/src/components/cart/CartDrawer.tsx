'use client';

import { useEffect, useRef, useState } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useTenant } from '@/providers/TenantProvider';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  selectCartItems,
  selectCartItemCount,
  selectCartSubtotal,
  selectCartIsEmpty,
  selectPendingProductIds,
} from '@/lib/cart/cartSelectors';
import { CartDrawerHeader } from './CartDrawerHeader';
import { CartDrawerFooter } from './CartDrawerFooter';
import { CartDrawerEmpty } from './CartDrawerEmpty';
import { CartItem } from './CartItem';
import { CartUndoToast } from './CartUndoToast';
import type { CartItem as CartItemType } from '@lepefy/types';

const TITLE_ID = 'cart-drawer-title';
const UNDO_TIMEOUT_MS = 5000;

/**
 * Point d'accès rapide au panier — remplace la navigation directe vers /cart
 * depuis le lien "Panier" du Header desktop (§2/§3 de la spec redesign).
 *
 * Monté une seule fois dans ShopLayout (comme ChatWidget), toujours présent
 * dans le DOM et piloté par classes CSS (transform/opacity) plutôt que par
 * mount/unmount conditionnel : permet une vraie transition d'ouverture/
 * fermeture sans lib d'animation (aucune dans ce repo, cf. audit §21).
 *
 * Source de vérité unique : cartStore (§23) — ce composant ne détient aucune
 * copie du panier, seulement l'état local éphémère du toast d'annulation.
 */
export function CartDrawer() {
  const isOpen = useCartUiStore((s) => s.isDrawerOpen);
  const closeDrawer = useCartUiStore((s) => s.closeDrawer);
  const tenant = useTenant();

  const items = useCartStore(selectCartItems);
  const itemCount = useCartStore(selectCartItemCount);
  const subtotal = useCartStore(selectCartSubtotal);
  const isEmpty = useCartStore(selectCartIsEmpty);
  const pendingProductIds = useCartStore(selectPendingProductIds);
  const unavailableProductIds = useCartStore((s) => s.unavailableProductIds);
  const syncStatus = useCartStore((s) => s.syncStatus);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const addItem = useCartStore((s) => s.addItem);

  const panelRef = useRef<HTMLDivElement>(null);
  const [undo, setUndo] = useState<{ item: CartItemType; timeoutId: ReturnType<typeof setTimeout> } | null>(null);

  useFocusTrap(panelRef, isOpen, closeDrawer);

  // Verrou de scroll body pendant l'ouverture — restaure la valeur précédente
  // à la fermeture/démontage, jamais un `hidden` en dur qui écraserait un
  // autre verrou éventuel.
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [isOpen]);

  // Un toast d'annulation périmé n'a pas de sens une fois le drawer refermé.
  useEffect(() => {
    if (isOpen) return;
    if (undo) { clearTimeout(undo.timeoutId); setUndo(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => () => { if (undo) clearTimeout(undo.timeoutId); }, [undo]);

  function handleIncrement(productId: string) {
    const item = items.find((i) => i.product.id === productId);
    if (!item) return;
    updateQuantity(productId, Math.min(item.quantity + 1, item.product.stock));
  }

  function handleDecrement(productId: string) {
    const item = items.find((i) => i.product.id === productId);
    if (!item) return;
    updateQuantity(productId, item.quantity - 1);
  }

  function handleRemove(productId: string) {
    const item = items.find((i) => i.product.id === productId);
    if (!item) return;
    if (undo) clearTimeout(undo.timeoutId);
    removeItem(productId);
    const timeoutId = setTimeout(() => setUndo(null), UNDO_TIMEOUT_MS);
    setUndo({ item, timeoutId });
  }

  function handleUndo() {
    if (!undo) return;
    clearTimeout(undo.timeoutId);
    addItem(undo.item.product, undo.item.quantity);
    setUndo(null);
  }

  return (
    <div className={isOpen ? '' : 'pointer-events-none'} aria-hidden={!isOpen}>
      {/* Overlay */}
      <div
        onClick={closeDrawer}
        className={`fixed inset-0 z-[70] bg-black/40 transition-opacity duration-200 motion-reduce:transition-none ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel — bottom sheet sur mobile, side drawer à partir de sm (§3/§20) */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
        className={`fixed z-[71] bg-white shadow-xl flex flex-col
          inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl
          sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:bottom-auto sm:top-0
          sm:h-full sm:max-h-none sm:w-full sm:max-w-[420px] sm:rounded-t-none
          transition-transform duration-200 ease-out motion-reduce:transition-none
          ${isOpen ? 'translate-y-0 translate-x-0' : 'translate-y-full sm:translate-y-0 sm:translate-x-full'}`}
      >
        <CartDrawerHeader itemCount={itemCount} onClose={closeDrawer} titleId={TITLE_ID} />

        {isEmpty ? (
          <CartDrawerEmpty onNavigate={closeDrawer} />
        ) : (
          <ul className="flex-1 overflow-y-auto px-5">
            {items.map((item) => (
              <CartItem
                key={item.product.id}
                item={item}
                currency={tenant.currency}
                unavailableProductIds={unavailableProductIds}
                pendingProductIds={pendingProductIds}
                onIncrement={handleIncrement}
                onDecrement={handleDecrement}
                onRemove={handleRemove}
              />
            ))}
          </ul>
        )}

        {/* Flux normal, jamais en overlay par-dessus le footer — cf.
            commentaire dans CartUndoToast.tsx. */}
        {undo && (
          <CartUndoToast productName={undo.item.product.name} onUndo={handleUndo} />
        )}

        {!isEmpty && (
          <CartDrawerFooter
            subtotal={subtotal}
            currency={tenant.currency}
            syncStatus={syncStatus}
            onNavigateToCart={closeDrawer}
            onContinueShopping={closeDrawer}
          />
        )}
      </div>
    </div>
  );
}
