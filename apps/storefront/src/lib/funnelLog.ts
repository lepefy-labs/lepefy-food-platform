type FunnelModule = 'shop' | 'card' | 'event' | 'rental';

interface FunnelLogParams {
  module:       FunnelModule;
  event_type:   string;
  reference_id?: string | null;
  detail?:      Record<string, unknown> | null;
}

// Fire-and-forget — mai awaited dai chiamanti, mai deve rallentare o
// bloccare il flusso di pagamento. keepalive garantisce l'invio anche se
// la pagina naviga via subito dopo (es. redirect Stripe).
export function logFunnelEvent(params: FunnelLogParams): void {
  try {
    fetch('/api/funnel-log', {
      method:     'POST',
      headers:    { 'Content-Type': 'application/json' },
      body:       JSON.stringify(params),
      keepalive:  true,
    }).catch(() => {
      // Ignorato di proposito.
    });
  } catch {
    // Ignorato di proposito — mai deve interrompere il caller.
  }
}

// Variante con sendBeacon — usata SOLO per l'evento di abbandono (vedi
// registerAbandonmentListener sotto). sendBeacon è pensato apposta per
// garantire l'invio quando la pagina sta per sparire (chiusura tab, swipe
// away su mobile) — più affidabile di fetch keepalive in questo scenario
// specifico su Safari/WebView mobile.
function sendBeaconLog(params: FunnelLogParams): void {
  try {
    const blob = new Blob([JSON.stringify(params)], { type: 'application/json' });
    const sent = navigator.sendBeacon?.('/api/funnel-log', blob);
    if (!sent) {
      // Fallback se sendBeacon non è disponibile o rifiuta il payload.
      logFunnelEvent(params);
    }
  } catch {
    // Ignorato di proposito.
  }
}

// Registra un listener che spara un evento 'abandoned_payment_form' se il
// cliente lascia/nasconde la pagina mentre è sullo step Stripe Elements
// SENZA aver mai completato il pagamento. `hasSucceededRef` è un ref
// booleano aggiornato dal chiamante quando confirm_succeeded_client viene
// raggiunto — evita falsi positivi (l'utente che chiude il tab DOPO aver
// pagato non deve risultare "abbandonato").
//
// Restituisce una funzione di cleanup da chiamare in un useEffect return.
export function registerAbandonmentListener(params: {
  module:        FunnelModule;
  reference_id?: string | null;
  hasSucceededRef: { current: boolean };
}): () => void {
  let fired = false;

  function handlePageHide() {
    if (fired || params.hasSucceededRef.current) return;
    fired = true;
    sendBeaconLog({
      module:       params.module,
      event_type:   'abandoned_payment_form',
      reference_id: params.reference_id ?? null,
    });
  }

  // pagehide copre la chiusura tab/navigazione; visibilitychange con
  // document.hidden copre lo swipe-away su mobile (iOS Safari spesso non
  // emette pagehide in modo affidabile quando l'app va in background).
  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') handlePageHide();
  }

  window.addEventListener('pagehide', handlePageHide);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    window.removeEventListener('pagehide', handlePageHide);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}
