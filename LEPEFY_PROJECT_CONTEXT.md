# Lepefy Food Platform — Project Context

> **Documento operativo di riferimento per Codex / Claude Code / sviluppatori.**
>
> **Aggiornato:** 24 agosto 2026 — **v5.0 Current-State Snapshot**
>
> **Source of truth:** `main` di `lepefy-labs/lepefy-food-platform`, audit eseguito sul commit
> `9063b441a534bc4341fb0b811af2a81e539e1316`.
>
> Questo documento descrive lo **stato realmente presente nel codice**. Per la cronologia usare
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

Script applicativi includono build, lint, typecheck e runner Playwright unit/E2E.

---

## 3. Multi-tenancy e branding

Storefront tenant risolto principalmente da:

```env
NEXT_PUBLIC_TENANT_SLUG
```

Flusso di riferimento:

1. `src/lib/tenant/getTenant.ts`
2. caricamento tenant da Supabase
3. root layout/provider
4. CSS custom properties tenant
5. query filtrate per `tenant_id`
6. RLS dove configurata

### Branding admin di piattaforma

Dal 23/24 agosto 2026 `/admin/**` non deve essere considerato semplicemente un'estensione dei
colori del tenant. Esiste una configurazione separata di **platform branding** per l'identità
SaaS admin.

Migrazione corrente:

```text
supabase/migrations/071_platform_branding.sql
```

Tabella singleton:

```text
public.platform_branding
```

Campi principali includono nome piattaforma, logo e token colore/surface. L'accesso è
server-side tramite service role; non esiste deliberatamente una policy browser-facing per la
scrittura diretta.

L'admin usa l'identità **Lepefy Commerce** e primitive condivise di pagina/blocco; tenant branding
continua invece a guidare storefront e superfici tenant dove previsto.

---

## 4. Route groups principali

### Shop

```text
apps/storefront/src/app/(shop)/
```

Include homepage, `/products`, product detail, `/cart`, `/checkout`, confirmation, `/compte`,
indirizzi e ordini cliente.

### Digital Card

```text
apps/storefront/src/app/card/
```

Hub mobile tenant con branding, location fisica, Google Maps URL configurabile, metodi di
pagamento e Quick Pay.

### Événementiel

```text
apps/storefront/src/app/(evenementiel)/
```

Layout pubblico dedicato e separato dallo shop standard.

### Admin

```text
apps/storefront/src/app/admin/
```

Area protetta con Supabase Auth e `admin_users`.

### API

```text
apps/storefront/src/app/api/
```

Checkout, shipping, auth/customer, cart, admin, eventi, rental, pagamenti, notifiche e webhook.

---

## 5. Catalogo `/products`

Il catalogo è la superficie commerce primaria e mobile-first.

Stato da preservare:

- search prominente e sticky;
- heading/banner ridondanti ridotti;
- `Nos univers` mobile come scroller orizzontale;
- tablet/desktop come grid;
- auto-motion rispettosa di `prefers-reduced-motion`;
- fallback immagini categoria da immagini prodotto reali;
- product grid densa;
- ProductCard mobile ottimizzata;
- quick-add con touch target adeguato;
- prezzi promo basati su dati reali (`compare_at_price`).

La PWA è orientata all'apertura del catalogo; verificare `src/app/manifest.ts` prima di cambiare
la destinazione iniziale.

---

## 6. Cart — stato, sync e UX corrente

### Stato e sync

Il cart usa Zustand (`src/stores/cartStore.ts`) con persistenza guest in `localStorage`.

Per utenti autenticati esiste sync server-side con optimistic concurrency control:

```text
src/lib/cart/
src/components/cart/CartSyncProvider.tsx
POST /api/customers/me/cart
```

Protocollo logico:

```ts
{
  expectedVersion,
  mutations
}
```

Mutation: `add`, `set_quantity`, `remove`, `clear`. Il 409 è riconciliazione canonica, non
sovrascrittura cieca. Migrazione di riferimento: `070_cart_versioning.sql`, RPC
`apply_cart_mutations()`.

### `/cart` dopo il redesign del 24 agosto

`/cart` è tornato ad avere una responsabilità chiara: **modificare il basket e iniziare il
checkout**, non raccogliere indirizzo o calcolare la spedizione.

File di riferimento:

```text
apps/storefront/src/app/(shop)/cart/CartPurchaseClient.tsx
apps/storefront/src/components/cart/CartItem.tsx
```

UX corrente:

- niente titolo/breadcrumb mobile ridondante;
- card prodotto separate, compatte e cliccabili verso `/products/[slug]`;
- controlli `+`, `-`, `Retirer` indipendenti dalla navigazione card;
- Nala nascosta nel purchase funnel;
- action bar mobile unica con due azioni affiancate:
  - ritorno acquisti secondario;
  - `Livraison` primaria;
- CTA persistente sopra la BottomNav con safe-area;
- `/cart` non contiene più form indirizzo/shipping quote.

Il Cart Drawer desktop continua a esistere come esperienza separata.

---

## 7. Checkout shop — architettura reale

Il checkout shop è stato ristrutturato il 24 agosto 2026.

Route:

```text
/apps/storefront/src/app/(shop)/checkout/
```

Componente attivo:

```text
CheckoutFlow.tsx
```

Il vecchio `CheckoutForm.tsx` è ancora presente nel repository per compatibilità/storia, ma il
nuovo funnel è implementato in `CheckoutFlow`.

### State machine percepita

Il checkout non è più:

```text
Livraison -> Coordonnées -> Paiement
```

È ora:

```text
Livraison / Retrait + informations destinataire -> Paiement
```

`CheckoutProgressIndicator` mostra **2 macro-step**.

### Primo macro-step

Nello stesso flusso vengono raccolti:

1. modalità `delivery` / `pickup`;
2. destinatario (`firstName`, `lastName`) o persona che ritira;
3. indirizzo di consegna per delivery;
4. contatto (`email`, `phone`).

Per delivery, Nome + Cognome alimentano anche:

```text
shippingAddress.full_name
```

Per pickup non viene richiesto un indirizzo cliente; viene mostrato l'indirizzo di ritiro tenant.

Il telefono è **obbligatorio nella validazione client** (`contactSchema`, minimo 6 caratteri) sia
per delivery sia per Click & Collect, perché serve al corriere o al negozio per contattare il
cliente.

### Shipping quote

Il quote Packlink continua a dipendere dai dati logistici necessari e non aspetta il completamento
di nome/email/telefono. La UI calcola il quote appena paese/CAP sono sufficienti e conserva il
`quoteToken` firmato.

L'indirizzo selezionato può essere bloccato/riepilogato come `Adresse validée` e riaperto con
`Modifier`.

### Login durante checkout

Il checkout guest resta supportato. `OtpLoginForm` è una facilitazione opzionale e il suo submit è
isolato dal form checkout per evitare form annidati/submit involontari.

### Payment step

Dopo la validazione completa si entra direttamente nella selezione pagamento:

- Stripe/card;
- external payment links configurati;
- pagamento in boutique solo quando applicabile al pickup.

Stripe resta un sottostato `payment` del macro-step Paiement.

### Chrome purchase funnel

Durante `/checkout*`:

- header focalizzato con back/logo/security cue;
- BottomNav nascosta;
- ticker promozionale nascosto;
- Nala nascosta;
- CTA mobile sticky con totale persistente.

### Protezioni business da preservare

Non semplificare o spostare sul client:

- pricing server-side;
- stock validation;
- quote token verification;
- shipping amount verificato server-side;
- ambassador discount server-side;
- checkout session/retry;
- Stripe deferred PaymentIntent;
- external-link flow;
- payment redirect recovery.

---

## 8. Incoerenza reale: telefono checkout

La UI corrente rende il telefono obbligatorio, ma le API shop al commit auditato tipizzano ancora:

```ts
phone?: string | null
```

in particolare in:

```text
apps/storefront/src/app/api/checkout/route.ts
apps/storefront/src/app/api/checkout/external-link/route.ts
```

La guardia iniziale server controlla gli elementi/email (e gli altri requisiti specifici), non
impone ancora in modo uniforme il telefono.

Quindi **non dichiarare che l'obbligatorietà del telefono è server-enforced** finché le route non
vengono allineate. È technical debt reale da correggere in un intervento checkout approvato.

---

## 9. Nala / shopping assistant

Componente:

```text
apps/storefront/src/components/chat/ChatWidget.tsx
```

Identità approvata:

- `Nala`;
- `Assistant shopping par Lepefy`;
- primary indipendente dal tenant `#6D5AF6`;
- launcher mobile discovery -> compact;
- suggested prompts nel flusso chat esistente.

Regola corrente importante: **Nala non deve apparire in `/cart`, `/checkout*` e purchase funnel
correlato**, dove compete con le CTA di conversione.

---

## 10. Pagamenti condivisi

Componente centrale:

```text
apps/storefront/src/components/payments/StripePaymentStep.tsx
```

Responsabilità:

- Stripe Elements/PaymentElement;
- locale;
- warning pagamento;
- funnel logging;
- `elements.submit()`;
- callback `createIntent` differita;
- `stripe.confirmPayment`;
- `return_url`;
- `redirect: 'if_required'`;
- protezione `beforeunload` durante conferma;
- auto-centering;
- `prefers-reduced-motion`;
- CTA mobile sticky.

Non modificare il componente condiviso senza verificare tutti i caller shop/event/rental/card.

La configurazione Stripe è modulare (`PaymentModule`) e un metodo disponibile nel Dashboard non
implica che sia disponibile in ogni modulo.

`payment_funnel_logs` resta cross-module e il `reference_id` deve restare coerente.

---

## 11. Admin — shell e identità piattaforma

Ruoli applicativi:

- `platform_owner`
- `tenant_admin`
- `tenant_cashier`

Guard:

```text
src/lib/auth/requireAdmin.ts
```

`admin_users` è la fonte applicativa per ruolo, tenant e active state. Nascondere una voce UI non
sostituisce mai authorization server-side.

### UI system admin

Dal redesign del 23/24 agosto l'admin usa una gerarchia condivisa e il branding Lepefy Commerce,
separato dal storefront tenant. Sono presenti primitive condivise per page header e block accent,
un shell responsive e un drawer mobile accessibile.

Le pagine `/admin/parametres*` e pagamento sono state riallineate a questo sistema.

---

## 12. Admin Commandes / order detail

`/admin` / Commandes è oggi un **workspace operativo**, non una semplice tabella archivio.

Stato corrente:

- KPI operativi compatti;
- pagamenti esterni pending collassabili;
- tabs/stati ordine;
- quick views operative;
- filtri secondari;
- ordinamento server-side;
- ricerca server-side;
- paginazione server-side, 50 ordini/pagina;
- rimosso il vecchio limite funzionale dei 500 record caricati client-side;
- righe tabella più dense e gerarchizzate;
- responsive/mobile dedicato.

### Workflow ordine

La logica di transizione singola e bulk è stata unificata.

Flusso operativo principale:

```text
new -> preparing
```

Delivery:

```text
preparing -> shipped -> delivered
```

Pickup:

```text
preparing -> ready_for_pickup -> delivered
```

`cancelled` è gestito separatamente secondo le regole applicative.

Regole importanti:

- regressioni/transizioni incompatibili vengono bloccate;
- delivery non può passare a `shipped` senza tracking;
- bulk e dettaglio usano le stesse regole;
- la spedizione bulk deve attivare la stessa side-effect pipeline/notifica della spedizione singola;
- loyalty resta collegata alla transizione `delivered` dove prevista;
- payment logic non va confusa con fulfillment status.

Il dettaglio ordine è action-oriented: mostra la **prossima azione valida** invece di affidare il
workflow a un select libero di enum.

---

## 13. Événementiel

Route group:

```text
apps/storefront/src/app/(evenementiel)/
```

È un modulo separato con layout/header/footer dedicati.

Hub e detail usano dati reali per eventi, pricing, availability e immagini. Non inventare prezzi,
posti, date o immagini.

Checkout evento mantiene la state machine:

```text
select -> info -> select-payment -> payment
```

Per Stripe evento il Payment Element interno è **card-only** lato client e server. External payment
links configurati sono un percorso separato.

Capacità/prezzi devono essere verificati server-side; la capacità finale usa la logica atomica
prevista dal modulo.

Services/catering e rental sono famiglie distinte: non inventare campi description per rental item
se non esistono nel modello.

---

## 14. Digital Card `/card`

La digital card è un hub mobile tenant.

Location fisica usa:

```text
tenant.google_maps_url
```

Regole:

- URL configurabile e validato;
- apertura dell'URL esatto;
- niente Google Maps iframe/API/key;
- niente tile/mappe/geografia finte;
- preview solo astratta/decorativa.

Quick Pay usa il pagamento Stripe condiviso e deve preservare return URL/recovery.

Migrazione location:

```text
071_tenant_google_maps_url.sql
```

---

## 15. Shipping

Packlink resta integrazione principale.

Trattare come business logic sensibile:

- packaging;
- peso;
- parcel splitting;
- provider quote;
- VAT;
- surcharge;
- country rules;
- tenant rules.

Il frontend non è source of truth del costo. Leggere `src/lib/shipping/` e route quote/admin prima
di cambiare comportamento.

---

## 16. Notifiche

La configurazione destinatari notifiche tenant è versionata e non va sostituita con indirizzi
hardcoded.

Riferimenti:

```text
071_tenant_notification_recipients.sql
src/lib/notifications/getNotificationRecipients.ts
/api/admin/notification-recipients/
```

---

## 17. Database / migrations

Le migration sono fonte versionata dello schema, ma la presenza nel repo **non prova** che siano
applicate in ogni Supabase remoto.

### Collisione prefisso `071`

Al commit auditato esistono almeno **tre migration con prefisso 071**:

```text
071_tenant_google_maps_url.sql
071_tenant_notification_recipients.sql
071_platform_branding.sql
```

È una incoerenza reale. Non rinominare retroattivamente file potenzialmente già applicati senza
una procedura esplicita. Per nuove migration usare una numerazione successiva non ambigua.

---

## 18. Supabase / auth

Browser client:

```text
src/lib/supabase/client.ts
```

Server/service:

```text
src/lib/supabase/server.ts
```

Operazioni service-role devono restare server-only. Non esporre `SUPABASE_SERVICE_ROLE_KEY`.

Il checkout guest è supportato; OTP login durante checkout è opzionale e non deve bloccare la
conversione.

---

## 19. UI conventions

Lingua storefront principale: **francese**.

Convenzioni permanenti:

- Tabler Icons;
- responsive mobile-first;
- target touch ~44px o superiore;
- focus visibile;
- safe-area su CTA fixed/sticky;
- `prefers-reduced-motion` per motion automatica;
- niente dati fake nei mockup/implementazioni;
- storefront branding da tenant;
- admin branding da platform branding;
- non alterare arbitrariamente logo tenant;
- per task visuali, business logic resta invariata salvo approvazione esplicita.

---

## 20. File/moduli ad alto impatto

Prima di toccare verificare caller e contratti:

```text
apps/storefront/src/components/payments/StripePaymentStep.tsx
apps/storefront/src/stores/cartStore.ts
apps/storefront/src/lib/cart/*
apps/storefront/src/lib/shipping/*
apps/storefront/src/lib/tenant/getTenant.ts
apps/storefront/src/lib/supabase/*
apps/storefront/src/app/api/checkout/*
apps/storefront/src/app/(shop)/checkout/*
apps/storefront/src/app/api/events/*
apps/storefront/src/app/(evenementiel)/*
apps/storefront/src/app/admin/*
packages/types/*
supabase/migrations/*
```

---

## 21. Known inconsistencies / technical debt

### 21.1 Prefisso migration `071` duplicato/triplicato

Vedi sezione Database. Non correggere con rename distruttivo senza conoscere lo stato remoto.

### 21.2 Telefono checkout non ancora server-enforced

La UI lo rende obbligatorio, ma le route checkout continuano a modellarlo come opzionale. Da
allineare in un intervento checkout/business approvato.

### 21.3 Legacy `CheckoutForm.tsx`

Il nuovo shop checkout usa `CheckoutFlow.tsx`; il vecchio componente resta nel repository. Prima
di rimuoverlo verificare import/caller e compatibility needs.

### 21.4 `CLAUDE.md`

Può contenere affermazioni storiche superate (per esempio sul testing). Codice + questo snapshot
corrente prevalgono.

### 21.5 Test/CI

Non riutilizzare la dichiarazione “test verdi” di commit precedenti. Ogni delivery deve essere
validata sul proprio SHA finale.

---

## 22. Cambiamenti strutturali entrati dopo lo snapshot del 22 agosto

### Admin / piattaforma

- platform branding separato dal tenant;
- identità Lepefy Commerce nell'admin;
- shell/page hierarchy condivisa;
- `/admin/parametres*` riallineato;
- Commandes/order detail trasformati in workspace operativo;
- workflow ordine singolo/bulk unificato;
- tracking server-side richiesto prima di shipped;
- ricerca/paginazione/ordinamento server-side;
- quick views operative.

### Cart / checkout

- `/cart` ridotto a gestione basket + ingresso checkout;
- card prodotto cliccabili e più compatte;
- action bar mobile dual-CTA;
- Nala esclusa dal purchase funnel;
- checkout con chrome focalizzato;
- ticker e BottomNav nascosti nel checkout;
- shipping/address spostati dal cart al checkout;
- state machine shop ridotta a 2 macro-step;
- destinatario + address/pickup + contact unificati;
- telefono obbligatorio lato UI;
- OTP submit isolato dal form checkout;
- sticky purchase CTA con totale;
- Stripe/external payment engine preservato.

---

## 23. Checklist prima di consegnare codice

### Repo

- [ ] letto il `main` corrente;
- [ ] base SHA nota;
- [ ] diff limitato allo scope;
- [ ] nessun artefatto temporaneo.

### Business critical

- [ ] tenant isolation preservata;
- [ ] pricing/stock server-side preservati;
- [ ] shipping quote/token preservati;
- [ ] payment return/recovery preservati;
- [ ] auth/roles verificati;
- [ ] nessun secret esposto.

### UX

- [ ] mobile;
- [ ] desktop;
- [ ] touch target;
- [ ] focus;
- [ ] safe-area;
- [ ] reduced motion;
- [ ] niente dati inventati.

### Delivery

- [ ] remote validation riferita allo SHA finale;
- [ ] Vercel `READY` quando applicabile;
- [ ] `LEPEFY_PROJECT_CONTEXT.md` rivalutato se l'implementazione è importante.

---

## 24. Regola di manutenzione di questo file

Questo file deve essere aggiornato quando una implementazione importante cambia uno o più di:

- architettura;
- route/module principali;
- workflow business permanente;
- schema/migrations significative;
- payment/checkout architecture;
- auth/roles/security model;
- cart sync;
- shipping;
- tenant/platform config;
- design system cross-cutting;
- feature condivisa fra moduli.

Non aggiungere cronaca per micro-fix cosmetici o bug locali senza impatto sul modello del sistema.

Per ogni aggiornamento:

1. leggere il codice reale sul target corrente;
2. aggiornare data e SHA auditato;
3. correggere/rimuovere affermazioni superate;
4. aggiungere solo technical debt verificato;
5. non dichiarare test/build verdi senza evidenza sullo SHA pertinente.

`AGENTS.md` contiene la regola operativa che rende questa verifica parte del Definition of Done
delle implementazioni importanti.

---

# Fine snapshot v5.0

**Audit reference:** `main @ 9063b441a534bc4341fb0b811af2a81e539e1316`  
**Data:** 24 agosto 2026  
**Obiettivo:** descrivere la situazione reale del codebase, non la cronologia delle conversazioni.
