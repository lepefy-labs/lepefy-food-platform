# Lepefy Food Platform — Project Context

> Documento operativo di riferimento per Codex / Claude Code / sviluppatori.
>
> **Aggiornato:** 2 settembre 2026 — **v6.30 Current-State Snapshot**
>
> **Source of truth:** codice del repository `lepefy-labs/lepefy-food-platform`. Per lo stato deployed prevalgono branch/commit effettivamente promossi e migration realmente applicate.

---

## 1. Piattaforma e stack

Lepefy Food è una piattaforma SaaS food multi-tenant con storefront commerce, admin tenant, pagamenti, shipping, loyalty/referral, digital card, Nala e modulo Événementiel.

Principi:
- unica codebase multi-tenant;
- isolamento dati tramite `tenant_id` e RLS dove previsto;
- Next.js App Router + TypeScript;
- Supabase DB/auth;
- Stripe per pagamenti carta;
- Packlink per shipping;
- Zustand per cart;
- storefront brandizzato tenant; admin con identità piattaforma Lepefy e co-branding tenant nel journey di accesso.

Monorepo principale:

```text
apps/storefront/
packages/types/
supabase/migrations/
docs/
scripts/
AGENTS.md
LEPEFY_PROJECT_CONTEXT.md
```

---

## 2. Multi-tenancy, domini e workspace

Il tenant applicativo è ancora risolto principalmente da `NEXT_PUBLIC_TENANT_SLUG`; `getTenant()` e le query applicative filtrano per `tenant_id`.

`tenants.storefront_url` è l'URL canonico Boutique. Il dominio Events resta configurato tramite `NEXT_PUBLIC_EVENTS_SUBDOMAIN`; `next.config.mjs` usa rewrite host-based nello stesso deployment Vercel.

Admin Core unico, due workspace UX:

```text
shop host   -> workspace shop
events host -> workspace events
```

Resolver canonico: `src/lib/admin/workspace.ts`.

La navigazione admin e la ricerca globale sono permission-aware. Lo switch workspace è mostrato solo se l'utente possiede almeno una capability della surface destinazione.

### Storefront routing, Catalogue, navigation e PWA

Le route storefront canoniche sono:

```text
/                     -> Catalogue storefront
/accueil              -> pagina editoriale “Découvrir”
/products             -> redirect permanente 308 verso /
/products/[slug]      -> Product Detail, invariato
```

La root `/` possiede ricerca, filtro categoria e paginazione tramite query string (`?q=`, `?category=`, `?page=`). I link di navigazione al Catalogue puntano direttamente a `/`; il logo storefront continua a puntare a `/`. La pagina editoriale secondaria è esposta in UI come **Découvrir**, non “Accueil”.

La navigazione storefront mobile usa `BottomNav` per le destinazioni operative frequenti e un drawer laterale per esplorazione e servizi secondari. Il drawer è data-driven in base alla configurazione tenant. Su desktop le destinazioni principali restano visibili nell'header e lo stesso drawer è accessibile come menu secondario.

Il pattern di drawer è condiviso da Shop ed Events tramite `BrandNavigationDrawer`: overlay, Escape/backdrop, body scroll lock, focus ring, safe-area footer, social e legal sono implementati una sola volta; ogni surface passa sezioni e capability proprie.

Sul dominio Events la navigazione pubblica usa URL pulite (`/`, `/evenements/[slug]`, `/services/[slug]`) mentre le route interne `/evenementiel/**` restano l'implementazione App Router raggiunta tramite rewrite host-based. I link verso Traiteur/Location/Galerie sono esposti solo se esistono contenuti pubblici attivi.

La PWA usa `start_url: '/'` e lo shortcut prodotti punta a `/`; il service worker pre-cachea la root canonica.

---

## 3. Admin authorization — RBAC dinamico

Il modello authorization canonico è:

```text
auth.users
   -> admin_users (identità/profilo)
   -> admin_memberships (utente + tenant/global)
   -> admin_roles
   -> admin_role_permissions
   -> admin_permissions (catalogo capability stabile)
```

Tabelle introdotte da `085_admin_rbac_permissions.sql` / `086_admin_rbac_role_permission_rpc.sql`:
- `admin_roles`;
- `admin_permissions`;
- `admin_role_permissions`;
- `admin_memberships`;
- `admin_access_audit`.

`admin_users.role` e `admin_users.tenant_id` restano compatibility mirror temporanei, non source of truth di lungo periodo.

Ruoli sistema:
- `platform_owner`: global, protetto;
- `tenant_admin`: accesso completo tenant, protetto;
- `tenant_cashier`: capability operative cassa/scanner;
- `admin_scanner` / “Service repas”: solo scanner Events.

Il Platform Owner gestisce ruoli, permissions e memberships da `/admin/platform/access`. I ruoli tenant custom possono essere creati senza deploy componendo capability esistenti.

### Semantica system role

`platform_owner` bypassa tutte le capability applicative.

`tenant_admin` è contrattualmente “full tenant admin”: `canAdmin()` considera valido qualsiasi permesso non `platform.*` anche se una capability appena deployata non è ancora stata materializzata in `admin_role_permissions`.

Gli altri ruoli, inclusi i custom role, ricevono esclusivamente le capability persistite nel DB.

---

## 4. Enforcement API admin

`src/lib/auth/adminRbac.ts` fornisce `getAdminAccessContext()`, `canAdmin()` e `requirePermission()`.

Scanner usa direttamente `requirePermission()` capability-per-capability.

Le API admin legacy che chiamano ancora `requireAdmin()` sono capability-driven:

```text
/api/admin request
   -> middleware.ts (solo /api/admin/*)
   -> x-lepefy-admin-path + x-lepefy-admin-method
   -> adminApiPermissions.ts
   -> business capability
   -> requirePermission()
```

`apps/storefront/src/lib/auth/adminApiPermissions.ts` è la mappa canonica method+route → capability. La mappa è **fail-closed**.

Capability principali:

```text
orders.view
orders.manage
shop_payments.confirm
catalog.view
catalog.manage
shipping.view
shipping.manage
loyalty.manage
loyalty.scan
growth.manage
growth.payouts.manage
ai_knowledge.manage
events.view
events.manage
event_capacity.manage
event_reservations.view
event_reservations.manage
event_payments.view
event_payments.confirm
event_payments.cancel
event_payments.refund
event_content.manage
scan.access
scan.search
scan.redeem
scan.metrics
scan.undo_own
scan.undo_any
tenant_settings.view
tenant_settings.manage
billing.view
ai_usage.view
platform.*
```

Le capability money-moving/manual-financial sono isolate e `critical`. La creazione di una prenotazione Events già incassata in negozio è mappata esplicitamente a `event_payments.confirm`, non alla generica `event_reservations.manage`.

La modifica della capacità vendabile di un evento è isolata nella capability `event_capacity.manage`. Il CRUD generico `events.manage` non può più modificare `capacity_total`; l'unico percorso applicativo supportato è l'endpoint dedicato `/api/admin/evenementiel/events/[id]/capacity`, che usa l'RPC atomica `adjust_event_capacity`.

---

## 5. Profilo e onboarding admin

`admin_users` contiene `first_name`, `last_name`, `nickname`, `phone` opzionale e `profile_completed_at`.

Al primo accesso un admin senza profilo completo viene indirizzato a `/admin/onboarding`; la modalità `/admin/onboarding?edit=1` è reversibile.

Login, onboarding e accept-invite usano co-branding coerente: Lepefy come piattaforma, logo/nome tenant come organizzazione operativa, fallback iniziali se manca il logo e colori admin Lepefy indipendenti dai colori tenant.

---

## 6. Boundary Platform / Tenant

Console Platform interna Lepefy:

```text
/admin/platform
/admin/platform/access
/admin/platform/ai-usage
/admin/platform/notifications
/admin/team
```

`/admin/platform/**` ha guard server-side platform-owner-only aggiuntivo. `/admin/team` resta gestione utenti amministrativi cross-tenant e non è il futuro Team self-service tenant.

`public.platform_branding` resta singleton service-role-only.

---

## 7. Platform billing

`084_platform_billing_boundary.sql` separa il billing SaaS dal tenant; `094_feature_entitlements_foundation.sql` normalizza il catalogo e la risoluzione delle feature commerciali:

```text
platform_billing_settings
platform_plans
platform_features
platform_plan_features
tenant_subscriptions
tenant_feature_overrides
tenant_feature_settings
```

`platform_features` è il catalogo canonico estensibile delle capability commerciali. `platform_plan_features.feature_key` referenzia il catalogo senza CHECK hardcoded. `tenant_feature_overrides` contiene soltanto eccezioni temporali o permanenti al piano (`manual`, `addon`, `trial`, `promotion`); in assenza di una riga il tenant eredita il piano attivo. Catalogo e override sono service-role-only, con RLS e nessuna policy browser.

`src/lib/entitlements/tenantEntitlements.ts` è il resolver canonico server-side: un override applicabile secondo `starts_at` / `expires_at` prevale sull'entitlement del piano. `tenant_feature_settings` è invece il layer canonico di configurazione operativa, separato da piani, billing e override commerciali. Nala è disponibile soltanto quando coesistono entitlement commerciale `nala` e setting operativo `nala.enabled`; assenza del setting o errori di risoluzione fanno fallire il gating in modo chiuso senza interrompere lo storefront.

`src/lib/admin/platformBilling.ts` resta il resolver dello snapshot billing; `/admin/billing` legge piano, features, subscription e coordinate Lepefy dal dominio platform con fallback legacy temporaneo.

`nala_analytics` è una capability commerciale distinta da `nala`, inclusa nel piano all-inclusive `food-platform`. La raccolta è fail-closed: un errore del resolver analytics non interrompe Nala e non produce scritture. `nala_sessions` e `nala_interactions` conservano conversazioni, associazione cliente nullable, pagina sorgente, locale, device category e geografia approssimativa derivata server-side (country/region/city); non conservano IP, user-agent, fingerprint o cookie analytics. Il target di retention raw è 90 giorni tramite RPC service-role-only, da collegare a uno scheduler giornaliero approvato. Conversion Attribution V1 è implementata come capability commerciale separata `nala_conversion_attribution`. Il browser conserva solo touch minimizzati in `sessionStorage`, con finestra esatta di 30 minuti e last qualifying touch per prodotto. Il server riconvalida tenant, entitlement, interaction/session, finestra temporale e appartenenza del prodotto a `matched_product_ids`; tenant, prezzi, currency e valore assistito non sono mai autorevoli dal browser. La dashboard Nala non è ancora implementata.\n\nIl semantic enrichment Nala è asincrono e separato dal chat path: la migration `097_nala_semantic_enrichment.sql` aggiunge intent/confidence, demand status, retrieval quality, knowledge status, requested product text e stato/versione operativi direttamente a `nala_interactions`. La taxonomy V1 comprende intent prodotto, availability/price/recommendation/substitution, recipe, delivery/store/event information, order/payment help, complaint, small talk, other e unknown. `requested_product_text` è una frase derivata massima di 150 caratteri, non una copia del messaggio, e viene eliminata con la stessa retention della riga.\n\nIl dispatcher `.github/workflows/nala-semantic-enrichment.yml` richiama ogni 10 minuti la route service-role-only `/api/internal/nala-semantic-enrichment`. L'RPC `claim_nala_interactions_for_enrichment` usa `FOR UPDATE SKIP LOCKED`, batch massimo 25, recovery claim dopo 15 minuti e massimo tre tentativi (`pending -> processing -> completed | failed`). Small talk è completato deterministicamente senza AI. Le altre righe usano `gemini-2.5-flash-lite`, JSON strutturato validato e solo message/reply/outcome più nomi prodotto e contesto KB associati; identità, sessione, geografia e device non entrano nel prompt. Il costo è tracciato separatamente in `ai_usage_log` con endpoint `nala_semantic_enrichment`. La conversion attribution riusa `matched_product_ids` come source of truth del retrieval e non duplica un evento `product_retrieved`; la dashboard resta fuori scope.

Nala Structured Product Actions V1 estende `/api/chat` con action `add_to_cart` server-validate e user-confirmed. La UI mostra al massimo una card compatta per risposta e usa `cartStore.addItem(..., 1)`, quindi riutilizza sync, drawer e Conversion Attribution. Le action restano metadata UI e non entrano nella history testuale inviata a Gemini. La copy action usa il locale storefront esplicito risolto da `localeStore` e dalle locale supportate dal tenant; `navigator.language` non è source of truth e il fallback resta francese.

Product Relationships V1 introduce `product_relationships`, layer direzionale tenant-scoped con tipi distinti `similar`, `substitute` e `complementary`. Le relazioni persistenti `manual` precedono `system`; all'interno della stessa source una priority numerica maggiore viene prima. Il trigger DB verifica che source e target appartengano al tenant, vieta self relation e duplicati, e le foreign key eliminano le relazioni con il prodotto. RLS non concede accesso browser: admin e Nala operano server-side con service role e authorization `catalog.view/manage`.

Il resolver canonico `src/lib/catalog/productRelationships.ts` restituisce prodotti canonici acquistabili. Dopo manual/system, `similar` può completare tramite embedding con preferenza di categoria; `substitute` richiede stessa categoria, alta similarità e disponibilità; `complementary` resta explicit-only. Il fallback semantico non viene persistito. Nala applica guard conversazionali deterministiche, non effettua una seconda AI call e mantiene una sola action per turno. Il type `direct|similar|substitute|complementary` accompagna l'action; il prompt riceve soltanto la relazione già validata e vieta affermazioni “identico” o “sostituto perfetto”.

`nala_interactions.action_product_ids` e `action_relationship_types` mantengono distinti prodotti retrieved e prodotti effettivamente emessi come action. Conversion Attribution qualifica entrambi senza falsificare `matched_product_ids`; cart, checkout e purchase restano invariati e fail-open rispetto all'analytics. Il tenant gestisce le relazioni dal tab “Produits associés” dell'editor catalogo con ricerca reale, add/remove, priority e active toggle. Nala Cart Builder V1 riconosce intent recipe/meal con guard deterministiche leggere e usa la stessa chiamata Gemini principale per produrre reply + ingredienti strutturati (4–6 preferiti, massimo 8), senza product ID, prezzi o stock generati dall'AI. Il server esegue embedding batch degli ingredienti, risolve in parallelo prodotti canonici tenant-safe e purchasable, quindi applica direct match forte, substitute esplicito/manual-first o fallback semantico conservativo; complementary non viene usato come sostituto e un match incerto resta unavailable.

La proposta è client-safe e legata all'interaction tramite UUID logico. Il flusso richiede due consensi: apertura della preview e bulk add finale dei soli item selezionati; un follow-up “Oui” espande soltanto l'ultima proposta ancora pendente. Quantità sempre 1, massimo 8 SKU, nessun quantity editor o calcolo confezioni. Il bulk add riusa `cartStore.addItem()`, protegge dal doppio click, mantiene i successi in caso di errore parziale e apre il drawer esistente tramite `cartUiStore`. I prodotti proposti restano separati dal retrieval in `action_product_ids`; direct/substitute descrivono il match catalogo mentre recipe resta l'intent/action context. Gli eventi add-to-cart, checkout e purchase continuano nella Conversion Attribution esistente. Locale: storefront/tenant, fallback FR, mai `navigator.language`.

Non esiste un recipe database né una tabella `nala_cart_plans`: V1 mantiene il piano nel turn client-side e usa interaction metadata + conversion events esistenti per misurare proposta/accettazione senza una seconda pipeline. Dashboard, meal planner, automatic quantity optimization, collaborative filtering e persistenza delle ricette restano fuori scope.

Le vecchie colonne billing in `tenants` restano compatibilità e non vanno rimosse senza migration dedicata.

---

## 8. Cart / checkout Shop

Modello canonico:

```text
cart -> checkout_session -> pagamento confermato -> order
```

L'attribuzione Nala è un sidecar best-effort e non cambia questo state machine. `nala_checkout_attributions` lega per prodotto il checkout all'ultima interaction qualificante e sopravvive a resume/reuse; `nala_conversion_events` registra solo `add_to_cart`, `checkout_started` e `purchase_completed`. La purchase viene scritta dopo le `order_items` da una RPC idempotente e usa il subtotale lordo reale delle sole righe assistite, prima di sconti order-level e shipping. Errori o schema analytics non disponibile non bloccano carrello, checkout, pagamento o ordine.

Checkout session lifecycle:

```text
open -> completed | cancelled | expired
open + external handoff -> awaiting_verification
awaiting_verification -> completed | cancelled | open
```

Recovery canonica: `/checkout/reprendre/[id]`; legacy `/orders/en-attente/[id]` redirige lì. Le conferme manuali di pagamento esterno Shop sono protette dalla capability critica `shop_payments.confirm`.

---

## 9. Pagamenti condivisi

Componente centrale: `apps/storefront/src/components/payments/StripePaymentStep.tsx`. Verificare tutti i caller shop/events/rental/card prima di modificarlo.

`payment_funnel_logs` è cross-module.

---

## 10. Événementiel

External payment requests usano `event_reservation_requests`:

```text
pending -> confirmed | stock_conflict | cancelled
```

Finché `pending`, nessuna capacità è riservata. La conferma admin crea la reservation con capacity-check server-side. L'annullo non rimborsa automaticamente il provider.

Quando una nuova request `external_link` viene creata con successo, l'applicazione invia un alert interno best-effort al tenant tramite n8n (`/webhook/event-external-payment-awaiting-verification`). I destinatari sono risolti da `tenant_notification_recipients` con `notify_external_payment_pending = true`; nessun indirizzo è hardcoded. La CTA porta direttamente a `/admin/evenementiel/paiements-en-attente/[requestId]`. Un errore di notifica non annulla né fallisce la request già creata e non modifica la capacità. Il contratto del payload è documentato in `docs/EVENT_EXTERNAL_PAYMENT_TENANT_ALERT.md`.

Le prenotazioni pagate direttamente nel negozio fisico seguono invece un flusso admin diretto da evento → `Réservations` → `Ajouter une réservation`. L'admin seleziona formule e quantità, inserisce i dati cliente e conferma che il pagamento è già stato incassato in negozio. Il server ricalcola il totale dai prezzi correnti delle formule attive, verifica tenant/evento, usa lo stesso `reserve_event_capacity` atomico degli altri flussi e crea immediatamente una normale `event_reservations` `confirmed` con QR e items. Non viene creata una `event_reservation_requests` intermedia.

`event_reservations` traccia l'origine tramite:
- `source`: `online | external_link | admin_in_store`;
- `payment_method`: `stripe | external_link | in_store`;
- `created_by_admin_id`: admin che ha registrato l'incasso in negozio, nullable per i flussi cliente.

La funzione condivisa `createEventReservationFromRequest()` resta il punto canonico per capacity decrement, creazione reservation/items, QR e notifica di conferma. Le prenotazioni `admin_in_store` entrano quindi senza percorsi paralleli in scanner, report, liste e codici A5. Il rimborso Stripe resta disponibile solo per reservation che possiedono un `stripe_payment_intent_id`; una vendita fisica non viene marcata come rimborsata automaticamente dalla piattaforma senza un flusso di rimborso offline dedicato.

### Chiusura prenotazioni online

Gli eventi possono definire `events.booking_closes_at` come deadline opzionale e modificabile dall'admin. Se il campo è `NULL`, il comportamento storico resta invariato. Quando è valorizzato, la pagina pubblica aumenta progressivamente l'urgenza nelle ultime 24/6/2 ore e nasconde il checkout una volta raggiunta la scadenza.

La deadline è enforcement server-side, non solo UI: sia `/api/events/[id]/checkout` sia `/api/events/[id]/checkout-external-link` rifiutano nuove richieste dopo `booking_closes_at`, prima di creare rispettivamente un PaymentIntent Stripe o una `event_reservation_requests`. La chiusura riguarda esclusivamente i canali pubblici: le prenotazioni manuali `admin_in_store` restano disponibili per vendite o eccezioni gestite dal personale. L'admin API valida che `booking_closes_at` preceda `date_start`.

### Report automatici alla chiusura

Migration `093_event_booking_close_reports.sql` rende automatico l'invio al tenant dei tre export operativi già disponibili in admin:

- CSV dettagliato delle prenotazioni;
- lista prenotazioni stampabile PDF;
- codici prenotazione A5 PDF.

L'orario effettivo è:

```text
booking_closes_at ?? (date_start - booking_close_reports_fallback_hours)
```

`booking_close_reports_fallback_hours` default `2`, configurabile già alla creazione evento e successivamente nella card `Réservations en ligne`. La migration calcola `booking_close_reports_scheduled_for` anche per eventi esistenti; gli eventi già iniziati non vengono mai inviati retroattivamente. Un evento futuro già dentro la finestra fallback diventa immediatamente eleggibile.

Il dispatcher canonico è `.github/workflows/event-booking-close-reports.yml`, schedulato ogni 5 minuti e avviabile anche manualmente. Lo script `scripts/process-event-booking-close-reports.mjs` usa le credenziali Supabase service-role già previste nei GitHub Actions, seleziona solo eventi futuri dovuti e chiama l'applicazione sul dominio canonico del tenant.

Il dispatcher invoca `/api/events/internal/booking-close-reports` con `eventId` e token opaco `booking_close_reports_dispatch_token`. L'RPC service-role-only `claim_event_booking_close_reports` implementa claim atomico/idempotente e recovery di sender bloccati dopo 15 minuti. Stati:

```text
pending -> sending -> sent
             |       
             -> error -> retry dispatcher
```

La route rigenera i tre file dalla sorgente canonica `loadEventReservationExportData()` al momento dell'invio, quindi include solo reservation ancora utilizzabili (`confirmed` + `quantity_remaining > 0`). Consegna n8n via `/webhook/event-booking-closed-reports` con tre attachment base64. Destinatari: `tenant_notification_recipients.notify_event_booking_closed_reports = true`, default true per destinatari esistenti. Errori di generazione/trasporto portano a `error` e vengono ritentati dal dispatcher; successo imposta `booking_close_reports_sent_at` e impedisce duplicati. Contratto: `docs/EVENT_BOOKING_CLOSE_REPORTS.md`.

### Visibilità dei posti restanti

Ogni evento può configurare `events.show_remaining_places`. Il default è `true`, quindi gli eventi esistenti mantengono la visualizzazione numerica già in uso. Il tenant admin modifica l'opzione dalla card `Réservations en ligne` insieme alla deadline.

Quando `show_remaining_places = false`, le surface pubbliche Events non espongono il numero esatto di `capacity_remaining`: home, card, dettaglio e messaggi di urgenza usano soltanto stati qualitativi (`Places disponibles`, `Places limitées`, `Presque complet`, `Complet`). La capacità reale resta invariata e continua a essere visibile nell'admin e usata integralmente dai controlli server-side di disponibilità/checkout.

### Gestione capacità evento

Il tenant admin può aumentare o ridurre la capacità dalla card `Occupation` del résumé evento tramite `Gérer la capacité`. L'azione è visibile solo a chi supera il controllo server-side `event_capacity.manage`.

La capacità non viene più modificata dal PATCH generico evento. L'endpoint dedicato usa `adjust_event_capacity`, che:
- acquisisce un lock sulla riga `events`;
- calcola le places già riservate da `capacity_total - capacity_remaining`;
- rifiuta qualsiasi nuova capacità inferiore alle places già riservate;
- aggiorna insieme `capacity_total` e `capacity_remaining`;
- registra la variazione in `event_capacity_adjustments` con delta, motivo, admin e timestamp.

La riduzione di capacità non annulla, rimborsa o invalida prenotazioni esistenti. Se la capacità fisica desiderata è inferiore alle prenotazioni già confermate, l'admin deve prima gestire le prenotazioni interessate tramite i flussi appropriati.

Capability finanziarie Events:
- `event_payments.view`;
- `event_payments.confirm`;
- `event_payments.cancel`;
- `event_payments.refund`.

Scanner canonico `/scan?event_id=<id>` usa ledger `event_reservation_item_redemptions` ed è capability-driven end-to-end.

La surface pubblica Events ha `EventsHeader`/`EventsFooter` propri ma usa il drawer cross-surface condiviso con lo Shop. L'header ricava le capability di navigazione dai record pubblici attivi. La CTA header punta al prossimo evento quando esiste, altrimenti al contatto; il footer privilegia WhatsApp rispetto all'e-mail quando configurato.

La home Events tratta il prossimo evento come primary conversion object: hero contestuale, disponibilità reale, data/ora e CTA verso il dettaglio. Gallery e servizi restano data-driven.

Gli eventi possono avere una `on_site_price_list_image_url`: carta prezzi informativa per piatti/bevande acquistabili e pagabili sul posto, separata da `event_ticket_types`, checkout e capacità prenotabile.

Gli export operativi delle prenotazioni evento (CSV, lista fallback A4 e codici A5) includono solo prenotazioni ancora utilizzabili: `status = confirmed` e `quantity_remaining > 0`. Il dettaglio formule usa il residuo per riga calcolato da `event_reservation_item_redemptions` non annullati.

---

## 11. AI usage

Accounting tecnico interno: `ai_usage_log`, `ai_pricing`, `ai_usage_monthly_by_tenant`.

`/admin/platform/ai-usage` mostra costi/provider solo Platform. `/admin/ai-usage` mostra al tenant utilizzo prodotto senza provider/model/token/costo tecnico.

---

## 12. Login admin e sicurezza

Password/OTP supportano `next` solo relativo/same-origin. Non esiste ancora SSO esplicito cross-subdomain shop/events.

Tabelle RBAC: RLS enabled, nessuna policy browser; operazioni tramite service role server-side.

Le route personali di sicurezza/profilo restano accessibili indipendentemente dalle business permissions.

---

## 13. Digital Card / shipping / notifiche

`/card` è hub tenant; location usa `tenant.google_maps_url`, senza Google Maps API/iframe.

Packlink resta provider shipping principale. `shipping.view` separa consultazione/operazioni da `shipping.manage` per le regole di configurazione.

`docs/NOTIFICATION_JOURNEY_V1.md` resta riferimento notifiche; `tenant_notification_recipients` è source of truth destinatari interni. Gli alert pagamento esterno Shop/Events condividono `notify_external_payment_pending` ma webhook/payload distinti. Gli eventi aggiungono `notify_event_booking_closed_reports` per i tre report automatici di chiusura.

---

## 14. Migration recenti

La presenza nel repo non prova l'applicazione in ogni Supabase remoto.

```text
074_checkout_recovery_lifecycle.sql
075_external_payment_verification.sql
079_tenant_storefront_url.sql
080_external_payment_tenant_notifications.sql
081_event_gallery_social_share.sql
082_event_checkin_operations.sql
083_event_external_payment_cancellation.sql
084_platform_billing_boundary.sql
085_admin_rbac_permissions.sql
086_admin_rbac_role_permission_rpc.sql
087_admin_rbac_completion_permissions.sql
088_event_on_site_price_list.sql
089_event_manual_reservations.sql
090_event_capacity_management.sql
091_event_booking_closes_at.sql
092_event_remaining_places_visibility.sql
093_event_booking_close_reports.sql
094_feature_entitlements_foundation.sql
095_nala_conversation_analytics.sql
096_tenant_feature_settings.sql
097_nala_semantic_enrichment.sql
098_nala_conversion_attribution.sql
099_nala_product_relationships.sql
```

`087` aggiunge le capability emerse dal full admin authorization audit e le assegna ai system role `platform_owner` e `tenant_admin`; non amplia automaticamente alcun custom role.

`088` aggiunge il campo nullable `events.on_site_price_list_image_url`; non modifica formule, disponibilità, checkout o pagamenti.

`089` è additiva: aggiunge a `event_reservations` `source`, `payment_method` e `created_by_admin_id`, effettuando un backfill deterministico dell'historico (`stripe_payment_intent_id` presente → online/stripe, assente → external_link/external_link). Abilita la tracciabilità delle prenotazioni incassate in negozio senza cambiare il modello di capacità o QR.

`090` è additiva: introduce `event_capacity_adjustments`, la capability `event_capacity.manage` e l'RPC `adjust_event_capacity`. L'RPC rende atomiche le modifiche di capacità e impedisce di scendere sotto le places già prenotate. La capability viene assegnata ai system role `platform_owner` e `tenant_admin`; i custom role non vengono ampliati automaticamente.

`091` è additiva: introduce `events.booking_closes_at` nullable. Gli eventi esistenti non ricevono backfill e conservano il comportamento precedente; quando valorizzata, la deadline chiude i checkout pubblici Events ma non le prenotazioni manuali admin.

`092` è additiva: introduce `events.show_remaining_places boolean NOT NULL DEFAULT true`. L'opzione controlla esclusivamente la disclosure pubblica del numero residuo; non modifica capacità, disponibilità reale, checkout o prenotazioni.

`093` è additiva ma operativa: introduce configurazione fallback report, schedule/dispatch/idempotency su `events`, flag destinatario `notify_event_booking_closed_reports`, trigger di calcolo schedule, backfill degli eventi esistenti e RPC di claim service-role-only. Non modifica checkout, prezzi, capacità o pagamenti.

`094` è additiva: introduce il catalogo `platform_features`, sostituisce il CHECK hardcoded di `platform_plan_features.feature_key` con una foreign key, include `nala` nel piano `food-platform` e crea gli override sparsi `tenant_feature_overrides`.

`095` è additiva: introduce l'entitlement `nala_analytics`, le tabelle service-role-only `nala_sessions` e `nala_interactions`, la risoluzione atomica delle sessioni e la purge raw a 90 giorni. I customer sono referenziati solo per UUID nullable; geografia e metadata sono minimizzati. Lo scheduling giornaliero della purge resta da collegare a infrastruttura approvata.

`096` introduce `tenant_feature_settings` come configuration layer operativo service-role-only, effettua il backfill verificato del toggle Nala per ogni tenant e rimuove dal current schema il boolean legacy. I nuovi tenant senza setting Nala restano operationally disabled per default.\n\n`097` è additiva e operativa: estende `nala_interactions` con classificazioni semantiche controllate, stato/versione/tentativi, indici dashboard-ready e claim RPC service-role-only concurrency-safe. Le righe esistenti restano eleggibili e vengono drenate in piccoli batch; small talk viene completato senza AI. Il worker scheduled non modifica outcome, chat response, retrieval o retention.

`098` è additiva e service-role-only: introduce l'entitlement `nala_conversion_attribution`, la lineage prodotto/checkout `nala_checkout_attributions`, gli eventi conversione durevoli e la RPC idempotente `record_nala_purchase_attribution`. La purge delle conversazioni porta a `NULL` solo i riferimenti session/interaction; product ID, checkout/order ID, quantità, prezzi snapshot e gross assisted value restano disponibili per reporting.

`099` è additiva e service-role-only: introduce `product_relationships` con semantica direzionale, vincoli same-tenant/self/duplicate, priority e source manual/system. Estende `nala_interactions` con metadata action separati dal retrieval per qualificare correttamente similar/substitute/complementary nelle conversioni. Non effettua backfill e la tabella può restare vuota; in quel caso il direct retrieval continua, similar/substitute possono usare fallback sicuri e complementary non viene inventato.

---

## 15. UI conventions

Admin/storefront principale in francese. Tabler Icons, mobile-first, touch target ~44px+, focus visibile, safe-area, reduced motion, niente dati fake.

Storefront usa branding tenant. Admin usa branding Lepefy con tenant identity contestuale nei touchpoint di accesso.

---

## 16. File/moduli ad alto impatto

```text
apps/storefront/middleware.ts
apps/storefront/src/lib/auth/adminRbac.ts
apps/storefront/src/lib/auth/adminApiPermissions.ts
apps/storefront/src/lib/auth/adminRoutePermissions.ts
apps/storefront/src/lib/auth/requireAdmin.ts
apps/storefront/src/components/layout/BrandNavigationDrawer.tsx
apps/storefront/src/components/payments/StripePaymentStep.tsx
apps/storefront/src/components/checkout-session/*
apps/storefront/src/stores/cartStore.ts
apps/storefront/src/lib/cart/*
apps/storefront/src/lib/checkout/*
apps/storefront/src/lib/shipping/*
apps/storefront/src/lib/tenant/getTenant.ts
apps/storefront/src/lib/admin/workspace.ts
apps/storefront/src/lib/admin/platformBilling.ts
apps/storefront/src/lib/ai/*
apps/storefront/src/lib/notifications/*
apps/storefront/src/app/api/admin/*
apps/storefront/src/app/admin/*
apps/storefront/src/app/scan/*
packages/types/*
supabase/migrations/*
```

---

## 17. Known technical debt

- collisione storica prefisso migration `071`: non rinominare retroattivamente;
- telefono checkout non uniformemente server-enforced;
- legacy `CheckoutForm.tsx`: verificare caller prima della rimozione;
- abandoned-checkout outbound automatico non abilitato senza policy consenso/timing;
- tenant resolution resta deployment/env-based (`NEXT_PUBLIC_TENANT_SLUG`);
- URL Events resta temporaneamente env-based;
- SSO esplicito cross-subdomain shop/events non introdotto;
- colonne billing legacy in `tenants` restano temporaneamente;
- Console Platform non è ancora CRUD completo di piani/tenant;
- tenant Team self-service non esiste ancora;
- `admin_users.role/tenant_id` restano compatibility mirror finché tutti i job/script non saranno auditati e migrati;
- le API admin legacy mantengono il nome helper `requireAdmin()` per compatibilità, ma l'enforcement è già capability-driven tramite `adminApiPermissions.ts`;
- AI credits predisposti semanticamente ma non monetizzati/applicati.

---

## 18. Checklist delivery

Prima di consegnare codice:
- target/base SHA verificati;
- diff limitato allo scope;
- tenant isolation e authorization preservati;
- nessun secret esposto;
- project context aggiornato quando cambia architettura;
- migration remota verificata quando necessaria;
- remote validation sullo SHA finale;
- Vercel `READY` quando applicabile.

---

# Fine snapshot v6.30

**Base audit:** `main @ Nala Cart Builder V1`
**Data:** 2 settembre 2026
**Obiettivo:** descrivere lo stato architetturale corrente, non la cronologia delle conversazioni.
