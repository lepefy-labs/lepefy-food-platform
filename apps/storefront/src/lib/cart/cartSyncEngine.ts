import type { CartItem } from '@lepefy/types';
import { useCartStore, registerCartFlushScheduler } from '@/stores/cartStore';
import { fetchServerCart, pushCartMutations } from './cartApi';
import { CartSyncError } from './cartErrors';
import { enqueueMutation, markRetried, removeApplied } from './cartQueue';
import { logCart } from './cartLog';
import { mergeGuestCartWithServerCart } from './mergeCarts';
import { reconcileCart } from './reconcile';
import { toPayload } from './cartTypes';
import type { PendingMutation } from './cartTypes';

// ─── Sync engine ────────────────────────────────────────────────────────────
// Tutta la business logic della sincronizzazione vive qui. CartSyncProvider si
// limita al lifecycle (auth, online/offline, visibility, idratazione).
//
// Modello: local-first + mutation queue + optimistic concurrency control.
//   1. L'azione utente aggiorna subito lo store (UI istantanea) e accoda una
//      mutation persistita in localStorage insieme al carrello.
//   2. Il flush, debouncato, invia il batch con la versione server attesa.
//   3. Il server applica atomicamente e restituisce lo stato canonical.
//   4. In caso di 409 lo stato canonical arriva comunque: si riapplicano
//      sopra le mutation ancora pendenti e si ritenta.

/** Debounce del flush: "+ + + + +" produce una sola richiesta. */
const FLUSH_DEBOUNCE_MS = 700;
/** Tetto di mutation per richiesta — il resto parte nel batch successivo. */
const MAX_BATCH_SIZE = 50;
/** Backoff esponenziale per gli errori transitori. */
const RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000];
/** Oltre questo numero di tentativi falliti una mutation smette di ritentare. */
const MAX_ATTEMPTS = 5;
/** Età oltre la quale un ritorno sulla tab giustifica un reconcile. */
const STALE_AFTER_MS = 30_000;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight     = false;
let rerunPending = false;
let transientAttempts = 0;

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function clearFlushTimer(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}

/** Programma un flush debouncato. Chiamata da ogni azione dello store. */
export function scheduleCartFlush(delayMs: number = FLUSH_DEBOUNCE_MS): void {
  const state = useCartStore.getState();
  if (!state.ownerCustomerId || state.pendingMutations.length === 0) return;

  if (isOffline()) {
    // Offline: il carrello resta pienamente utilizzabile, le mutation si
    // accumulano in coda e partiranno all'evento 'online'.
    useCartStore.setState({ syncStatus: 'offline' });
    return;
  }

  clearFlushTimer();
  flushTimer = setTimeout(() => { flushTimer = null; void flushCart(); }, delayMs);
}

// Registrazione presso lo store (inversione di dipendenza: lo store non
// importa mai questo modulo).
registerCartFlushScheduler(() => scheduleCartFlush());

/**
 * Invia immediatamente le mutation pendenti.
 * @param options.keepalive true quando la pagina sta per sparire (pagehide,
 *        visibilitychange → hidden): il browser completa la richiesta anche
 *        dopo l'unload del documento.
 */
export async function flushCart(options: { keepalive?: boolean } = {}): Promise<void> {
  clearFlushTimer();

  if (inFlight) { rerunPending = true; return; }

  const state = useCartStore.getState();
  const owner = state.ownerCustomerId;
  if (!owner) return;

  if (state.pendingMutations.length === 0) {
    if (state.syncStatus === 'syncing' || state.syncStatus === 'conflict') {
      useCartStore.setState({ syncStatus: 'synced' });
    }
    return;
  }

  if (isOffline()) {
    useCartStore.setState({ syncStatus: 'offline' });
    return;
  }

  // Una mutation che ha già esaurito i tentativi congela la coda: nessun retry
  // automatico finché un evento di lifecycle (online, ritorno sulla tab, login)
  // non azzera i contatori. Le mutation NON vengono mai scartate.
  if (state.pendingMutations.some((m) => m.retryCount >= MAX_ATTEMPTS)) {
    useCartStore.setState({ syncStatus: 'error' });
    return;
  }

  const batch = state.pendingMutations.slice(0, MAX_BATCH_SIZE);
  inFlight = true;
  useCartStore.setState({ syncStatus: 'syncing' });
  logCart('cart_sync_started', { mutations: batch.length, expectedVersion: state.serverVersion });

  try {
    const result = await pushCartMutations(
      state.serverVersion,
      batch.map(toPayload),
      { keepalive: options.keepalive },
    );
    transientAttempts = 0;
    applySyncResult(owner, result.items, result.version, result.appliedMutationIds, result.unavailableProductIds);
    logCart('cart_sync_success', { version: result.version, applied: result.appliedMutationIds.length });
  } catch (error) {
    handleSyncError(owner, batch, error);
  } finally {
    inFlight = false;
  }

  const after = useCartStore.getState();
  const shouldContinue =
    rerunPending ||
    (after.ownerCustomerId === owner &&
      after.pendingMutations.length > 0 &&
      after.syncStatus !== 'error' &&
      after.syncStatus !== 'offline' &&
      transientAttempts === 0);

  rerunPending = false;
  if (shouldContinue) scheduleCartFlush(0);
}

function applySyncResult(
  owner: string,
  serverItems: CartItem[],
  version: number,
  appliedIds: string[],
  unavailableProductIds: string[],
): void {
  const state = useCartStore.getState();
  // Il proprietario è cambiato durante il volo (logout / altro cliente):
  // la risposta non lo riguarda più e va scartata, mai applicata.
  if (state.ownerCustomerId !== owner) return;

  const remaining = removeApplied(state.pendingMutations, appliedIds);

  useCartStore.setState({
    // Le mutation accodate DURANTE la richiesta vengono riapplicate sopra lo
    // stato canonical: nessuna azione dell'utente viene persa da una risposta
    // in ritardo.
    items:                 reconcileCart(serverItems, state.items, remaining),
    serverVersion:         version,
    pendingMutations:      remaining,
    lastSyncedAt:          new Date().toISOString(),
    syncStatus:            remaining.length > 0 ? 'idle' : 'synced',
    unavailableProductIds,
  });

  if (unavailableProductIds.length > 0) {
    logCart('cart_products_unavailable', { productIds: unavailableProductIds });
  }
}

function handleSyncError(owner: string, batch: PendingMutation[], error: unknown): void {
  const state = useCartStore.getState();
  if (state.ownerCustomerId !== owner) return;

  const batchIds = batch.map((m) => m.id);

  if (!(error instanceof CartSyncError)) {
    useCartStore.setState({
      syncStatus:       'error',
      pendingMutations: markRetried(state.pendingMutations, batchIds),
    });
    logCart('cart_sync_error', { code: 'SERVER_ERROR' });
    return;
  }

  if (error.code === 'CART_CONFLICT' && error.conflictState) {
    // Riconciliazione: si parte dallo stato canonical del server (che contiene
    // le modifiche degli altri device) e si riapplicano sopra TUTTE le mutation
    // ancora pendenti. Né "server wins" né "local wins": entrambe le parti
    // sopravvivono, e il ritentativo parte dalla versione appena appresa.
    const pending = markRetried(state.pendingMutations, batchIds);
    useCartStore.setState({
      items:            reconcileCart(error.conflictState.items, state.items, pending),
      serverVersion:    error.conflictState.version,
      pendingMutations: pending,
      syncStatus:       'conflict',
    });
    logCart('cart_sync_conflict', { serverVersion: error.conflictState.version, pending: pending.length });
    if (pending.every((m) => m.retryCount < MAX_ATTEMPTS)) scheduleCartFlush(150);
    else useCartStore.setState({ syncStatus: 'error' });
    return;
  }

  if (error.code === 'CART_UNAUTHORIZED') {
    // Sessione non più valida. La coda appartiene a un cliente che non è più
    // autenticato: non deve MAI essere inviata sulla sessione successiva.
    // Il carrello locale resta come carrello guest (la copia server è intatta
    // e verrà ritrovata al prossimo login).
    useCartStore.setState({
      ownerCustomerId:  null,
      pendingMutations: [],
      serverVersion:    null,
      syncStatus:       'idle',
    });
    logCart('cart_sync_error', { code: error.code });
    return;
  }

  const pending = markRetried(state.pendingMutations, batchIds);

  if (error.retryable && transientAttempts < RETRY_BACKOFF_MS.length) {
    const delay = RETRY_BACKOFF_MS[transientAttempts];
    transientAttempts += 1;
    useCartStore.setState({ pendingMutations: pending, syncStatus: 'idle' });
    logCart('cart_sync_retry', { code: error.code, attempt: transientAttempts, delayMs: delay });
    scheduleCartFlush(delay);
    return;
  }

  // Errore permanente, o tentativi transitori esauriti: stato d'errore, niente
  // retry continuo. Le mutation restano in coda e ripartiranno al prossimo
  // evento di lifecycle.
  transientAttempts = 0;
  useCartStore.setState({ pendingMutations: pending, syncStatus: 'error' });
  logCart('cart_sync_error', { code: error.code, status: error.status });
}

/** Azzera i contatori di retry — invocato dagli eventi di lifecycle. */
function resetRetries(): void {
  transientAttempts = 0;
  const state = useCartStore.getState();
  if (state.pendingMutations.some((m) => m.retryCount > 0)) {
    useCartStore.setState({
      pendingMutations: state.pendingMutations.map((m) => ({ ...m, retryCount: 0 })),
    });
  }
}

/**
 * Idratazione del carrello per un cliente autenticato (login, oppure pagina
 * ricaricata mentre la sessione è già attiva).
 *
 * Due percorsi distinti, ed è la distinzione che evita sia la perdita sia la
 * "resurrezione" di articoli:
 *
 *  - Proprietario diverso (o nessuno): il carrello locale è un carrello guest
 *    mai sincronizzato → MERGE deterministico con il carrello server.
 *  - Stesso proprietario: il carrello locale è già stato sincronizzato, l'unico
 *    delta non ancora sul server è la coda pendente → RECONCILE (stato server
 *    come base + mutation pendenti riapplicate sopra). Un articolo rimosso da
 *    un altro device resta rimosso, invece di riapparire.
 */
export async function hydrateCartForCustomer(customerId: string): Promise<void> {
  const before      = useCartStore.getState();
  const sameOwner   = before.ownerCustomerId === customerId;
  const localItems  = before.items;
  // Coda di un ALTRO cliente: mai inviata: viene scartata qui (§21).
  const pending: PendingMutation[] = sameOwner ? before.pendingMutations : [];

  resetRetries();

  let server;
  try {
    server = await fetchServerCart();
  } catch (error) {
    // Idratazione fallita (offline, 5xx): il carrello locale resta utilizzabile
    // così com'è. Si registra comunque il proprietario, così le azioni
    // successive vengono accodate e partiranno al ritorno della connessione.
    useCartStore.setState({
      ownerCustomerId:  customerId,
      pendingMutations: pending,
      syncStatus:       isOffline() ? 'offline' : 'error',
    });
    logCart('cart_sync_error', {
      code: error instanceof CartSyncError ? error.code : 'NETWORK_ERROR',
      phase: 'hydrate',
    });
    return;
  }

  if (sameOwner) {
    useCartStore.setState({
      items:            reconcileCart(server.items, localItems, pending),
      serverVersion:    server.version,
      ownerCustomerId:  customerId,
      pendingMutations: pending,
      lastSyncedAt:     new Date().toISOString(),
      syncStatus:       pending.length > 0 ? 'idle' : 'synced',
    });
    logCart('cart_restored', { version: server.version, items: server.items.length });
  } else {
    const merged = mergeGuestCartWithServerCart(localItems, server.items);
    let queue: PendingMutation[] = [];
    for (const mutation of merged.mutations) queue = enqueueMutation(queue, mutation);

    useCartStore.setState({
      items:            merged.items,
      serverVersion:    server.version,
      ownerCustomerId:  customerId,
      pendingMutations: queue,
      lastSyncedAt:     new Date().toISOString(),
      syncStatus:       queue.length > 0 ? 'idle' : 'synced',
    });
    logCart('cart_merge', {
      local: localItems.length, server: server.items.length,
      merged: merged.items.length, mutations: queue.length,
    });
  }

  await flushCart();
}

/**
 * Reconcile leggero — usato al ritorno sulla tab e al ritorno della
 * connessione. Rilegge lo stato canonical (che può contenere modifiche
 * effettuate su un altro device) e ci riapplica sopra le mutation pendenti.
 */
export async function reconcileCartFromServer(): Promise<void> {
  const state = useCartStore.getState();
  const owner = state.ownerCustomerId;
  if (!owner || isOffline()) return;

  try {
    const server = await fetchServerCart();
    const current = useCartStore.getState();
    if (current.ownerCustomerId !== owner) return;

    useCartStore.setState({
      items:         reconcileCart(server.items, current.items, current.pendingMutations),
      serverVersion: server.version,
      lastSyncedAt:  new Date().toISOString(),
      syncStatus:    current.pendingMutations.length > 0 ? 'idle' : 'synced',
    });
    logCart('cart_restored', { version: server.version, source: 'reconcile' });
  } catch (error) {
    logCart('cart_sync_error', {
      code: error instanceof CartSyncError ? error.code : 'NETWORK_ERROR',
      phase: 'reconcile',
    });
    return;
  }

  await flushCart();
}

/** True se l'ultimo sync è abbastanza vecchio da giustificare un reconcile. */
export function isCartStale(now: number = Date.now()): boolean {
  const { lastSyncedAt } = useCartStore.getState();
  if (!lastSyncedAt) return true;
  return now - new Date(lastSyncedAt).getTime() > STALE_AFTER_MS;
}

/** Ritorno della connettività: si azzerano i retry e si svuota la coda. */
export async function handleCartOnline(): Promise<void> {
  const state = useCartStore.getState();
  if (!state.ownerCustomerId) return;
  resetRetries();
  await reconcileCartFromServer();
}

export function handleCartOffline(): void {
  clearFlushTimer();
  if (useCartStore.getState().ownerCustomerId) {
    useCartStore.setState({ syncStatus: 'offline' });
  }
}

/** Ritorno sulla tab: reconcile solo se l'ultimo sync è vecchio (no polling). */
export async function handleCartVisible(): Promise<void> {
  const state = useCartStore.getState();
  if (!state.ownerCustomerId) return;
  resetRetries();
  if (state.pendingMutations.length > 0) { await flushCart(); return; }
  if (isCartStale()) await reconcileCartFromServer();
}

/**
 * Logout. Ordine importante:
 *  1. ultimo flush best-effort (keepalive) — ciò che è sincronizzabile parte;
 *  2. il carrello locale viene SVUOTATO: su un dispositivo condiviso il
 *     carrello del cliente A non deve restare visibile al visitatore
 *     successivo. Nessuna perdita: la copia server è intatta e viene
 *     ripristinata al login successivo;
 *  3. se la coda non è stata svuotata (offline), viene conservata insieme al
 *     suo proprietario: se A si ri-autentica su questo device le mutation
 *     ripartono, se si autentica un cliente diverso vengono scartate
 *     (hydrateCartForCustomer). Mai inviate sulla sessione di un altro.
 */
export async function resetCartForLogout(): Promise<void> {
  clearFlushTimer();
  try {
    await flushCart({ keepalive: true });
  } catch {
    // Best-effort: un logout non deve mai fallire per colpa del carrello.
  }

  const state = useCartStore.getState();
  const unsynced = state.pendingMutations.length > 0;

  useCartStore.setState({
    items:                 [],
    syncStatus:            'idle',
    serverVersion:         unsynced ? state.serverVersion : null,
    lastSyncedAt:          null,
    pendingMutations:      unsynced ? state.pendingMutations : [],
    ownerCustomerId:       unsynced ? state.ownerCustomerId : null,
    unavailableProductIds: [],
  });
  transientAttempts = 0;
}
