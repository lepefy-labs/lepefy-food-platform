import type { ReactNode } from 'react';

interface ShopTagProps {
  children: ReactNode;
  /** Positionnement dans le contexte appelant (absolu sur une card, statique dans l'eyebrow). */
  className?: string;
}

/**
 * Élément signature de la plateforme : le "cartellino da bottega" — étiquette
 * de boutique en forme de tag (pointe à gauche, coin biseauté, petite
 * perforation), inspirée des étiquettes d'épicerie artisanale.
 *
 * Couleur dérivée de var(--color-secondary) — jamais hardcodée en or/gold :
 * pour ChloeFood le token résout aujourd'hui vers une teinte moutarde proche
 * de la maquette, mais le composant reste correct pour n'importe quel tenant.
 *
 * Exception d'accessibilité documentée : le texte utilise un ton sombre fixe
 * (#1a1a1a) plutôt qu'un token, car --color-secondary est conçu comme un
 * accent clair (badge panier en Fase 1) et un texte blanc y échouerait le
 * contraste AA pour la plupart des teintes d'accent plausibles. Même choix
 * déjà fait pour le badge panier de BottomNav.tsx.
 */
export function ShopTag({ children, className = '' }: ShopTagProps) {
  return (
    <span
      className={`font-display inline-flex items-center gap-1 pl-3.5 pr-2.5 py-1 text-2xs font-semibold tracking-wide uppercase shadow-card whitespace-nowrap ${className}`}
      style={{
        backgroundColor: 'var(--color-secondary)',
        color: '#1a1a1a',
        clipPath: 'polygon(15% 0%, 92% 0%, 100% 8%, 100% 100%, 15% 100%, 0% 50%)',
        WebkitMaskImage: 'radial-gradient(circle 2.5px at 9px 50%, transparent 98%, black 100%)',
        maskImage: 'radial-gradient(circle 2.5px at 9px 50%, transparent 98%, black 100%)',
        transform: 'rotate(-3deg)',
      }}
    >
      {children}
    </span>
  );
}
