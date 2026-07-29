/**
 * Variante du "cartellino da bottega" (ShopTag.tsx) pour la corde de
 * parrainage : même géométrie (clip-path pointe + perforation), mais couleur
 * et taille variables — jamais --color-secondary ici (réservé au code perso
 * dans le hero), toujours dérivé de --color-primary via color-mix comme la
 * ticker bar (cf. (shop)/layout.tsx, 55% niveau 1). Composant séparé plutôt
 * que d'étendre ShopTag.tsx pour ne pas toucher un composant déjà utilisé
 * ailleurs dans la plateforme.
 */
interface RopeTagProps {
  /** Taille en px du côté du tag — encode les points générés par la branche, jamais décoratif seul (32-56px). */
  size: number;
  /** Niveau dans la chaîne (1 = filleul direct) — pilote l'assombrissement progressif. */
  level: number;
  /** Texte accessible (lu par lecteur d'écran / title au survol) — jamais email/téléphone. */
  label: string;
}

export function RopeTag({ size, level, label }: RopeTagProps) {
  const darkenPct = Math.max(55 - 10 * level, 20);
  const clampedSize = Math.max(32, Math.min(56, size));

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="relative inline-flex shrink-0 shadow-card"
      style={{
        backgroundColor: `color-mix(in oklch, var(--color-primary) ${darkenPct}%, black)`,
        width: clampedSize,
        height: clampedSize * 0.72,
        clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 14% 100%, 0% 68%)',
        transform: 'rotate(-2deg)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: clampedSize * 0.14,
          left: clampedSize * 0.14,
          width: Math.max(3, clampedSize * 0.09),
          height: Math.max(3, clampedSize * 0.09),
          borderRadius: '50%',
          backgroundColor: '#fff',
        }}
      />
    </span>
  );
}
