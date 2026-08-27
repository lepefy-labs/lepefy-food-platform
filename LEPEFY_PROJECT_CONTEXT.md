# Lepefy Food Platform — Project Context

> Documento operativo di riferimento per Codex / Claude Code / sviluppatori.
>
> **Aggiornato:** 27 agosto 2026 — **v5.8 Current-State Snapshot**
>
> **Source of truth:** codice del repository `lepefy-labs/lepefy-food-platform`. Per lo stato deployed prevalgono branch/commit effettivamente promossi e migration realmente applicate.

---

## 1. Cos'è Lepefy Food Platform

Lepefy Food è una piattaforma SaaS e-commerce **multi-tenant** per attività food, con storefront commerce, back-office tenant, pagamenti e checkout, shipping/logistica, loyalty/referral, digital card, assistente shopping Nala e modulo Événementiel con eventi, servizi e rental.

Principi architetturali:
- unica codebase multi-tenant;
- isolamento dati tramite `tenant_id` e RLS dove previsto;
- Next.js App Router;
- Supabase per database/auth;
- Stripe per pagamenti carta;
- Packlink per shipping;
- Zustand per cart client;
- TypeScript condiviso tramite `@lepefy/types`;
- branding storefront tenant e branding admin piattaforma separati.

---

## 2. Monorepo e stack

```text
lepefy-food-platform/
├─ apps/storefront/
├─ packages/types/
├─ supabase/migrations/
├─ docs/
├─ scripts/
├─ AGENTS.md
├─ CLAUDE.md
├─ INTEGRATION.md
└─ LEPEFY_PROJECT_CONTEXT.md
```

Package manager: pnpm workspaces. Stack principale: Next.js 14.2.35, React 18.3.1, TypeScript, Tailwind, Supabase, Stripe, Zustand, React Hook Form, Zod, Tabler Icons, Playwright, `html5-qrcode`, Google GenAI e React Markdown.

---

## 3. Multi-tenancy, domini e branding

Il tenant applicativo è ancora risolto principalmente da `NEXT_PUBLIC_TENANT_SLUG`, quindi `getTenant()`, CSS custom properties tenant e query filtrate per `tenant_id`.

L'URL pubblico canonico della Boutique è `tenants.storefront_url`; `NEXT_PUBLIC_APP_URL`/fallback legacy non devono prevalere quando `storefront_url` è configurato.

Il modulo pubblico Événementiel può essere esposto su sottodominio dedicato tramite `NEXT_PUBLIC_EVENTS_SUBDOMAIN`; `next.config.mjs` usa rewrite host-based `beforeFiles` per instradare la surface events nello stesso deployment.

Il progetto Vercel corrente può quindi servire più surface dello stesso tenant (`shop.*`, `events.*`) dallo stesso deployment. Questa è una soluzione intermedia: multi-tenant nel codice/dati, ma tenant resolution ancora deployment/env-based. Una futura infrastruttura host→tenant potrà sostituire `NEXT_PUBLIC_TENANT_SLUG` senza cambiare il concetto di surface/workspace.

`/admin/**` usa platform branding (`public.platform_branding`) indipendente dai colori tenant.

---

## 4. Route groups principali

```text
apps/storefront/src/app/(shop)/          # shop/cart/checkout/compte/orders
apps/storefront/src/app/(evenementiel)/  # modulo pubblico eventi
apps/storefront/src/app/card/            # digital card / quick pay
apps/storefront/src/app/admin/           # admin core condiviso
apps/storefront/src/app/scan/            # service repas operativo
apps/storefront/src/app/api/             # API e webhook
```

---

## 5. Catalogo `/products`

Superficie commerce primaria mobile-first. Preservare search sticky, `Nos univers`, product grid densa, ProductCard mobile, quick-add accessibile, pricing promo da dati reali e `prefers-reduced-motion`. La PWA è orientata al catalogo.

---

## 6. Cart e checkout shop

Il cart usa Zustand con persistenza guest e sync server-side per utenti autenticati con optimistic concurrency (`expectedVersion`). `/cart` modifica basket e avvia checkout; shipping, indirizzo e contatti appartengono al checkout. Nala è esclusa dal purchase funnel.

Modello checkout canonico:

```text
cart -> checkout_session -> pagamento confermato -> order
```

Una checkout session non è un ordine. Lifecycle principale:

```text
open -> completed | cancelled | expired
open + external provider handoff -> awaiting_verification
awaiting_verification -> completed | cancelled | open
```

Per cliente autenticato e tenant esiste al massimo una sessione `open`. Guest resume tramite token firmato. PaymentIntent Stripe viene riusato/aggiornato quando possibile. Route canonica recovery: `/checkout/reprendre/[id]`; legacy `/orders/en-attente/[id]` redirige lì.

Stock non riservato alla nascita della checkout session; pricing, stock, shipping quote/token, discount, PaymentIntent e completion restano server-side. `payment_funnel_logs` e `checkout_funnel_30d` coprono lifecycle/recovery. Payment Recovery v1 è manuale e limitato alle external-link unresolved.

Telefono checkout: UI obbligatoria ma alcune API shop modellano ancora `phone?: string | null`; technical debt da trattare in uno scope checkout dedicato.

---

## 7. Nala

Identità: `Nala`, “Assistant shopping par Lepefy”, primary `#6D5AF6`, tenant-independent. Non appare in `/cart`, `/checkout*` e superfici purchase funnel correlate.

---

## 8. Pagamenti condivisi

Componente centrale: `apps/storefront/src/components/payments/StripePaymentStep.tsx`. Non modificarlo senza verificare tutti i caller shop/event/rental/card. `payment_funnel_logs` è cross-module.

---

## 9. Admin — core condiviso, workspace e ruoli

Ruoli applicativi invariati: `platform_owner`, `tenant_admin`, `tenant_cashier`. `admin_users` resta la fonte per ruolo/tenant/active; authorization server-side obbligatoria anche se una voce è nascosta in UI.

L'admin è modellato come **un solo Admin Core con due workspace UX**:

```text
request host
   ├─ shop host   -> workspace `shop`
   └─ events host -> workspace `events`
```

Il resolver canonico è `src/lib/admin/workspace.ts`. Non introdurre env separate per “admin shop/admin events”.

Workspace Boutique:
- Commandes / Funnel checkout / Catalogue;
- Clients/Promotions quando disponibili;
- Slides accueil;
- Opérations: Scan fidélité, Livraison;
- Croissance: Fidélité / Parrainage, Ambassadeurs, IA.

Workspace Événementiel:
- Vue d’ensemble;
- Événements;
- Réservations / Paiements;
- Demandes traiteur;
- Locations;
- Galerie / Contenu;
- Service repas / Scan.

Paramètres, Abonnement e strumenti platform_owner restano condivisi. La stessa shell, auth, API, DB e design system servono entrambi i workspace.

Lo switch Boutique→Événementiel usa `NEXT_PUBLIC_EVENTS_SUBDOMAIN` tramite resolver centralizzato. Lo switch Événementiel→Boutique usa **`tenant.storefront_url` come source of truth canonica**.

Su host events, `/admin` viene riscritto internamente verso `/admin/evenementiel`, mantenendo nel browser l'entry point `events.<tenant>/admin` e riusando l'overview eventi.

`tenant_cashier` viene indirizzato alla superficie operativa coerente col workspace: scan fidélité sullo shop, `/scan` sull'host events.

---

## 10. Admin Commandes / external payment operations

Nel workspace Boutique, `/admin` è il workspace operativo ordini. La queue **Paiements en attente** riguarda external-link senza `order_id`, separata dagli ordini. Stato canonico dopo provider handoff: `awaiting_verification`.

Workflow fulfillment:

```text
new -> preparing -> shipped -> delivered
new -> preparing -> ready_for_pickup -> delivered
```

Payment status e fulfillment status restano separati. La dashboard ordini privilegia stati operativi azionabili e nasconde le priorità a zero; il blocco external payments è comprimibile e non cambia il workflow di conferma pagamento.

---

## 11. Événementiel

Route group pubblico `apps/storefront/src/app/(evenementiel)/`. Checkout evento ha state machine propria e non va confuso con `checkout_sessions` shop.

### Social sharing

`event_gallery_photos` è source of truth immagini. `is_social_share` marca foto approvate. Social card 9:16 server-side tramite `/api/evenementiel/events/[slug]/social-card?photo=<gallery-photo-id>`.

### Prenotazioni e biglietti

`event_reservations` nasce solo dopo conferma del pagamento/confirmation flow previsto. Il QR token resta stabile. Quantità acquistate in `event_reservation_items`.

### Scanner / Service repas

Superficie operativa canonica:

```text
/scan?event_id=<event-id>
```

La legacy `/admin/evenementiel/scan` redirige alla surface `/scan`, preferendo il dominio events configurato.

Lo scanner è vincolato all'evento: lookup, conferma, ricerca fallback e undo verificano tenant + `event_id`.

Flusso:

```text
camera scan -> preview prenotazione -> conferma formule -> success -> ritorno scanner
```

Camera primaria; ricerca manuale fallback per nome, e-mail, telefono, QR o riferimento completo. Biglietto interamente utilizzato mostra STOP esplicito e nessuna quantità redimibile. L'RPC di redemption mantiene lock e controllo atomico del residuo.

Modello dati:

```text
reservation -> reservation_items -> item_redemptions
```

`event_reservation_item_redemptions` è source of truth canonica per redemption/audit, quantità parziali e soft-void. `event_reservation_redemptions` è legacy storico.

Scanner online-only per scan/ricerca/conferma/undo; API `force-dynamic`/`force-no-store`; KPI live con breakdown per formula.

Migration `082_event_checkin_operations.sql` aggiunge `checkin_opens_at` e `checkin_closes_at` nullable. `NULL` significa nessuna restrizione temporale. Preview e POST verificano entrambi la finestra.

Undo:
- `tenant_cashier`: annulla solo propria redemption entro 5 minuti;
- `tenant_admin` / `platform_owner`: override più ampio, motivo obbligatorio nei casi previsti;
- undo sempre soft-void.

---

## 12. Login admin e destinazione

Password login e OTP supportano un parametro `next` **solo relativo e same-origin** (`/…`, mai `//…`). Questo permette `/scan -> /admin/login?next=/scan -> /scan` senza introdurre open redirect.

Non esiste ancora SSO cross-subdomain esplicito. Le sessioni Supabase non vengono estese intenzionalmente a `.tenant-domain`; un eventuale SSO shop/events è uno scope auth/security separato.

---

## 13. Digital Card `/card`

Hub mobile tenant. Location usa `tenant.google_maps_url`; niente iframe/API Maps o geografia simulata. Quick Pay usa payment engine condiviso ma resta dominio indipendente dagli ordini shop.

---

## 14. Shipping

Packlink resta integrazione principale. Packaging, peso, splitting, quote, VAT, surcharge, country e tenant rules sono business logic sensibile; frontend non source of truth del costo.

---

## 15. Notifiche

Spec: `docs/NOTIFICATION_JOURNEY_V1.md`. n8n è trasporto/orchestrazione; stato ordine/checkout, recipient resolution e payload restano source of truth nell'app. `tenant_notification_recipients` è source of truth destinatari interni.

---

## 16. AI usage, product value e unit economics

L'AI usa due livelli distinti che non vanno confusi:

### Accounting tecnico Lepefy

`public.ai_usage_log` è la source of truth per chiamate tecniche AI per tenant: endpoint, provider, model, token, immagini, status e `estimated_cost_usd`. `public.ai_pricing` mantiene il listino provider. `public.ai_usage_monthly_by_tenant` aggrega per mese/provider/endpoint.

Questi dati sono **service-role only** e rappresentano cost accounting interno. Provider, model e costo industriale non devono essere esposti come valore commerciale al tenant.

La console `/admin/platform/ai-usage` è riservata a `platform_owner` e mostra chiamate/costi provider del tenant corrente per il controllo unit economics.

### Utilizzo prodotto tenant

`src/lib/ai/productUsage.ts` è il layer semantico canonico che traduce endpoint tecnici in feature prodotto stabili:
- Nala — Assistant shopping;
- Recherche intelligente;
- Descriptions produits;
- Images produits;
- Indexation catalogue;
- Base de connaissance IA;
- fallback `Autres usages IA` per endpoint futuri non ancora classificati.

Ogni feature definisce label tenant, unità d'uso e `creditWeight`. Il `creditWeight` è **solo predisposizione architetturale**: non esistono ancora quota mensile commerciale, overage, blocco o supplemento fatturato.

`/admin/billing` mostra ai tenant solo utilizzo per funzionalità e il messaggio che l'AI è attualmente inclusa nell'abbonamento. La pagina tenant non interroga più provider/model/costo.

Quando verrà definita una policy commerciale, entitlement/limiti/credit pack/overage dovranno essere introdotti in uno scope billing dedicato e persistente; non derivare mai il prezzo tenant direttamente dal costo provider.

---

## 17. Database / migrations

La presenza di una migration nel repo non prova che sia applicata in ogni Supabase remoto.

AI accounting attuale deriva dalla migration `027_ai_rate_limiting_cost_tracking.sql`; il layer product usage introdotto nello snapshot v5.8 **non richiede una nuova migration**.

Numerazione recente:

```text
074_checkout_recovery_lifecycle.sql
075_external_payment_verification.sql
079_tenant_storefront_url.sql
080_external_payment_tenant_notifications.sql
081_event_gallery_social_share.sql
082_event_checkin_operations.sql
```

Il refactor admin workspace non ha richiesto migration: riusa `tenants.storefront_url` già esistente e l'attuale env events.

---

## 18. Supabase / auth

Browser: `src/lib/supabase/client.ts`. Server/service: `src/lib/supabase/server.ts`. Operazioni service-role server-only. Checkout guest supportato. Signed link Payment Recovery usa token HMAC esistente.

---

## 19. UI conventions

Lingua storefront/admin principale: francese. Tabler Icons, mobile-first, touch target ~44px+, focus visibile, safe-area, reduced motion, niente dati fake, storefront branding tenant, admin branding piattaforma.

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
apps/storefront/src/lib/admin/workspace.ts
apps/storefront/src/lib/ai/*
apps/storefront/src/lib/notifications/*
apps/storefront/src/app/api/checkout/*
apps/storefront/src/app/api/checkout-sessions/*
apps/storefront/src/app/api/admin/evenementiel/scan/*
apps/storefront/src/app/api/webhooks/stripe/*
apps/storefront/src/app/admin/*
apps/storefront/src/app/scan/*
packages/types/*
supabase/migrations/*
```

---

## 21. Known inconsistencies / technical debt

- collisione storica prefisso migration `071`: non rinominare retroattivamente;
- telefono checkout non uniformemente server-enforced;
- legacy `CheckoutForm.tsx`: verificare caller prima della rimozione;
- abandoned-checkout outbound automatico non abilitato senza policy consenso/timing;
- admin external-payment confirm/cancel richiede controllo concurrency;
- `event_reservation_redemptions` è legacy storico;
- tenant resolution resta deployment/env-based (`NEXT_PUBLIC_TENANT_SLUG`); futura evoluzione consigliata: registry host/domain→tenant senza cambiare il resolver surface/workspace;
- URL Events resta temporaneamente env-based; futuro modello consigliato: registry `tenant_domains` o equivalente;
- SSO esplicito cross-subdomain shop/events non ancora introdotto;
- catalogo feature/credit weight AI è oggi applicativo; quando esisterà una vera policy commerciale multi-plan dovrà evolvere verso entitlement/config persistente senza perdere la separazione da `ai_pricing` provider.

---

## 22. Cambiamenti strutturali correnti

### Admin / piattaforma

- platform branding separato;
- Admin Core condiviso con workspace Boutique/Événementiel risolti dall'host;
- switch workspace centralizzato;
- `tenant.storefront_url` canonico per tornare alla Boutique;
- host events `/admin` riusa overview Événementiel;
- `/scan` separato dalla shell admin;
- login admin supporta destinazione `next` same-origin;
- utilizzo AI tenant separato dai costi provider interni Lepefy.

### Cart / checkout

Purchase-intent persistente, una open session per cliente autenticato, `awaiting_verification` durevole, PaymentIntent reuse, recovery route canonica, signed reminder link, audit lifecycle e alert tenant external payment.

### Événementiel

- social kit da gallery approvata;
- scanner orientato al service repas e vincolato a `event_id`;
- camera primaria, ricerca senza QR fallback;
- STOP biglietto esaurito;
- KPI breakdown formula;
- online-only;
- ledger granulare canonico;
- undo policy tracciata.

### AI

- raw provider accounting in `ai_usage_log`/`ai_pricing` resta interno;
- product usage tenant aggregato tramite `productUsage.ts`;
- `/admin/billing` espone valore/utilizzo, non costi industriali;
- `/admin/platform/ai-usage` espone costi tecnici solo a `platform_owner`;
- credits predisposti semanticamente ma non ancora monetizzati né applicati.

---

## 23. Checklist e manutenzione

Prima di consegnare codice:
- target/base SHA verificati;
- diff limitato allo scope;
- tenant isolation, auth/roles, pricing/stock/payment preservati;
- nessun secret esposto;
- project context aggiornato quando cambia architettura;
- remote validation sullo SHA finale;
- Vercel `READY` quando applicabile.

Aggiornare questo file quando cambiano architettura, route/module principali, workflow business, schema/migration significative, payment/checkout, auth, cart sync, shipping, tenant/platform config o feature cross-module. Non trasformarlo in changelog.

---

# Fine snapshot v5.8

**Base audit:** `main @ AI usage product/platform separation`  
**Data:** 27 agosto 2026  
**Obiettivo:** descrivere la situazione architetturale reale del codebase, non la cronologia delle conversazioni.
