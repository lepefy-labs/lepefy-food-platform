# Lepefy Food Platform — Project Context

> **Documento operativo di riferimento per Codex / Claude Code / sviluppatori.**
>
> **Aggiornato:** 22 agosto 2026 — **v4.0 Current-State Snapshot**
>
> **Source of truth:** `main` di `lepefy-labs/lepefy-food-platform`, audit eseguito sul commit
> `dd1e0f8270a6671705e0271293acdb42cb56ba9c`.
>
> Questa revisione cambia deliberatamente il formato del documento: invece di continuare ad
> accumulare un changelog di sessione sempre più lungo, descrive **lo stato realmente presente
> nel codice**. Per la storia puntuale delle modifiche usare `git log` / Pull Request / commit.
> Se questo documento e il codice divergono, **vince il codice**.

---

## 1. Cos'è Lepefy Food Platform

Lepefy Food è una piattaforma SaaS e-commerce **multi-tenant** per attività food, con storefront,
back-office, pagamenti, spedizioni, loyalty/referral, carta digitale, assistente shopping e un
modulo Événementiel separato.

Il tenant di riferimento attualmente usato più spesso è `chloefood`, ma il codice non deve
hardcodare Chloe Food salvo seed/configurazioni esplicitamente tenant-specifiche.

Principi architetturali:

- un'unica codebase multi-tenant;
- branding e configurazione letti dal tenant;
- isolamento dati tramite `tenant_id` e RLS dove previsto;
- Next.js App Router;
- Supabase per database/auth;
- Stripe per i pagamenti carta;
- Packlink per la logistica/spedizione;
- Zustand per lo stato cart client;
- TypeScript condiviso tramite `@lepefy/types`.

---

## 2. Monorepo

```text
lepefy-food-platform/
├─ apps/
│  └─ storefront/            # applicazione Next.js principale
├─ packages/
│  └─ types/                 # tipi TypeScript condivisi (@lepefy/types)
├─ supabase/
│  ├─ migrations/            # schema e migrazioni SQL
│  └─ seed.sql               # seed
├─ docs/                     # documentazione tecnica
├─ scripts/                  # script operativi / one-off
├─ CLAUDE.md
├─ INTEGRATION.md
├─ README.md
└─ LEPEFY_PROJECT_CONTEXT.md
```

Package manager: **pnpm workspaces**.

Comandi storefront:

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
```

Nel package storefront sono inoltre presenti:

```bash
pnpm test:unit
pnpm test:e2e
pnpm test:e2e:report
```

Quindi non è più corretto affermare che il repository non abbia test: esistono runner Playwright
dedicati a unit ed E2E.

---

## 3. Stack attuale

Dallo `apps/storefront/package.json` corrente:

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

Non introdurre dipendenze nuove per problemi che possono essere risolti con le primitive già
presenti, salvo necessità esplicita.

---

## 4. Multi-tenancy

Il tenant pubblico è risolto a partire da:

```env
NEXT_PUBLIC_TENANT_SLUG
```

Il flusso di riferimento resta:

1. `src/lib/tenant/getTenant.ts`
2. caricamento tenant da Supabase
3. root layout
4. CSS custom properties / provider tenant
5. query applicative filtrate per `tenant_id`
6. RLS Supabase dove configurata

Variabili pubbliche essenziali:

```env
NEXT_PUBLIC_TENANT_SLUG=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=
```

Variabili server-only tipiche:

```env
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
PACKLINK_API_KEY=
```

Le Preview Vercel e Production possono avere configurazioni env differenti. Una differenza
visiva o dati mancanti tra Preview e Production non deve essere interpretata automaticamente
come bug del codice: verificare prima le env e il tenant effettivamente risolto.

---

## 5. Route groups principali

### Storefront shop

Le pagine cliente vivono prevalentemente in:

```text
apps/storefront/src/app/(shop)/
```

Il modulo shop comprende, tra le altre aree:

- homepage;
- catalogo `/products`;
- product detail;
- cart;
- checkout;
- conferma ordine;
- account `/compte`;
- ordini cliente;
- indirizzi;
- loyalty/referral dove integrati.

### Digital Card

Route indipendente:

```text
apps/storefront/src/app/card/
```

La card non è una semplice loyalty card: è diventata un hub mobile del tenant con:

- identità/branding tenant;
- informazioni pratiche;
- location fisica;
- Google Maps URL configurabile;
- metodi di pagamento;
- Quick Pay carta;
- componenti dedicati come `CardQuickPay`, `CardLocation`,
  `PaymentMethodsAccordion`, `DigitalCard`.

### Événementiel

Route group dedicato:

```text
apps/storefront/src/app/(evenementiel)/
```

È deliberatamente separato dal layout shop standard e dispone di header/footer/pagine
pubbliche dedicate.

### Admin

```text
apps/storefront/src/app/admin/
```

L'area protetta usa Supabase Auth e il modello `admin_users`.

### API

```text
apps/storefront/src/app/api/
```

Le API Next.js coprono checkout, shipping, customer cart/account, admin, eventi, rental,
pagamenti, notifiche e integrazioni applicative.

---

## 6. Catalogo e storefront commerce

Il catalogo `/products` è oggi la superficie commerce primaria e mobile-first.

Stato UI/UX corrente da preservare:

- search molto prominente;
- search sticky;
- eliminazione/riduzione di heading ridondanti che sottraevano spazio ai prodotti;
- `Nos univers`:
  - mobile: scroller orizzontale;
  - tablet/desktop: grid;
  - comportamento motion rispettoso di `prefers-reduced-motion`;
  - immagini categoria con fallback basato sulle immagini prodotto reali;
- product grid più densa;
- ProductCard ottimizzata per mobile;
- quick-add con target touch adeguato;
- prezzi promozionali reali quando disponibili (`compare_at_price`);
- business logic cart invariata dalle modifiche puramente visuali.

La PWA è orientata all'apertura del catalogo; verificare `src/app/manifest.ts` prima di cambiare
la destinazione iniziale.

Non reintrodurre hero/banner/heading ridondanti nel catalogo senza motivazione prodotto.

---

## 7. Cart: stato, sync e UX

### Stato client

Il cart usa Zustand:

```text
src/stores/cartStore.ts
```

Persistenza guest in `localStorage`.

### Sync cross-device

Per utenti autenticati il cart è sincronizzato server-side con optimistic concurrency control.

Componenti logici principali:

```text
src/lib/cart/
src/stores/cartStore.ts
src/components/cart/CartSyncProvider.tsx
```

Protocollo attuale:

- mutation tipizzate:
  - `add`
  - `set_quantity`
  - `remove`
  - `clear`
- client optimistic;
- coda pendente persistita;
- debounce/retry/backoff;
- gestione offline;
- 409 = riconciliazione con stato canonico, non overwrite;
- merge login idempotente;
- isolamento della coda per customer;
- logout non deve lasciare il carrello del cliente come guest cart.

Server:

```text
POST /api/customers/me/cart
```

Payload logico:

```ts
{
  expectedVersion,
  mutations
}
```

La migrazione di riferimento è:

```text
070_cart_versioning.sql
```

e usa l'RPC atomica `apply_cart_mutations()`.

Documentazione tecnica:

```text
docs/CART_SYNC.md
```

### Cart Drawer

Il desktop header non è più obbligato a navigare immediatamente a `/cart`: esiste un Mini
Cart / Cart Drawer dedicato, costruito senza una libreria Dialog esterna.

Componenti di riferimento in `components/cart/` includono:

- `CartDrawer`
- `CartDrawerHeader`
- `CartItem`
- `CartQuantityControl`
- `CartDrawerFooter`
- `CartDrawerEmpty`
- `CartUndoToast`

`/cart` resta la pagina completa di gestione carrello.

---

## 8. Account cliente

La pagina `/compte` è stata riprogettata come dashboard account responsive.

Principi correnti:

- mobile lineare e leggibile;
- desktop composto, non semplice colonna mobile ingrandita;
- loyalty prominente;
- reminder ambassadeur secondario;
- accesso a tutti gli indirizzi salvati;
- azione `Ajouter` con target touch adeguato;
- navigazione account compatta;
- logout visivamente secondario;
- focus visibile e contrasto dell'accent tenant verificabile;
- non inventare route o meccaniche loyalty non esistenti.

File rilevanti includono:

```text
apps/storefront/src/app/(shop)/compte/AccountDashboard.tsx
apps/storefront/src/components/.../LoyaltyCardWidget.tsx
```

Verificare sempre il path reale del widget prima di modificarlo.

---

## 9. Nala / shopping assistant

Il repository integra un assistente shopping branded **Nala**.

File di riferimento:

```text
apps/storefront/src/components/chat/ChatWidget.tsx
```

Identità approvata:

- nome: `Nala`;
- sottotitolo: `Assistant shopping par Lepefy`;
- primary indipendente dal tenant: `#6D5AF6`;
- launcher mobile inizialmente esteso;
- stato persistente compatto icon-only dopo onboarding/scroll;
- il launcher non deve coprire ProductCard o competere con il catalogo;
- suggested prompts passano attraverso il flusso chat esistente.

Non ribrandizzare Nala con i colori tenant salvo decisione prodotto esplicita.

---

## 10. Pagamenti — architettura corrente

I pagamenti Stripe hanno oggi una base UI/client condivisa.

Componente centrale:

```text
apps/storefront/src/components/payments/StripePaymentStep.tsx
```

Responsabilità correnti del componente:

- inizializzazione `Elements`;
- `PaymentElement`;
- locale Stripe;
- warning prima del pagamento;
- funnel logging;
- `elements.submit()`;
- creazione differita del PaymentIntent tramite callback `createIntent`;
- `stripe.confirmPayment`;
- `return_url`;
- gestione `redirect: 'if_required'`;
- protezione `beforeunload` mentre `isConfirming`;
- auto-centering del blocco pagamento;
- rispetto di `prefers-reduced-motion`;
- CTA pagamento:
  - desktop inline;
  - mobile sticky bottom;
- padding mobile per evitare che la CTA copra il form.

Locale supportata dal wrapper:

```ts
'auto' | 'fr' | 'it'
```

Il default corrente del wrapper è francese, mentre i caller possono esplicitare una locale
diversa quando necessario (per esempio `/card`).

### Payment modules

La configurazione Stripe è modulare e usa `PaymentModule` / config client-server dedicata.
Non assumere che ogni modulo condivida necessariamente le stesse chiavi o gli stessi metodi.

### Funnel logging

La tabella condivisa `payment_funnel_logs` raccoglie eventi del funnel tra i moduli di pagamento.
Il `reference_id` deve restare coerente per il tentativo/modulo.

Non rimuovere funnel logging durante refactor UI.

---

## 11. Événementiel — stato reale al 22 agosto 2026

Il modulo Événementiel è molto più evoluto della prima implementazione documentata nelle
revisioni storiche.

### Layout pubblico

File principali:

```text
apps/storefront/src/app/(evenementiel)/layout.tsx
apps/storefront/src/app/(evenementiel)/_components/EventsHeader.tsx
apps/storefront/src/app/(evenementiel)/_components/EventsFooter.tsx
```

Header:

- usa il vero `tenant.logo_url`;
- non applicare inversioni/filtri cosmetici arbitrari al logo;
- non aggiungere lockup testuali inventati;
- CTA `Voir les dates` visibile anche su mobile;
- menu mobile separato.

### Hub `/evenementiel`

File:

```text
apps/storefront/src/app/(evenementiel)/evenementiel/page.tsx
```

Il redesign corrente comprende:

- hero più compatto;
- featured event;
- cards eventi;
- CTA di prenotazione più esplicita;
- pricing reale ricavato dai ticket type attivi;
- urgenza/disponibilità visiva;
- sezioni servizi;
- immagini reali da database quando disponibili.

Disponibilità evento:

- `0`: completo;
- capacità molto bassa: stato rosso / urgenza alta;
- capacità intermedia: amber;
- capacità ampia: verde.

Non inventare prezzi, posti, date o immagini.

### Immagini eventi

Componente:

```text
apps/storefront/src/components/evenementiel/EventImageFader.tsx
```

Il componente deve mantenere:

- fallback visivo dietro le immagini;
- positioning del caller;
- stacking context locale (`isolate`) per evitare che overlay interni blocchino hero/CTA;
- nessun overlay che intercetti pointer events dei contenuti sovrapposti.

### Dettaglio evento e checkout

File principali:

```text
apps/storefront/src/app/(evenementiel)/evenementiel/evenements/[slug]/page.tsx
apps/storefront/src/app/(evenementiel)/evenementiel/evenements/[slug]/EventCheckoutClient.tsx
```

La state machine checkout resta:

```text
select -> info -> select-payment -> payment
```

Questa sequenza è parte del comportamento approvato e non va alterata per un semplice redesign.

Il flusso preserva:

- ticket type reali;
- pricing server-side;
- controllo capacità;
- customer info;
- draft/recovery;
- Stripe;
- external payment links quando configurati;
- stati pending;
- conferma/QR dopo successo.

### Stripe eventi: card-only

Per il pagamento Stripe interno dell'evento, il codice corrente è **card-only**.

Client `StripePaymentStep`:

```ts
module === 'event'
=> paymentMethodTypes: ['card']
```

Server:

```text
apps/storefront/src/app/api/events/[id]/checkout/route.ts
```

crea il PaymentIntent con:

```ts
payment_method_types: ['card']
```

Quindi Satispay/Klarna/Amazon Pay/Bancontact/EPS non devono comparire nel Payment Element
dell'evento.

Questo non elimina automaticamente gli **external payment links** configurati dal tenant:
quelli sono un percorso separato.

### API checkout evento

L'API corrente:

- verifica `events_enabled`;
- valida nome/email;
- valida formato email;
- valida quantità ticket;
- verifica tenant/event/status;
- rilegge ticket type e prezzi dal database;
- non si fida del prezzo client;
- effettua controllo preliminare capacità;
- delega la garanzia atomica definitiva a `reserve_event_capacity()` al momento corretto del
  workflow;
- crea metadata `type: event_reservation`;
- logga `intent_created`.

### Stati pending e ticket

Sono presenti pagine dedicate per:

- pending payment evento;
- pending payment rental;
- confirmation rental;
- ticket pubblico via QR token.

File noti:

```text
.../evenements/[slug]/en-attente/PendingEventPaymentClient.tsx
.../services/[slug]/en-attente/PendingRentalPaymentClient.tsx
.../services/[slug]/confirmation/RentalConfirmationClient.tsx
.../billet/[qr_token]/page.tsx
```

---

## 12. Services / Catering / Rental

All'interno del route group Événementiel esistono due famiglie da non confondere:

1. **services / devis**, per esempio catering;
2. **rental / location matériel**, con basket e checkout dedicati.

File rappresentativi:

```text
apps/storefront/src/app/(evenementiel)/evenementiel/services/[slug]/page.tsx
apps/storefront/src/app/(evenementiel)/evenementiel/services/[slug]/DevisForm.tsx
apps/storefront/src/app/(evenementiel)/evenementiel/services/[slug]/RentalCheckoutClient.tsx
```

`RentalItem` non dispone di una description libera da inventare. I campi applicativi noti sono:

```ts
id
tenant_id
service_offering_id
name
category
price_per_unit
stock_quantity
image_url
active
sort_order
```

Non generare testo descrittivo falso per un rental item se il dato non esiste nel modello.

---

## 13. `/card` — digital card e location fisica

La card contiene una sezione location esplicitamente progettata per rispondere a:

> dove si trova il negozio fisico?

e:

> come apro il percorso?

Configurazione tenant:

```text
tenant.google_maps_url
```

Il link deve essere:

- validato;
- configurabile dall'admin;
- passato alla card;
- aperto esattamente come configurato.

Il design corrente evita deliberatamente:

- Google Maps iframe;
- API Google Maps;
- API key;
- geolocalizzazione;
- tile/mappe finte;
- logo Google simulato;
- nomi strada/geografia inventati.

`CardLocation` può usare una preview astratta/direzionale, ma deve restare chiaramente
decorativa e onesta.

Migrazione:

```text
supabase/migrations/071_tenant_google_maps_url.sql
```

Admin:

```text
/admin/(protected)/parametres/
api/admin/tenant
```

Tipi:

```text
packages/types/tenant.ts
apps/storefront/src/lib/supabase/types.ts
```

### Quick Pay

`CardQuickPay` usa il pagamento Stripe condiviso e deve mantenere il `return_url`/recovery.
La UI Stripe può essere localizzata in base al contesto card.

---

## 14. Admin

L'area admin è protetta da Supabase Auth lato Server Component/layout.

Ruoli applicativi:

- `platform_owner`
- `tenant_admin`
- `tenant_cashier`

Guard di riferimento:

```text
src/lib/auth/requireAdmin.ts
```

Regole importanti:

- `platform_owner`: accesso globale secondo il guard;
- tenant roles: tenant scope obbligatorio;
- `tenant_cashier`: percorso operativo più ristretto;
- team management è platform-only;
- non creare accessi admin basati solo su UI hiding.

Il modello `admin_users` è la fonte applicativa per ruolo, tenant e active state.

---

## 15. Loyalty / QR / scanner

La piattaforma contiene loyalty/referral e flussi scanner QR.

`html5-qrcode` è già dipendenza del progetto.

Il componente scanner deve proteggere `stop()` anche da eccezioni sincrone e non assumere
che lo scanner sia sempre in stato `SCANNING` o `PAUSED`.

Non duplicare scanner implementations se una componente condivisa già soddisfa il caso d'uso.

---

## 16. Shipping

Packlink resta l'integrazione di spedizione principale.

La logica shipping deve essere trattata come business logic sensibile:

- packaging;
- peso;
- parcel splitting;
- provider quote;
- VAT;
- surcharge;
- country rules;
- eventuali regole tenant.

Non semplificare il calcolo dal frontend.

Esistono configurazioni/migrazioni successive per shipping country rules e simulatori admin:
prima di cambiare comportamento leggere l'implementazione attuale in `src/lib/shipping/`
e le relative route admin/API.

---

## 17. Notifiche

Il codice corrente include configurazione destinatari notifiche tenant.

Migrazione:

```text
supabase/migrations/071_tenant_notification_recipients.sql
```

Helper:

```text
apps/storefront/src/lib/notifications/getNotificationRecipients.ts
```

API admin:

```text
apps/storefront/src/app/api/admin/notification-recipients/
```

Non hardcodare indirizzi destinatari in nuove route se il caso è coperto da questa
configurazione.

---

## 18. Database e migrations

Le migrations sono la fonte versionata dello schema.

### Cart versioning

```text
070_cart_versioning.sql
```

### Collisione di numerazione nota

Sul `main` attuale esistono **due migrations con prefisso 071**:

```text
071_tenant_google_maps_url.sql
071_tenant_notification_recipients.sql
```

Questa è una incoerenza reale del repository.

**Regola:** non rinominare retroattivamente migrations già potenzialmente applicate a DB remoti
senza una procedura di migrazione esplicita. Per nuove migration usare un numero successivo e
documentare la collisione.

### Stato DB remoto

La presenza di un file SQL nel repository **non prova** che sia già applicato in ogni ambiente
Supabase. Prima di fare diagnosi su Preview/Production distinguere:

- migration presente nel repo;
- migration applicata nel DB;
- env Vercel che punta a quel DB.

---

## 19. Supabase clients

Usare il client corretto per contesto.

Browser:

```text
src/lib/supabase/client.ts
```

Server:

```text
src/lib/supabase/server.ts
```

Le operazioni privilegiate/service-role devono restare server-only.

Non esporre `SUPABASE_SERVICE_ROLE_KEY`.

---

## 20. UI conventions

Lingua principale storefront corrente: **francese**.

Eccezioni/localizzazioni esistono dove deliberate, per esempio `/card`.

Convenzioni:

- Tabler Icons;
- focus visibile;
- target touch >= ~44px dove interattivo;
- responsive mobile-first;
- safe areas su CTA fixed/mobile bottom;
- `prefers-reduced-motion` per motion automatica;
- niente dati fake per completare mockup;
- tenant branding da DB;
- non alterare logo tenant con filtri se non esplicitamente previsto;
- UI premium sì, business logic no-touch quando il task è visuale.

---

## 21. Regole per modifiche future

Prima di modificare un modulo:

1. leggere il file corrente su `main`;
2. leggere i caller e i tipi;
3. identificare API/migration coinvolte;
4. verificare se il componente è condiviso;
5. evitare regressioni su shop/event/rental/card;
6. non dedurre schema da vecchie note;
7. preservare tenant isolation;
8. preservare funnel/payment recovery;
9. non inventare dati;
10. eseguire almeno typecheck quando l'ambiente lo consente.

Per una modifica puramente UI:

- non cambiare route;
- non cambiare schema;
- non cambiare checkout semantics;
- non cambiare pricing/calcoli;
- non cambiare auth;
- non cambiare payment method configuration;
- salvo che il task lo richieda esplicitamente.

---

## 22. File ad alto impatto

Prima di toccare questi file verificare tutti i caller:

```text
apps/storefront/src/components/payments/StripePaymentStep.tsx
apps/storefront/src/stores/cartStore.ts
apps/storefront/src/lib/cart/*
apps/storefront/src/lib/shipping/*
apps/storefront/src/lib/tenant/getTenant.ts
apps/storefront/src/lib/supabase/*
apps/storefront/src/app/api/checkout/*
apps/storefront/src/app/api/events/*
apps/storefront/src/app/(evenementiel)/*
apps/storefront/src/app/(shop)/checkout/*
packages/types/*
supabase/migrations/*
```

---

## 23. Known inconsistencies / technical debt

### 23.1 Duplicate migration prefix `071`

Confermato sul `main`:

```text
071_tenant_google_maps_url.sql
071_tenant_notification_recipients.sql
```

Non correggere con rename distruttivo senza conoscere lo stato dei DB remoti.

### 23.2 `CLAUDE.md` non è completamente aggiornato

Il file dichiara ancora:

> There is no test suite yet.

ma `apps/storefront/package.json` contiene `test:unit` e `test:e2e`.

`CLAUDE.md` resta utile per l'architettura di base ma non va considerato più autorevole del
codice o di questo snapshot aggiornato.

### 23.3 Le note storiche del precedente `LEPEFY_PROJECT_CONTEXT.md`

Il precedente documento incorporava moltissimi report di sessione, inclusi stati temporanei
come “non pushato”, branch locali, test eseguiti in sessioni precedenti e gap branch/main poi
superati.

Queste informazioni non sono affidabili come descrizione dello stato attuale.

Da v4.0:

- questo file descrive lo **stato corrente**;
- `git log` conserva lo storico;
- i test vanno dichiarati “verdi” solo se eseguiti sul commit in questione;
- non riutilizzare risultati di typecheck/CI di commit precedenti come prova sul commit corrente.

### 23.4 Test/CI

Questo audit è documentale e di codebase. Non dedurre che l'ultimo `main` sia verde solo perché
revisioni precedenti dichiaravano typecheck/test verdi.

---

## 24. Ultimi filoni entrati su `main` prima di questo snapshot

I commit recenti su `main` mostrano questi filoni:

### 21 agosto 2026

- Google Maps URL tenant per `/card`;
- admin/schema/types/seed collegati;
- `CardLocation` azionabile;
- preview astratta direzioni;
- redesign completo Événementiel:
  - header/footer;
  - hub;
  - service pages;
  - rental;
  - event detail;
  - checkout;
  - pending states;
  - rental confirmation;
  - public ticket;
  - image fader;
  - logo tenant corretto.

### 22 agosto 2026

- affinamenti hub/dettaglio/booking mobile;
- availability e pricing sulle cards evento;
- contact step più compatto;
- trust cues;
- mobile payment step;
- Stripe event card-only;
- shared sticky payment CTA;
- auto-centering Stripe form;
- warning/protezione active payment;
- locale Stripe condivisa;
- `/card` localizzata sul wrapper condiviso.

Il commit di riferimento di questo snapshot è:

```text
dd1e0f8270a6671705e0271293acdb42cb56ba9c
fix(card): localize shared Stripe payment UI
```

---

## 25. Cosa NON assumere

Non assumere che:

- ogni migration repo sia applicata in Production;
- Preview e Production puntino allo stesso Supabase project;
- il tenant seed corrisponda ai valori runtime;
- un prezzo mostrato in un vecchio screenshot sia hardcoded;
- un metodo Stripe disponibile in Dashboard debba apparire in ogni modulo;
- shop/event/rental/card possano essere modificati insieme senza verificare i caller;
- una descrizione di rental item esista;
- il logo Chloe possa essere ricostruito come testo;
- una Google Maps preview possa simulare una mappa reale;
- una nota storica “test verdi” valga per l'ultimo commit.

---

## 26. Checklist rapida prima di consegnare codice

### Repo

- [ ] ho letto `main` attuale;
- [ ] conosco il commit di base;
- [ ] diff limitato allo scope;
- [ ] nessun file generato/spazzatura incluso.

### TypeScript

- [ ] `pnpm typecheck` eseguito, oppure dichiarato esplicitamente non eseguito.

### Payments

- [ ] nessun `return_url` rimosso;
- [ ] `StripePaymentStep` condiviso verificato sui caller;
- [ ] event card-only preservato;
- [ ] external-link flow non confuso con Stripe Payment Element;
- [ ] funnel logging preservato;
- [ ] mobile sticky CTA non copre contenuto.

### Events

- [ ] state machine `select -> info -> select-payment -> payment` preservata;
- [ ] prezzi riletti dal DB/server;
- [ ] capacità preservata;
- [ ] logo da `tenant.logo_url`;
- [ ] nessun dato fake.

### Cart

- [ ] niente accesso diretto a internals del sync engine da UI;
- [ ] mutation semantics preservate;
- [ ] conflitti 409 non trasformati in overwrite.

### Tenant

- [ ] `tenant_id` filtrato;
- [ ] config da tenant quando prevista;
- [ ] nessun secret esposto.

### UX

- [ ] mobile verificato;
- [ ] desktop verificato;
- [ ] touch target;
- [ ] focus;
- [ ] reduced motion;
- [ ] safe-area per elementi fixed.

---

## 27. Regola di manutenzione di questo file

Aggiornare questo documento quando cambia uno di questi elementi:

- architettura;
- route/module principali;
- schema/migrations significative;
- payment architecture;
- auth/roles;
- cart sync;
- shipping;
- tenant config;
- feature cross-cutting;
- convenzioni permanenti.

Non aggiungere un nuovo paragrafo “cronaca della sessione” per ogni micro-fix.

Per i micro-fix usare commit message / PR.

Quando si aggiorna questo documento:

1. impostare data;
2. indicare commit `main` auditato;
3. correggere la sezione corrente;
4. aggiungere technical debt reale;
5. rimuovere affermazioni superate;
6. non dichiarare test eseguiti se non verificati sul commit.

---

# Fine snapshot v4.0

**Audit reference:** `main @ dd1e0f8270a6671705e0271293acdb42cb56ba9c`  
**Data:** 22 agosto 2026  
**Obiettivo:** descrivere la situazione reale del codebase, non la cronologia delle conversazioni.
