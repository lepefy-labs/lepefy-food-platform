'use client';

import { useEffect, useRef } from 'react';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import {
  flushCart,
  handleCartOffline,
  handleCartOnline,
  handleCartVisible,
  hydrateCartForCustomer,
  resetCartForLogout,
} from '@/lib/cart/cartSyncEngine';

// Sincronizza il carrello Zustand/localStorage con il carrello server
// (tabella carts) per un cliente autenticato — continuità cross-device.
// Nessun impatto visivo: wrapper trasparente, montato una sola volta in
// ShopLayout. Il carrello guest (non autenticato) resta strettamente
// localStorage, zero chiamate di rete da questo componente (regola
// permanente 6).
//
// Questo componente si occupa SOLO del lifecycle. Tutta la logica di
// sincronizzazione (queue, versioning, retry, riconciliazione, merge) vive in
// lib/cart/cartSyncEngine.ts, testabile senza React.

export function CartSyncProvider({ children }: { children: React.ReactNode }) {
  const { customer, refresh } = useSessionCustomer();

  // Cliente per cui l'idratazione è già stata eseguita — evita di rieseguirla
  // ad ogni re-render, e permette di rieseguirla se cambia il cliente.
  const hydratedForRef = useRef<string | null>(null);

  // ─── 1. Idratazione : login, oppure pagina ricaricata già autenticati ────
  useEffect(() => {
    if (!customer) return;
    if (hydratedForRef.current === customer.id) return;
    hydratedForRef.current = customer.id;
    void hydrateCartForCustomer(customer.id);
  }, [customer]);

  // ─── 2/3. Eventi login/logout ───────────────────────────────────────────
  // CartSyncProvider è persistente tra le navigazioni client-side: non viene
  // rimontato al ritorno da /compte/connexion e non potrebbe scoprire il login
  // in altro modo.
  useEffect(() => {
    function onAuthenticated() {
      void refresh();
    }
    function onLoggedOut() {
      hydratedForRef.current = null;
      void resetCartForLogout();
    }

    window.addEventListener('lepefy:customer-authenticated', onAuthenticated);
    window.addEventListener('lepefy:customer-logged-out', onLoggedOut);
    return () => {
      window.removeEventListener('lepefy:customer-authenticated', onAuthenticated);
      window.removeEventListener('lepefy:customer-logged-out', onLoggedOut);
    };
  }, [refresh]);

  // ─── 4. Connettività ────────────────────────────────────────────────────
  useEffect(() => {
    function onOnline()  { void handleCartOnline(); }
    function onOffline() { handleCartOffline(); }

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // ─── 5. Visibilità e uscita dalla pagina ────────────────────────────────
  // Al ritorno sulla tab si riconcilia solo se l'ultimo sync è abbastanza
  // vecchio (nessun polling aggressivo). Quando la pagina sta per sparire si
  // forza un flush con keepalive: le mutation sono comunque già persistite in
  // localStorage, quindi anche se il browser tronca la richiesta nulla va
  // perso — non ci si affida a beforeunload.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void handleCartVisible();
      else void flushCart({ keepalive: true });
    }
    function onPageHide() {
      void flushCart({ keepalive: true });
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  return <>{children}</>;
}
