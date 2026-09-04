export interface NalaFastProductCandidate {
  id: string;
  name: string;
  name_alt?: string | null;
  stock: number | null;
}

export interface NalaFastProductResolution {
  product: NalaFastProductCandidate;
  query: string;
  available: boolean;
  reply: string;
}

function language(locale: string): 'fr' | 'it' | 'en' {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith('it')) return 'it';
  if (normalized.startsWith('en')) return 'en';
  return 'fr';
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanRequestedPhrase(value: string): string | null {
  const cleaned = value
    .replace(/[?!.,;:]+$/g, '')
    .replace(/\b(?:en stock|disponible|disponibles|in stock|available|disponibile|disponibili)\b\s*$/iu, '')
    .replace(/^\s*(?:du|de la|de l[’']|des|le|la|les|un|une|del|della|dei|degli|delle|il|lo|la|i|gli|le|some|the|a|an)\s+/iu, '')
    .replace(/[%_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  if (cleaned.length < 2) return null;
  const normalized = normalize(cleaned);
  if (!normalized || /^(?:produit|produits|product|products|prodotto|prodotti|quelque chose|something|qualcosa|stock)$/.test(normalized)) {
    return null;
  }
  if (/\b(?:remplac\w*|substitut\w*|alternativ\w*|similair\w*|similar\w*|conseill\w*|recommend\w*|recette\w*|recipe\w*|ricetta\w*)\b|\b(?:avec quoi|what goes with)\b/.test(normalized)) {
    return null;
  }
  return cleaned;
}

/**
 * Extracts only explicit availability/existence product questions. Broader recommendation,
 * substitution and meal intents deliberately fall through to the normal Understanding path.
 */
export function extractNalaAvailabilityProductQuery(message: string): string | null {
  const source = message.trim().slice(0, 300);
  if (!source) return null;

  const patterns = [
    /^(?:est[- ]ce que\s+)?(?:vous\s+avez|avez[- ]vous|vous\s+vendez|vendez[- ]vous|est[- ]ce que vous vendez)\s+(.+)$/iu,
    /^(?:est[- ]ce qu['’]il y a|y a[- ]t[- ]il)\s+(.+)$/iu,
    /^(?:avete|vendete|c['’è]|c['’]e|ci sono)\s+(.+)$/iu,
    /^(?:do you have|have you got|do you sell|is there|are there)\s+(.+)$/iu,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const requested = match?.[1] ? cleanRequestedPhrase(match[1]) : null;
    if (requested) return requested;
  }
  return null;
}

function candidateScore(query: string, candidate: NalaFastProductCandidate): number {
  const requested = normalize(query);
  const name = normalize(candidate.name);
  const alternate = candidate.name_alt ? normalize(candidate.name_alt) : '';
  if (!requested || !name) return 0;

  if (name === requested) return 1;
  if (name.startsWith(`${requested} `) || name.startsWith(`${requested}-`) || name.startsWith(`${requested} (`)) return 0.99;
  if (alternate === requested) return 0.98;
  if (alternate && (alternate.startsWith(`${requested} `) || alternate.startsWith(`${requested}-`))) return 0.97;
  if (requested.length >= 5 && (` ${name} `).includes(` ${requested} `)) return 0.82;
  if (alternate && requested.length >= 5 && (` ${alternate} `).includes(` ${requested} `)) return 0.8;
  return 0;
}

function productReply(locale: string, name: string, available: boolean): string {
  if (language(locale) === 'it') {
    return available
      ? `Sì, abbiamo ${name} disponibile.`
      : `Abbiamo ${name}, ma al momento è esaurito.`;
  }
  if (language(locale) === 'en') {
    return available
      ? `Yes, we have ${name} in stock.`
      : `We carry ${name}, but it is currently out of stock.`;
  }
  return available
    ? `Oui, nous avons ${name} en stock.`
    : `Nous avons bien ${name}, mais il est actuellement en rupture de stock.`;
}

/**
 * Resolves only an unambiguous, high-confidence lexical catalogue match.
 * A weak or tied match returns null so semantic retrieval + AI Core remain the safe fallback.
 */
export function resolveNalaFastProductAvailability(params: {
  query: string;
  locale: string;
  products: NalaFastProductCandidate[];
}): NalaFastProductResolution | null {
  const ranked = params.products
    .map(product => ({ product, score: candidateScore(params.query, product) }))
    .filter(candidate => candidate.score >= 0.97)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));

  const best = ranked[0];
  if (!best) return null;
  const second = ranked[1];
  if (second && best.score - second.score < 0.08) return null;
  if (best.product.stock == null || !Number.isFinite(best.product.stock)) return null;

  const available = best.product.stock > 0;
  return {
    product: best.product,
    query: params.query,
    available,
    reply: productReply(params.locale, best.product.name, available),
  };
}
