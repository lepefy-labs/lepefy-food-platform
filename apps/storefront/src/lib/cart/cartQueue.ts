import type { CartMutationInput, PendingMutation } from './cartTypes';
import { newMutationId } from './cartTypes';

// Funzioni PURE di gestione della coda — nessun accesso allo store, nessun
// side effect, interamente testabili.

export function createPendingMutation(input: CartMutationInput): PendingMutation {
  return { ...input, id: newMutationId(), createdAt: new Date().toISOString(), retryCount: 0 };
}

function productIdOf(mutation: PendingMutation): string | null {
  return mutation.type === 'clear' ? null : mutation.productId;
}

/**
 * Aggiunge una mutation alla coda fondendola con quelle già pendenti quando
 * l'operazione è equivalente (§32: cinque pressioni di "+" non devono produrre
 * cinque richieste HTTP).
 *
 * Regole, tutte a semantica preservata:
 *  - `clear`             → azzera la coda: tutto ciò che precede è irrilevante.
 *  - `remove` / `set_quantity` (assolute) → eliminano le mutation pendenti
 *    dello stesso prodotto, che sarebbero comunque sovrascritte.
 *  - `add` (relativa)    → si somma all'ultima mutation pendente dello stesso
 *    prodotto: `add`+`add` = un solo add; `set(n)`+`add(k)` = `set(n+k)`
 *    (equivalente perché il set è assoluto e l'add si applica dopo).
 *
 * Nessuna regola scarta un'intenzione dell'utente: le mutation eliminate sono
 * solo quelle che l'operazione successiva rende matematicamente irrilevanti.
 */
export function enqueueMutation(
  queue: PendingMutation[],
  input: CartMutationInput,
): PendingMutation[] {
  if (input.type === 'clear') {
    return [createPendingMutation(input)];
  }

  if (input.type === 'remove' || input.type === 'set_quantity') {
    const kept = queue.filter((m) => productIdOf(m) !== input.productId);
    return [...kept, createPendingMutation(input)];
  }

  // input.type === 'add'
  const lastIndex = findLastIndex(queue, (m) => productIdOf(m) === input.productId);
  const last      = lastIndex >= 0 ? queue[lastIndex] : null;

  if (last && (last.type === 'add' || last.type === 'set_quantity')) {
    const merged: PendingMutation = { ...last, quantity: last.quantity + input.quantity };
    const next = [...queue];
    next[lastIndex] = merged;
    return next;
  }

  return [...queue, createPendingMutation(input)];
}

/** Rimuove dalla coda le mutation confermate come applicate dal server. */
export function removeApplied(queue: PendingMutation[], appliedIds: string[]): PendingMutation[] {
  if (appliedIds.length === 0) return queue;
  const applied = new Set(appliedIds);
  return queue.filter((m) => !applied.has(m.id));
}

/** Incrementa il contatore di retry delle mutation di un batch fallito. */
export function markRetried(queue: PendingMutation[], batchIds: string[]): PendingMutation[] {
  const batch = new Set(batchIds);
  return queue.map((m) => (batch.has(m.id) ? { ...m, retryCount: m.retryCount + 1 } : m));
}

// Array.prototype.findLastIndex richiede ES2023 — il target TS del progetto è
// più basso, quindi implementazione locale invece di alzare la lib globale.
function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item !== undefined && predicate(item)) return i;
  }
  return -1;
}
