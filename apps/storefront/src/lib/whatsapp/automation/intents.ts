import { extractNalaAvailabilityProductQuery } from '@/lib/ai/nalaFastProductResolver';

/**
 * Détection déterministe (sans IA) des intentions WhatsApp, FR / IT / EN.
 * Conservatrice : une intention n'est retenue que sur un signal explicite ; le
 * reste part vers Nala (si activée) ou vers un opérateur. Les horaires et
 * l'adresse sont détectés par le Fast Resolver de Nala (réutilisé, pas dupliqué).
 */

export type DetectedIntent =
  | 'human_request'
  | 'complaint'
  | 'payment_issue'
  | 'order_not_received'
  | 'order_status'
  | 'tracking'
  | 'shipping'
  | 'catalog'
  | 'product_availability'
  | 'greeting';

export interface IntentDetection {
  intents: DetectedIntent[];
  /** Produit demandé (disponibilité), extrait par le résolveur Nala existant. */
  productQuery: string | null;
  /** true si le message n'est qu'une salutation (aucune autre demande). */
  greetingOnly: boolean;
}

export function normalizeForIntent(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9#\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PATTERNS: Record<Exclude<DetectedIntent, 'product_availability' | 'greeting'>, RegExp[]> = {
  human_request: [
    /\b(?:parler|discuter|echanger) (?:a|avec) (?:un|une|quelqu un|un vrai|une vraie|le|la|votre)\b/,
    /\b(?:operateur|operatrice|conseiller|conseillere|humain|vraie personne|vrai personne|service client)\b/,
    /\b(?:parlare|parlo) con (?:un|una|qualcuno|operatore|persona)\b/,
    /\b(?:operatore|persona reale|assistenza clienti)\b/,
    /\b(?:talk|speak|chat) (?:to|with) (?:a|an|someone|somebody|human|person|agent|representative)\b/,
    /\b(?:human|real person|customer service|live agent)\b/,
  ],
  complaint: [
    /\b(?:reclamation|plainte|inadmissible|inacceptable|scandale|honte|arnaque|deçu|decu|decue|mecontent|mecontente)\b/,
    /\b(?:produit|colis|commande|article)s? (?:abime|abimee|casse|cassee|endommage|endommagee|perime|perimee|pourri|pourrie)s?\b/,
    /\b(?:reclamo|lamentela|inaccettabile|vergogna|truffa|deluso|delusa|danneggiat[oa]|rott[oa]|scadut[oa])\b/,
    /\b(?:complaint|unacceptable|scam|disappointed|damaged|broken|expired|rotten)\b/,
    /\b(?:rembours|refund|rimbors)/,
  ],
  payment_issue: [
    /\b(?:paiement|payer|carte|virement|prelevement|debite|debit)\b.*\b(?:refuse|echoue|echec|bloque|probleme|erreur|deux fois|double|pas passe|ne passe pas)\b/,
    /\b(?:refuse|echoue|echec|bloque|probleme|erreur|deux fois|double)\b.*\b(?:paiement|carte|virement)\b/,
    /\b(?:pagamento|carta|bonifico|addebit)\w*\b.*\b(?:rifiutat|fallit|bloccat|problema|errore|due volte|doppio)\w*/,
    /\b(?:payment|card|charged)\b.*\b(?:declined|failed|refused|problem|error|twice|double)\b/,
  ],
  order_not_received: [
    /\b(?:pas|jamais|toujours pas|rien) (?:encore )?(?:recu|arrive|livre|livree)\b/,
    /\b(?:colis|commande|livraison)\b.*\b(?:perdu|perdue|disparu|disparue|pas arrive|pas arrivee|jamais arrive)\b/,
    /\b(?:non (?:ho )?(?:ancora )?ricevut[oa]|mai arrivat[oa]|non e (?:ancora )?arrivat[oa]|pacco (?:perso|smarrito))\b/,
    /\b(?:(?:not|never|still not|haven t|have not|didn t|did not) (?:yet )?(?:received|arrived|delivered|got)|package (?:lost|missing))\b/,
  ],
  order_status: [
    /\b(?:ma|mon|notre) commande\b/,
    /\b(?:statut|etat|ou en est|ou est|suivi) (?:de )?(?:ma |la |mon )?commande\b/,
    /\bcommande (?:n|no|numero|#)\s?[a-z0-9]{4,}\b/,
    /\b(?:il mio|mio) ordine\b|\bstato (?:del(?:l)? )?ordine\b|\bdov e (?:il )?(?:mio )?ordine\b/,
    /\bmy order\b|\border status\b|\bwhere is my order\b/,
  ],
  tracking: [
    /\b(?:suivi|suivre|tracking|numero de suivi|ou est (?:mon|le) colis|mon colis)\b/,
    /\b(?:tracciamento|traccia(?:re)?|codice di tracking|il mio pacco|dov e (?:il )?(?:mio )?pacco)\b/,
    /\b(?:track(?:ing)?(?: number)?|where is my (?:parcel|package)|my (?:parcel|package))\b/,
  ],
  shipping: [
    /\b(?:livraison|livrez|livrer|frais de port|frais d envoi|expedition|expediez|envoyez)\b/,
    /\b(?:spedizione|spedite|consegna|consegnate|spese di spedizione)\b/,
    /\b(?:shipping|delivery|deliver|ship to|postage)\b/,
  ],
  catalog: [
    /\b(?:catalogue|vos produits|liste des produits|site|boutique en ligne|commander en ligne|carte des produits)\b/,
    /\b(?:catalogo|i vostri prodotti|lista (?:dei )?prodotti|sito|negozio online|ordinare online)\b/,
    /\b(?:catalog(?:ue)?|your products|product list|website|online shop|online store|order online)\b/,
  ],
};

const GREETING = /^(?:bonjour|bonsoir|salut|coucou|hello|hi|hey|ciao|buongiorno|buonasera|salve|good (?:morning|afternoon|evening)|yo)(?:\s+(?:a tous|tout le monde|a vous|madame|monsieur|the team|team|a tutti))?(?:\s|$)/;
const GREETING_ONLY = /^(?:bonjour|bonsoir|salut|coucou|hello|hi|hey|ciao|buongiorno|buonasera|salve|good (?:morning|afternoon|evening)|yo|merci|thanks|grazie)(?:\s+[a-z]+){0,2}$/;

export function detectIntents(message: string): IntentDetection {
  const text = normalizeForIntent(message);
  const intents: DetectedIntent[] = [];
  if (!text) return { intents, productQuery: null, greetingOnly: false };

  for (const [intent, patterns] of Object.entries(PATTERNS) as Array<[DetectedIntent, RegExp[]]>) {
    if (patterns.some((pattern) => pattern.test(text))) intents.push(intent);
  }
  // « Où est mon colis » relève du suivi, pas d'un colis jamais reçu.
  const productQuery = extractNalaAvailabilityProductQuery(message);
  if (productQuery) intents.push('product_availability');
  const greeting = GREETING.test(text);
  if (greeting) intents.push('greeting');
  return { intents, productQuery, greetingOnly: greeting && GREETING_ONLY.test(text) && intents.length === 1 };
}

const LANGUAGE_HINTS: Record<'fr' | 'it' | 'en', RegExp> = {
  fr: /\b(?:bonjour|bonsoir|merci|commande|livraison|vous|avez|est-ce|je|pour|colis|quand|ou est)\b/g,
  it: /\b(?:ciao|buongiorno|buonasera|grazie|ordine|spedizione|avete|vorrei|sono|quando|dov e|pacco|il mio)\b/g,
  en: /\b(?:hello|hi|thanks|order|delivery|shipping|do you|have|my|when|where|please|the)\b/g,
};

/** Langue du message (fr / it / en) ou null si aucun signal clair. */
export function detectLanguage(message: string): 'fr' | 'it' | 'en' | null {
  const text = normalizeForIntent(message);
  let best: 'fr' | 'it' | 'en' | null = null;
  let bestScore = 0;
  let tie = false;
  for (const language of ['fr', 'it', 'en'] as const) {
    const score = text.match(LANGUAGE_HINTS[language])?.length ?? 0;
    if (score > bestScore) { best = language; bestScore = score; tie = false; }
    else if (score === bestScore && score > 0) tie = true;
  }
  return tie ? null : best;
}

/** Référence courte de commande citée par le client (8 caractères, cf. orderShortRef). */
export function extractOrderRef(message: string): string | null {
  const match = message.toUpperCase().match(/(?:#|\b(?:N[°O]?|NO|NUM(?:ERO|ÉRO)?|REF|ORDER|ORDINE|COMMANDE)\s*[:#]?\s*)([0-9A-F]{8})\b/);
  return match?.[1] ?? null;
}
