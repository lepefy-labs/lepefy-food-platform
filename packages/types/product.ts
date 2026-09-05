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
  product: Pick<Product, 'id' | 'name' | 'slug' | 'price' | 'image_url' | 'weight_grams' | 'stock' | 'storage_type'>;
  quantity: number;
}
