# Lepefy Food Platform — Project Context

> **Documento operativo di riferimento per Codex / Claude Code / sviluppatori.**
>
> **Aggiornato:** 25 agosto 2026 — **v5.2 Current-State Snapshot**
>
> **Source of truth:** codice del repository `lepefy-labs/lepefy-food-platform`. Questo aggiornamento
> è preparato dalla base `main @ 62b9049bd8e26fe52660735cb8879d7029b73de0` e include la delivery
> Notification Journey v1; per lo stato deployed prevalgono sempre branch/commit effettivamente
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

Il tenant di riferimento più usato è `chloefood`, ma il codice non deve hardcodare Chloe Food
salvo seed/configurazioni esplicitamente tenant-specifiche.

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

Storefront tenant risolto principalmente da `NEXT_PUBLIC_TENANT_SLUG`, quindi `getTenant()`, CSS
custom properties tenant e query filtrate per `tenant_id`.

L'URL storefront pubblico canonico è configurato per tenant tramite `tenants.storefront_url`.
`NEXT_PUBLIC_STOREFRONT_URL` resta solo fallback legacy quando il contesto notifiche non dispone di
un URL tenant/legale.

### Branding admin di piattaforma

`/admin/**` usa una configurazione separata di **platform branding** (`public.platform_branding`),
con identità Lepefy Commerce indipendente dai colori tenant. Tenant branding continua a guidare
storefront e superfici tenant dove previsto.

---

## 4. Route groups principali

```text
apps/storefront/src/app/(shop)/          # shop, cart, checkout, compte, orders
apps/storefront/src/app/card/            # digital card / quick pay
apps/storefront/src/app/(evenementiel)/  # modulo pubblico eventi
apps/storefront/src/app/admin/            # back-office protetto
apps/storefront/src/app/api/              # API applicative/webhook
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

Il cart usa Zustand con persistenza guest e sync server-side per utenti autenticati con optimistic
concurrency (`expectedVersion`, mutations `add/set_quantity/remove/clear`).

`/cart` ha responsabilità limitata a **modificare il basket e iniziare il checkout**. Shipping,
indirizzo e contatti appartengono al checkout. Nala è esclusa dal purchase funnel.

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

Non creare righe `orders` “pending” per rappresentare checkout incompleti. `orders` nasce solo dopo
conferma del pagamento (o immediatamente per il caso `in_store`, che è un ordine valido con
pagamento da regolare in boutique secondo il flusso esistente).

### Lifecycle `checkout_sessions`

Migration di riferimento:

```text
supabase/migrations/074_checkout_recovery_lifecycle.sql
```

State machine:

```text
open -> completed
open -> cancelled
open -> expired
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
```

Default recovery window: **24 ore**. L'expiry è non distruttiva: una sessione scaduta passa a
`expired` e resta disponibile per analytics/audit.

Per cliente autenticato e tenant esiste al massimo **una sessione `open`**. Un nuovo submit del
checkout aggiorna la purchase intent esistente invece di accumulare sessioni duplicate.

Per guest non usare l'email come identity key: il resume continua tramite token firmato della
checkout session.

### Stripe PaymentIntent reuse

Per una purchase intent Stripe aperta si riusa lo stesso `PaymentIntent` finché il suo stato lo
consente. Se il contenuto del checkout cambia, l'amount viene aggiornato server-side. Se l'intent è
cancellato/già concluso viene creato un replacement. Passando da Stripe a external-link, un intent
ancora pendente viene cancellato e scollegato.

Non moltiplicare `PaymentIntent` per retry/reload dello stesso acquisto.

### Recovery UX

Per account autenticati con checkout recuperabile:

- banner contestuale su `/products`, `/cart`, `/compte`, `/orders`;
- singola CTA primaria per continuare;
- `/orders` mantiene il checkout incompleto separato dall'historique degli ordini;
- route canonica: `/checkout/reprendre/[id]`;
- legacy `/orders/en-attente/[id]` redirige alla route canonica.

Il linguaggio UI deve usare **“achat à finaliser / finaliser votre achat”**, non trattare la
purchase intent come “commande confirmée”.

### Completion e audit trail

Dopo conferma pagamento la checkout session **non viene più considerata disposable**:

```text
status = completed
order_id = <orders.id>
completed_at = ...
```

Il lineage `checkout_session -> PaymentIntent -> order` deve restare interrogabile. La migration
074 include una protezione compatibile con i vecchi cleanup `DELETE` e collega le sessioni Stripe
all'ordine creato dal webhook.

### Stock

Lo stock **non è riservato** quando nasce la checkout session. Si preservano:

- stock validation pre-payment “fail fast”;
- pricing server-side;
- shipping quote/token verification;
- decremento atomico definitivo nel punto di conferma ordine;
- gestione stock conflict/refund post-capture esistente.

### Analytics conversion/recovery

`payment_funnel_logs` resta cross-module e viene esteso con eventi checkout lifecycle/recovery.
La view `checkout_funnel_30d` espone KPI tenant per:

- checkout started;
- completed;
- open;
- expired;
- cancelled;
- resumed;
- recovered.

Dashboard admin:

```text
/admin/checkout-funnel
```

Le notifiche automatiche di abandoned-checkout non devono essere attivate senza una policy
esplicita su consenso, canale, timing e configurazione tenant. Il lifecycle persistente fornisce i
dati necessari per aggiungerle senza cambiare nuovamente il dominio.

### Chrome purchase funnel

Durante `/checkout*`: header focalizzato, BottomNav/ticker/Nala esclusi, CTA mobile sticky con
totale persistente.

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
- payment redirect recovery.

---

## 8. Telefono checkout

La UI rende il telefono obbligatorio, ma le API shop modellano ancora `phone?: string | null`.
L'obbligatorietà non è quindi uniformemente server-enforced: technical debt reale da correggere in
un intervento checkout dedicato.

---

## 9. Nala / shopping assistant

Identità: `Nala`, “Assistant shopping par Lepefy”, primary `#6D5AF6`, tenant-independent. Nala non
deve apparire in `/cart`, `/checkout*` e superfici purchase funnel correlate.

---

## 10. Pagamenti condivisi

Componente centrale: `apps/storefront/src/components/payments/StripePaymentStep.tsx`.

Responsabilità: PaymentElement, warning, funnel logging, `elements.submit()`, `createIntent`,
`stripe.confirmPayment`, return URL/recovery, beforeunload, auto-centering e CTA sticky.

Non modificare il componente condiviso senza verificare tutti i caller shop/event/rental/card.
`payment_funnel_logs` è cross-module e `reference_id` deve restare coerente.

---

## 11. Admin — shell e identità piattaforma

Ruoli applicativi: `platform_owner`, `tenant_admin`, `tenant_cashier`. `admin_users` è la fonte per
ruolo/tenant/active; authorization server-side obbligatoria anche se una voce è nascosta in UI.

L'admin usa branding Lepefy Commerce e primitive condivise di pagina/blocco.

---

## 12. Admin Commandes / order detail

`/admin` è un workspace operativo con KPI, quick views, ricerca/paginazione/ordinamento server-side,
tracking e workflow ordine unificato.

Con checkout lifecycle v2, **pagamento external-link pending** significa esclusivamente:

```text
checkout_sessions.status = open
AND expires_at > now()
AND payment_method = external_link
```

Le sessioni `completed/cancelled/expired` non devono riapparire nel banner operativo anche se sono
conservate per audit.

Workflow fulfillment principale:

```text
new -> preparing
preparing -> shipped -> delivered                # delivery
preparing -> ready_for_pickup -> delivered       # pickup
```

Payment status e fulfillment status restano concetti separati.

---

## 13. Événementiel

Route group `apps/storefront/src/app/(evenementiel)/`. Modulo separato con layout dedicato. Eventi,
pricing, disponibilità e immagini devono provenire da dati reali. Checkout evento mantiene la sua
state machine e non va confuso con `checkout_sessions` dello shop.

---

## 14. Digital Card `/card`

Hub mobile tenant. Location fisica usa `tenant.google_maps_url`; niente iframe/API Google Maps o
geografia simulata. Quick Pay usa il payment engine condiviso ma resta dominio indipendente dagli
ordini shop.

---

## 15. Shipping

Packlink resta integrazione principale. Packaging, peso, splitting, quote, VAT, surcharge, country
e tenant rules sono business logic sensibile. Il frontend non è source of truth del costo.

---

## 16. Notifiche

Il modello transazionale shop è definito in `docs/NOTIFICATION_JOURNEY_V1.md`.

n8n è il layer di trasporto/orchestrazione; stato ordine e payload webhook restano source of truth
nell'applicazione. Gli eventi cliente v1 sono:

```text
order-confirmed
order-ready-for-pickup
order-shipped
order-completed
order-cancelled
```

`order-completed` distingue `completionType = delivered | picked_up`.

`order-stock-conflict` resta un incidente operativo/admin in v1 e non va trasformato in una normale
email cliente finché il flusso refund/risoluzione non è modellato esplicitamente.

Il contesto notifiche è multi-tenant e include identità/branding, `storefrontUrl`, locale/currency,
support email/WhatsApp, business context e dati Click & Collect:

```text
pickup.address
pickup.mapsUrl
pickup.hours
```

I dati pickup provengono da `tenant.click_collect_*` / `tenant.google_maps_url`; non usare
`business.legalAddress` come sostituto semantico della location Click & Collect.

Per le email v1: una sola CTA primaria per milestone, copy transazionale breve, `[TEST]` + banner
visibile in test mode, niente branding n8n nel messaggio cliente.

I destinatari tenant sono configurati/versionati; non usare email hardcoded. Recovery marketing o
reminder checkout futuri devono rispettare consenso/configurazione tenant e non partire solo perché
una sessione è `open`.

---

## 17. Database / migrations

La presenza di una migration nel repo **non prova** che sia applicata in ogni Supabase remoto.
Per release che leggono nuove colonne, applicare la migration DB prima di promuovere il codice che
le richiede.

Esiste una collisione storica del prefisso `071`; non rinominare retroattivamente file già
potenzialmente applicati. Le nuove migration usano numerazione successiva non ambigua; checkout
lifecycle v2 usa `074_checkout_recovery_lifecycle.sql`.

---

## 18. Supabase / auth

Browser client: `src/lib/supabase/client.ts`. Server/service: `src/lib/supabase/server.ts`.
Operazioni service-role restano server-only. Il checkout guest è supportato; OTP login è opzionale
e non deve bloccare conversione.

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

### 21.4 Recovery outbound
Il modello v2 misura resume/recovery ma non abilita automaticamente abandoned-cart email/push.
Serve decisione esplicita su consenso, timing e canali tenant prima dell'attivazione.

### 21.5 Test/CI
Ogni delivery deve essere validata sul proprio SHA; non riusare dichiarazioni di commit precedenti.

---

## 22. Cambiamenti strutturali recenti

### Admin / piattaforma
- platform branding separato;
- shell/page hierarchy condivisa;
- Commandes/order detail come workspace operativo;
- workflow singolo/bulk unificato;
- `/admin/checkout-funnel` per conversion/recovery shop;
- console `PLATFORM_OWNER` per testare i webhook notifiche senza creare ordini reali.

### Cart / checkout
- `/cart` focalizzato sul basket;
- checkout a 2 macro-step;
- purchase chrome focalizzato;
- Nala esclusa dal funnel;
- `checkout_sessions` evolute a purchase-intent persistente;
- una sessione open per cliente autenticato;
- PaymentIntent riusato/aggiornato;
- resume route canonica `/checkout/reprendre/[id]`;
- completed checkout collegato a `order_id` e conservato;
- expiry 24h non distruttiva;
- analytics lifecycle/recovery.

### Notifiche
- payload ordine multi-tenant con branding/support/storefront canonico;
- Notification Journey v1 come specifica transazionale;
- contesto Click & Collect esplicito (`pickup.address/mapsUrl/hours`);
- stock conflict mantenuto come incidente operativo v1.

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

Aggiornare questo file quando cambiano architettura, route/module principali, workflow business,
schema/migration significative, payment/checkout, auth, cart sync, shipping, tenant/platform config
o feature cross-module. Non trasformarlo in changelog.

---

# Fine snapshot v5.2

**Base audit:** `main @ 62b9049bd8e26fe52660735cb8879d7029b73de0` + Notification Journey v1 delivery  
**Data:** 25 agosto 2026  
**Obiettivo:** descrivere la situazione architetturale reale del codebase, non la cronologia delle conversazioni.
