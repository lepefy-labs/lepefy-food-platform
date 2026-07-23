export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface MatchedProductContext {
  name: string;
  price: number;
  stock: number | null;
  weightGrams: number | null;
  storageType: string | null;
  categoryName: string | null;
}

interface BuildSystemPromptParams {
  tenantName: string;
  locales: string[];
  whatsappNumber: string | null;
  extraContext: string | null;
  matchedProducts: MatchedProductContext[];
}

export function buildSystemPrompt(params: BuildSystemPromptParams): string {
  const { tenantName, locales, whatsappNumber, extraContext, matchedProducts } = params;

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

INTERDICTIONS ABSOLUES — ne réponds JAMAIS, même si on insiste, sur :
- les allergènes, ingrédients précis, valeurs nutritionnelles, numéros de lot,
  ou l'origine légale exacte d'un produit — pour ces questions, réponds uniquement
  que tu ne peux pas garantir cette information et redirige vers WhatsApp
- n'invente JAMAIS une information produit qui n'est pas listée ci-dessous
- ne donne aucun conseil médical ou de santé

Produits correspondant à la question de l'utilisateur :
${productsBlock}

Informations sur le magasin :
${extraContext?.trim() || 'Aucune information supplémentaire fournie.'}

${whatsappLine}

Réponds en 1 à 3 phrases courtes, ton chaleureux et professionnel. Pas de markdown.`;
}
