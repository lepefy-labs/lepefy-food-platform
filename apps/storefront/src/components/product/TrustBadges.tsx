import { IconTruck, IconLock, IconSnowflake, IconPackage } from '@tabler/icons-react';

interface TrustBadgesProps {
  storageType: 'dry' | 'fresh' | 'frozen' | null;
}

/**
 * Réassurance sous le CTA — uniquement des promesses réellement tenues par
 * la plateforme (pas de "satisfait ou remboursé", aucune garantie
 * contractuelle non confirmée). "Conservé au frais" n'est affiché que pour
 * les produits frais/surgelés : l'afficher pour un produit sec serait un
 * claim faux.
 */
export function TrustBadges({ storageType }: TrustBadgesProps) {
  const showCold = storageType === 'fresh' || storageType === 'frozen';

  const badges = [
    { icon: IconTruck, label: 'Livraison suivie' },
    { icon: IconLock, label: 'Paiement sécurisé' },
    ...(showCold ? [{ icon: IconSnowflake, label: 'Conservé au frais' }] : []),
    { icon: IconPackage, label: 'Emballage soigné' },
  ];

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
      {badges.map(({ icon: Icon, label }) => (
        <div key={label} className="flex items-center gap-1.5 text-xs text-gray-500">
          <Icon size={16} stroke={1.75} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
