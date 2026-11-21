// Compteur du panier (en-têtes, barre, checkout) : « 1 article » / « 11 articles ».
// Le nombre compte les unités, comme le badge (`selectCartItemCount` : un carton
// de 10 paquets = 10). Le mot est « article » et non « produit » : 1 carton
// + 1 paquet d'une même fiche tiennent sur une seule ligne, « 11 produits »
// laissait croire à 11 fiches. Locale française (fr-FR sur tout le storefront).
export function formatProductCount(count: number): string {
  return `${count} article${count > 1 ? 's' : ''}`;
}
