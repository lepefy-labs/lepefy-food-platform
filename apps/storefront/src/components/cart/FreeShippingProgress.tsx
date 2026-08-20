import { formatPrice } from '@/lib/utils/format';

interface FreeShippingProgressProps {
  subtotal: number;
  /**
   * Seuil de livraison gratuite. `null`/`undefined` → rien n'est rendu.
   *
   * Volontairement jamais alimenté avec une vraie valeur dans cette tâche :
   * le repo n'a pas de seuil global — seulement `shipping_country_rules.
   * free_shipping_above`, résolu serveur par pays/CAP (cf. resolveCountryRule.
   * ts), donc dépendant d'une adresse que le drawer n'a pas. L'introduire ici
   * demanderait un nouvel appel réseau + de la logique métier shipping,
   * explicitement hors périmètre (§12/§35 de la spec). Composant prêt à
   * recevoir un seuil réel dès qu'une source appropriée existera, sans
   * modification.
   */
  threshold?: number | null;
  currency?: string;
}

export function FreeShippingProgress({ subtotal, threshold, currency }: FreeShippingProgressProps) {
  if (threshold === null || threshold === undefined || threshold <= 0) return null;

  const remaining = Math.max(0, threshold - subtotal);
  const progress = Math.min(100, (subtotal / threshold) * 100);

  if (remaining === 0) {
    return (
      <p className="text-sm font-medium text-center py-1" style={{ color: 'var(--color-primary)' }}>
        🎉 Vous avez atteint la livraison gratuite&nbsp;!
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-1.5">
        Plus que <span className="font-semibold text-gray-700">{formatPrice(remaining, currency)}</span> pour la livraison gratuite
      </p>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${progress}%`, backgroundColor: 'var(--color-primary)' }}
        />
      </div>
    </div>
  );
}
