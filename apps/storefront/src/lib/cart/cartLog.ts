export type CartLogEvent =
  | 'cart_sync_started'
  | 'cart_sync_success'
  | 'cart_sync_conflict'
  | 'cart_sync_retry'
  | 'cart_sync_error'
  | 'cart_merge'
  | 'cart_restored'
  | 'cart_products_unavailable';

// Logging diagnostico del sync. Nessuna nuova piattaforma di analytics: si usa
// la console, come già fa il resto del repo lato server (console.error nelle
// route handler). Silenzioso in produzione tranne che per gli errori, per non
// inquinare la console dei clienti.
//
// Non viene mai loggato nulla di sensibile: solo conteggi, versioni, codici
// d'errore e product id. Mai token di sessione, mai email, mai dati di
// pagamento.
export function logCart(event: CartLogEvent, detail: Record<string, unknown> = {}): void {
  const isError = event === 'cart_sync_error';
  if (process.env.NODE_ENV === 'production' && !isError) return;

  const payload = { event, ...detail };
  if (isError) console.warn('[cart-sync]', payload);
  else         console.info('[cart-sync]', payload);
}
