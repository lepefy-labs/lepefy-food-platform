'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => el.offsetParent !== null);
}

/**
 * Piège le focus clavier à l'intérieur de `containerRef` tant que `active`
 * est vrai (Tab/Shift+Tab bouclent dans le conteneur), et appelle `onClose`
 * sur Échap. Focus le premier élément focusable à l'activation, restitue le
 * focus à l'élément précédemment actif (le déclencheur du drawer) à la
 * désactivation — sans ça, un utilisateur clavier perdrait sa position dans
 * la page après fermeture. Pas de nouvelle dépendance : ~30 lignes, aucune
 * librairie de ce type dans le repo (cf. audit §21).
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement>, active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const initial = getFocusable(container)[0] ?? container;
    initial.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !container) return;

      const items = getFocusable(container);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
