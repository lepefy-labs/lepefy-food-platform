/**
 * « Petits plus » (migration 165) : produits d'impulsion choisis et ordonnés
 * par la boutique (`products.add_on_position`), proposés au panier et dans la
 * confirmation d'ajout après les complémentaires du panier. Règles pures,
 * partagées par l'admin et les routes.
 */

export const MAX_ADD_ONS = 40;

export interface AddOnAdminProduct {
  id: string;
  name: string;
  price: number;
  stock: number | null;
  active: boolean;
  weight_grams: number | null;
  min_order_quantity?: number | null;
}

/** Ce qui empêche un petit plus d'être proposé, ou le rend moins utile. Jamais bloquant pour l'enregistrement. */
export function addOnWarnings(product: AddOnAdminProduct): string[] {
  const warnings: string[] = [];
  if (!product.active) warnings.push('Inactif : jamais proposé');
  else if ((product.stock ?? 0) < Math.max(1, product.min_order_quantity ?? 1)) warnings.push('Stock insuffisant : pas proposé pour l’instant');
  if (!(typeof product.weight_grams === 'number' && product.weight_grams > 0)) warnings.push('Sans poids : jamais dans « Ça rentre dans votre colis »');
  return warnings;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corps du PUT admin : UUID uniquement, ordre gardé, sans doublon, au plus MAX_ADD_ONS. */
export function parseAddOnIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !UUID.test(item)) return null;
    const id = item.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length <= MAX_ADD_ONS ? ids : null;
}

/** Colonne absente (migration 165 non appliquée) : la fonctionnalité est simplement vide. */
export function isMissingAddOnColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.code === '42703' || error.code === 'PGRST204' || /add_on_position/.test(error.message ?? '')));
}
