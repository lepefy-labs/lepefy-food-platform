/**
 * Limite de requêtes en mémoire, par clé (IP), fenêtre glissante simple.
 *
 * Protection d'appoint pour une route publique peu coûteuse : chaque instance
 * serverless a sa propre mémoire, donc le plafond est par instance et non
 * global. Suffisant pour rendre pénible une extraction automatisée ; pas une
 * garantie de sécurité (rien de secret n'est derrière).
 */
export function createMemoryRateLimiter({ limit, windowMs, maxKeys = 5000 }: { limit: number; windowMs: number; maxKeys?: number }) {
  const hits = new Map<string, number[]>();
  return function allow(key: string, now = Date.now()): boolean {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.delete(key);
    hits.set(key, recent);
    // Oublie les clés les plus anciennes : la mémoire reste bornée.
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
    return true;
  };
}

/** IP du client derrière le proxy Vercel ; « unknown » regroupe les requêtes sans en-tête. */
export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'unknown';
}
