// Product editor: send only what the admin changed. The PATCH route updates a
// column only when its key is present in the body, so an untouched field
// (stock decremented by orders meanwhile, price changed from the list…) is
// never overwritten by the value loaded when the editor opened. Pure.

export type ProductBody = Record<string, unknown>;

/** Readable labels of the PATCH keys, for the "unsaved changes" bar. */
export const PRODUCT_FIELD_LABELS: Record<string, string> = {
  name: 'Nom', name_alt: 'Traduction du nom', description: 'Description', descriptions: 'Descriptions',
  description_source: 'Relecture IA', price: 'Prix', compare_at_price: 'Prix avant remise', position: 'Position',
  weight_grams: 'Poids', stock: 'Stock', min_order_quantity: 'Quantité minimale', order_quantity_step: 'Incrément',
  active: 'Statut', featured: 'En vedette', storage_type: 'Stockage', category_id: 'Catégorie',
  warehouse_location: 'Emplacement', image_url: 'Image', images: 'Images', producer_id: 'Producteur',
  importer_id: 'Importateur', ingredients_text: 'Ingrédients', allergens_text: 'Allergènes',
  gluten_free_certified: 'Sans gluten', usage_instructions: 'Conseils d’utilisation',
  conservation_instructions: 'Conservation', conservation_after_opening: 'Conservation après ouverture',
  country_of_origin: 'Origine', durability_type: 'Durabilité', quid_ingredient: 'QUID', quid_percentage: 'QUID %',
  alcohol_pct: 'Alcool', net_quantity_display: 'Quantité nette', packaging_material: 'Emballage',
  recycling_note: 'Tri sélectif', nutrition_basis: 'Base nutritionnelle', nutrition: 'Valeurs nutritionnelles',
  label_background_image_url: 'Fond d’étiquette', label_background_color: 'Couleur d’étiquette',
};

/** Order-insensitive serialisation for plain objects (nutrition, descriptions). */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Keys whose value differs between the loaded body and the current one. */
export function changedProductKeys(initial: ProductBody, current: ProductBody): string[] {
  const keys = new Set([...Object.keys(initial), ...Object.keys(current)]);
  return Array.from(keys).filter((key) => stable(initial[key]) !== stable(current[key]));
}

/** PATCH payload restricted to the changed keys (empty object when nothing changed). */
export function productPatchPayload(initial: ProductBody, current: ProductBody): ProductBody {
  return Object.fromEntries(changedProductKeys(initial, current).map((key) => [key, current[key]]));
}

/** "Poids, Descriptions" — de-duplicated labels for the save bar (unknown keys kept as is). */
export function changedFieldLabels(keys: string[]): string[] {
  return Array.from(new Set(keys.map((key) => PRODUCT_FIELD_LABELS[key] ?? key)));
}

/** Catalogue list state passed as `?from=` to the editor, re-serialised safely by the caller. */
export function readFromParam(raw: string | null | undefined): URLSearchParams {
  try { return new URLSearchParams(raw ?? ''); } catch { return new URLSearchParams(); }
}
