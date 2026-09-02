import type { NalaCanonicalProduct } from '@/lib/ai/nalaProductActionContract';

export const NALA_CART_PLAN_MAX_ITEMS = 8;
export const NALA_CART_PLAN_MIN_DIRECT_SIMILARITY = 0.55;
export const NALA_CART_PLAN_MIN_AUTO_SUBSTITUTE_SIMILARITY = 0.82;

export type NalaCartPlanItemStatus = 'matched' | 'substitute' | 'unavailable';
export type NalaCartPlanMatchSource = 'direct' | 'manual' | 'system' | 'semantic';

export interface NalaCartPlanIngredient {
  name: string;
  required: boolean;
  quantityHint: string | null;
}

export interface NalaCartPlanExtraction {
  type: 'recipe';
  title: string;
  ingredients: NalaCartPlanIngredient[];
}

export interface NalaCartPlanLabels {
  prepare: string;
  addProducts: string;
  adding: string;
  viewCart: string;
  substitute: string;
  unavailable: string;
  indicativeTotal: string;
  productsAdded: string;
  productFailed: string;
  retryFailed: string;
  basketTitle: string;
  selectionHelp: string;
  productsFound: string;
  unavailableCount: string;
}

export interface NalaCartPlanItem {
  ingredientName: string;
  required: boolean;
  status: NalaCartPlanItemStatus;
  source: NalaCartPlanMatchSource | null;
  confidence: number | null;
  selectedByDefault: boolean;
  product?: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    price: number;
    currency: string;
    stock: number;
    weightGrams: number | null;
    storageType: 'dry' | 'fresh' | 'frozen' | null;
  };
  quantity: 1;
}

export interface NalaCartPlan {
  id: string;
  interactionId: string;
  title: string;
  type: 'recipe';
  items: NalaCartPlanItem[];
  currency: string;
  totals: {
    availableItems: number;
    unavailableItems: number;
    subtotal: number;
  };
  labels: NalaCartPlanLabels;
}

export interface CartIngredientCandidate {
  product: NalaCanonicalProduct & { category_id?: string | null };
  similarity: number;
}

export interface CartIngredientSubstitute {
  product: {
    id: string;
    tenantId: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    price: number;
    stock: number;
    active: boolean;
    weightGrams: number | null;
    storageType: 'dry' | 'fresh' | 'frozen' | null;
  };
  source: 'manual' | 'system' | 'semantic';
  similarity: number | null;
}

const RECIPE_INTENT_PATTERNS = [
  /\b(je veux|j['’]aimerais|nous voulons)\s+(?:cuisiner|préparer|preparer|faire)\b/i,
  /\b(?:que faut-il|qu['’]est-ce qu['’]il (?:me|nous) faut)\s+(?:pour|afin de)\b/i,
  /\bprépare(?:z)?[- ]moi\s+de quoi\s+(?:faire|préparer|cuisiner)\b/i,
  /\b(?:recette|recipe|ricetta)\b.*\b(?:ingrédients?|ingredients?|ingredienti)\b/i,
  /\b(?:voglio|vorrei)\s+(?:cucinare|preparare|fare)\b/i,
  /\b(?:cosa serve|che cosa serve)\s+per\s+(?:fare|preparare|cucinare)\b/i,
  /\b(?:i want|i['’]d like)\s+to\s+(?:cook|make|prepare)\b/i,
  /\bwhat do (?:i|we) need\s+to\s+(?:cook|make|prepare)\b/i,
];

const PRODUCT_ONLY_PATTERNS = [
  /^\s*(?:avez-vous|vous avez|avete|do you have|have you got)\b/i,
  /\b(?:combien coûte|combien coute|quanto costa|how much is)\b/i,
];

const AFFIRMATIVE_PATTERNS = [
  /^\s*(?:oui|oui merci|d['’]accord|ok|okay|vas-y|allez-y|sì|si|va bene|certo|yes|yes please|sure)\s*[!.]?\s*$/i,
];

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return cleaned || null;
}

export function isNalaCartBuilderIntent(message: string): boolean {
  const normalized = message.trim();
  if (normalized.length < 4 || PRODUCT_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return RECIPE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isNalaCartBuilderAffirmative(message: string): boolean {
  return AFFIRMATIVE_PATTERNS.some((pattern) => pattern.test(message));
}

export function normalizeNalaCartPlanExtraction(
  value: unknown,
  enabled: boolean,
): NalaCartPlanExtraction | null {
  if (!enabled || !value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const title = cleanText(candidate.title, 80);
  if (candidate.type !== 'recipe' || !title || !Array.isArray(candidate.ingredients)) return null;

  const seen = new Set<string>();
  const ingredients = candidate.ingredients.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const name = cleanText(item.name, 100);
    if (!name) return [];
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      name,
      required: item.required !== false,
      quantityHint: cleanText(item.quantityHint, 60),
    }];
  }).slice(0, NALA_CART_PLAN_MAX_ITEMS);

  return ingredients.length > 0 ? { type: 'recipe', title, ingredients } : null;
}

export function getNalaCartPlanCopy(locale: unknown): NalaCartPlanLabels {
  const language = typeof locale === 'string'
    ? locale.trim().toLowerCase().replace(/_/g, '-').split('-')[0]
    : 'fr';

  if (language === 'it') {
    return {
      prepare: 'Prepara il mio carrello',
      addProducts: 'Aggiungi i prodotti',
      adding: 'Aggiungo…',
      viewCart: 'Vedi il carrello',
      substitute: 'Alternativa proposta',
      unavailable: 'Non disponibile al momento',
      indicativeTotal: 'Totale indicativo',
      productsAdded: 'prodotti aggiunti',
      productFailed: 'prodotto non aggiunto',
      retryFailed: 'Riprova non riusciti',
      basketTitle: 'Il tuo carrello',
      selectionHelp: 'Scegli i prodotti da aggiungere.',
      productsFound: 'prodotti trovati',
      unavailableCount: 'non disponibili',
    };
  }
  if (language === 'en') {
    return {
      prepare: 'Prepare my cart',
      addProducts: 'Add products',
      adding: 'Adding…',
      viewCart: 'View cart',
      substitute: 'Suggested alternative',
      unavailable: 'Currently unavailable',
      indicativeTotal: 'Estimated total',
      productsAdded: 'products added',
      productFailed: 'product could not be added',
      retryFailed: 'Retry failed items',
      basketTitle: 'Your cart',
      selectionHelp: 'Choose the products to add.',
      productsFound: 'products found',
      unavailableCount: 'unavailable',
    };
  }
  return {
    prepare: 'Préparer mon panier',
    addProducts: 'Ajouter les produits',
    adding: 'J’ajoute…',
    viewCart: 'Voir mon panier',
    substitute: 'Alternative proposée',
    unavailable: 'Non disponible actuellement',
    indicativeTotal: 'Total indicatif',
    productsAdded: 'produits ajoutés',
    productFailed: 'produit n’a pas pu être ajouté',
    retryFailed: 'Réessayer les produits échoués',
    basketTitle: 'Votre panier',
    selectionHelp: 'Choisissez les produits à ajouter.',
    productsFound: 'produits trouvés',
    unavailableCount: 'indisponibles',
  };
}

function isPurchasable(product: NalaCanonicalProduct, tenantId: string): boolean {
  return product.tenant_id === tenantId
    && product.active
    && Number.isFinite(product.price)
    && Number.isFinite(product.stock)
    && product.stock > 0;
}

function productPayload(
  product: NalaCanonicalProduct,
  currency: string,
): NonNullable<NalaCartPlanItem['product']> {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    imageUrl: product.image_url,
    price: Number(product.price),
    currency: currency.toUpperCase(),
    stock: product.stock,
    weightGrams: product.weight_grams,
    storageType: product.storage_type,
  };
}

export function selectNalaCartPlanItem(params: {
  tenantId: string;
  ingredient: NalaCartPlanIngredient;
  currency: string;
  directCandidates: CartIngredientCandidate[];
  substitute?: CartIngredientSubstitute | null;
}): NalaCartPlanItem {
  const direct = params.directCandidates.find((candidate) => (
    candidate.similarity >= NALA_CART_PLAN_MIN_DIRECT_SIMILARITY
    && isPurchasable(candidate.product, params.tenantId)
  ));

  if (direct) {
    return {
      ingredientName: params.ingredient.name,
      required: params.ingredient.required,
      status: 'matched',
      source: 'direct',
      confidence: direct.similarity,
      selectedByDefault: params.ingredient.required,
      product: productPayload(direct.product, params.currency),
      quantity: 1,
    };
  }

  const substitute = params.substitute;
  if (
    substitute
    && substitute.product.tenantId === params.tenantId
    && substitute.product.active
    && substitute.product.stock > 0
    && Number.isFinite(substitute.product.price)
  ) {
    const confidence = substitute.similarity ?? 1;
    return {
      ingredientName: params.ingredient.name,
      required: params.ingredient.required,
      status: 'substitute',
      source: substitute.source,
      confidence,
      selectedByDefault: params.ingredient.required
        && (substitute.source !== 'semantic'
          || confidence >= NALA_CART_PLAN_MIN_AUTO_SUBSTITUTE_SIMILARITY),
      product: {
        id: substitute.product.id,
        name: substitute.product.name,
        slug: substitute.product.slug,
        imageUrl: substitute.product.imageUrl,
        price: Number(substitute.product.price),
        currency: params.currency.toUpperCase(),
        stock: substitute.product.stock,
        weightGrams: substitute.product.weightGrams,
        storageType: substitute.product.storageType,
      },
      quantity: 1,
    };
  }

  return {
    ingredientName: params.ingredient.name,
    required: params.ingredient.required,
    status: 'unavailable',
    source: null,
    confidence: null,
    selectedByDefault: false,
    quantity: 1,
  };
}

export function finalizeNalaCartPlan(params: {
  id: string;
  interactionId: string;
  title: string;
  items: NalaCartPlanItem[];
  currency: string;
  locale: unknown;
}): NalaCartPlan {
  const items = params.items.slice(0, NALA_CART_PLAN_MAX_ITEMS);
  const available = items.filter((item) => item.product);
  return {
    id: params.id,
    interactionId: params.interactionId,
    title: params.title,
    type: 'recipe',
    items,
    currency: params.currency.toUpperCase(),
    totals: {
      availableItems: available.length,
      unavailableItems: items.length - available.length,
      subtotal: Math.round(available.reduce((sum, item) => sum + (item.product?.price ?? 0), 0) * 100) / 100,
    },
    labels: getNalaCartPlanCopy(params.locale),
  };
}

export function toNalaCartPlanProduct(item: NalaCartPlanItem) {
  if (!item.product) return null;
  return {
    id: item.product.id,
    name: item.product.name,
    slug: item.product.slug,
    price: item.product.price,
    image_url: item.product.imageUrl,
    weight_grams: item.product.weightGrams,
    stock: item.product.stock,
    storage_type: item.product.storageType,
  };
}

export interface NalaBulkAddResult {
  addedIds: string[];
  failedIds: string[];
}

export async function performNalaBulkAdd(params: {
  inFlight: Set<string>;
  planId: string;
  items: NalaCartPlanItem[];
  selectedIds: Set<string>;
  addItem: (item: NalaCartPlanItem) => void | Promise<void>;
}): Promise<NalaBulkAddResult | null> {
  if (params.inFlight.has(params.planId)) return null;
  params.inFlight.add(params.planId);
  const result: NalaBulkAddResult = { addedIds: [], failedIds: [] };

  try {
    for (const item of params.items) {
      const productId = item.product?.id;
      if (!productId || !params.selectedIds.has(productId)) continue;
      try {
        await params.addItem(item);
        result.addedIds.push(productId);
      } catch {
        result.failedIds.push(productId);
      }
    }
    return result;
  } finally {
    params.inFlight.delete(params.planId);
  }
}
