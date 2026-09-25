# Ordini assistiti, preordini e pagamento diretto

> Stato: **implementato nel codice**, migration `128_assisted_orders.sql` **preparata ma da applicare manualmente**.
> Base analizzata: `main@7fd6054ae8ac49e6d383653a296a1a65261ff3e9` (25/09/2026).
> Il codice che legge le nuove colonne **non deve essere deployato prima dell'applicazione della migration** (vedi §10).

Permette al tenant di registrare acquisti ricevuti da WhatsApp, telefono, Instagram o in negozio:

1. **À payer** — preordine + link di pagamento `/pay/<token>` da condividere manualmente (WhatsApp/copia);
2. **Paiement à vérifier** — pagamento esterno dichiarato, confermato poi da un admin;
3. **Déjà payé** — incasso già ricevuto (espèces, virement, Postepay, Satispay, PayPal, Revolut, autre): ordine creato subito;
4. **Brouillon** — bozza modificabile, nessuna notifica.

Non è implementata l'acquisizione automatica delle conversazioni WhatsApp né WhatsApp Cloud API.

---

## 1. Analisi del codice esistente (conclusioni DISCOVER)

| Tema | Stato trovato |
| --- | --- |
| Stati `checkout_sessions` | `open`, `awaiting_verification`, `completed`, `cancelled`, `expired` (074/075). Tutti usati. Nessuno stato bozza. |
| Importi | Server-side: `validateCheckoutItems` (prezzi catalogo, regole min/step/gruppi, stock) + `verifyCheckoutShipping` (token preventivo firmato) + sconto ambassador. Il browser non è mai autorità. |
| Magazzino | Nessuna riserva: `decrement_stock_for_order` atomico (tutto o niente) **alla creazione dell'ordine**; se fallisce dopo un pagamento → ordine `stock_conflict` + rimborso Stripe o rimborso manuale. |
| Pagamenti esterni | `external_link` → `awaiting_verification` (trigger 075); conferma admin `shop_payments.confirm` via `createOrderFromCheckoutSession`. |
| Duplicati | Solo Stripe era protetto a livello DB (indice unico `orders.stripe_payment_intent_id` + 23505). La conferma manuale **non aveva lock**: due conferme simultanee potevano creare due ordini. |
| Automatismi alla creazione | consenso, CRM (`customer_events`), attribuzione Nala, n8n `order-confirmed` / `order-stock-conflict`. |
| Vincoli e-mail | `orders.email` e `checkout_sessions.email` NOT NULL; `customers.email` già nullable dalla 109; token di tracking HMAC(orderId + email). |
| Identità guest | `resolveOrCreateCustomer` (Auth ID → e-mail → telefono ≥ 8 cifre → creazione), anti-duplicato con indice univoco normalizzato. |
| Recovery storefront | `activeCheckoutSession`, `/checkout/reprendre`, `/api/checkout-sessions/*`, `/orders` trattavano **qualsiasi** sessione `open` del cliente come il suo carrello: un preordine assistito sarebbe stato sovrascritto o reso modificabile dal cliente, e l'indice «una sola sessione open per cliente» ne avrebbe impedito la creazione. |
| Webhook Stripe storefront | Contiene una propria copia inline della creazione ordine (non toccata, vedi debito tecnico). |

## 2. Modello dati (migration 128)

`checkout_sessions` (additivo):

- `email` nullable, con vincolo `checkout_sessions_contact_check`: storefront ⇒ e-mail obbligatoria; assisted ⇒ e-mail **o** telefono.
- `origin` (`storefront` default | `assisted`), `sales_channel` (`whatsapp|phone|instagram|in_store|other`).
- `created_by_admin_id`, `admin_note` (interna, mai esposta), `notify_customer`, `request_key` (idempotenza della saisie, unico per tenant).
- Link: `pay_token_hash` (SHA-256, unico), `pay_token_nonce`, `pay_token_issued_at`, `pay_link_version`.
- Pagamento dichiarato: `declared_payment_at`, `declared_payment_reference`.
- Stato `draft` aggiunto al CHECK (solo per `origin = 'assisted'`).
- Indice `checkout_sessions_one_open_per_customer` ricreato **limitato a `origin = 'storefront'`**.
- Trigger di log funnel e vista `checkout_funnel_30d` limitati allo storefront.

`orders` (additivo): `email` nullable (vincolo: storefront ⇒ e-mail), `order_origin`, `sales_channel`,
`checkout_session_id` (**indice unico** = chiave di idempotenza della conversione), `created_by_admin_id`,
`payment_confirmation_source` (`stripe_webhook | admin_verified | admin_recorded`), `payment_received_at`,
`payment_reference`, `payment_confirmed_by`, `payment_note`; `payment_method` accetta `manual`.

`assisted_order_events`: journal append-only (creazione, modifiche, link emessi/revocati, pagamento dichiarato/confermato, ordine creato, annullamento, conflitto stock, secondo pagamento, notifiche). RLS attiva senza policy, service-role only. Nessun token né dato bancario.

RPC `convert_checkout_session_to_order(tenant, session, payment jsonb)`: vedi §4. `EXECUTE` revocato a `public/anon/authenticated`.

## 3. Lifecycle del preordine (nessuna seconda macchina a stati)

| Stato funzionale | `checkout_sessions.status` |
| --- | --- |
| Brouillon | `draft` |
| En attente de paiement | `open` (+ link attivo) |
| Paiement à vérifier | `awaiting_verification` |
| Terminée | `completed` (+ `order_id`) |
| Expirée | `expired` |
| Annulée | `cancelled` |

```text
draft ──link──▶ open ──Stripe webhook──▶ completed
  │              ├─cliente sceglie pagamento esterno──▶ awaiting_verification ──admin conferma──▶ completed
  │              │                                        └─admin «remettre en attente»──▶ open
  │              └─72 h──▶ expired ──nuovo link──▶ open
  └─ draft|open|expired|awaiting_verification ──annulla──▶ cancelled
«Déjà payé»: sessione open creata e convertita subito (admin_recorded).
```

Azioni per stato: `lib/orders/assisted/assistedOrderPolicy.ts` (`allowedPreorderActions`), applicate lato server da aggiornamenti condizionali sullo stato.

### Politica link, scadenza, prezzi, disponibilità

- **Durata**: link valido **72 h** (`ASSISTED_PAY_LINK_TTL_HOURS`); scadenza pigra (nessun cron) al primo accesso admin/pubblico.
- **Prezzi**: ogni emissione di link rivalida disponibilità, regole e spedizione e applica i **prezzi catalogo correnti**; da lì importi **garantiti fino alla scadenza** del link.
- **Disponibilità**: nessuna riserva di stock (coerente con il sistema esistente). Prima di ogni PaymentIntent, dichiarazione esterna o incasso admin: `validateCheckoutItems` (attivo, regole, stock) + `revalidateSessionShipping` (forfait attivo). Se non più valido → pagamento bloccato («à mettre à jour par le magasin»).
- **Modifica dopo condivisione**: la modifica annulla il PaymentIntent aperto (rifiutata se il pagamento carta è in corso/riuscito), **revoca il link** (hash azzerato) e riporta la precommande in `draft`. Il cliente vede «Ce lien n'est plus valide»; un nuovo link va emesso esplicitamente. Nessun importo obsoleto è pagabile.
- **Rigenerazione**: nuovo nonce ⇒ il vecchio link smette immediatamente di funzionare.
- **Pagamento esterno dichiarato** (`awaiting_verification`): nessuna scadenza, come i link esterni storici (075).
- **Bozze**: mai pagabili; `expires_at` = +30 giorni solo come riferimento di conservazione.

## 4. Conversione centrale e idempotenza

Unico servizio: `lib/orders/convertCheckoutSessionToOrder.ts` → RPC `convert_checkout_session_to_order`.
Usato da: webhook Stripe dei preordini (`metadata.type = assisted_preorder`), conferma admin dei pagamenti esterni (storefront **e** assistiti, route esistente `/api/admin/checkout-sessions/[id]/confirm-payment` rifattorizzata), «Déjà payé» e «Encaissement reçu». `createOrderFromCheckoutSession.ts` è stato rimosso (unico chiamante migrato).

Nella RPC, in **una transazione**:
1. `SELECT … FOR UPDATE` della sessione (tenant-scoped) → le richieste concorrenti si serializzano;
2. se la sessione ha già `order_id` (o un ordine con quel `checkout_session_id`) → ritorna l'ordine esistente con `created = false`;
3. controllo stato ammesso: Stripe `open|awaiting_verification|expired|cancelled` (un pagamento catturato produce sempre un ordine), admin verificato `open|awaiting_verification|expired`, admin registrato anche `draft`;
4. decremento stock in sotto-transazione: se fallisce, rollback dei decrementi e ordine `stock_conflict`;
5. insert `orders` (+ origine, canale, audit incasso) + `order_items`, sessione `completed`.

Solo l'invocazione con `created = true` esegue gli effetti: consenso, CRM, Nala (solo storefront), notifiche, rimborso/alert stock. Webhook duplicati, retry e doppie conferme ⇒ **un ordine, un decremento, una notifica**. Garanzia finale: indice unico `orders_checkout_session_id_uniq`.

Webhook Stripe assistito: importo atteso ricalcolato dalla sessione (discrepanza tracciata `amount_mismatch`), errori transitori → HTTP 500 (Stripe ritenta, conversione idempotente). Se la sessione è già stata saldata in altro modo, il secondo pagamento è **rimborsato automaticamente** (`duplicate_payment`, idempotency key Stripe). Il successo sulla pagina `/pay` è mostrato solo quando il server riporta `completed` (polling), mai dal solo redirect del browser.

## 5. Pagamenti manuali e distinzione delle fonti

- `stripe_webhook`: confermato automaticamente da Stripe (`payment_method = stripe`).
- `admin_verified`: pagamento dichiarato (cliente o team) e verificato da un admin (`payment_method = external_link`, tipo/etichetta dichiarati).
- `admin_recorded`: incasso già ricevuto registrato dal team (`payment_method = manual`, `external_payment_type` = `cash|bank_transfer|postepay|satispay|paypal|revolut|other`).

Ogni conferma manuale registra data d'incasso (mai futura), riferimento, nota, admin (`payment_confirmed_by`) ed evento di journal. Capability: **`shop_payments.confirm`** per `/api/admin/assisted-orders/paid`, `/api/admin/assisted-orders/[id]/confirm-payment` e la route storica; `orders.manage` per creazione/modifica/link/annullamento; `orders.view` per le letture.

Conflitto di stock dopo un incasso: Stripe → rimborso automatico come prima; esterno/manuale → ordine `stock_conflict` con `payment_status = pending` (comportamento storico) + alert n8n `order-stock-conflict` per rimborso/intervento manuale. «Déjà payé» e «Encaissement reçu» rifiutano (409) un carrello non più disponibile prima di creare l'ordine.

## 6. Pagina pubblica `/pay/[token]`

- Fuori dal layout shop (nessun carrello/Nala), branding tenant, mobile-first, `noindex`, `no-referrer`.
- Mostra: riferimento `P-XXXXXXXX`, articoli, consegna, totale, metodi. **Mai**: nota interna, ID cliente/admin, e-mail, telefono, storico, PaymentIntent.
- Metodi: carta Stripe (Payment Element esistente, `StripePaymentStep`, PaymentIntent via `/api/pay/[token]/intent`) + metodi `tenant_payment_methods` attivi con modulo `shop` (link PayPal con importo come il checkout, Revolut/altro con link, **bonifico** con IBAN/BIC/beneficiario e riferimento `P-…`, istruzioni se senza link). Contanti, carta e Apple Pay esclusi dai metodi esterni.
- La scelta di un metodo esterno (`/api/pay/[token]/external`) porta la sessione a `awaiting_verification`, annulla l'intent carta, invia l'alert interno esistente (`notify_external_payment_pending`, claim idempotente). **Non è una conferma d'incasso.**
- Stati dedicati: link invalido/revocato, scaduto, annullato, in verifica, pagato (con link di tracking).

## 7. Notifiche

- Nessuna notifica di ordine confermato prima della conversione.
- `order-confirmed` (n8n) emessa una sola volta dalla conversione vincente; per «Déjà payé»/«Encaissement reçu» il tenant sceglie se inviarla (`notify_customer`), per i link è attiva di default.
- Cliente senza e-mail: nessuna e-mail dichiarata inviata (`skipped_no_email`), e **tutte** le notifiche di stato successive (spedito/pronto/consegnato/annullato) vengono saltate in `runOrderTransitionSideEffects` (loyalty e recensioni invariate). Il link di tracking (HMAC su `orderId` + e-mail vuota) è copiabile/condivisibile via WhatsApp dal dettaglio ordine e dal preordine.
- Condivisione link di pagamento: copia + `wa.me` (nessun indicativo inventato), nessun invio automatico.

## 8. CRM e statistiche

- Cliente esistente cercato per nome/telefono/e-mail (`/api/admin/assisted-orders/customers`), oppure risoluzione centrale `resolveOrCreateCustomer` con `source = 'admin'`: nessun duplicato, nessuna e-mail inventata, nessun consenso marketing dedotto (i campi consenso della sessione restano `null`).
- `customer_events.order_completed` con `source = 'assisted_order'` e metadata `order_origin`, `sales_channel`, `payment_confirmation_source`. Nessuna attribuzione Nala per ordini assistiti.
- Fatturato (`admin_order_dashboard_stats`, `customer_crm_overview`): basato su `orders.payment_status = 'paid'`; bozze e preordini non pagati non sono in `orders` ⇒ esclusi per costruzione. Gli ordini assistiti pagati contano normalmente.

## 9. Logistica

Nessuna dipendenza Packlink nel dominio assistito. Le spese usano lo stesso preventivo del checkout (`POST /api/shipping/quote` → token firmato → `verifyCheckoutShipping`: provider, forfait V1G, regole paese, zone, promozioni). L'ordine convertito nasce `preparing` (mai `shipped`) ed entra nel workflow esistente: picking, packing, catena del freddo, stampa, colli, tracking gestito/manuale, eventi di spedizione. `docs/SHIPPING_INTELLIGENCE.md` non richiede modifiche: nessun file del modulo è stato toccato.

## 10. Runbook migration

**Ordine obbligatorio**: 1) applicare la migration, 2) verificarla, 3) deployare il codice. Il codice legge `checkout_sessions.origin` anche nei percorsi storefront di recovery e la conferma manuale usa la RPC: deployato prima della migration romperebbe recovery checkout e conferme esterne.

1. Backup/PITR disponibile sul progetto Supabase di produzione.
2. `supabase db push` (oppure SQL Editor con il contenuto di `supabase/migrations/128_assisted_orders.sql`).
3. Eseguire `supabase/verification/128_assisted_orders_verification.sql` nel SQL Editor: tutto in `BEGIN … ROLLBACK`, deve terminare con la notice «Migration 128 — vérifications OK». Controlla schema, permessi RPC, idempotenza (2 chiamate → 1 ordine, 1 decremento), contatto solo telefono, conflitto di stock senza decremento parziale, sessione annullata rifiutata, isolamento tenant, indice storefront.
4. Controlli di sola lettura:
   ```sql
   select count(*) from checkout_sessions where origin is null;            -- 0
   select count(*) from orders where email is null and order_origin <> 'assisted'; -- 0
   select indexdef from pg_indexes where indexname = 'checkout_sessions_one_open_per_customer';
   ```
5. Deploy del codice; smoke test: `/admin/orders/new` (bozza), link `/pay/<token>` in una finestra anonima, pagamento Stripe di test, conferma manuale di un bonifico, «Déjà payé» contanti.

**Rollback**: codice → revert del commit su `main`. L'app precedente funziona con lo schema 128 (colonne additive, default `origin = 'storefront'`), ma non conosce l'origine: prima del revert **annullare i preordini assistiti ancora `open`/`draft`**, altrimenti la recovery storefront li tratterebbe come carrello del cliente. Schema → solo se nessun ordine assistito esiste, istruzioni commentate in fondo alla migration (drop RPC/tabella/indici/colonne, ripristino indice e CHECK 075, `email` di nuovo NOT NULL se nessuna riga nulla).

## 11. API e UI

Admin (`Admin → Commandes`):
- CTA **Nouvelle commande** (`/admin/orders/new`) e link **Précommandes** (`/admin/orders/precommandes`) con badge dei preordini attivi.
- Form a sezioni (origine, cliente, prodotti con controlli ± conformi a min/step/stock e gruppi, remise con indirizzi salvati e calcolo spese, percorso, nota interna), riepilogo laterale desktop e barra fissa mobile; `requestKey` per evitare doppi invii.
- Scheda preordine `/admin/orders/precommandes/[id]` (azioni per stato, link copiabile/WhatsApp, conferma incasso, remise en attente, annullamento con conferma, storico) e modifica `/modifier`.
- Dettaglio ordine: card «Origine & encaissement» (canale, fonte di conferma, data, riferimento, admin, nota, link tracking condivisibile).
- `/admin/paiements-en-attente/[id]` reindirizza i preordini assistiti alla loro scheda.

API: `GET/POST /api/admin/assisted-orders`, `POST …/paid`, `GET/PATCH …/[id]`, `POST …/[id]/link|cancel|reopen|confirm-payment`, `GET …/customers`, `GET …/customers/[id]`, `GET …/products`; pubbliche `GET /api/pay/[token]`, `POST /api/pay/[token]/intent`, `POST /api/pay/[token]/external`.

## 12. Test

- `apps/storefront/tests/unit/assistedOrders.spec.ts` (25 test): lifecycle/azioni, scadenza, arrotondamenti = SQL/PaymentIntent, token opaco/revoca/riemissione, lookup pubblico tenant-scoped, metodi pubblici, conversione Stripe/bonifico verificato/contanti/Postepay, cliente solo telefono, webhook duplicato, due conferme simultanee (una sola notifica), stock esaurito (rimborso + alert), storefront invariato (CRM/Nala), rifiuti mappati, regole min/gruppi server-side, spedizione nazionale/internazionale da token firmato, stock esaurito prima del pagamento, CRM senza duplicati e cross-tenant, mappa permessi, workflow logistico senza e-mail.
- `supabase/verification/128_assisted_orders_verification.sql`: garanzie transazionali sul database reale (da eseguire dopo l'applicazione).
- Non eseguiti: e2e browser (la suite e2e punta alla produzione e crea ordini reali Stripe) e verifica visiva su dati reali, possibile solo dopo la migration.

## 13. Limiti noti

- Il webhook Stripe **storefront** mantiene la sua creazione ordine inline (non migrata alla RPC per non toccare il flusso carta pubblico): due implementazioni di scrittura ordine restano (storefront carta vs. servizio centrale).
- Nessuna riserva di stock per i preordini (per design); un prodotto può esaurirsi prima del pagamento → pagamento bloccato o `stock_conflict` in caso di corsa.
- Gli indirizzi inseriti per un preordine non vengono salvati nella rubrica del cliente.
- «Déjà payé» non supporta bozza di spedizione senza preventivo.
