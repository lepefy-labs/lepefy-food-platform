'use client';

import Link from 'next/link';
import { IconStack2 } from '@tabler/icons-react';
import { useQuantityGroups } from '@/lib/cart/useQuantityGroups';
import { useHydratedCartItems } from '@/lib/cart/useHydratedCart';
import { computeQuantityRuleState } from '@/lib/purchaseQuantityRules';
import { groupChipText } from '@/lib/storefrontCopy/quantityRuleCopy';

/**
 * Un produit d'un groupe à mélanger (ex. « Boissons », 12 minimum tous
 * produits confondus) le dit là où on l'ajoute : card du catalogue et
 * confirmation d'ajout. « Boissons : 12 minimum, à mélanger », puis
 * « Boissons : 3 / 12 » dès qu'il y en a au panier, « Boissons : 12 ✓ ».
 *
 * Lit les groupes du store partagé (une requête par page, CDN) ; rien tant
 * qu'ils ne sont pas lus. Guide seulement : /api/checkout reste l'autorité.
 */
export function QuantityGroupChip({ productId, withLink = false, onNavigate, className = '' }: {
  productId: string;
  /** Lien « Voir les produits à mélanger » (confirmation d'ajout). */
  withLink?: boolean;
  /** Fermeture de la fenêtre qui contient le lien. */
  onNavigate?: () => void;
  className?: string;
}) {
  const { groups } = useQuantityGroups();
  const items = useHydratedCartItems();
  const group = groups.find((entry) => entry.productIds.includes(productId));
  if (!group || group.min_quantity <= 1) return null;
  const current = items
    .filter((item) => group.productIds.includes(item.product.id))
    .reduce((sum, item) => sum + item.quantity, 0);
  const state = computeQuantityRuleState(current, group.min_quantity, group.quantity_step);
  const done = current > 0 && state.isValid;
  const text = groupChipText(group.name, group.min_quantity, current, state.nextValidQuantity);
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border px-1.5 py-1 text-xs font-semibold leading-snug ${done ? 'border-green-300 bg-green-50 text-green-900' : 'border-sky-300 bg-sky-50 text-sky-950'} ${className}`}>
      <IconStack2 size={14} aria-hidden="true" className="shrink-0" />
      <span aria-live="polite">{text}</span>
      {withLink && !done && (
        <Link href={`/?quantityGroup=${encodeURIComponent(group.id)}`} prefetch={false} onClick={onNavigate} className="font-bold underline underline-offset-2">
          Voir les produits à mélanger
        </Link>
      )}
    </p>
  );
}
