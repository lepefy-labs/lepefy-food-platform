/**
 * Règles admin des formats de vente (migration 187) : lecture du corps de la
 * requête, avertissements (minimums, groupes à mélanger) et messages d'erreur
 * des RPC. Pur, partagé par la route et l'éditeur. Jamais de désactivation
 * implicite d'un groupe : on signale seulement.
 */
import { productSlugBase } from './productDuplication';

export const MAX_SALE_FORMATS = 8;

export interface SaleFormatInput {
  id: string | null;
  label: string;
  units_per_sale: number;
  price: number;
  weight_grams: number | null;
  active: boolean;
  stock_mode: 'shared' | 'own';
}

export interface SaleFormatsBody {
  baseLabel: string;
  formats: SaleFormatInput[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corps du PUT, ou un message d'erreur en français. */
export function parseSaleFormatsBody(raw: unknown): { ok: true; body: SaleFormatsBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Requête invalide.' };
  const value = raw as { baseLabel?: unknown; formats?: unknown };
  const baseLabel = typeof value.baseLabel === 'string' ? value.baseLabel.trim() : '';
  if (!Array.isArray(value.formats)) return { ok: false, error: 'Liste des formats manquante.' };
  if (value.formats.length > MAX_SALE_FORMATS) return { ok: false, error: `${MAX_SALE_FORMATS} formats au plus.` };
  if (value.formats.length > 0 && !baseLabel) return { ok: false, error: 'Donnez un nom au format de base (ex. « 1 paquet »).' };
  if (baseLabel.length > 60) return { ok: false, error: 'Nom du format de base trop long (60 caractères au plus).' };

  const formats: SaleFormatInput[] = [];
  const labels = new Set(baseLabel ? [baseLabel.toLowerCase()] : []);
  for (const [index, entry] of value.formats.entries()) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const position = `Format ${index + 1}`;
    const id = typeof row.id === 'string' && UUID.test(row.id) ? row.id : null;
    if (row.id != null && row.id !== '' && !id) return { ok: false, error: `${position} : identifiant invalide.` };
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!label || label.length > 60) return { ok: false, error: `${position} : nom obligatoire (60 caractères au plus).` };
    if (labels.has(label.toLowerCase())) return { ok: false, error: `${position} : « ${label} » existe déjà.` };
    labels.add(label.toLowerCase());
    const units = Number(row.units_per_sale);
    if (!Number.isInteger(units) || units < 2 || units > 999) return { ok: false, error: `${position} : indiquez de 2 à 999 unités par vente.` };
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0 || Math.abs(Math.round(price * 100) - price * 100) > 1e-6) {
      return { ok: false, error: `${position} : prix invalide.` };
    }
    const weightRaw = row.weight_grams;
    const weight = weightRaw === null || weightRaw === undefined || weightRaw === '' ? null : Number(weightRaw);
    if (weight !== null && (!Number.isInteger(weight) || weight < 0)) return { ok: false, error: `${position} : poids invalide (grammes entiers).` };
    formats.push({
      id,
      label,
      units_per_sale: units,
      price,
      weight_grams: weight,
      active: row.active !== false,
      stock_mode: row.stock_mode === 'own' ? 'own' : 'shared',
    });
  }
  return { ok: true, body: { baseLabel, formats } };
}

/** Slug d'un nouveau format : `<slug fiche>-<libellé>`, unique dans le tenant. */
export function saleFormatSlugBase(parentSlug: string, label: string): string {
  return `${parentSlug}-${productSlugBase(label)}`.slice(0, 120).replace(/-$/, '');
}

export interface SaleFormatWarningInput {
  base: { min_order_quantity: number; order_quantity_step: number; stock: number; weight_grams: number | null };
  formats: Array<Pick<SaleFormatInput, 'label' | 'units_per_sale' | 'weight_grams' | 'active' | 'price'>>;
  basePrice: number;
  /** Groupes à mélanger actifs qui contiennent la fiche ou un de ses formats. */
  groups: Array<{ name: string; min_quantity: number }>;
}

/** Avertissements affichés avant d'enregistrer ; jamais bloquants, jamais appliqués à la place de l'admin. */
export function saleFormatWarnings(input: SaleFormatWarningInput): string[] {
  const warnings: string[] = [];
  const active = input.formats.filter((format) => format.active);
  if (active.length === 0) return warnings;
  if (input.base.min_order_quantity > 1) {
    warnings.push(`Le format de base a un minimum de ${input.base.min_order_quantity} : le client ne pourra pas acheter une seule unité. Changez « Quantité minimale » dans « Règles de vente » si c’est voulu.`);
  }
  for (const group of input.groups) {
    if (group.min_quantity > 1) {
      warnings.push(`Ce produit est dans le groupe actif « ${group.name} » (minimum ${group.min_quantity}) : la règle du groupe s’applique toujours. Il ne sera pas modifié automatiquement.`);
    }
  }
  for (const format of active) {
    if (format.weight_grams == null || format.weight_grams <= 0) {
      warnings.push(`« ${format.label} » n’a pas de poids : la livraison ne pourra pas être calculée correctement.`);
    } else if (input.base.weight_grams && format.weight_grams < input.base.weight_grams * format.units_per_sale * 0.9) {
      warnings.push(`« ${format.label} » pèse moins que ${format.units_per_sale} unités de base : vérifiez le poids de l’ensemble (emballage compris).`);
    }
    if (input.basePrice > 0 && format.price >= input.basePrice * format.units_per_sale) {
      warnings.push(`« ${format.label} » ne coûte pas moins cher que ${format.units_per_sale} unités à l’unité : aucune économie ne sera affichée.`);
    }
    if (Math.floor(Math.max(0, input.base.stock) / format.units_per_sale) === 0) {
      warnings.push(`Stock actuel insuffisant pour « ${format.label} » : il s’affichera épuisé.`);
    }
  }
  return warnings;
}

const RPC_ERRORS: Record<string, string> = {
  formats_invalid_input: 'Requête invalide.',
  formats_too_many: `${MAX_SALE_FORMATS} formats au plus.`,
  format_parent_not_found: 'Produit introuvable, ou c’est lui-même un format.',
  format_base_label_required: 'Donnez un nom au format de base (ex. « 1 paquet »).',
  format_label_required: 'Chaque format doit avoir un nom.',
  format_label_duplicate: 'Deux formats portent le même nom.',
  format_units_invalid: 'Indiquez de 2 à 999 unités par vente.',
  format_price_invalid: 'Prix invalide.',
  format_weight_invalid: 'Poids invalide.',
  format_stock_mode_invalid: 'Origine du stock invalide.',
  format_not_found: 'Un format n’appartient plus à ce produit. Rechargez la page.',
  format_price_promotion_active: 'Un format est en promotion : changez son prix depuis sa fiche (section Promotion).',
  format_slug_invalid: 'Adresse du format invalide.',
  format_parent_is_format: 'Un format ne peut pas avoir de formats.',
  format_has_formats: 'Ce produit a déjà des formats.',
  format_attach_self: 'Un produit ne peut pas être un format de lui-même.',
  format_attach_not_found: 'Produit à rattacher introuvable dans cette boutique.',
  format_attach_already_format: 'Ce produit est déjà un format d’une fiche. Détachez-le d’abord.',
  format_attach_stock_not_empty: 'Ce produit a du stock : rattachez-le avec un stock propre, ou mettez son stock à 0 pour le partager avec la fiche.',
  format_detach_not_format: 'Ce produit n’est pas un format.',
  format_detach_shared: 'Un format à stock partagé ne se détache pas : mettez-le hors vente.',
};

/** Message français d'une erreur de la RPC `set_product_sale_formats`. */
export function saleFormatRpcError(message: string | null | undefined): { status: number; error: string } {
  const text = message ?? '';
  if (/attach_product_as_sale_format|detach_product_sale_format/.test(text) && /does not exist|could not find|schema cache/i.test(text)) {
    return { status: 503, error: 'Fonction indisponible : la migration 188 n’est pas encore appliquée.' };
  }
  if (/set_product_sale_formats|PGRST202|sale_formats/.test(text) && /does not exist|could not find|schema cache/i.test(text)) {
    return { status: 503, error: 'Fonction indisponible : la migration 187 n’est pas encore appliquée.' };
  }
  const code = Object.keys(RPC_ERRORS).find((key) => text.includes(key));
  if (code) return { status: code === 'format_not_found' || code === 'format_attach_already_format' ? 409 : 400, error: RPC_ERRORS[code]! };
  if (/duplicate key|products_tenant_slug|unique/i.test(text)) return { status: 409, error: 'Adresse déjà utilisée, réessayez.' };
  return { status: 500, error: 'Impossible d’enregistrer les formats.' };
}

// ─── Rattacher un produit existant (migration 188) ───────────────────────────

export interface AttachSaleFormatBody {
  productId: string;
  label: string;
  units_per_sale: number;
  stock_mode: 'shared' | 'own';
  /** Nom du format de base, requis seulement si la fiche n'a pas encore de formats. */
  baseLabel: string;
}

/** Corps du POST …/formats/attach, ou un message d'erreur en français. */
export function parseAttachSaleFormatBody(raw: unknown): { ok: true; body: AttachSaleFormatBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Requête invalide.' };
  const value = raw as Record<string, unknown>;
  const productId = typeof value.productId === 'string' && UUID.test(value.productId) ? value.productId : null;
  if (!productId) return { ok: false, error: 'Choisissez le produit à rattacher.' };
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  if (!label || label.length > 60) return { ok: false, error: 'Nom du format obligatoire (60 caractères au plus).' };
  const units = Number(value.units_per_sale);
  if (!Number.isInteger(units) || units < 2 || units > 999) return { ok: false, error: 'Indiquez de 2 à 999 unités de base par vente.' };
  const baseLabel = typeof value.baseLabel === 'string' ? value.baseLabel.trim() : '';
  if (baseLabel.length > 60) return { ok: false, error: 'Nom du format de base trop long (60 caractères au plus).' };
  if (baseLabel && baseLabel.toLowerCase() === label.toLowerCase()) return { ok: false, error: 'Le format et le format de base ne peuvent pas porter le même nom.' };
  return { ok: true, body: { productId, label, units_per_sale: units, stock_mode: value.stock_mode === 'shared' ? 'shared' : 'own', baseLabel } };
}

/** Produit proposé au rattachement (recherche de l'éditeur). */
export interface AttachCandidate {
  id: string;
  name: string;
  slug: string;
  price: number;
  compare_at_price: number | null;
  stock: number;
  active: boolean;
  featured: boolean;
  min_order_quantity: number;
  order_quantity_step: number;
  add_on_position: number | null;
  image_url: string | null;
  format_parent_id: string | null;
  /** A lui-même des formats : ne peut pas devenir un format. */
  has_formats: boolean;
}

/** Raison pour laquelle un produit ne peut pas être rattaché à cette fiche (null = possible). */
export function attachBlocker(candidate: Pick<AttachCandidate, 'id' | 'format_parent_id' | 'has_formats'>, parentId: string): string | null {
  if (candidate.id === parentId) return 'C’est cette fiche.';
  if (candidate.format_parent_id) return 'Déjà un format d’une fiche.';
  if (candidate.has_formats) return 'A ses propres formats.';
  return null;
}

/**
 * Ce que le rattachement change, en clair, pour la confirmation. Même règle
 * que la RPC 188 et le trigger 187 : rien n'est changé en silence.
 */
export function attachConsequences(input: {
  candidate: AttachCandidate;
  parent: { name: string; stock: number };
  label: string;
  units: number;
  stockMode: 'shared' | 'own';
}): string[] {
  const { candidate, parent, label, units, stockMode } = input;
  const lines = [
    `Son nom devient « ${parent.name} — ${label} ». Il prend la catégorie, la conservation et le mode de réception de la fiche.`,
    'Il garde son prix, les paniers et l’historique des commandes. Il n’apparaît plus seul dans le catalogue et son adresse mène à la fiche.',
  ];
  lines.push(stockMode === 'own'
    ? `Il garde son stock propre : ${Math.max(0, candidate.stock)}.`
    : `Son stock sera calculé depuis la fiche : ${Math.floor(Math.max(0, parent.stock) / units)} disponibles.`);
  if (candidate.compare_at_price != null && Number(candidate.compare_at_price) > Number(candidate.price)) {
    lines.push('Sa promotion est conservée et reste visible dans « Nos promos ».');
  }
  if (candidate.min_order_quantity !== 1 || candidate.order_quantity_step !== 1) {
    lines.push(`Sa quantité minimale (${candidate.min_order_quantity}) et son pas (${candidate.order_quantity_step}) passent à 1 : un format se vend par 1.`);
  }
  if (candidate.featured) lines.push('Il n’est plus mis en avant.');
  if (candidate.add_on_position != null) lines.push('Il sort des « Petits plus ».');
  if (!candidate.active) lines.push('Il est hors vente et le restera : cochez « En vente » ensuite si besoin.');
  return lines;
}
