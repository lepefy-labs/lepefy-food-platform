/**
 * Projection Supabase canonique pour toute requête `products` qui alimente
 * une carte produit (ProductCard, GoodiesHero, RelatedProducts, Nala…).
 *
 * Un seul endroit à modifier pour ajouter/retirer un champ affiché sur une
 * card — au lieu de répéter (et faire diverger) la même liste de colonnes
 * dans chaque page/route qui interroge `products`. `min_order_quantity` et
 * `order_quantity_step` (migration 121) sont volontairement dans cette
 * liste : toute card doit pouvoir afficher la règle de quantité minimale,
 * jamais la découvrir seulement à l'ajout au panier. Même raison pour
 * `fulfillment_policy` (migration 155) : « retrait uniquement » se voit sur la card.
 */
/** Colonnes du format de vente affiché au client (lib/storefrontCopy/sellingFormat.ts, migration 154). */
export const PRODUCT_SELLING_FORMAT_COLUMNS = 'net_quantity_display, sale_unit, net_content_value, net_content_unit, pack_count';

/** Colonnes scalaires communes, sans la relation `category` (jointure dont la
 *  forme — `left join` ou `!inner` — varie selon l'appelant, cf. gadgets). */
export const PRODUCT_CARD_BASE_COLUMNS =
  `id, name, slug, price, compare_at_price, image_url, weight_grams, stock, storage_type, min_order_quantity, order_quantity_step, fulfillment_policy, ${PRODUCT_SELLING_FORMAT_COLUMNS}`;

export const PRODUCT_CARD_SELECT = `${PRODUCT_CARD_BASE_COLUMNS}, category:categories(name)`;
