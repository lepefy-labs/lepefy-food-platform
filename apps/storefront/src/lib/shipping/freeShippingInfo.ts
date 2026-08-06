// Forme condivise tra POST /api/shipping/quote (server) e la UI carrello/
// checkout (client). File volutamente senza import (stesso principio di
// lib/customers/types.ts): importabile da un Client Component senza trascinare
// dentro codice server-side.
//
// threshold     → gratuità per soglia carrello raggiunta (mostra la soglia)
// country_promo → costo 0 indipendente dal subtotale (forfait a 0, sconto
//                 100%): la UI usa questa distinzione anche per NON ri-quotare
//                 al cambio quantità, visto che il risultato non può cambiare.
export type FreeShippingInfo =
  | { reason: 'threshold'; thresholdAmount: number }
  | { reason: 'country_promo' }
  | null;
