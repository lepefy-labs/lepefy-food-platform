import type { ServerCartState } from './cartTypes';

// Modello d'errore strutturato — sostituisce i `throw new Error('...')`
// generici: il chiamante deve poter distinguere "ritenta" da "non ritentare
// mai" senza ispezionare stringhe.
export type CartErrorCode =
  | 'CART_CONFLICT'       // 409 — versione stale, riconciliazione necessaria
  | 'CART_UNAUTHORIZED'   // 401 — sessione scaduta/logout, queue da abbandonare
  | 'PRODUCT_UNAVAILABLE' // prodotto inesistente/inattivo/di un altro tenant
  | 'INVALID_QUANTITY'    // payload rifiutato dal server, retry inutile
  | 'NETWORK_ERROR'       // fetch fallita, offline, timeout — transitorio
  | 'SERVER_ERROR';       // 5xx/408/429 — transitorio

const RETRYABLE: ReadonlySet<CartErrorCode> = new Set<CartErrorCode>([
  'NETWORK_ERROR',
  'SERVER_ERROR',
]);

export class CartSyncError extends Error {
  readonly code:     CartErrorCode;
  readonly status?:  number;
  /** Stato canonical restituito dal server con un 409 — evita una GET extra. */
  readonly conflictState?: ServerCartState;

  constructor(
    code: CartErrorCode,
    message: string,
    options: { status?: number; conflictState?: ServerCartState } = {},
  ) {
    super(message);
    this.name          = 'CartSyncError';
    this.code          = code;
    this.status        = options.status;
    this.conflictState = options.conflictState;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

// Mappa uno status HTTP sul codice d'errore corrispondente. 408/429/5xx sono
// transitori per definizione; 4xx restanti sono permanenti (ritentarli
// produrrebbe solo traffico inutile e un loop).
export function codeFromStatus(status: number): CartErrorCode {
  if (status === 401 || status === 403) return 'CART_UNAUTHORIZED';
  if (status === 409)                   return 'CART_CONFLICT';
  if (status === 408 || status === 429) return 'SERVER_ERROR';
  if (status >= 500)                    return 'SERVER_ERROR';
  return 'INVALID_QUANTITY';
}
