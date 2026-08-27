# Lepefy Food Platform — Project Context

> Documento operativo di riferimento per Codex / Claude Code / sviluppatori.
>
> **Aggiornato:** 27 agosto 2026 — **v6.3 Current-State Snapshot**
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

Il Platform Owner gestisce ruoli, permissions e memberships da `/admin/platform/access`. I ruoli tenant custom possono essere creati senza deploy componendo capability esistenti. Una capability nuova richiede una sola integrazione applicativa, poi può essere assegnata liberamente a qualsiasi ruolo.

### Semantica system role

`platform_owner` bypassa tutte le capability applicative.

`tenant_admin` è contrattualmente “full tenant admin”: `canAdmin()` considera valido qualsiasi permesso non `platform.*` anche se una capability appena deployata non è ancora stata materializzata in `admin_role_permissions`. Questo evita interruzioni tra deploy applicativo e applicazione di una migration permission-catalog additiva.

Gli altri ruoli, inclusi i custom role, ricevono esclusivamente le capability persistite nel DB.

---

## 4. Enforcement API admin

`src/lib/auth/adminRbac.ts` fornisce `getAdminAccessContext()`, `canAdmin()` e `requirePermission()`.

Scanner usa direttamente `requirePermission()` capability-per-capability.

Le API admin legacy che chiamano ancora `requireAdmin()` non usano più i nomi ruolo come authorization boundary. Il compatibility guard è ora capability-driven:

```text
/api/admin request
   -> middleware.ts (solo /api/admin/*)
   -> x-lepefy-admin-path + x-lepefy-admin-method
   -> adminApiPermissions.ts
   -> business capability
   -> requirePermission()
```

`apps/storefront/src/lib/auth/adminApiPermissions.ts` è la mappa canonica method+route → capability per gli handler legacy. La mappa è **fail-closed**: una route admin protetta da `requireAdmin()` ma non mappata restituisce 403 invece di ereditare privilegi da `tenant_admin`.

Questo consente ai custom role di operare su tutti gli endpoint mappati senza modifiche per-role nel codice e mantiene il service-role Supabase dietro un controllo server-side uniforme.

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

Le capability money-moving/manual-financial sono isolate e `critical`: conferma pagamento esterno Shop, conferme/annulli/rimborsi Events e gestione payout ambassador non vengono implicitamente incluse in capability generiche di visualizzazione.

---

## 5. Profilo e onboarding admin

`admin_users` contiene:
- `first_name`;
- `last_name`;
- `nickname` (UI: “Nom affiché”);
- `phone` opzionale;
- `profile_completed_at`.

Al primo accesso un admin senza profilo completo viene indirizzato a `/admin/onboarding`; l'onboarding iniziale resta obbligatorio.

La modalità `/admin/onboarding?edit=1` è invece reversibile: mostra `Annuler`, torna a `/admin` senza salvare e chiede conferma se esistono modifiche non salvate.

Login, onboarding e accept-invite usano co-branding coerente:
- Lepefy = piattaforma;
- logo/nome tenant = organizzazione operativa;
- fallback iniziali se manca il logo;
- colori admin Lepefy indipendenti dai colori tenant.

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

`084_platform_billing_boundary.sql` separa il billing SaaS dal tenant:

```text
platform_billing_settings
platform_plans
platform_plan_features
tenant_subscriptions
```

`src/lib/admin/platformBilling.ts` è il resolver canonico; `/admin/billing` legge piano, features, subscription e coordinate Lepefy dal dominio platform con fallback legacy temporaneo.

Le vecchie colonne billing in `tenants` restano compatibilità e non vanno rimosse senza migration dedicata.

---

## 8. Cart / checkout Shop

Modello canonico:

```text
cart -> checkout_session -> pagamento confermato -> order
```

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

Capability finanziarie Events:
- `event_payments.view`;
- `event_payments.confirm`;
- `event_payments.cancel`;
- `event_payments.refund`.

Scanner canonico `/scan?event_id=<id>` usa ledger `event_reservation_item_redemptions` ed è capability-driven end-to-end.

Gli export operativi delle prenotazioni evento (CSV, lista fallback A4 e codici A5) includono solo prenotazioni ancora utilizzabili: `status = confirmed` e `quantity_remaining > 0`. Il dettaglio formule stampato/exportato usa il residuo per riga calcolato da `event_reservation_item_redemptions` non annullati (`voided_at IS NULL`), così formule già consumate non vengono ristampate come valide.

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

`docs/NOTIFICATION_JOURNEY_V1.md` resta riferimento notifiche; `tenant_notification_recipients` è source of truth dei destinatari interni.

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
```

`087` è additiva e aggiunge le capability emerse dal full admin authorization audit:
- `shop_payments.confirm`;
- `shipping.manage`;
- `growth.payouts.manage`;
- `event_payments.refund`.

Le assegna ai system role `platform_owner` e `tenant_admin`; non amplia automaticamente alcun custom role.

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

# Fine snapshot v6.3

**Base audit:** `main @ RBAC completion + tenant co-branding`  
**Data:** 27 agosto 2026  
**Obiettivo:** descrivere lo stato architetturale corrente, non la cronologia delle conversazioni.
