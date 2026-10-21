/**
 * Duplication d'un produit du catalogue admin : `source → brouillon de création`.
 *
 * Le brouillon alimente l'éditeur de création existant (`/admin/catalogue/nouveau?duplicateFrom=<id>`)
 * et rien n'est écrit avant « Créer le produit » (POST /api/admin/catalogue, chemin unique).
 * Champ par champ, jamais une copie de la ligne : seuls les attributs structurels du produit
 * sont repris ; tout ce qui est opérationnel, commercial temporaire ou historique repart de zéro.
 * Pur et testé (tests/unit/productDuplication.spec.ts).
 */
import type { DurabilityType, NutritionInfo, ProductFulfillmentPolicy, ProductImage } from '@lepefy/types';
import { DEFAULT_FULFILLMENT_POLICY, normalizeFulfillmentPolicy } from '../fulfillment/fulfillmentPolicy';
import { pricingInputFromRow } from './promotionSchedule';
import { normalizeProductImages } from './productImages';

/** Colonnes lues sur le produit source (toujours filtré par tenant_id côté serveur). */
export const DUPLICATE_SOURCE_SELECT = `
  id, name, name_alt, description, descriptions, description_source,
  price, compare_at_price, promo_price, promo_starts_at, promo_ends_at, promo_until_sold_out, promo_applied,
  position, weight_grams, min_order_quantity, order_quantity_step, storage_type,
  image_url, images, category_id, producer_id, importer_id, ingredients_text, allergens_text,
  gluten_free_certified, usage_instructions, conservation_instructions, conservation_after_opening,
  country_of_origin, durability_type, quid_ingredient, quid_percentage, alcohol_pct, net_quantity_display,
  sale_unit, net_content_value, net_content_unit, pack_count, fulfillment_policy,
  packaging_material, recycling_note, nutrition_basis, nutrition,
  label_background_image_url, label_background_color
`;

export interface DuplicateSourceRow {
  id: string;
  name: string;
  name_alt: string | null;
  description: string | null;
  descriptions: Record<string, string> | null;
  description_source: 'ai' | 'human' | null;
  price: number;
  compare_at_price: number | null;
  promo_price: number | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  promo_until_sold_out: boolean | null;
  promo_applied: boolean | null;
  position: number | null;
  weight_grams: number | null;
  min_order_quantity: number | null;
  order_quantity_step: number | null;
  storage_type: string | null;
  image_url: string | null;
  images: unknown;
  category_id: string;
  producer_id: string | null;
  importer_id: string | null;
  ingredients_text: string | null;
  allergens_text: string | null;
  gluten_free_certified: boolean | null;
  usage_instructions: string | null;
  conservation_instructions: string | null;
  conservation_after_opening: string | null;
  country_of_origin: string | null;
  durability_type: DurabilityType | null;
  quid_ingredient: string | null;
  quid_percentage: number | null;
  alcohol_pct: number | null;
  net_quantity_display: string | null;
  sale_unit: string | null;
  net_content_value: number | null;
  net_content_unit: string | null;
  pack_count: number | null;
  fulfillment_policy: string | null;
  packaging_material: string | null;
  recycling_note: string | null;
  nutrition_basis: '100g' | '100ml' | null;
  nutrition: NutritionInfo | null;
  label_background_image_url: string | null;
  label_background_color: string | null;
}

/** Forme attendue par `ProductEditClient` en création. */
export interface ProductDraft {
  id: string;
  name: string;
  name_alt: string | null;
  slug: string;
  description: string | null;
  descriptions: Record<string, string> | null;
  description_source: 'ai' | 'human' | null;
  price: number;
  compare_at_price: number | null;
  promo_price: number | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  promo_until_sold_out: boolean;
  promo_applied: boolean;
  new_until: string | null;
  manual_new_until: string | null;
  position: number;
  weight_grams: number | null;
  stock: number;
  min_order_quantity: number;
  order_quantity_step: number;
  active: boolean;
  featured: boolean;
  storage_type: string;
  image_url: string | null;
  images: ProductImage[];
  warehouse_location: string | null;
  category_id: string;
  producer_id: string | null;
  importer_id: string | null;
  ingredients_text: string | null;
  allergens_text: string | null;
  gluten_free_certified: boolean;
  usage_instructions: string | null;
  conservation_instructions: string | null;
  conservation_after_opening: string | null;
  country_of_origin: string | null;
  durability_type: DurabilityType | null;
  quid_ingredient: string | null;
  quid_percentage: number | null;
  alcohol_pct: number | null;
  net_quantity_display: string | null;
  sale_unit: string | null;
  net_content_value: number | null;
  net_content_unit: string | null;
  pack_count: number | null;
  fulfillment_policy: ProductFulfillmentPolicy;
  packaging_material: string | null;
  recycling_note: string | null;
  nutrition_basis: '100g' | '100ml';
  nutrition: NutritionInfo | null;
  label_background_image_url: string | null;
  label_background_color: string | null;
  barcode_value: string | null;
}

/** Création vide (ancienne valeur en dur de la page « Nouveau produit »). */
export function emptyProductDraft(categoryId: string): ProductDraft {
  return {
    id: '', name: '', name_alt: null, slug: '',
    description: null, descriptions: null, description_source: null,
    price: 0, compare_at_price: null,
    promo_price: null, promo_starts_at: null, promo_ends_at: null, promo_until_sold_out: false, promo_applied: false,
    new_until: null, manual_new_until: null,
    position: 9999, weight_grams: null, stock: 0, min_order_quantity: 1, order_quantity_step: 1,
    active: false, featured: false, storage_type: 'dry',
    image_url: null, images: [], warehouse_location: null, category_id: categoryId,
    producer_id: null, importer_id: null, ingredients_text: null, allergens_text: null, gluten_free_certified: false,
    usage_instructions: null, conservation_instructions: null, conservation_after_opening: null,
    country_of_origin: null, durability_type: null, quid_ingredient: null, quid_percentage: null, alcohol_pct: null,
    net_quantity_display: null, sale_unit: null, net_content_value: null, net_content_unit: null, pack_count: null,
    fulfillment_policy: DEFAULT_FULFILLMENT_POLICY,
    packaging_material: null, recycling_note: null, nutrition_basis: '100g', nutrition: null,
    label_background_image_url: null, label_background_color: null, barcode_value: null,
  };
}

/** Galerie reprise du produit source (même normalisation que les routes médias). */
export function duplicateGallery(source: Pick<DuplicateSourceRow, 'images' | 'image_url' | 'name'>): { image_url: string | null; images: ProductImage[] } {
  const images = normalizeProductImages(source.images, source.image_url, source.name);
  return { image_url: images[0]?.url ?? null, images };
}

/**
 * Brouillon de création à partir d'un produit existant.
 * Repris : nom, traductions, descriptions, catégorie, producteur/importateur, prix normal,
 * poids, format de vente, règles de quantité, stockage, mode de réception, étiquetage, médias.
 * Remis à zéro : id, slug, stock (0), actif (non), mis en avant (non), promotion (aucune,
 * prix barré compris), nouveauté, emplacement d'entrepôt, code-barres.
 * La position reste celle du source : la variante se range à côté de l'original.
 */
export function toDuplicateDraft(source: DuplicateSourceRow): ProductDraft {
  const regularPrice = Number(pricingInputFromRow({
    price: Number(source.price),
    compare_at_price: source.compare_at_price,
    promo_price: source.promo_price,
    promo_starts_at: source.promo_starts_at,
    promo_ends_at: source.promo_ends_at,
    promo_until_sold_out: source.promo_until_sold_out,
    promo_applied: source.promo_applied,
  }).regular_price);
  const minimum = Number(source.min_order_quantity);
  const step = Number(source.order_quantity_step);

  return {
    ...emptyProductDraft(source.category_id),
    ...duplicateGallery(source),
    name: source.name,
    name_alt: source.name_alt,
    description: source.description,
    descriptions: source.descriptions ? { ...source.descriptions } : null,
    description_source: source.description_source,
    price: Number.isFinite(regularPrice) ? regularPrice : 0,
    position: Number.isInteger(source.position) ? Number(source.position) : 9999,
    weight_grams: source.weight_grams,
    min_order_quantity: Number.isInteger(minimum) && minimum >= 1 ? minimum : 1,
    order_quantity_step: Number.isInteger(step) && step >= 1 ? step : 1,
    storage_type: source.storage_type ?? 'dry',
    producer_id: source.producer_id,
    importer_id: source.importer_id,
    ingredients_text: source.ingredients_text,
    allergens_text: source.allergens_text,
    gluten_free_certified: Boolean(source.gluten_free_certified),
    usage_instructions: source.usage_instructions,
    conservation_instructions: source.conservation_instructions,
    conservation_after_opening: source.conservation_after_opening,
    country_of_origin: source.country_of_origin,
    durability_type: source.durability_type,
    quid_ingredient: source.quid_ingredient,
    quid_percentage: source.quid_percentage,
    alcohol_pct: source.alcohol_pct,
    net_quantity_display: source.net_quantity_display,
    sale_unit: source.sale_unit,
    net_content_value: source.net_content_value,
    net_content_unit: source.net_content_unit,
    pack_count: source.pack_count,
    fulfillment_policy: normalizeFulfillmentPolicy(source.fulfillment_policy),
    packaging_material: source.packaging_material,
    recycling_note: source.recycling_note,
    nutrition_basis: source.nutrition_basis === '100ml' ? '100ml' : '100g',
    nutrition: source.nutrition ? { ...source.nutrition } : null,
    // Le fichier du fond est copié côté serveur à la création (chemin lié à l'id du produit).
    label_background_image_url: source.label_background_image_url,
    label_background_color: source.label_background_color,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `duplicateFrom` / `duplicate_from` : un UUID, rien d'autre. */
export function parseDuplicateSourceId(raw: unknown): string | null {
  return typeof raw === 'string' && UUID_RE.test(raw.trim()) ? raw.trim().toLowerCase() : null;
}

/** Slug de base dérivé du nom (même forme que la création admin historique). */
export function productSlugBase(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/, '');
  return base || 'produit';
}

/** Premier slug libre : `base`, puis `base-2`, `base-3`… (même suffixe que l'import WhatsApp). */
export function nextAvailableSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

const LABEL_BACKGROUND_PATH_RE = /\/storage\/v1\/object\/public\/assets\/(labels\/product-background-([0-9a-f-]{36})\.([a-z0-9]+))(?:\?.*)?$/i;

/**
 * Fond d'étiquette stocké sous un chemin lié à un produit (`labels/product-background-<id>.<ext>`,
 * réécrit en place à chaque téléversement) : il doit être copié pour la nouvelle fiche, sinon un
 * nouveau fond sur l'original changerait aussi la copie. null = autre URL, partageable telle quelle.
 */
export function labelBackgroundStoragePath(url: string | null | undefined): { path: string; ext: string } | null {
  if (!url) return null;
  const match = LABEL_BACKGROUND_PATH_RE.exec(url);
  return match ? { path: match[1]!, ext: match[3]!.toLowerCase() } : null;
}
