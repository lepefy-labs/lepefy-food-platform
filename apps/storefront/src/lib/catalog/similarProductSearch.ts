/**
 * Tolérance aux fautes de frappe de la recherche produits : règle pure,
 * déterministe, sans IA ni extension SQL. Compare chaque mot de la recherche
 * aux mots du nom (minuscules, sans accents) par distance d'édition
 * (Damerau-Levenshtein : insertion, suppression, substitution, inversion de
 * deux lettres voisines). Utilisée seulement quand la recherche exacte
 * (`ilike` sur le nom) trouve trop peu de produits.
 */

export interface SimilarCandidate {
  id: string;
  name: string;
}

const MIN_TOKEN_LENGTH = 2;
/** Score minimum (0–1) pour qu'un produit soit proposé. */
const MIN_PRODUCT_SCORE = 0.6;
/** Écart maximal avec le meilleur score : une correspondance nette écarte les ressemblances faibles. */
const MAX_GAP_FROM_BEST = 0.2;

export function normalizeSearchText(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

/** Fautes tolérées selon la longueur du mot tapé : 1 jusqu'à 4 lettres, 2 jusqu'à 7, 3 au-delà. */
export function allowedEdits(length: number): number {
  if (length <= 2) return 0;
  if (length <= 4) return 1;
  if (length <= 7) return 2;
  return 3;
}

/** Distance de Damerau-Levenshtein (variante « optimal string alignment »), arrêtée au-delà de `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array<number>(b.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
  }
  return rows[a.length]![b.length]!;
}

/**
 * Proximité (0–1) d'un mot tapé avec un mot du nom. Un début de mot exact
 * vaut 1 (« mani » → « manioc ») ; sinon le mot entier est comparé avec les
 * fautes tolérées, et son début de même longueur (saisie en cours) avec une
 * faute de moins.
 */
export function tokenSimilarity(query: string, word: string): number {
  if (word.startsWith(query)) return 1;
  const max = allowedEdits(query.length);
  if (max === 0) return 0;
  const whole = editDistance(query, word, max);
  // Début de mot (saisie en cours) : une faute de moins, sinon « bobollo » rejoindrait « bouillon ».
  const prefixMax = Math.max(1, max - 1);
  const prefix = word.length > query.length ? editDistance(query, word.slice(0, query.length), prefixMax) : prefixMax + 1;
  const distance = Math.min(whole <= max ? whole : Infinity, prefix <= prefixMax ? prefix : Infinity);
  if (distance === Infinity) return 0;
  return 1 - distance / Math.max(query.length, 2) * 0.8;
}

/**
 * Produits dont le nom ressemble à la recherche, du plus proche au moins
 * proche. Chaque mot tapé doit trouver un mot proche dans le nom ; un nom
 * qui contient déjà la recherche exacte n'est pas exclu ici (l'appelant
 * retire les résultats déjà montrés).
 */
export function rankSimilarProducts<T extends SimilarCandidate>(query: string, candidates: T[], limit: number): T[] {
  const queryTokens = normalizeSearchText(query);
  if (!queryTokens.length || limit <= 0) return [];
  const scored: Array<{ candidate: T; score: number }> = [];
  for (const candidate of candidates) {
    const words = normalizeSearchText(candidate.name);
    if (!words.length) continue;
    let total = 0;
    let matchedAll = true;
    for (const token of queryTokens) {
      let best = 0;
      for (const word of words) {
        const similarity = tokenSimilarity(token, word);
        if (similarity > best) best = similarity;
        if (best === 1) break;
      }
      if (best === 0) { matchedAll = false; break; }
      total += best;
    }
    if (!matchedAll) continue;
    const score = total / queryTokens.length;
    if (score >= MIN_PRODUCT_SCORE) scored.push({ candidate, score });
  }
  const best = scored.reduce((max, entry) => Math.max(max, entry.score), 0);
  return scored
    .filter((entry) => entry.score >= best - MAX_GAP_FROM_BEST)
    .sort((a, b) => b.score - a.score || a.candidate.name.length - b.candidate.name.length || a.candidate.name.localeCompare(b.candidate.name))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
