# Lepefy Food — Revisione tecnica e di business

> Analisi di stack, struttura, sicurezza e strategia del progetto, con migliorie
> ordinate per priorità. Data revisione: luglio 2026.

---

## TL;DR

Il progetto è ben strutturato per essere un MVP: monorepo pulito, logica di
spedizione ben isolata e documentata, flusso checkout → webhook solido come
design. Ci sono però **3 falle di sicurezza serie da sistemare prima di
scalare** (API admin senza autenticazione, prezzi fidati dal client, policy RLS
troppo aperte), e il modello "un deploy per tenant" è il vero tetto alla
crescita del business: finché onboarding e billing restano manuali, ogni nuovo
cliente costa ore di lavoro invece di minuti.

---

## 1. Stack e struttura — cosa va bene

| Area | Valutazione |
|---|---|
| Stack (Next.js 14 + Supabase + Stripe + Zustand) | ✅ Coerente e adatto a un team piccolo: poca infrastruttura, costi bassi |
| Monorepo pnpm (`apps/storefront`, `packages/types`) | ✅ Pulito, tipi condivisi importati come `@lepefy/types` |
| Logica spedizione (`calculateShipping.ts`) | ✅ Il pezzo migliore del codebase (vedi sotto) |
| Flusso pagamento | ✅ `checkout_session` → PaymentIntent → webhook → ordine: l'ordine nasce solo a pagamento confermato |
| Separazione client/server Supabase | ✅ Rispettata (browser client vs server client con cookies) |
| Documentazione (`CLAUDE.md`, `INTEGRATION.md`) | ✅ Sopra la media per un progetto di queste dimensioni |

Punti di forza di `calculateShipping.ts`:

- Funzioni pure esportate (`splitIntoParcels`, `resolveVatRate`,
  `calcPackagingSurcharge`) → facilmente testabili.
- Tutto configurabile da DB (`packaging_surcharges`, `shipping_vat_rates`):
  zero deploy per cambiare importi o logica.
- Fallback IVA a due livelli (tax_price Packlink → aliquota DB per paese).

---

## 2. Criticità tecniche — da sistemare subito

### 2.1 Le API admin non hanno alcun controllo di autenticazione — **CRITICO**

L'autenticazione esiste solo nel layout `(protected)` che protegge le
**pagine**. Le route API amministrative usano `createServiceClient()` (che
bypassa RLS) **senza mai verificare la sessione né la whitelist
`ADMIN_EMAILS`**:

- `src/app/api/admin/catalogue/route.ts` — creazione prodotti
- `src/app/api/admin/catalogue/[id]/route.ts` — modifica/cancellazione prodotti
- `src/app/api/admin/orders/[id]/route.ts` — cambio stato ordini
- `src/app/api/admin/generate-product-image/route.ts` — consumo quota Gemini
- `src/app/api/admin/upload-product-image/route.ts` — upload su storage

Chiunque conosca l'URL può creare/modificare prodotti, cambiare stato ordini e
consumare la quota API Gemini con una semplice POST.

**Fix:** helper condiviso `requireAdmin()` (verifica sessione Supabase +
`ADMIN_EMAILS`) chiamato in testa a ogni route admin.

### 2.2 Il checkout si fida dei prezzi inviati dal client — **CRITICO**

In `src/app/api/checkout/route.ts` il subtotale è calcolato da `items[].price`
che arriva dal browser, e anche `shippingTotal` è passato dal client. Un utente
può modificare il payload e pagare 0,01 € per l'intero carrello.

**Fix:**
- Ricaricare i prezzi da DB tramite `productId` e ricalcolare il subtotale
  lato server.
- Salvare il quote di spedizione in `checkout_sessions` al momento della
  quotazione e riusarlo, invece di riaccettare `shippingTotal` dal client.

### 2.3 Policy RLS troppo permissive — **ALTO**

`orders_insert_any` e `order_items_insert_any` con `with check (true)`
(`supabase/migrations/002_rls_policies.sql`) permettono a chiunque con la anon
key (pubblica per definizione) di inserire ordini arbitrari nel DB.

**Fix:** eliminare le due policy — gli insert reali passano tutti dal service
role, che bypassa RLS.

### 2.4 Idempotenza webhook fragile — **ALTO**

Il check "esiste già un ordine per questo intent?" nel webhook Stripe è
check-then-insert: due retry Stripe concorrenti possono creare ordini
duplicati.

**Fix:** indice unico su `orders.stripe_payment_intent_id` + gestione
dell'errore di conflitto nel webhook.

### 2.5 Nessuna gestione stock reale — **MEDIO**

Stock default 999, nessun controllo né decremento al checkout: si può vendere
merce esaurita — problema concreto per fresco/surgelato. Il campo
`product.stock` è usato solo come cap nel carrello lato client.

### 2.6 Incoerenze minori da pulire — **MEDIO/BASSO**

- `FROM_ADDRESS` hardcoded a `IT 42122` in `api/shipping/quote/route.ts`
  nonostante esista la migration `010_warehouse_location.sql` — il secondo
  tenant spedirebbe "da Reggio Emilia".
- Il quote restituisce `_internal` (corriere, IVA, surcharge imballaggio) come
  `shippingDetails` al client: la documentazione dice che il breakdown è
  nascosto, ma è visibile nei devtools — incluso il markup di 3 €/pacco.
- File morti: `src/app/admin/orders/[id]/` e `src/app/admin/orders/id/`
  duplicano la versione dentro `(protected)`; `middleware.ts` è un
  `export {}` vuoto.
- Dipendenze: `xlsx@0.18.5` ha vulnerabilità note senza fix (valutare
  `exceljs`); `@supabase/ssr@0.3` è vecchio e già oggi impone i workaround sui
  cookie documentati in `CLAUDE.md`; Next 14.2 → valutare upgrade a 15.

### 2.7 Zero test — **MEDIO**

Le funzioni pure di `calculateShipping` sono il candidato perfetto per partire
con Vitest a costo quasi nullo: split pacchi, fallback IVA, surcharge
`per_parcel`/`per_order` sono esattamente i punti dove un errore costa soldi
veri a ogni ordine.

---

## 3. Architettura — il limite alla scalabilità

### 3.1 Un tenant = un deployment

Il tenant è risolto da `NEXT_PUBLIC_TENANT_SLUG` a build time: ogni nuovo
negozio richiede un progetto Vercel dedicato, env vars, deploy e configurazione
manuale. Regge fino a ~5 tenant, poi diventa il collo di bottiglia.

**Evoluzione naturale:** risolvere il tenant dal dominio (header `Host` nel
middleware → lookup su una colonna `tenants.domain`). Un solo deployment serve
tutti i tenant; l'onboarding diventa una riga nel DB + un record DNS. Non è
urgente oggi, ma conviene deciderlo prima di firmare il terzo cliente.

### 3.2 Flusso pagamenti da chiarire

Esiste `tenants.stripe_account_id` ma il PaymentIntent è creato sull'account
della piattaforma senza Stripe Connect: i soldi degli ordini ChloeFood arrivano
a Lepefy Labs, e il giroconto al negoziante è presumibilmente manuale.

**Evoluzione:** Stripe Connect (destination charges) — i pagamenti vanno
direttamente al tenant e la piattaforma trattiene una `application_fee`
automatica.

---

## 4. Migliorie lato business

### 4.1 Automatizzare il billing SaaS

Situazione attuale (migration 011): 89 €/mese con Payment Link o bonifico,
aggiornamento manuale del DB. Dettaglio importante: **lo storefront non
controlla mai `subscription_status`** — un tenant scaduto continua a vendere
indefinitamente.

**Proposte:**
- Stripe Billing con subscription vere → dunning automatico sui pagamenti
  falliti, zero lavoro manuale di riconciliazione.
- Check in `getTenant` con periodo di grazia e banner "rinnova entro X giorni",
  poi blocco soft dello storefront.

### 4.2 Doppia leva di ricavo

Il canone fisso da solo scala linearmente con la fatica commerciale. Con Stripe
Connect si può aggiungere una fee sulle transazioni (es. 89 €/mese + 1–2 % sul
transato): il ricavo della piattaforma si allinea al successo del negozio e si
abbassa la barriera d'ingresso per i nuovi tenant (canone ridotto + fee più
alta).

### 4.3 Recupero carrelli abbandonati — l'infrastruttura c'è già

Le `checkout_sessions` non completate restano nel DB con email, telefono e
contenuto del carrello: un job (o flusso n8n, già in uso) che dopo 24h manda
una mail "il tuo carrello ti aspetta" è tipicamente il singolo intervento con
miglior ROI in e-commerce food.

### 4.4 Automatizzare la creazione spedizioni Packlink

La Phase 2 è già documentata in `INTEGRATION.md` (§7) e il `serviceId` del
quote viene già salvato in `shipping_details`: creare la spedizione via API al
`payment_intent.succeeded` toglie alla cliente il lavoro manuale sulla
dashboard Packlink. È anche un argomento di vendita forte verso i prossimi
tenant ("l'etichetta si stampa da sola").

### 4.5 Onboarding tenant self-service (medio termine)

Oggi un nuovo negozio richiede: seed SQL manuale, utente Supabase creato a
mano, env `ADMIN_EMAILS`, deploy dedicato. Un wizard di setup (anche solo
interno) che crea tenant + admin + configurazione spedizione riduce il costo di
acquisizione di ogni cliente da giorni a ore.

### 4.6 Crescita del singolo negozio

- **Soglia spedizione gratuita** come leva sullo scontrino medio (il campo
  `free_above` esiste già nello schema legacy, non è collegato). Nel food
  l'AOV è tutto, dato il peso della spedizione sul totale.
- **Email transazionali robuste**: oggi la conferma ordine dipende da una
  chiamata n8n fire-and-forget nel webhook Stripe — se n8n è giù, il cliente
  non riceve nulla e non c'è retry. Pattern outbox (tabella
  `pending_notifications` + retry) o provider diretto (es. Resend).
- **PWA già presente** → notifiche push per riordini ricorrenti (il food ha
  riacquisto naturale mensile).
- **Analytics per il tenant**: dashboard vendite/prodotti top nel pannello
  admin → aumenta il valore percepito del canone.

### 4.7 i18n prima dell'espansione

Tutte le stringhe UI sono francese hardcoded. Il target è "African food shops
in Europe": Belgio e Svizzera francofona funzionano, ma Germania/Italia/UK no.
Introdurre `next-intl` con `tenants.locale` (colonna già esistente) come
sorgente è molto più economico ora che dopo.

---

## 5. Roadmap consigliata

| Orizzonte | Interventi |
|---|---|
| **Subito** (giorni) | Auth sulle API admin · ricalcolo prezzi server-side nel checkout · unique index su `stripe_payment_intent_id` · chiusura policy RLS |
| **Breve** (settimane) | Enforcement abbonamento · test Vitest su `calculateShipping` · controllo stock al checkout · pulizia file morti · `FROM_ADDRESS` da DB |
| **Medio** (mesi, guidato dal commerciale) | Stripe Connect + billing automatico · risoluzione tenant per dominio · recupero carrelli abbandonati · creazione spedizioni Packlink automatica · i18n |
