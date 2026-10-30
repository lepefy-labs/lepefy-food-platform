---
id: eng-module-payments-stripe
titolo: Pagamenti e Stripe
modulo: payments-stripe
categoria: Pagamenti
stato: parziale
owner: Platform Owner
file_monitorati: [apps/storefront/src/lib/checkout/validateCheckoutItems.ts, apps/storefront/src/lib/checkout/cartComeback.ts, apps/storefront/src/lib/payments/cardCartOutcome.ts, docs/CHECKOUT_RECOVERY_V2_ROLLOUT.md]
---

# Pagamenti e Stripe

> Bozza iniziale derivata dalla documentazione di progetto. **Non verificata da una persona**: stato «Parziale». Area sensibile: qualunque modifica richiede approvazione esplicita.

## Scopo

Checkout dello storefront, creazione di PaymentIntent Stripe, webhook, pagamenti con carta, link di pagamento esterni e recupero dei carrelli non pagati.

## Flusso

```text
Carrello (Zustand) → /checkout → POST /api/shipping/quote → POST /api/checkout → /order-confirmation
```

`/order-confirmation?payment_intent=…` legge l'ordine tramite `POST /api/checkout-sessions/[id]/order` con il token di sessione restituito da `/api/checkout` (conservato nel `sessionStorage` della scheda, mai nell'URL); finché il webhook non crea l'ordine la risposta è `pending`.

## Punti di ingresso

- Validazione autoritativa del carrello: `apps/storefront/src/lib/checkout/validateCheckoutItems.ts` (il quarto argomento `{ mode, pickupAvailable }` è obbligatorio: ogni percorso di pagamento dichiara la modalità).
- Recupero di un carrello con carta: `apps/storefront/src/lib/checkout/cartComeback.ts` (link firmato HMAC `cart-comeback:` con `TRACKING_SECRET`).
- Esito di un carrello con carta: `apps/storefront/src/lib/payments/cardCartOutcome.ts` (`classifyCardCart` sugli eventi di `payment_funnel_logs`).

## Invarianti

- Il webhook di piattaforma accetta solo i segreti di firma dell'account Stripe di Lepefy per rinnovare un abbonamento, mai quello di un tenant.
- Sulla distribuzione demo `getStripeSecretKey` rifiuta chiavi non di test e il webhook rifiuta eventi `livemode`.
- Il prezzo di spedizione pagato viene sempre dal preventivo firmato; ogni percorso di pagamento ricontrolla le regole di quantità e di evasione.
- Una nuova API pubblica di scrittura chiama `guardModule(tenant.id, '<modulo>')` prima di creare qualcosa; i webhook no.

## Limiti noti

La descrizione degli eventi webhook gestiti non è ancora in questo documento.
