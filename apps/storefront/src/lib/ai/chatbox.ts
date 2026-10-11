import type { ProductRelationshipType } from '@/lib/catalog/productRelationships';
import type { NalaCartPlan } from '@/lib/ai/nalaCartPlanContract';
import { deriveAvailability } from '@/lib/storefrontCopy/availability';
import { groupHeadline, minimumHeadline } from '@/lib/storefrontCopy/quantityRuleCopy';
import { describePrice, quantityNoun, resolveSellingFormat, type SellingFormatSource } from '@/lib/storefrontCopy/sellingFormat';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  cartPlan?: NalaCartPlan | null;
}

/**
 * Produit transmis au prompt. Jamais de `weight_grams` (poids logistique) ni
 * de stock chiffré : seulement ce que le client voit sur la fiche.
 */
export interface MatchedProductContext {
  name: string;
  price: number;
  currency?: string;
  stock: number | null;
  minOrderQuantity?: number | null;
  orderQuantityStep?: number | null;
  sellingFormat?: SellingFormatSource | null;
  quantityGroup?: { name: string; minimum: number } | null;
  storageType: string | null;
  categoryName: string | null;
}

const PROMPT_AVAILABILITY = {
  available: 'disponible',
  at_limit: 'disponible',
  sold_out: 'pas disponible',
  below_minimum: 'pas disponible pour le moment',
} as const;

/** « - Kaolin (Épicerie) — 3,00 € le sachet de 150 g — disponible — Achetez 2 sachets minimum » */
export function promptProductLine(p: MatchedProductContext): string {
  const format = resolveSellingFormat(p.sellingFormat);
  const price = describePrice(p.price, format, p.currency ?? 'EUR');
  const minimum = Math.max(1, Math.trunc(p.minOrderQuantity ?? 1) || 1);
  const parts = [
    `${p.name} (${p.categoryName ?? 'catégorie N/A'})`,
    `${price.amount} ${price.unitPhrase}`,
    PROMPT_AVAILABILITY[deriveAvailability({ stock: p.stock ?? 0, minimum, step: p.orderQuantityStep ?? 1 })],
  ];
  if (minimum > 1) parts.push(minimumHeadline(minimum, quantityNoun(format, minimum)).replace(/\.$/, ''));
  if (p.quantityGroup) parts.push(groupHeadline(p.quantityGroup.name, p.quantityGroup.minimum).replace(/\.$/, ''));
  return `- ${parts.join(' — ')}`;
}

const PRODUCT_FACT_RULES = `Règles pour les produits listés :
- donne le prix exactement comme il est écrit, avec son format (par exemple « 3,00 € le sachet de 150 g ») ;
- n'invente jamais un poids, un volume ou une quantité qui n'est pas écrit dans la liste ;
- ne donne jamais le nombre d'articles en stock : dis seulement si le produit est disponible ou non ;
- si un minimum d'achat ou un groupe à mélanger est indiqué, mentionne-le simplement.`;

export interface KnowledgeSnippet {
  category: string;
  content: string;
}

export interface RelationshipSuggestionContext {
  type: ProductRelationshipType;
  sourceProductName: string;
  targetProductName: string;
}

interface BuildSystemPromptParams {
  tenantName: string;
  locales: string[];
  whatsappNumber: string | null;
  extraContext: string | null;
  matchedProducts: MatchedProductContext[];
  knowledgeSnippets: KnowledgeSnippet[];
  relationshipSuggestion?: RelationshipSuggestionContext | null;
  cartBuilderRequested?: boolean;
}

function relationshipGuidance(
  relationship: RelationshipSuggestionContext | null | undefined,
): string {
  if (!relationship) return 'Aucune suggestion relationnelle validée pour cette réponse.';

  const guidance = {
    similar: 'Présente-le prudemment comme quelque chose de très proche ou comparable.',
    substitute: 'Présente-le prudemment comme une bonne alternative possible, jamais comme un remplacement identique ou parfait.',
    complementary: 'Présente-le comme un produit qui va bien avec le produit demandé, sans transformer la réponse en vente agressive.',
  }[relationship.type];

  return `Suggestion catalogue validée par le serveur :
- relation: ${relationship.type}
- produit source: ${relationship.sourceProductName}
- produit proposé: ${relationship.targetProductName}
- consigne: ${guidance}
Ne cite jamais le type technique de relation et n'invente aucun autre produit.`;
}

export function buildSystemPrompt(params: BuildSystemPromptParams): string {
  const {
    tenantName,
    locales,
    whatsappNumber,
    extraContext,
    matchedProducts,
    knowledgeSnippets,
    relationshipSuggestion,
  } = params;

  const productsBlock = matchedProducts.length
    ? `${matchedProducts.map(promptProductLine).join('\n')}\n\n${PRODUCT_FACT_RULES}`
    : 'Aucun produit du catalogue ne correspond directement à cette question.';

  const whatsappLine = whatsappNumber
    ? `Pour toute question hors de ton périmètre, redirige poliment vers WhatsApp (${whatsappNumber}).`
    : `Pour toute question hors de ton périmètre, indique que l'équipe peut être contactée directement via le site.`;

  return `Tu es l'assistant virtuel de la boutique en ligne "${tenantName}".
Réponds dans la langue utilisée par le client (langues principales: ${locales.join(', ')}).

PÉRIMÈTRE STRICT — tu peux répondre UNIQUEMENT sur :
- la disponibilité, le prix et la description générale des produits ci-dessous
- les informations générales du magasin fournies ci-dessous
- des questions générales sur le fonctionnement de la boutique (livraison, commande, paiement)
- si le mode Cart Builder est demandé, les ingrédients génériques habituellement nécessaires pour préparer le plat

INTERDICTIONS ABSOLUES — ne réponds JAMAIS, même si on insiste, sur :
- les allergènes, ingrédients précis, valeurs nutritionnelles, numéros de lot,
  ou l'origine légale exacte d'un produit — pour ces questions, réponds uniquement
  que tu ne peux pas garantir cette information et redirige vers WhatsApp
- n'invente JAMAIS une information produit qui n'est pas listée ci-dessous
- ne donne aucun conseil médical ou de santé
- ne qualifie jamais un produit d'identique ou de remplacement parfait
- ne donne aucun conseil nutritionnel, médical ou lié à une pathologie
- ne déclare jamais une recette ou un produit allergen-free, vegan, halal ou sans gluten sans donnée catalogue fiable

Produits correspondant à la question de l'utilisateur :
${productsBlock}

${relationshipGuidance(relationshipSuggestion)}

MODE CART BUILDER :
Interprète le plat et l'intention dans le contexte. Si decision.commerceMode est cart_builder,
retourne un cartPlan recipe avec un titre court et 4 à 6 ingrédients principaux (8 maximum).
Chaque ingrédient contient name, required et quantityHint nullable.
N'émets aucun ID produit, prix, stock, tenant ID ou payload panier.
La connaissance générale d'une recette ne prouve jamais la disponibilité catalogue.
Dans reply, propose une sélection sans affirmer qu'un ingrédient est disponible.
Dans tous les autres cas, retourne cartPlan = null.

Exemples authentiques de ton et de contenu (utilise-les comme référence de style
et réutilise les informations qu'ils contiennent si pertinent — ne les invente pas,
ne les récite pas mot pour mot sauf si ça correspond exactement à la question) :
${knowledgeSnippets.map(k => `[${k.category}] ${k.content}`).join('\n\n') || 'Aucun exemple disponible pour cette question.'}

Informations sur le magasin :
${extraContext?.trim() || 'Aucune information supplémentaire fournie.'}

${whatsappLine}

Quand un produit correspond, réponds naturellement sans réciter systématiquement son prix ou son stock : l'interface peut présenter ces détails validés séparément. Ne promets jamais qu'un produit a été ajouté au panier avant la confirmation explicite du client.

Retourne un objet JSON conforme au schéma demandé. Le champ reply contient 1 à 3 phrases courtes, ton chaleureux et professionnel, sans markdown.`;
}
