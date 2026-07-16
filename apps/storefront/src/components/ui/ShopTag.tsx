import type { ReactNode } from 'react';

interface ShopTagProps {
  children: ReactNode;
  /** Positionnement dans le contexte appelant (absolu sur une card, statique dans l'eyebrow). */
  className?: string;
}

/**
 * Élément signature de la plateforme : le "cartellino da bottega" — étiquette
 * de boutique en forme de tag (pointe en bas à gauche, petite perforation),
 * fidèle à la géométrie du mockup approuvé (Mockup_Fase3_Validazione_UIUX.html).
 *
 * Couleur dérivée de var(--color-secondary) — jamais hardcodée en or/gold :
 * le mockup la décrit comme "fixe, tirée du logo", un raisonnement propre à
 * ChloeFood et non généralisable. Pour ChloeFood le token résout aujourd'hui
 * vers une teinte moutarde proche de la maquette, mais le composant reste
 * correct pour n'importe quel tenant.
 *
 * Police : le mockup utilise var(--font-body) pour le texte du tag (pas
 * --font-display) — repris ici tel quel, le display est réservé aux titres.
 *
 * Exception d'accessibilité documentée : le texte utilise un ton sombre fixe
 * (#1a1a1a) plutôt qu'un token, car --color-secondary est conçu comme un
 * accent clair (badge panier en Fase 1) et un texte blanc y échouerait le
 * contraste AA pour la plupart des teintes d'accent plausibles. Même choix
 * déjà fait pour le badge panier de BottomNav.tsx. La perforation utilise un
 * point plein blanc (comme le mockup), pas un vrai trou : simple et fiable
 * puisque le tag repose toujours sur un fond neutre connu (page ou carte),
 * jamais directement sur une photo produit.
 */
export function ShopTag({ children, className = '' }: ShopTagProps) {
  return (
    <span
      className={`relative inline-flex items-center gap-1.5 text-xs font-bold tracking-wide shadow-card whitespace-nowrap ${className}`}
      style={{
        backgroundColor: 'var(--color-secondary)',
        color: '#1a1a1a',
        padding: '6px 12px 6px 10px',
        clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 12px 100%, 0% 70%)',
        transform: 'rotate(-2deg)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          width: 5,
          height: 5,
          borderRadius: '50%',
          backgroundColor: '#fff',
        }}
      />
      {children}
    </span>
  );
}
