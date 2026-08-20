// "1 produit" / "4 produits" — jamais "produits" au singulier (§4 de la spec
// redesign). Locale française : CLAUDE.md impose fr-FR sur tout le storefront,
// contrairement aux exemples italiens du prompt d'origine.
export function formatProductCount(count: number): string {
  return `${count} produit${count > 1 ? 's' : ''}`;
}
