export interface Producer {
  id: string;
  tenant_id: string;
  name: string;
  legal_address: string;
  vat_number: string | null;
  health_stamp: string | null;
  country: string;
  active: boolean;
}

export interface Importer {
  id: string;
  tenant_id: string;
  name: string;
  legal_address: string;
  vat_number: string | null;
  email: string | null;
  active: boolean;
}

export interface NutritionInfo {
  kcal?: number;
  kj?: number;
  fat_g?: number;
  saturated_fat_g?: number;
  carbs_g?: number;
  sugars_g?: number;
  fiber_g?: number;
  protein_g?: number;
  salt_g?: number;
}

export type DurabilityType = 'best_before' | 'use_by';

export type LabelTemplateKey = 'default' | 'fullbleed' | 'banner';

export type LabelPaletteKey = 'verde_palma' | 'blu_epices' | 'terra_piccante';

/** pill = bandierina nell'asola esistente. block = blocco grafico più grande. medallion = bollino circolare con testo curvo. */
export type LabelOriginStyleKey = 'pill' | 'block' | 'medallion';

export interface ProductLabelData {
  id: string;
  name: string;
  name_alt: string | null;
  slug: string;
  image_url: string | null;
  weight_grams: number | null;
  net_quantity_display: string | null;
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
  packaging_material: string | null;
  recycling_note: string | null;
  nutrition_basis: '100g' | '100ml';
  nutrition: NutritionInfo | null;
  label_background_image_url: string | null;
  label_background_color: string | null;
  producer: Producer | null;
  importer: Importer | null;
  category: {
    id: string;
    name: string;
    label_background_image_url: string | null;
    label_background_color: string | null;
  } | null;
}

export interface LabelSettings {
  id: string;
  tenant_id: string;
  default_template_key: LabelTemplateKey;
  sheet_width_mm: number;
  sheet_height_mm: number;
  label_width_mm: number;
  label_height_mm: number;
  margin_mm: number;
  gutter_mm: number;
  crop_marks: boolean;
}

export interface LabelSections {
  image: boolean;
  nutrition: boolean;
  allergens: boolean;
  usage: boolean;
  conservation: boolean;
  origin: boolean;
}

export interface LabelJobInput {
  productId: string;
  templateKey: LabelTemplateKey;
  palette: LabelPaletteKey;
  naturalBadge: boolean;
  originStyle: LabelOriginStyleKey;
  sections: LabelSections;
  lotNumber: string;
  productionDate: string | null;
  durabilityDate: string;
  quantity: number;
  sheetWidthMm: number;
  sheetHeightMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
}

export interface LabelLayout {
  cols: number;
  rows: number;
  perSheet: number;
  sheets: number;
}

export type LabelJobStatus = 'draft' | 'generated';

export interface LabelPrintJob {
  id: string;
  tenant_id: string;
  product_id: string;
  status: LabelJobStatus;
  duplicated_from_id: string | null;
  template_key: LabelTemplateKey;
  palette: LabelPaletteKey;
  natural_badge: boolean;
  origin_style: LabelOriginStyleKey;
  included_sections: LabelSections;
  lot_number: string | null;
  production_date: string | null;
  durability_date: string | null;
  quantity: number | null;
  sheet_width_mm: number;
  sheet_height_mm: number;
  label_width_mm: number;
  label_height_mm: number;
  labels_per_sheet: number | null;
  sheets_generated: number | null;
  pdf_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
