'use client';

import { useEffect, useRef } from 'react';

/**
 * Bouton « retour » du téléphone dans /card : chaque écran ouvert par-dessus
 * la page (paiement, détail d'un moyen externe, étape Stripe) ajoute une
 * entrée d'historique sur la même URL. Le retour système ferme alors l'écran
 * du dessus au lieu de quitter /card. Une pile unique garantit qu'un seul
 * écran — le plus récent — se ferme par pression.
 *
 * L'état Next.js existant (`history.state`) est recopié dans chaque entrée :
 * le routeur App Router recharge la page sur un popstate sans son état.
 * Un écran fermé par l'interface (bouton « Retour », paiement terminé…)
 * retire lui-même son entrée, en une seule navigation groupée.
 */
/** `close` peut refuser (retour `false`) : l'écran reste et l'entrée est recréée. */
interface Step { close: () => boolean | void; popped: boolean }

const stack: Step[] = [];
let ignoredPops = 0;
let pendingBack = 0;
let listening = false;

function onPopState() {
  if (ignoredPops > 0) {
    ignoredPops -= 1;
    return;
  }
  const top = stack[stack.length - 1];
  if (!top) return;
  if (top.close() === false) {
    // Retour refusé (paiement en cours de confirmation) : on reste sur l'écran.
    window.history.pushState({ ...(window.history.state ?? {}), lepefyCardStep: stack.length }, '');
    return;
  }
  stack.pop();
  top.popped = true;
}

function scheduleBack() {
  pendingBack += 1;
  if (pendingBack > 1) return;
  queueMicrotask(() => {
    const count = pendingBack;
    pendingBack = 0;
    ignoredPops += 1;
    window.history.go(-count);
  });
}

export function useCardHistoryStep(open: boolean, close: () => boolean | void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    if (!listening) {
      window.addEventListener('popstate', onPopState);
      listening = true;
    }
    const step: Step = { close: () => closeRef.current(), popped: false };
    stack.push(step);
    window.history.pushState({ ...(window.history.state ?? {}), lepefyCardStep: stack.length }, '');
    return () => {
      const index = stack.indexOf(step);
      if (index === -1) return; // déjà retiré par le retour système
      stack.splice(index, 1);
      if (!step.popped) scheduleBack();
    };
  }, [open]);
}
