interface TrustBadgesProps {
  storageType: 'dry' | 'fresh' | 'frozen' | null;
}

/**
 * Réassurance sous le CTA — uniquement des promesses réellement tenues par
 * la plateforme (pas de "satisfait ou remboursé", aucune garantie
 * contractuelle non confirmée). "Conservé au frais" n'est affiché que pour
 * les produits frais/surgelés : l'afficher pour un produit sec serait un
 * claim faux.
 *
 * Emoji plutôt qu'icônes Tabler monochromes : ici c'est la vitrine client
 * (pas le dashboard admin), la couleur native de l'emoji sert la perception
 * de confiance sans avoir besoin d'un token couleur supplémentaire. Fond
 * gris neutre (gray-50), volontairement indépendant de --color-primary —
 * c'est un habillage identique quel que soit le tenant, pas un accent de
 * marque.
 */
export function TrustBadges({ storageType }: TrustBadgesProps) {
  const showCold = storageType === 'fresh' || storageType === 'frozen';

  const badges = [
    { emoji: '🚚', label: 'Livraison suivie' },
    { emoji: '🔒', label: 'Paiement sécurisé' },
    ...(showCold ? [{ emoji: '❄️', label: 'Conservé au frais' }] : []),
    { emoji: '📦', label: 'Emballage soigné' },
  ];

  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {badges.map(({ emoji, label }) => (
        <div
          key={label}
          className="flex items-center gap-2.5 bg-gray-50 rounded-[10px] px-3 py-3"
        >
          <span className="text-base leading-none" aria-hidden="true">{emoji}</span>
          <span className="text-[13px] text-gray-600">{label}</span>
        </div>
      ))}
    </div>
  );
}
