/**
 * Display order of admin lists (payment methods, social links): pure move and
 * validation of a full reorder request. Client-safe.
 */

/** Moves the item at `from` to `to` (both clamped); returns a new array. */
export function moveItem<T>(items: ReadonlyArray<T>, from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item as T);
  return next;
}

/**
 * Validates a full reorder request against the tenant's rows: every id exactly
 * once, nothing foreign. Returns the rows whose sort_order must change.
 */
export function planReorder(
  current: ReadonlyArray<{ id: string; sort_order: number }>,
  requestedIds: unknown,
): { ok: true; updates: Array<{ id: string; sort_order: number }> } | { ok: false; error: string } {
  if (!Array.isArray(requestedIds) || requestedIds.some((id) => typeof id !== 'string')) {
    return { ok: false, error: 'ids doit être une liste d’identifiants.' };
  }
  const known = new Map(current.map((row) => [row.id, row.sort_order]));
  const unique = new Set(requestedIds as string[]);
  if (unique.size !== requestedIds.length || unique.size !== known.size || [...unique].some((id) => !known.has(id))) {
    return { ok: false, error: 'La liste a changé entre-temps (autre onglet ou autre personne). Rechargez la page.' };
  }
  const updates = (requestedIds as string[])
    .map((id, index) => ({ id, sort_order: index }))
    .filter(({ id, sort_order }) => known.get(id) !== sort_order);
  return { ok: true, updates };
}
