'use client';

import { useEffect, useRef, useState } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useAddToCartUiStore } from '@/stores/addToCartUiStore';
import {
  CART_NUDGE_STORAGE_KEY,
  parseNudgeHistory,
  shouldNudgeCart,
} from './cartNudgePolicy';
import { isCheckoutPath } from '@/lib/storefront/shopChrome';

const POP_MS = 450;
const NUDGE_MS = 700;
const NUDGE_DELAY_MS = 900;

/** `true` le temps du « pop » qui suit un ajout réel du client (jamais au montage). */
export function useCartAddPulse(): boolean {
  const revision = useCartUiStore((s) => s.addRevision);
  const seen = useRef(revision);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (revision === seen.current) return;
    seen.current = revision;
    // Relance l'animation même si un ajout précédent est encore en cours.
    setPulsing(false);
    const frame = requestAnimationFrame(() => setPulsing(true));
    const timer = setTimeout(() => setPulsing(false), POP_MS + 50);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [revision]);

  return pulsing;
}

function readHistory(): number[] {
  try { return parseNudgeHistory(window.sessionStorage.getItem(CART_NUDGE_STORAGE_KEY)); } catch { return []; }
}

function writeHistory(history: number[]): void {
  try { window.sessionStorage.setItem(CART_NUDGE_STORAGE_KEY, JSON.stringify(history)); } catch { /* stockage bloqué */ }
}

/**
 * Rappel occasionnel d'un panier non vide, évalué uniquement quand le client
 * ouvre une nouvelle page. La fréquence est bornée par `shouldNudgeCart`.
 */
export function useCartNudge(pathname: string): boolean {
  const sessionStartedAt = useRef<number | null>(null);
  const [nudging, setNudging] = useState(false);

  useEffect(() => {
    if (sessionStartedAt.current === null) sessionStartedAt.current = Date.now();
    const onCart = pathname === '/cart';
    if (onCart) useCartUiStore.getState().markViewed();

    const history = readHistory();
    const decide = (now: number) => shouldNudgeCart({
      now,
      itemCount: useCartStore.getState().totalItems(),
      onCartOrCheckout: onCart || isCheckoutPath(pathname),
      drawerOpen: useCartUiStore.getState().isDrawerOpen,
      confirmationOpen: useAddToCartUiStore.getState().product !== null,
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
      documentHidden: document.visibilityState === 'hidden',
      sessionStartedAt: sessionStartedAt.current ?? now,
      lastAddAt: useCartUiStore.getState().lastAddAt,
      lastCartViewAt: useCartUiStore.getState().lastViewAt,
      history,
    });
    if (!decide(Date.now())) return;

    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    // Laisse la nouvelle page s'afficher ; revérifie au moment de jouer.
    const startTimer = setTimeout(() => {
      const now = Date.now();
      if (!decide(now)) return;
      writeHistory([...history, now]);
      setNudging(true);
      stopTimer = setTimeout(() => setNudging(false), NUDGE_MS + 50);
    }, NUDGE_DELAY_MS);
    return () => {
      clearTimeout(startTimer);
      if (stopTimer) clearTimeout(stopTimer);
      setNudging(false);
    };
  }, [pathname]);

  return nudging;
}
