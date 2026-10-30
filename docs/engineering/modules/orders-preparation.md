---
id: eng-module-orders-preparation
titolo: Ordini e preparazione
modulo: orders-preparation
categoria: Operazioni
stato: parziale
owner: Platform Owner
file_monitorati: [apps/storefront/src/lib/orders/convertCheckoutSessionToOrder.ts, apps/storefront/src/lib/orders/preparation/preparationPolicy.ts, apps/storefront/src/lib/orders/closure/orderClosureService.ts, docs/ORDER_PREPARATION.md, docs/ORDER_CLOSURE.md, docs/ASSISTED_ORDERS.md]
---

# Ordini e preparazione

> Bozza iniziale derivata dalla documentazione di progetto. **Non verificata da una persona**: stato «Parziale».

## Scopo

Dal pagamento confermato all'ordine consegnato: conversione delle sessioni di checkout, cockpit ordini admin («Aujourd'hui» e `/admin/orders`), modalità di preparazione, chiusura/annullamento, documenti PDF e portale QR.

## Punti di ingresso

- Conversione: `apps/storefront/src/lib/orders/convertCheckoutSessionToOrder.ts` → RPC `convert_checkout_session_to_order` (migration 128): lock di riga, ordine/righe/stock in una transazione, `orders.checkout_session_id` univoco; gli effetti collaterali partono solo se `created = true`.
- Regole di preparazione: `apps/storefront/src/lib/orders/preparation/preparationPolicy.ts` (`preparationState`, `preparationBlockers`); modalità per tenant `digital | paper | none` (migration 160).
- Chiusura: `POST /api/admin/orders/[id]/close` → `apps/storefront/src/lib/orders/closure/orderClosureService.ts` (migration 161); il `PATCH status: 'cancelled'` è rifiutato.

## Invarianti

- Per gli ordini assistiti nessuna riga `orders` esiste prima del pagamento confermato; `orders.email` può essere nullo.
- Le modalità carta/nessuna non scrivono mai le colonne digitali di picking/imballo; pagamento, stock, numero colli inserito da una persona e tracking restano obbligatori.
- La chiusura non cambia `payment_status`, non rimborsa, non rifornisce lo stock e non tocca Packlink.
- Le statistiche contano una cancellazione commerciale come `status = 'cancelled' and coalesce(closure_type, 'cancelled') = 'cancelled'`.

## Dati

`orders`, `order_items`, `checkout_sessions`, `order_public_access_tokens` (solo service role).

## Limiti noti

Le transizioni di stato ordine e gli effetti collaterali per transizione non sono ancora descritti qui; fonte: `docs/ORDER_PREPARATION.md`, `docs/ORDER_CLOSURE.md`.
