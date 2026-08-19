'use client';

import { useEffect, useRef } from 'react';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import { useCartStore } from '@/stores/cartStore';
import type { CartItem } from '@lepefy/types';

// Synchronise le panier Zustand/localStorage avec le panier serveur
// (carts table) pour un client authentifié — continuité cross-device.
// Aucun impact visuel : wrapper transparent, monté une seule fois dans
// ShopLayout. Le panier guest (non authentifié) reste strictement
// localStorage, zéro appel réseau depuis ce composant (règle permanente 6).

const SYNC_DEBOUNCE_MS = 900;

// Fusion "somme les quantités, clampe au stock" — même principe que
// addItem() de cartStore.ts, mais appliqué en un seul setState atomique
// plutôt qu'en boucle d'appels addItem : évite plusieurs écritures
// persist/localStorage successives et plusieurs re-renders pour un seul
// événement logique (le merge au login). Les infos produit du panier serveur
// sont préférées (rihydratées à l'instant via /api/customers/me/cart, donc
// plus fraîches que celles potentiellement stockées depuis longtemps dans le
// panier local) : seule la quantité locale est reportée, jamais son prix/stock.
function mergeCartItems(localItems: CartItem[], serverItems: CartItem[]): CartItem[] {
  const merged = new Map<string, CartItem>();
  for (const item of serverItems) merged.set(item.product.id, item);

  for (const item of localItems) {
    const existing = merged.get(item.product.id);
    if (existing) {
      merged.set(item.product.id, {
        product:  existing.product,
        quantity: Math.min(existing.quantity + item.quantity, existing.product.stock),
      });
    } else {
      merged.set(item.product.id, item);
    }
  }

  return Array.from(merged.values());
}

async function pushCartToServer(items: CartItem[]) {
  try {
    await fetch('/api/customers/me/cart', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
      }),
    });
  } catch {
    // Best-effort — un échec de sync ne doit jamais bloquer l'usage local du
    // panier ; le prochain changement (ou le prochain login) retentera.
  }
}

export function CartSyncProvider({ children }: { children: React.ReactNode }) {
  const { customer, refresh } = useSessionCustomer();

  // Une seule fusion par "session de login" — se réinitialise au logout
  // (cf. Task 3/4 du prompt) pour permettre un nouveau merge si un autre
  // client se logue sur le même appareil.
  const hasMergedRef = useRef(false);
  const isAuthedRef   = useRef(false);
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function mergeCart() {
    if (hasMergedRef.current) return;
    hasMergedRef.current = true;
    try {
      const res = await fetch('/api/customers/me/cart');
      if (!res.ok) return;
      const data = await res.json();
      const serverItems: CartItem[] = data.items ?? [];
      const localItems = useCartStore.getState().items;
      const merged = mergeCartItems(localItems, serverItems);
      useCartStore.setState({ items: merged });
      await pushCartToServer(merged);
    } catch {
      // best-effort — laisse hasMergedRef à true : un échec réseau ponctuel
      // ne doit pas redéclencher un merge en boucle à chaque re-render.
    }
  }

  // 1. Cas "page rechargée alors que déjà connecté".
  useEffect(() => {
    if (customer && !hasMergedRef.current) mergeCart();
    isAuthedRef.current = !!customer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  // 2/3. Événements login/logout — CartSyncProvider est persistant entre
  // navigations client-side, il ne se remonte pas au retour de
  // /compte/connexion et ne peut donc pas découvrir le login autrement.
  useEffect(() => {
    function onAuthenticated() {
      refresh().then(() => mergeCart());
    }
    function onLoggedOut() {
      // Le panier local n'est volontairement PAS vidé ici (reste comme
      // panier guest sur l'appareil) — compromis connu pour un appareil
      // partagé, accepté pour cette v1, cf. deviation report.
      hasMergedRef.current = false;
      isAuthedRef.current  = false;
    }

    window.addEventListener('lepefy:customer-authenticated', onAuthenticated);
    window.addEventListener('lepefy:customer-logged-out', onLoggedOut);
    return () => {
      window.removeEventListener('lepefy:customer-authenticated', onAuthenticated);
      window.removeEventListener('lepefy:customer-logged-out', onLoggedOut);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 5. Sync continue, débouncée — uniquement si authentifié à l'instant du
  // changement (guard isAuthedRef, jamais un appel réseau pour un guest).
  useEffect(() => {
    const unsubscribe = useCartStore.subscribe((state) => {
      if (!isAuthedRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        pushCartToServer(state.items);
      }, SYNC_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return <>{children}</>;
}
