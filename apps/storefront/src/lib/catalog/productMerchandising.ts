export function parseCompareAtPrice(raw: unknown, price: number): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') throw new Error('Prix avant remise invalide.');
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isFinite(price) || value <= price || price < 0) {
    throw new Error('Le prix avant remise doit dépasser le prix de vente.');
  }
  return value;
}

export function parseCatalogPosition(raw: unknown): number {
  if (raw == null || raw === '') return 9999;
  if (typeof raw !== 'number' && typeof raw !== 'string') throw new Error('Position catalogue invalide.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error('La position catalogue doit être un entier.');
  return value;
}

/** Merge before slicing so promoted products cannot cause gaps or duplicates. */
export function prioritizedCatalogIds(rankedIds: string[], pinnedIds: string[], offset: number, limit: number): string[] {
  return [...new Set([...pinnedIds, ...rankedIds])].slice(offset, offset + limit);
}
