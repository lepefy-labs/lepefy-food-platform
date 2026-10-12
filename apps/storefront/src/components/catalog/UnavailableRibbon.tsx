/**
 * Bandeau diagonal rouge « pas disponible » posé sur l'image d'un produit
 * indisponible (épuisé ou stock sous le minimum, cf. `deriveAvailability`).
 *
 * Le parent doit être `relative overflow-hidden`. Décoratif pour les lecteurs
 * d'écran (`aria-hidden`) : l'indisponibilité est toujours dite aussi par le
 * texte du bouton ou de la fiche, jamais seulement par cette image.
 */
export function UnavailableRibbon({ size = 'card' }: { size?: 'card' | 'detail' }) {
  const detail = size === 'detail';
  return (
    <span aria-hidden="true" data-unavailable-ribbon="" className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      <span
        className={`absolute left-1/2 top-1/2 w-[160%] -translate-x-1/2 -translate-y-1/2 -rotate-[30deg] border-y-2 border-white/90 bg-red-700/95 text-center font-black text-white shadow-[0_4px_14px_rgba(127,29,29,0.35)] ${
          detail ? 'py-2.5 text-xl tracking-[0.06em] sm:text-2xl' : 'py-1.5 text-[13px] tracking-[0.04em] sm:text-sm'
        }`}
      >
        pas disponible
      </span>
    </span>
  );
}
