import type { ProductRelationshipType } from '@/lib/catalog/productRelationships';

export const NALA_PRODUCT_ACTION_MAX = 1;
export const NALA_PRODUCT_ACTION_MIN_SIMILARITY = 0.4;

export type NalaActionRelationshipType = 'direct' | ProductRelationshipType;

export interface NalaProductActionLabels {
  adding: string;
  added: string;
  viewCart: string;
  error: string;
  retry: string;
  viewProduct: string;
}

export interface NalaProductAction {
  type: 'product';
  action: 'add_to_cart';
  relationshipType: NalaActionRelationshipType;
  product: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    price: number;
    compareAtPrice: number | null;
    currency: string;
    available: true;
    stock: number;
    weightGrams: number | null;
    storageType: 'dry' | 'fresh' | 'frozen' | null;
    minOrderQuantity: number;
    orderQuantityStep: number;
  };
  /** Quantité que Nala ajoute réellement — respecte le minimum de vente (cf. purchaseQuantityRules.ts), jamais 1 littéral. */
  quantity: number;
  ctaLabel: string;
  labels: NalaProductActionLabels;
  interactionId: string;
}

export interface NalaProductActionCandidate {
  id: string;
  similarity?: number;
  relationshipType: NalaActionRelationshipType;
}

export interface NalaCanonicalProduct {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  image_url: string | null;
  price: number;
  compare_at_price: number | null;
  stock: number;
  active: boolean;
  weight_grams: number | null;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  min_order_quantity: number;
  order_quantity_step: number;
}

const NON_PRODUCT_ACTION_PATTERNS = [
  /^\s*(bonjour|bonsoir|salut|hello|hi|ciao|buongiorno|buonasera)[!,.?\s]*$/i,
  /\b(horaires?|heures? d['’]ouverture|quand (?:êtes|etes)-vous ouverts?|adresse|où (?:êtes|etes)-vous|téléphone|telephone|whatsapp|contact(?:er|ez)?)\b/i,
  /\b(frais de (?:port|livraison)|délai de livraison|delai de livraison|expédition|expedition|livrez-vous)\b/i,
  /\b(moyens? de paiement|comment payer|paiements? acceptés?|paiements? acceptes?)\b/i,
  /\b(ma commande|mon colis|suivi de commande|suivre ma commande|annuler ma commande|remboursement)\b/i,
  /\b(orari|quando siete apert[io]|indirizzo|telefono|contatt|spese di spedizione|tempi di consegna|metodi di pagamento|il mio ordine|rimborso)\b/i,
  /\b(opening hours?|when are you open|store hours?|address|phone number|contact you|shipping cost|delivery time|payment methods?|my order|track my order|refund)\b/i,
  /\b(recette|recipe|ricetta)\b/i,
];

const ACTION_LANGUAGES = new Set(['fr', 'it', 'en']);

function languageOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, '-').split('-')[0] ?? '';
  return ACTION_LANGUAGES.has(normalized) ? normalized : null;
}

export function resolveNalaProductActionLocale(params: {
  storefrontLocale?: unknown;
  conversationLocale?: unknown;
  tenantLocales?: unknown;
  tenantLocale?: unknown;
}): 'fr' | 'it' | 'en' {
  const supportedTenantLanguages = new Set(
    (Array.isArray(params.tenantLocales) ? params.tenantLocales : [])
      .map(languageOf)
      .filter((language): language is string => Boolean(language)),
  );

  const explicit = languageOf(params.storefrontLocale);
  if (explicit && (supportedTenantLanguages.size === 0 || supportedTenantLanguages.has(explicit))) {
    return explicit as 'fr' | 'it' | 'en';
  }

  const conversation = languageOf(params.conversationLocale);
  if (
    conversation
    && (supportedTenantLanguages.size === 0 || supportedTenantLanguages.has(conversation))
  ) {
    return conversation as 'fr' | 'it' | 'en';
  }

  const defaultTenantLanguage =
    (Array.isArray(params.tenantLocales) ? params.tenantLocales : [])
      .map(languageOf)
      .find(Boolean)
    ?? languageOf(params.tenantLocale);

  return (defaultTenantLanguage ?? 'fr') as 'fr' | 'it' | 'en';
}

export function shouldOfferNalaProductAction(message: string): boolean {
  const normalized = message.trim();
  if (normalized.length < 2) return false;
  return !NON_PRODUCT_ACTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * `quantity` reflète le minimum de vente du produit (cf. purchaseQuantityRules.ts).
 * Au-delà de 1, le texte doit le dire explicitement — Nala ne doit jamais
 * proposer "je vous l'ajoute ?" pour un produit qui exige un minimum de 4.
 */
export function getNalaProductActionCopy(locale: unknown, quantity = 1): {
  ctaLabel: string;
  labels: NalaProductActionLabels;
} {
  const language = languageOf(locale) ?? 'fr';
  const n = Math.max(1, Math.trunc(quantity) || 1);

  if (language === 'it') {
    return {
      ctaLabel: n > 1 ? `Il minimo per questo prodotto è ${n} — te li metto nel carrello?` : 'Te lo metto nel carrello?',
      labels: {
        adding: 'Aggiungo…',
        added: n > 1 ? `✓ ${n} aggiunti al carrello` : '✓ Aggiunto al carrello',
        viewCart: 'Vedi il carrello',
        error: 'Non sono riuscita ad aggiungerlo.',
        retry: 'Riprova',
        viewProduct: 'Vedi il prodotto',
      },
    };
  }

  if (language === 'en') {
    return {
      ctaLabel: n > 1 ? `This product has a minimum of ${n} — shall I add them to your cart?` : 'Shall I add it to your cart?',
      labels: {
        adding: 'Adding…',
        added: n > 1 ? `✓ ${n} added to cart` : '✓ Added to cart',
        viewCart: 'View cart',
        error: 'I couldn’t add it.',
        retry: 'Try again',
        viewProduct: 'View product',
      },
    };
  }

  return {
    ctaLabel: n > 1 ? `Ce produit a un minimum de ${n} — je vous les ajoute ?` : 'Je vous le mets au panier ?',
    labels: {
      adding: 'J’ajoute…',
      added: n > 1 ? `✓ ${n} ajoutés au panier` : '✓ Ajouté au panier',
      viewCart: 'Voir mon panier',
      error: 'Je n’ai pas pu l’ajouter.',
      retry: 'Réessayer',
      viewProduct: 'Voir le produit',
    },
  };
}

export function buildValidatedNalaProductActions(params: {
  tenantId: string;
  interactionId: string;
  currency: string;
  locale: unknown;
  candidates: NalaProductActionCandidate[];
  products: NalaCanonicalProduct[];
}): NalaProductAction[] {
  const productById = new Map(params.products.map((product) => [product.id, product]));

  return params.candidates.flatMap((candidate) => {
    if (
      candidate.relationshipType === 'direct'
      && (
        !Number.isFinite(candidate.similarity)
        || (candidate.similarity ?? 0) < NALA_PRODUCT_ACTION_MIN_SIMILARITY
      )
    ) {
      return [];
    }

    const product = productById.get(candidate.id);
    if (
      !product
      || product.tenant_id !== params.tenantId
      || !product.active
      || !Number.isFinite(product.stock)
      || product.stock <= 0
    ) {
      return [];
    }

    const minOrderQuantity = Math.max(1, Math.trunc(product.min_order_quantity ?? 1) || 1);
    const orderQuantityStep = Math.max(1, Math.trunc(product.order_quantity_step ?? 1) || 1);
    // Stock insuffisant pour atteindre le minimum de vente : Nala ne doit
    // jamais proposer une quantité que le checkout rejettera ensuite.
    if (product.stock < minOrderQuantity) return [];

    const quantity = minOrderQuantity;
    const copy = getNalaProductActionCopy(params.locale, quantity);

    return [{
      type: 'product' as const,
      action: 'add_to_cart' as const,
      relationshipType: candidate.relationshipType,
      product: {
        id: product.id,
        name: product.name,
        slug: product.slug,
        imageUrl: product.image_url,
        price: Number(product.price),
        compareAtPrice: product.compare_at_price == null ? null : Number(product.compare_at_price),
        currency: params.currency.toUpperCase(),
        available: true as const,
        stock: product.stock,
        weightGrams: product.weight_grams,
        storageType: product.storage_type,
        minOrderQuantity,
        orderQuantityStep,
      },
      quantity,
      ctaLabel: copy.ctaLabel,
      labels: copy.labels,
      interactionId: params.interactionId,
    }];
  }).slice(0, NALA_PRODUCT_ACTION_MAX);
}

export function toNalaCartProduct(action: NalaProductAction) {
  return {
    id: action.product.id,
    name: action.product.name,
    slug: action.product.slug,
    price: action.product.price,
    image_url: action.product.imageUrl,
    weight_grams: action.product.weightGrams,
    stock: action.product.stock,
    storage_type: action.product.storageType,
    min_order_quantity: action.product.minOrderQuantity,
    order_quantity_step: action.product.orderQuantityStep,
  };
}

export async function performNalaAddOnce(
  inFlight: Set<string>,
  key: string,
  addItem: () => void | Promise<void>,
): Promise<boolean> {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  try {
    await addItem();
    return true;
  } finally {
    inFlight.delete(key);
  }
}
