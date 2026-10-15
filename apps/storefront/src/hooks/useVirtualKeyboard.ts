'use client';

import { useEffect, useState } from 'react';

/** Écart minimal (px) entre la hauteur de référence et la zone visible pour parler de clavier ouvert. */
const KEYBOARD_THRESHOLD = 150;

export interface VirtualKeyboardState {
  /** Clavier virtuel ouvert (zone visible nettement plus basse que l'écran). */
  open: boolean;
  /** Hauteur de la zone réellement visible (au-dessus du clavier), en px CSS. */
  viewportHeight: number | null;
  /** `visualViewport` absent : l'appelant retombe sur le seul focus. */
  supported: boolean;
}

/**
 * Clavier virtuel mobile (iOS, Android, PWA installée) déduit de
 * `visualViewport` : sa hauteur baisse quand le clavier s'ouvre. La hauteur
 * de référence est la plus grande vue pour la largeur courante (rotation =
 * nouvelle référence), ce qui fonctionne que le navigateur redimensionne ou
 * non la page. Le zoom (pincement) est neutralisé par `scale`. Inactif quand
 * `enabled` est faux : aucun écouteur.
 */
export function useVirtualKeyboard(enabled: boolean): VirtualKeyboardState {
  const [state, setState] = useState<VirtualKeyboardState>({ open: false, viewportHeight: null, supported: true });

  useEffect(() => {
    if (!enabled) {
      setState((current) => (current.open || current.viewportHeight !== null ? { ...current, open: false, viewportHeight: null } : current));
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) {
      setState({ open: false, viewportHeight: null, supported: false });
      return;
    }
    let baselineWidth = window.innerWidth;
    let baseline = Math.max(window.innerHeight, viewport.height * viewport.scale);
    function update() {
      if (!viewport) return;
      if (window.innerWidth !== baselineWidth) {
        baselineWidth = window.innerWidth;
        baseline = 0;
      }
      const visible = viewport.height * viewport.scale;
      baseline = Math.max(baseline, window.innerHeight, visible);
      const open = baseline - visible > KEYBOARD_THRESHOLD;
      setState((current) => (current.open === open && current.viewportHeight === viewport.height && current.supported
        ? current
        : { open, viewportHeight: viewport.height, supported: true }));
    }
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, [enabled]);

  return state;
}
