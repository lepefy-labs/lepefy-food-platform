import type { CartItem } from '@lepefy/types';
import { CartSyncError, codeFromStatus } from './cartErrors';
import type {
  CartMutationPayload,
  CartSyncResult,
  ServerCartState,
} from './cartTypes';

// Unico punto di contatto con /api/customers/me/cart. Nessun fetch del
// carrello deve vivere sparso nei componenti: qui stanno parsing, tipi e
// traduzione degli errori HTTP nel modello d'errore strutturato.

const CART_ENDPOINT = '/api/customers/me/cart';

interface ApiErrorBody {
  error?: string;
  code?:  string;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asItems(value: unknown): CartItem[] {
  return Array.isArray(value) ? (value as CartItem[]) : [];
}

function asVersion(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}

/** GET dello stato canonical. Usato all'idratazione, al login e ai reconcile. */
export async function fetchServerCart(): Promise<ServerCartState> {
  let res: Response;
  try {
    res = await fetch(CART_ENDPOINT, { cache: 'no-store' });
  } catch {
    throw new CartSyncError('NETWORK_ERROR', 'Panier indisponible hors connexion.');
  }

  if (!res.ok) {
    const body = (await readJson(res)) as ApiErrorBody;
    throw new CartSyncError(
      codeFromStatus(res.status),
      body.error ?? 'Erreur de récupération du panier.',
      { status: res.status },
    );
  }

  const body = await readJson(res);
  return { items: asItems(body.items), version: asVersion(body.version) };
}

/**
 * Invia un batch di mutation con controllo di versione ottimistico.
 *
 * @param expectedVersion versione server nota al client; null al primo invio
 *                        (il server applica senza controllo).
 * @param keepalive       true quando la pagina si sta chiudendo/nascondendo:
 *                        permette al browser di completare la richiesta anche
 *                        dopo l'unload del documento.
 *
 * @throws CartSyncError con code CART_CONFLICT e `conflictState` popolato
 *         quando il server risponde 409 — lo stato canonical arriva già nella
 *         risposta, quindi la riconciliazione non richiede una GET aggiuntiva.
 */
export async function pushCartMutations(
  expectedVersion: number | null,
  mutations: CartMutationPayload[],
  options: { keepalive?: boolean } = {},
): Promise<CartSyncResult> {
  let res: Response;
  try {
    res = await fetch(CART_ENDPOINT, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify({ expectedVersion, mutations }),
      keepalive: options.keepalive ?? false,
    });
  } catch {
    throw new CartSyncError('NETWORK_ERROR', 'Synchronisation du panier impossible.');
  }

  const body = await readJson(res);

  if (res.status === 409) {
    throw new CartSyncError('CART_CONFLICT', 'Panier modifié depuis un autre appareil.', {
      status:        409,
      conflictState: { items: asItems(body.items), version: asVersion(body.version) },
    });
  }

  if (!res.ok) {
    const err = body as ApiErrorBody;
    throw new CartSyncError(
      codeFromStatus(res.status),
      err.error ?? 'Erreur de synchronisation du panier.',
      { status: res.status },
    );
  }

  return {
    items:                 asItems(body.items),
    version:               asVersion(body.version),
    appliedMutationIds:    Array.isArray(body.appliedMutationIds)
      ? (body.appliedMutationIds as string[])
      : [],
    unavailableProductIds: Array.isArray(body.unavailableProductIds)
      ? (body.unavailableProductIds as string[])
      : [],
  };
}
