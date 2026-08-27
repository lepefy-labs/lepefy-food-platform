# Lepefy Food Platform — Project Context

> Documento operativo di riferimento per Codex / Claude Code / sviluppatori.
>
> **Aggiornato:** 27 agosto 2026 — **v6.2 Current-State Snapshot**
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
- branding storefront tenant separato dal branding admin Lepefy.

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

`tenants.storefront_url` è l'URL canonico Boutique. Il dominio Events è ancora configurato tramite `NEXT_PUBLIC_EVENTS_SUBDOMAIN`; `next.config.mjs` usa rewrite host-based nello stesso deployment Vercel.

Admin Core unico, due workspace UX:

```text
shop host   -> workspace shop
events host -> workspace events
```

Resolver canonico: `src/lib/admin/workspace.ts`.

Workspace Boutique: Commandes, Funnel checkout, Catalogue, Slides, Scan fidélité, Livraison, Fidélité/Parrainage, Ambassadeurs, IA.

Workspace Événementiel: Vue d’ensemble, Événements, Réservations/Paiements, Demandes traiteur, Locations, Galerie/Contenu, Service repas/Scan.

La navigazione admin è permission-aware: un utente vede solo le capability assegnate al proprio ruolo/membership. Lo switch tra workspace è mostrato solo se esiste almeno una capability per la surface destinazione.

---

## 3. Admin authorization — RBAC dinamico

L'authorization admin sta evolvendo da tre ruoli hardcoded a un modello RBAC dinamico gestibile dal Platform Owner.

Modello target/canonico introdotto dalle migration `085_admin_rbac_permissions.sql` e `086_admin_rbac_role_permission_rpc.sql`:

```text
auth.users
   -> admin_users (identità/profilo)
   -> admin_memberships (utente + tenant/global)
   -> admin_roles
   -> admin_role_permissions
   -> admin_permissions (catalogo capability stabile)
```

Tabelle:
- `admin_roles`: ruoli dinamici, scope `tenant|platform`, flag `is_system`;
- `admin_permissions`: catalogo capability applicative stabili, raggruppate per modulo e risk level;
- `admin_role_permissions`: composizione ruolo→permission;
- `admin_memberships`: ruolo di un admin in un tenant o globalmente a livello platform;
- `admin_access_audit`: audit di creazione/modifica ruoli, membership e profilo.

`admin_users.role` e `admin_users.tenant_id` restano temporaneamente come **compatibility mirror** durante la migrazione progressiva. Non sono il modello authorization di lungo periodo.

Ruoli sistema seed:
- `platform_owner`: global, protetto;
- `tenant_admin`: tutte le permission tenant;
- `tenant_cashier`: capability operative compatibili col vecchio ruolo;
- `admin_scanner` / “Service repas”: solo scanner Events.

Il Platform Owner può creare nuovi **ruoli tenant** da `/admin/platform/access`, assegnare/togliere capability esistenti e assegnare un ruolo a un utente/tenant senza deploy applicativo. I ruoli sistema sono visibili ma non modificabili dalla UI.

Le permission sono capability di business, non route HTTP, per esempio:

```text
orders.view
catalog.manage
event_payments.confirm
scan.access
scan.redeem
scan.undo_own
scan.undo_any
billing.view
platform.roles.manage
```

Una nuova tipologia di ruolo può essere creata senza codice combinando capability già note al prodotto. Una nuova capability applicativa richiede invece che il codice della funzionalità la faccia rispettare almeno una volta.

### Migrazione progressiva e fail-closed

`src/lib/auth/adminRbac.ts` è il resolver RBAC canonico e fornisce context + `canAdmin()` + `requirePermission()`.

Il rollout è progressivo per evitare un big-bang sull'access control:
- con le nuove tabelle disponibili, membership/role/permissions sono la source of truth;
- prima dell'applicazione remota delle migration 085/086, i ruoli legacy noti mantengono un fallback compatibile;
- un codice ruolo dinamico sconosciuto **non eredita** privilegi tenant_admin sui vecchi endpoint;
- le route admin mappate a capability sono protette server-side dal layout e la sidebar usa lo stesso set di permission;
- le API devono migrare gradualmente da `requireAdmin(...allowedRoles)` a `requirePermission()`.

**Scanner / Service repas è il primo modulo completamente capability-driven end-to-end**: pagina `/scan`, preview, search, metrics, redemption e undo non dipendono più dai nomi ruolo. Questo rende `admin_scanner` realmente utilizzabile senza modifica codice dopo assegnazione del ruolo.

Le API degli altri moduli continuano a mantenere i guard legacy finché non vengono migrate capability-per-capability. Per i custom role questo comportamento è intenzionalmente fail-closed.

La ricerca globale admin è filtrata sia in UI sia server-side sulle capability dell'utente, per evitare accesso trasversale a dati non autorizzati.

---

## 4. Profilo e onboarding admin

`admin_users` contiene anche l'identità operativa dell'amministratore:
- `first_name`;
- `last_name`;
- `nickname`;
- `phone` opzionale;
- `profile_completed_at`.

Al primo accesso, dopo autenticazione e prima della superficie operativa, un admin senza profilo completo viene indirizzato a:

```text
/admin/onboarding
```

Prénom, nom e nickname sono obbligatori; telefono è opzionale. Il nickname/nome viene usato nell'interfaccia e negli audit operativi quando disponibile. La pagina accetta `next` solo relativo/same-origin. Il profilo può essere modificato successivamente dal menu utente.

Le pagine personali di sicurezza account restano disponibili indipendentemente dalle business permissions del ruolo.

---

## 5. Boundary Platform / Tenant nell'admin

La Console Platform è interna Lepefy:

```text
/admin/platform                 # console platform
/admin/platform/access          # ruoli, permission e membership
/admin/platform/ai-usage        # cost accounting AI
/admin/platform/notifications   # diagnostics/test notifications
/admin/team                     # utenti amministrativi cross-tenant
```

Le route `/admin/platform/**` mantengono un layout server-side platform-owner-only aggiuntivo. `/admin/team` resta platform-owner-only e NON rappresenta la futura gestione staff self-service del tenant.

`public.platform_branding` resta singleton service-role-only per l'identità visuale Lepefy dell'admin.

---

## 6. Platform billing e subscription tenant

Migration `084_platform_billing_boundary.sql` separa il billing SaaS dalla configurazione tenant:

```text
platform_billing_settings
platform_plans
platform_plan_features
tenant_subscriptions
```

Responsabilità:
- `platform_billing_settings`: coordinate bancarie/supporto Lepefy;
- `platform_plans`: catalogo commerciale SaaS;
- `platform_plan_features`: entitlement/moduli inclusi;
- `tenant_subscriptions`: tenant→piano, status, paid_until e payment link tenant-specifico.

`src/lib/admin/platformBilling.ts` è il resolver canonico. `/admin/billing` non hardcoda prezzo o moduli e continua a mostrare al tenant il proprio piano/rinnovo/metodi di pagamento.

Le colonne billing legacy in `tenants` restano temporaneamente per compatibilità e non vanno eliminate senza uno scope migration dedicato.

---

## 7. Cart e checkout Shop

Modello canonico:

```text
cart -> checkout_session -> pagamento confermato -> order
```

Una checkout session non è un ordine. Lifecycle:

```text
open -> completed | cancelled | expired
open + external provider handoff -> awaiting_verification
awaiting_verification -> completed | cancelled | open
```

Una sola open session per cliente autenticato/tenant; guest resume tramite token firmato. Stock/pricing/shipping/discount/payment completion sono server-side.

Route recovery canonica: `/checkout/reprendre/[id]`; legacy `/orders/en-attente/[id]` redirige lì. External payments unresolved sono gestiti separatamente dagli ordini nell'admin Shop.

---

## 8. Pagamenti condivisi

Componente centrale: `apps/storefront/src/components/payments/StripePaymentStep.tsx`. Verificare tutti i caller shop/event/rental/card prima di modificarlo.

`payment_funnel_logs` è cross-module.

---

## 9. Événementiel — prenotazioni e pagamenti esterni

Checkout evento ha state machine propria e non usa `checkout_sessions` Shop.

External payment requests usano `event_reservation_requests`:

```text
pending -> confirmed | stock_conflict | cancelled
```

Finché `pending`, nessuna capacità/posto è riservata. La conferma admin crea la reservation con controllo finale capacità server-side. `stock_conflict` richiede gestione/rimborso manuale presso il provider esterno.

Surface admin:

```text
/admin/evenementiel/reservations
/admin/evenementiel/paiements-en-attente/[request-id]
```

La decisione `Confirmer réception` è nella fiche dedicata, non inline nel summary evento. Annullo request conserva storico e non effettua rimborso provider.

Migration `083_event_external_payment_cancellation.sql` aggiunge `cancelled` e `cancelled_at`.

---

## 10. Scanner / Service repas

Surface canonica:

```text
/scan?event_id=<event-id>
```

Flusso:

```text
camera -> preview reservation -> conferma formule -> success -> scanner
```

Camera primaria, ricerca manuale fallback, STOP esplicito su biglietto esaurito, audit redemption e KPI per formula. Online-only.

Ledger canonico:

```text
reservation -> reservation_items -> item_redemptions
```

`event_reservation_item_redemptions` è source of truth per redemption, parziali e soft-void.

Authorization scanner usa capability:
- `scan.access` per aprire/preview;
- `scan.search` per ricerca fallback;
- `scan.metrics` per KPI;
- `scan.redeem` per servire;
- `scan.undo_own` per annullare propria operazione entro 5 minuti;
- `scan.undo_any` per override con motivo secondo policy.

Il comportamento undo non dipende più dal nome `tenant_cashier`/`tenant_admin`.

---

## 11. AI usage e unit economics

Accounting tecnico interno: `ai_usage_log`, `ai_pricing`, `ai_usage_monthly_by_tenant`.

`/admin/platform/ai-usage` è platform-only e mostra costi/provider. `/admin/ai-usage` espone al tenant storico e breakdown per feature prodotto senza provider/model/token/costo tecnico.

`src/lib/ai/productUsage.ts` è il layer semantico tenant. I `creditWeight` sono predisposizione architetturale; nessuna quota, overage o supplemento AI è applicato oggi.

---

## 12. Login admin e sicurezza

Password/OTP supportano `next` solo relativo e same-origin. Non esiste ancora SSO esplicito cross-subdomain shop/events; è scope auth/security separato.

Le operazioni platform su ruoli/membership passano da API server-side protette `platform_owner`; le tabelle RBAC sono RLS-enabled senza policy browser e accessibili via service_role.

---

## 13. Digital Card

`/card` è hub mobile tenant. Location usa `tenant.google_maps_url`; niente iframe/API Google Maps. Quick Pay usa payment engine condiviso ma non è un ordine Shop.

---

## 14. Shipping

Packlink principale. Packaging, peso, splitting, quote, VAT, surcharge, country e tenant rules sono business logic sensibile server-side.

---

## 15. Notifiche

`docs/NOTIFICATION_JOURNEY_V1.md` è la spec di riferimento. n8n è trasporto/orchestrazione; stato e recipient resolution restano source of truth nell'app. `tenant_notification_recipients` è source of truth destinatari interni.

---

## 16. Social sharing Events

`event_gallery_photos` è source of truth immagini; `is_social_share` marca foto approvate. Social card 9:16 server-side via endpoint dedicato.

---

## 17. Database / migrations recenti

La presenza di una migration nel repo non prova che sia applicata in ogni Supabase remoto.

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
```

`085` è additiva sul modello RBAC ma allenta i vecchi check constraint di `admin_users.role` per consentire il compatibility mirror dei codici ruolo dinamici. Non elimina i campi legacy.

`086` espone al solo service_role un RPC atomico per sostituire le permission di un ruolo custom; i ruoli sistema sono bloccati anche lato RPC.

---

## 18. Supabase / auth

Browser: `src/lib/supabase/client.ts`. Server/service: `src/lib/supabase/server.ts`. Operazioni service-role server-only. Checkout guest supportato. Signed link Payment Recovery usa token HMAC esistente.

---

## 19. UI conventions

Admin/storefront principale in francese. Tabler Icons, mobile-first, touch target ~44px+, focus visibile, safe-area, reduced motion, niente dati fake. Storefront usa branding tenant; admin usa branding piattaforma.

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
apps/storefront/src/lib/admin/platformBilling.ts
apps/storefront/src/lib/auth/adminRbac.ts
apps/storefront/src/lib/auth/adminRoutePermissions.ts
apps/storefront/src/lib/ai/*
apps/storefront/src/lib/notifications/*
apps/storefront/src/app/api/admin/*
apps/storefront/src/app/admin/*
apps/storefront/src/app/scan/*
packages/types/*
supabase/migrations/*
```

---

## 21. Known technical debt

- collisione storica prefisso migration `071`: non rinominare retroattivamente;
- telefono checkout non uniformemente server-enforced;
- legacy `CheckoutForm.tsx`: verificare caller prima della rimozione;
- abandoned-checkout outbound automatico non abilitato senza policy consenso/timing;
- admin Shop external-payment confirm/cancel richiede controllo concurrency dedicato;
- `event_reservation_redemptions` è legacy storico;
- tenant resolution resta deployment/env-based (`NEXT_PUBLIC_TENANT_SLUG`);
- URL Events resta temporaneamente env-based;
- SSO esplicito cross-subdomain shop/events non introdotto;
- colonne billing legacy in `tenants` restano temporaneamente per compatibilità dopo migration 084;
- Console Platform non è ancora CRUD completo di piani/tenant;
- tenant Team self-service non esiste ancora; `/admin/team` resta volutamente platform-only;
- **RBAC rollout progressivo:** Scanner è già capability-driven end-to-end; le altre API admin devono essere migrate da `requireAdmin(...allowedRoles)` a `requirePermission()` prima che ruoli custom possano ottenere capability write su quei moduli;
- `admin_users.role/tenant_id` restano compatibility mirror durante il rollout RBAC e potranno essere rimossi solo dopo audit completo di tutte le API e job interni;
- AI credits sono semanticamente predisposti ma non monetizzati/applicati.

---

## 22. Stato strutturale corrente

### Admin / piattaforma
- Admin Core condiviso, workspace Shop/Events host-based;
- platform branding separato;
- Platform Billing separato dal tenant;
- RBAC dinamico con catalogo capability, ruoli e membership persistenti;
- `/admin/platform/access` è la console Platform Owner per ruoli/permissions;
- `/admin/team` gestisce gli utenti e assegna ruoli dinamici;
- onboarding admin obbligatorio per nome/cognome/nickname dopo migration RBAC;
- sidebar, route admin e global search sono permission-aware;
- Platform Owner resta system role protetto.

### Shop
Purchase intent persistente, `awaiting_verification`, recovery firmata, dashboard ordini operativa. Le API Shop restano in migrazione progressiva verso capability RBAC.

### Events
Queue cross-evento external payments e fiche dedicata. Scanner è il primo modulo completamente RBAC capability-driven.

---

## 23. Checklist delivery

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

# Fine snapshot v6.2

**Base audit:** `main @ dynamic admin RBAC + onboarding`  
**Data:** 27 agosto 2026  
**Obiettivo:** descrivere lo stato architetturale corrente, non la cronologia delle conversazioni.
