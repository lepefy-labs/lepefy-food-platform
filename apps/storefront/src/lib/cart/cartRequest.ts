import type { CartMutationPayload, CartMutationType } from './cartTypes';

// Validazione PURA del payload di sincronizzazione, condivisa dalla route
// handler e dai test. Vive fuori dalla route proprio per essere testabile
// senza dover simulare NextRequest/Supabase.

const MUTATION_TYPES: ReadonlySet<string> = new Set<CartMutationType>([
  'add', 'set_quantity', 'remove', 'clear',
]);

function isMutationType(value: unknown): value is CartMutationType {
  return typeof value === 'string' && MUTATION_TYPES.has(value);
}

/** Tetto difensivo: nessun carrello legittimo supera questi valori. */
const MAX_MUTATIONS_PER_REQUEST = 100;
const MAX_QUANTITY              = 999;

export type ParsedSyncRequest =
  | { ok: true;  expectedVersion: number | null; mutations: CartMutationPayload[] }
  | { ok: false; code: 'INVALID_QUANTITY' | 'INVALID_PAYLOAD'; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Estrae expectedVersion + mutations dal corpo della richiesta.
 *
 * TENANT ISOLATION (§22): tenantId e customerId eventualmente presenti nel
 * corpo vengono ignorati — non esistono in `CartMutationPayload` e non sono
 * mai letti qui. L'identità è derivata esclusivamente dalla sessione lato
 * server (getTenant + getSessionCustomer nella route handler).
 */
export function parseSyncRequest(body: unknown): ParsedSyncRequest {
  if (!isPlainObject(body)) {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Requête invalide.' };
  }

  const rawVersion = body.expectedVersion;
  let expectedVersion: number | null = null;
  if (rawVersion !== null && rawVersion !== undefined) {
    if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 0) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Version de panier invalide.' };
    }
    expectedVersion = rawVersion;
  }

  const rawMutations = body.mutations;
  if (!Array.isArray(rawMutations)) {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Mutations manquantes.' };
  }
  if (rawMutations.length > MAX_MUTATIONS_PER_REQUEST) {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Trop de modifications en une seule requête.' };
  }

  const mutations: CartMutationPayload[] = [];

  for (const raw of rawMutations) {
    if (!isPlainObject(raw)) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Mutation invalide.' };
    }

    const { id, type, productId, quantity } = raw;

    // L'id è l'idempotency key: senza, un retry dopo timeout applicherebbe due
    // volte lo stesso incremento. Obbligatorio, mai generato dal server.
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Identifiant de mutation invalide.' };
    }
    if (!isMutationType(type)) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Type de mutation inconnu.' };
    }

    if (type === 'clear') {
      mutations.push({ id, type });
      continue;
    }

    if (typeof productId !== 'string' || productId.length === 0) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Produit manquant.' };
    }

    if (type === 'remove') {
      mutations.push({ id, type, productId });
      continue;
    }

    // add / set_quantity
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) {
      return { ok: false, code: 'INVALID_QUANTITY', message: 'Quantité invalide.' };
    }
    // add con quantità 0 non ha senso: rifiutato per non consumare un id di
    // idempotenza a vuoto.
    if (type === 'add' && quantity === 0) {
      return { ok: false, code: 'INVALID_QUANTITY', message: 'Quantité invalide.' };
    }

    mutations.push({ id, type, productId, quantity });
  }

  return { ok: true, expectedVersion, mutations };
}

interface LegacyPutBody {
  items?: unknown;
  expectedVersion?: unknown;
}

export type ParsedLegacyPut =
  | { ok: true;  expectedVersion: number | null; items: Array<{ productId: string; quantity: number }> }
  | { ok: false; code: 'INVALID_PAYLOAD'; message: string };

/**
 * Corpo del vecchio PUT full-state, mantenuto per retrocompatibilità.
 * Le righe invalide sono scartate in silenzio come nell'implementazione
 * precedente (nessuna regressione per i consumer esistenti).
 */
export function parseLegacyPutBody(body: unknown): ParsedLegacyPut {
  if (!isPlainObject(body)) {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Requête invalide.' };
  }

  const raw = (body as LegacyPutBody).items;
  const rawItems = Array.isArray(raw) ? raw : [];

  const items = rawItems
    .filter(isPlainObject)
    .filter((i) => typeof i.productId === 'string' && (i.productId as string).length > 0
      && Number.isInteger(i.quantity) && (i.quantity as number) > 0
      && (i.quantity as number) <= MAX_QUANTITY)
    .map((i) => ({ productId: i.productId as string, quantity: i.quantity as number }));

  const rawVersion = (body as LegacyPutBody).expectedVersion;
  const expectedVersion =
    typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion >= 0
      ? rawVersion
      : null;

  return { ok: true, expectedVersion, items };
}
