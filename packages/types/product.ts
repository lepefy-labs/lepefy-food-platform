export type CatalogScope = 'shop' | 'gadgets';

export type CatalogCategoryOption = Pick<Category, 'id' | 'name' | 'slug' | 'catalog_scope'>;

export interface Category {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  image_url: string | null;
  catalog_scope: CatalogScope;
  position: number;
  created_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  category_id: string | null;
  name: string;
  name_alt: string | null;
  slug: string;
  description: string | null;
  descriptions: Record<string, string>;
  description_source: 'ai' | 'human' | null;
  price: number;
  compare_at_price: number | null;
  image_url: string | null;
  images: ProductImage[];
  weight_grams: number | null;
  stock: number;
  active: boolean;
  featured: boolean;
  position: number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  is_homemade: boolean;
  // Règles de quantité d'achat (migration 121_purchase_quantity_rules.sql).
  // Une quantité q est valide si q >= min_order_quantity et
  // (q - min_order_quantity) % order_quantity_step == 0. Défaut 1/1 = aucune règle.
  min_order_quantity: number;
  order_quantity_step: number;
  // Champs "étiquette" (migration 018_label_system.sql) — même source de
  // données que le système d'étiquettes imprimées, à ne pas dupliquer ailleurs.
  ingredients_text: string | null;
  allergens_text: string | null;
  gluten_free_certified: boolean;
  usage_instructions: string | null;
  conservation_instructions: string | null;
  conservation_after_opening: string | null;
  country_of_origin: string | null;
  net_quantity_display: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  url: string;
  alt?: string;
}

export interface ProductWithCategory extends Product {
  category: Category | null;
}

export interface CartItem {
  product: Pick<Product, 'id' | 'name' | 'slug' | 'price' | 'image_url' | 'weight_grams' | 'stock' | 'storage_type'>
    & Partial<Pick<Product, 'min_order_quantity' | 'order_quantity_step'>>;
  quantity: number;
}

/** Règle de quantité combinée (migration 121) — ex. "Boissons" min 12 pas 6. */
export interface PurchaseQuantityGroup {
  id: string;
  tenant_id: string;
  name: string;
  min_quantity: number;
  quantity_step: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}
