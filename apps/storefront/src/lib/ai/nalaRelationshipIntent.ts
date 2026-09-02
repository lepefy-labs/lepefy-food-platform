import type { ProductRelationshipType } from '@/lib/catalog/productRelationships';

export interface NalaRelationshipAnchor {
  id: string;
  stock: number | null;
}

const COMPLEMENTARY_PATTERNS = [
  /\b(avec quoi|quoi (?:manger|servir|préparer) avec|qu['’]est-ce qu['’]il faut avec|conseillez?-vous avec|accompagnement)\b/i,
  /\b(con cosa|cosa ci vuole con|abbinare|accompagnare)\b/i,
  /\b(what goes with|what do i need with|pair with|serve with)\b/i,
];

const SIMILAR_PATTERNS = [
  /\b(similaire|semblable|assez proche|quelque chose comme)\b/i,
  /\b(simile|qualcosa di simile|somigliante)\b/i,
  /\b(similar|something like|close to)\b/i,
];

const SUBSTITUTE_PATTERNS = [
  /\b(remplacement|remplacer|alternative|à la place)\b/i,
  /\b(sostitut|alternativa|al posto)\b/i,
  /\b(substitute|replacement|alternative|instead of)\b/i,
];

const AVAILABILITY_PATTERNS = [
  /\b(avez-vous|disponible|en stock|rupture)\b/i,
  /\b(avete|disponibile|in stock|esaurit)\b/i,
  /\b(do you have|available|in stock|out of stock)\b/i,
];

export function inferNalaRelationshipType(
  message: string,
  anchor: NalaRelationshipAnchor | null,
): ProductRelationshipType | null {
  if (COMPLEMENTARY_PATTERNS.some((pattern) => pattern.test(message))) return 'complementary';
  if (SIMILAR_PATTERNS.some((pattern) => pattern.test(message))) return 'similar';
  if (SUBSTITUTE_PATTERNS.some((pattern) => pattern.test(message))) return 'substitute';
  if (
    anchor
    && (anchor.stock ?? 0) <= 0
    && AVAILABILITY_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return 'substitute';
  }
  return null;
}
