# Lepefy Food Platform — Project Context

> **Documento operativo di riferimento per Codex / Claude Code / sviluppatori.**
>
> **Aggiornato:** 25 agosto 2026 — **v5.4 Current-State Snapshot**
>
> **Source of truth:** codice del repository `lepefy-labs/lepefy-food-platform`. Questo aggiornamento
> è preparato dalla base `main @ f60f64d51d59bc5bc91e979c75e9a82e5459ea34` e include l'alert tenant per
> pagamenti external-link in verifica; per lo stato deployed prevalgono sempre branch/commit effettivamente
> promossi e migration realmente applicate.
>
> Questo documento descrive lo **stato architetturale corrente del codice**. Per la cronologia usare
> `git log`, PR e commit. Se questo documento e il codice divergono, **vince il codice**.

---

## 1. Cos'è Lepefy Food Platform

Lepefy Food è una piattaforma SaaS e-commerce **multi-tenant** per attività food, con:

- storefront commerce;
- back-office tenant;
- pagamenti e checkout;
- shipping/logistica;
- loyalty/referral;
- digital card;
- assistente shopping Nala;
- modulo Événementiel con eventi, servizi e rental.

Il tenant di riferimento più usato è `chloefood`, ma il codice non deve hardcodare Chloe Food salvo seed/configurazioni esplicitamente tenant-specifiche.

Principi architetturali:

- unica codebase multi-tenant;
- isolamento dati tramite `tenant_id` e RLS dove previsto;
- Next.js App Router;
- Supabase per database/auth;
- Stripe per i pagamenti carta;
- Packlink per shipping;
- Zustand per il cart client;
- TypeScript condiviso tramite `@lepefy/types`;
- branding storefront tenant e branding admin piattaforma sono concetti separati.

---

## 2. Monorepo e stack

```text
lepefy-food-platform/
├─ apps/storefront/         # applicazione Next.js principale
├─ packages/types/          # tipi TypeScript condivisi
├─ supabase/migrations/     # schema versionato
├─ docs/
├─ scripts/
├─ AGENTS.md                # workflow UX Agent
├─ CLAUDE.md
├─ INTEGRATION.md
└─ LEPEFY_PROJECT_CONTEXT.md
```

Package manager: **pnpm workspaces**.

Stack storefront corrente:

- Next.js `14.2.35`
- React / ReactDOM `18.3.1`
- TypeScript `^5.4.5`
- Tailwind CSS `^3.4.3`
- Supabase JS `^2.43.0`
- `@supabase/ssr` `^0.3.0`
- Stripe JS `^4.0.0`
- React Stripe JS `^2.7.0`
- Stripe server SDK `^16.0.0`
- Zustand `^4.5.2`
- React Hook Form `^7.51.4`
- Zod `^3.23.8`
- Tabler Icons `^3.31.0`
- Playwright `^1.48.0`
- `html5-qrcode` `^2.3.8`
- `@google/genai` `^1.0.0`
- `react-markdown` `^10.1.0`

---

## 3. Multi-tenancy e branding

Storefront tenant risolto principalmente da `NEXT_PUBLIC_TENANT_SLUG`, quindi `getTenant()`, CSS custom properties tenant e query filtrate per `tenant_id`.

L'URL storefront pubblico canonico è configurato per tenant tramite `tenants.storefront_url`.
`NEXT_PUBLIC_STOREFRONT_URL` resta solo fallback legacy quando il contesto notifiche non dispone di un URL tenant/legale.

### Branding admin di piattaforma

`/admin/**` usa una configurazione separata di **platform branding** (`public.platform_branding`), con identità Lepefy Commerce indipendente dai colori tenant. Tenant branding continua a guidare storefront e superfici tenant dove previsto.

---

## 4. Route groups principali

```text
apps/storefront/src/app/(shop)/          # shop, cart, checkout, compte, orders
apps/storefront/src/app/card/            # digital card / quick pay
apps/storefront/src/app/(evenementiel)/  # modulo pubblico eventi
apps/storefront/src/app/admin/           # back-office protetto
apps/storefront/src/app/api/             # API applicative/webhook
```

---

## 5. Catalogo `/products`

Superficie commerce primaria e mobile-first. Preservare:

- search sticky prominente;
- `Nos univers` scroller mobile / grid tablet-desktop;
- product grid densa;
- ProductCard mobile ottimizzata;
- quick-add accessibile;
- prezzi promo da dati reali;
- motion rispettosa di `prefers-reduced-motion`.

La PWA è orientata al catalogo.

---

## 6. Cart — stato, sync e UX

Il cart usa Zustand con persistenza guest e sync server-side per utenti autenticati con optimistic concurrency (`expectedVersion`, mutations `add/set_quantity/remove/clear`).

`/cart` ha responsabilità limitata a **modificare il basket e iniziare il checkout**. Shipping, indirizzo e contatti appartengono al checkout. Nala è esclusa dal purchase funnel.

---

## 7. Checkout shop — purchase-intent architecture

Route principali:

```text
/apps/storefront/src/app/(shop)/checkout/
/apps/storefront/src/app/(shop)/checkout/reprendre/[id]
```

Componente funnel attivo: `CheckoutFlow.tsx`.

State machine percepita:

```text
Livraison / Retrait + destinataire/contact -> Paiement
```

### Regola di dominio fondamentale

**Una checkout session non è un ordine.**

Il modello è:

```text
cart -> checkout_session -> pagamento confermato -> order
```

Non creare righe `orders` “pending” per rappresentare checkout incompleti. `orders` nasce solo dopo conferma del pagamento (o immediatamente per il caso `in_store`, che è un ordine valido con pagamento da regolare in boutique secondo il flusso esistente).

### Lifecycle `checkout_sessions`

Migration di riferimento:

```text
supabase/migrations/074_checkout_recovery_lifecycle.sql
supabase/migrations/075_external_payment_verification.sql
supabase/migrations/080_external_payment_tenant_notifications.sql
```

State machine:

```text
open -> completed
open -> cancelled
open -> expired
open + external provider handoff -> awaiting_verification
awaiting_verification -> completed
awaiting_verification -> cancelled
awaiting_verification -> open   # solo quando il cliente sceglie di passare a Stripe durante recovery
```

Campi lifecycle principali:

```text
updated_at
last_activity_at
expires_at
completed_at
order_id
resume_count
last_resumed_at
external_payment_tenant_notified_at
```

Default recovery window delle sessioni `open`: **24 ore**. L'expiry è non distruttiva: una sessione scaduta passa a `expired` e resta disponibile per analytics/audit.

`awaiting_verification` è invece uno stato durevole per i pagamenti external-link dopo il provider handoff: non viene considerato abbandonato o scaduto soltanto perché è trascorsa la TTL delle sessioni `open`; resta fino a conferma/cancellazione admin.

Per cliente autenticato e tenant esiste al massimo **una sessione `open`**. Un nuovo submit del checkout aggiorna la purchase intent esistente invece di accumulare sessioni duplicate.

Per guest non usare l'email come identity key: il resume continua tramite token firmato della checkout session. Lo stesso token firmato può autorizzare il resume da una mail Payment Recovery senza introdurre un secondo formato di token. Per un link recovery valido, l'accesso è consentito anche se il cliente registrato non è attualmente autenticato; il token è verificato server-side contro `session.id + email`.

### Stripe PaymentIntent reuse

Per una purchase intent Stripe aperta si riusa lo stesso `PaymentIntent` finché il suo stato lo consente. Se il contenuto del checkout cambia, l'amount viene aggiornato server-side. Se l'intent è cancellato/già concluso viene creato un replacement. Passando da Stripe a external-link, un intent ancora pendente viene cancellato e scollegato.

Durante Payment Recovery, se una `awaiting_verification` viene esplicitamente cambiata dal cliente a Stripe, la sessione torna `open` con TTL rinnovata e segue il normale PaymentIntent flow. Non moltiplicare PaymentIntent per retry/reload dello stesso acquisto.

### Recovery UX

Per account autenticati con checkout recuperabile:

- banner contestuale su `/products`, `/cart`, `/compte`, `/orders`;
- singola CTA primaria per continuare;
- `/orders` mantiene il checkout incompleto separato dall'historique degli ordini;
- route canonica: `/checkout/reprendre/[id]`;
- legacy `/orders/en-attente/[id]` redirige alla route canonica.

La route canonica supporta anche link firmati `?token=...` per Payment Recovery. Se la sessione è `awaiting_verification`, mostra un warning forte: se il cliente ha già pagato esternamente non deve pagare una seconda volta; se è certo di non avere pagato può mantenere o cambiare metodo.

Il linguaggio UI deve usare **“achat à finaliser / finaliser votre achat”**, non trattare la purchase intent come “commande confirmée”.

### Completion e audit trail

Dopo conferma pagamento la checkout session **non viene più considerata disposable**:

```text
status = completed
order_id = <orders.id>
completed_at = ...
```

Il lineage `checkout_session -> PaymentIntent/external payment -> order` deve restare interrogabile.

### Stock

Lo stock **non è riservato** quando nasce la checkout session. Si preservano:

- stock validation pre-payment “fail fast”;
- pricing server-side;
- shipping quote/token verification;
- decremento atomico definitivo nel punto di conferma ordine;
- gestione stock conflict/refund post-capture esistente.

### Analytics conversion/recovery

`payment_funnel_logs` resta cross-module e viene esteso con eventi checkout lifecycle/recovery. La view `checkout_funnel_30d` espone KPI tenant per checkout started/completed/open/awaiting verification/expired/cancelled/resumed/recovered.

Dashboard admin:

```text
/admin/checkout-funnel
```

Payment Recovery v1 riusa `payment_funnel_logs` come audit del reminder manuale tramite `event_type = checkout_reused` + `detail.kind`, senza introdurre una tabella dedicata.

Le notifiche automatiche di abandoned-checkout non devono essere attivate senza una policy esplicita su consenso, canale, timing e configurazione tenant. Il reminder Payment Recovery v1 è invece manuale, transazionale e limitato esclusivamente a purchase intent external-link non risolte.

L'alert tenant per external payment è invece **operativo interno**: scatta best-effort quando la sessione entra realmente in `awaiting_verification`, usa `external_payment_tenant_notified_at` come claim atomica/idempotenza e non modifica l'esito del checkout se il trasporto notifiche fallisce.

### Chrome purchase funnel

Durante `/checkout*`: header focalizzato, BottomNav/ticker/Nala esclusi, CTA mobile sticky con totale persistente.

### Protezioni business da preservare

Non spostare sul client:

- pricing;
- stock validation;
- quote token verification;
- shipping amount;
- ambassador discount;
- lifecycle/retry checkout;
- Stripe PaymentIntent;
- external-link flow;
- payment redirect recovery;
- autorizzazione/cooldown Payment Recovery;
- recipient resolution/idempotenza alert tenant external payment.

---

## 8. Telefono checkout

La UI rende il telefono obbligatorio, ma le API shop modellano ancora `phone?: string | null`. L'obbligatorietà non è quindi uniformemente server-enforced: technical debt reale da correggere in un intervento checkout dedicato.

---

## 9. Nala / shopping assistant

Identità: `Nala`, “Assistant shopping par Lepefy”, primary `#6D5AF6`, tenant-independent. Nala non deve apparire in `/cart`, `/checkout*` e superfici purchase funnel correlate.

---

## 10. Pagamenti condivisi

Componente centrale: `apps/storefront/src/components/payments/StripePaymentStep.tsx`.

Responsabilità: PaymentElement, warning, funnel logging, `elements.submit()`, `createIntent`, `stripe.confirmPayment`, return URL/recovery, beforeunload, auto-centering e CTA sticky.

Non modificare il componente condiviso senza verificare tutti i caller shop/event/rental/card. `payment_funnel_logs` è cross-module e `reference_id` deve restare coerente.

---

## 11. Admin — shell e identità piattaforma

Ruoli applicativi: `platform_owner`, `tenant_admin`, `tenant_cashier`. `admin_users` è la fonte per ruolo/tenant/active; authorization server-side obbligatoria anche se una voce è nascosta in UI.

L'admin usa branding Lepefy Commerce e primitive condivise di pagina/blocco.

---

## 12. Admin Commandes / external payment operations

`/admin` è un workspace operativo con KPI, quick views, ricerca/paginazione/ordinamento server-side, tracking e workflow ordine unificato.

La file **Paiements en attente** è distinta dagli ordini e riguarda `checkout_sessions` external-link senza `order_id`. Include gli stati operativi legacy/recovery che richiedono decisione admin:

```text
payment_method = external_link
AND order_id IS NULL
AND status IN (open, expired, awaiting_verification)
```

Lo stato canonico dopo provider handoff è `awaiting_verification`. `completed/cancelled` non devono riapparire nella queue.

Il banner mantiene `Confirmer réception` come CTA primaria e `Gérer` come accesso alla pagina:

```text
/admin/paiements-en-attente/[id]
```

La pagina di gestione centralizza reminder, secure resume link, conferma ricezione e cancellazione. `Annuler` non è un'azione primaria inline nel banner.

Quando una external-link purchase intent entra in `awaiting_verification`, i destinatari tenant attivi con `notify_external_payment_pending = true` ricevono un alert operativo con CTA alla pagina `Gérer`. L'alert non deve chiamare la purchase intent “commande confirmée” e ricorda che lo stock non è riservato finché il pagamento non viene confermato.

Workflow fulfillment ordine principale:

```text
new -> preparing
preparing -> shipped -> delivered                # delivery
preparing -> ready_for_pickup -> delivered       # pickup
```

Payment status e fulfillment status restano concetti separati.

---

## 13. Événementiel

Route group `apps/storefront/src/app/(evenementiel)/`. Modulo separato con layout dedicato. Eventi, pricing, disponibilità e immagini devono provenire da dati reali. Checkout evento mantiene la sua state machine e non va confuso con `checkout_sessions` dello shop.

---

## 14. Digital Card `/card`

Hub mobile tenant. Location fisica usa `tenant.google_maps_url`; niente iframe/API Google Maps o geografia simulata. Quick Pay usa il payment engine condiviso ma resta dominio indipendente dagli ordini shop.

---

## 15. Shipping

Packlink resta integrazione principale. Packaging, peso, splitting, quote, VAT, surcharge, country e tenant rules sono business logic sensibile. Il frontend non è source of truth del costo.

---

## 16. Notifiche

Il modello transazionale shop è definito in `docs/NOTIFICATION_JOURNEY_V1.md`.

n8n è il layer di trasporto/orchestrazione; stato ordine/checkout, recipient resolution e payload webhook restano source of truth nell'applicazione. Gli eventi cliente ordine v1 sono:

```text
order-confirmed
order-ready-for-pickup
order-shipped
order-completed
order-cancelled
```

`order-completed` distingue `completionType = delivered | picked_up`.

`order-stock-conflict` resta un incidente operativo/admin in v1 e non va trasformato in una normale email cliente finché il flusso refund/risoluzione non è modellato esplicitamente.

Il contesto notifiche è multi-tenant e include identità/branding, `storefrontUrl`, locale/currency, support email/WhatsApp, business context e dati Click & Collect:

```text
pickup.address
pickup.mapsUrl
pickup.hours
```

I dati pickup provengono da `tenant.click_collect_*` / `tenant.google_maps_url`; non usare `business.legalAddress` come sostituto semantico della location Click & Collect.

Per le email v1: una sola CTA primaria per milestone, copy transazionale breve, `[TEST]` + banner visibile in test mode, niente branding n8n nel messaggio cliente/tenant.

### Destinatari interni tenant

`tenant_notification_recipients` è la source of truth per email operative staff/proprietario. I flag principali sono:

```text
notify_card_payment
notify_external_payment_pending
notify_order_stock_conflict
active
```

Non duplicare mailing list hardcoded in n8n. Il backend risolve `recipients[]` per ogni evento interno.

### External payment tenant alert

Webhook dedicato:

```text
external-payment-awaiting-verification -> /webhook/external-payment-awaiting-verification
```

Scatta quando una checkout shop external-link è realmente `awaiting_verification`. Payload principale:

```text
recipients[]
checkoutSessionId
paymentReference
customer.{fullName,email,phone}
paymentMethod.{type,label}
amount
fulfillmentType
items[]
shippingAddress
adminPaymentLink
createdAt
notificationSentAt
```

Una sola notifica accettata da n8n per checkout session; su errore trasporto/configurazione la claim viene rilasciata per consentire un retry. Il fallimento dell'alert non deve mai fallire il customer checkout.

### Payment Recovery v1

Webhook dedicato:

```text
payment-reminder -> /webhook/payment-reminder
```

È un reminder **manuale admin-triggered**, separato dalle notifiche ordine e dalle future campagne abandoned checkout.

Regole server v1:

- primo reminder dopo almeno 2 ore;
- max 1 reminder ogni 24 ore;
- max 2 reminder per checkout;
- solo external-link non risolte e senza ordine;
- audit/cooldown persistito in `payment_funnel_logs`;
- link `resumeLink` firmato con il token checkout esistente;
- copy prudente: mai dichiarare che il pagamento non sia arrivato con certezza;
- se il provider handoff è iniziato, avvisare esplicitamente di non pagare due volte;
- CTA principale `Reprendre mon achat`, con possibilità di mantenere o cambiare metodo.

La Notification Test Console PLATFORM_OWNER supporta `payment-reminder` e `external-payment-awaiting-verification` con payload sintetici/testMode senza toccare ordini, stock o pagamenti reali. Per l'alert tenant, l'email inserita nella console sostituisce solo in test la lista reale `tenant_notification_recipients`.

I destinatari tenant sono configurati/versionati; non usare email hardcoded. Recovery marketing o reminder checkout automatici futuri devono rispettare consenso/configurazione tenant e non partire solo perché una sessione è `open`.

---

## 17. Database / migrations

La presenza di una migration nel repo **non prova** che sia applicata in ogni Supabase remoto. Per release che leggono nuove colonne, applicare la migration DB prima di promuovere il codice che le richiede.

Esiste una collisione storica del prefisso `071`; non rinominare retroattivamente file già potenzialmente applicati. Le nuove migration usano numerazione successiva non ambigua; checkout lifecycle usa `074_checkout_recovery_lifecycle.sql`, stato external verification `075_external_payment_verification.sql`, canonical storefront `079_tenant_storefront_url.sql` e alert tenant external payment `080_external_payment_tenant_notifications.sql`.

Migration `080` aggiunge:

```text
tenant_notification_recipients.notify_external_payment_pending boolean default true
checkout_sessions.external_payment_tenant_notified_at timestamptz nullable
```

Payment Recovery reminder continua a usare lifecycle/campi già esistenti e audit JSON in `payment_funnel_logs.detail`.

---

## 18. Supabase / auth

Browser client: `src/lib/supabase/client.ts`. Server/service: `src/lib/supabase/server.ts`.
Operazioni service-role restano server-only. Il checkout guest è supportato; OTP login è opzionale e non deve bloccare conversione.

I link Payment Recovery usano esclusivamente il token HMAC esistente di `checkoutSessionAccessToken`; l'autorizzazione API accetta customer session corrispondente **oppure** token firmato valido. Non creare token guest alternativi.

---

## 19. UI conventions

Lingua storefront principale: **francese**.

- Tabler Icons;
- mobile-first;
- touch target ~44px+;
- focus visibile;
- safe-area per fixed/sticky;
- reduced motion;
- niente dati fake;
- storefront branding da tenant;
- admin branding da piattaforma;
- business logic invariata salvo approvazione esplicita.

---

## 20. File/moduli ad alto impatto

```text
apps/storefront/src/components/payments/StripePaymentStep.tsx
apps/storefront/src/components/checkout-session/*
apps/storefront/src/stores/cartStore.ts
apps/storefront/src/lib/cart/*
apps/storefront/src/lib/checkout/*
apps/storefront/src/lib/shipping/*
apps/storefront/src/lib/tenant/getTenant.ts
apps/storefront/src/lib/notifications/*
apps/storefront/src/lib/orders/adminOrderWorkflow.ts
apps/storefront/src/lib/supabase/*
apps/storefront/src/app/api/checkout/*
apps/storefront/src/app/api/checkout-sessions/*
apps/storefront/src/app/api/admin/checkout-sessions/*
apps/storefront/src/app/api/admin/platform/notifications/*
apps/storefront/src/app/(shop)/checkout/*
apps/storefront/src/app/api/webhooks/stripe/*
apps/storefront/src/app/admin/*
packages/types/*
supabase/migrations/*
```

---

## 21. Known inconsistencies / technical debt

### 21.1 Prefisso migration `071` duplicato/triplicato
Non correggere con rename distruttivo senza conoscere lo stato remoto.

### 21.2 Telefono checkout non server-enforced
UI obbligatoria, route ancora opzionali.

### 21.3 Legacy `CheckoutForm.tsx`
`CheckoutFlow.tsx` è attivo; verificare caller prima della rimozione.

### 21.4 Recovery outbound automatico
Payment Recovery v1 abilita solo reminder manuali per external payment unresolved. Non abilita abandoned-cart email/push automatici. Automazioni future richiedono decisione esplicita su consenso, timing, canali e configurazione tenant. L'alert automatico al tenant per un external payment in verifica è un'eccezione operativa interna, non marketing cliente.

### 21.5 Test/CI
Ogni delivery deve essere validata sul proprio SHA; non riusare dichiarazioni di commit precedenti.

### 21.6 Admin confirm/cancel concurrency
Le operazioni admin su checkout external payment sono business-critical. Se si modifica conferma/cancellazione, verificare sempre il numero di righe effettivamente aggiornate o usare una transizione atomica/RPC per evitare successi apparenti quando una transizione concorrente ha già vinto.

---

## 22. Cambiamenti strutturali recenti

### Admin / piattaforma
- platform branding separato;
- shell/page hierarchy condivisa;
- Commandes/order detail come workspace operativo;
- workflow singolo/bulk unificato;
- `/admin/checkout-funnel` per conversion/recovery shop;
- console `PLATFORM_OWNER` per testare i webhook notifiche senza creare ordini reali;
- `Gérer` payment recovery per external payments unresolved;
- configurazione destinatari tenant estesa con alert `Paiement externe à vérifier`.

### Cart / checkout
- `/cart` focalizzato sul basket;
- checkout a 2 macro-step;
- purchase chrome focalizzato;
- Nala esclusa dal funnel;
- `checkout_sessions` evolute a purchase-intent persistente;
- una sessione open per cliente autenticato;
- `awaiting_verification` durevole dopo provider handoff external-link;
- PaymentIntent riusato/aggiornato;
- resume route canonica `/checkout/reprendre/[id]`, inclusi signed reminder links;
- completed checkout collegato a `order_id` e conservato;
- expiry 24h non distruttiva per `open`;
- analytics lifecycle/recovery;
- Payment Recovery v1 manuale con cooldown e max 2 reminder;
- alert tenant idempotente all'ingresso external-link in `awaiting_verification`.

### Notifiche
- payload ordine multi-tenant con branding/support/storefront canonico;
- Notification Journey v1 come specifica transazionale;
- contesto Click & Collect esplicito (`pickup.address/mapsUrl/hours`);
- stock conflict mantenuto come incidente operativo v1;
- webhook `payment-reminder` e test console dedicato;
- webhook interno `external-payment-awaiting-verification` con `recipients[]` risolti server-side.

---

## 23. Checklist prima di consegnare codice

### Repo
- [ ] letto il target corrente;
- [ ] base SHA nota;
- [ ] diff limitato allo scope;
- [ ] nessun artefatto temporaneo.

### Business critical
- [ ] tenant isolation preservata;
- [ ] pricing/stock server-side preservati;
- [ ] shipping quote/token preservati;
- [ ] payment return/recovery preservati;
- [ ] auth/roles verificati;
- [ ] nessun secret esposto;
- [ ] migration applicata prima del codice dipendente.

### UX
- [ ] mobile;
- [ ] desktop;
- [ ] touch target;
- [ ] focus;
- [ ] safe-area;
- [ ] niente dati inventati.

### Delivery
- [ ] remote validation riferita allo SHA finale;
- [ ] Vercel `READY` quando applicabile;
- [ ] `LEPEFY_PROJECT_CONTEXT.md` aggiornato per cambi architetturali.

---

## 24. Regola di manutenzione di questo file

Aggiornare questo file quando cambiano architettura, route/module principali, workflow business, schema/migration significative, payment/checkout, auth, cart sync, shipping, tenant/platform config o feature cross-module. Non trasformarlo in changelog.

---

# Fine snapshot v5.4

**Base audit:** `main @ f60f64d51d59bc5bc91e979c75e9a82e5459ea34` + external-payment tenant alert delivery  
**Data:** 25 agosto 2026  
**Obiettivo:** descrivere la situazione architetturale reale del codebase, non la cronologia delle conversazioni.
