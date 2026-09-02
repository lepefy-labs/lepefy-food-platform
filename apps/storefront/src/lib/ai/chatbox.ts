import type { ProductRelationshipType } from '@/lib/catalog/productRelationships';
import type { NalaCartPlan } from '@/lib/ai/nalaCartPlanContract';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  cartPlan?: NalaCartPlan | null;
}

export interface MatchedProductContext {
  name: string;
  price: number;
  stock: number | null;
  weightGrams: number | null;
  storageType: string | null;
  categoryName: string | null;
}

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
    ? matchedProducts
        .map(p =>
          `- ${p.name} (${p.categoryName ?? 'catégorie N/A'}) — ${p.price} EUR — ` +
          `${p.stock !== null && p.stock > 0 ? `en stock (${p.stock})` : 'rupture de stock'}` +
          `${p.weightGrams ? `, ${p.weightGrams}g` : ''}`
        )
        .join('\n')
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
