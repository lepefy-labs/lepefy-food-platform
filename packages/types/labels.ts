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

export interface ProductLabelData {
  id: string;
  name: string;
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
  default_template_key: string;
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
  templateKey: string;
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
