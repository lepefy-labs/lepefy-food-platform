/** Pastille quantité du panier : lisible même au-delà de 99 articles. */
export function formatCartBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Libellé accessible du panier, cohérent avec le nombre d'articles. */
export function cartAriaLabel(count: number, prefix = 'Panier'): string {
  if (count <= 0) return `${prefix}, vide`;
  return `${prefix}, ${count} article${count > 1 ? 's' : ''}`;
}
