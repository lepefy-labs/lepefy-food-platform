# Lepefy Food Platform — Project Context

> Documento operativo di riferimento per Codex / Claude Code / sviluppatori.
>
> **Aggiornato:** 27 agosto 2026 — **v6.1 Current-State Snapshot**
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

`tenant_cashier` viene indirizzato alla surface operativa coerente: scan fidélité su shop, `/scan` su events.

---

## 3. Boundary Platform / Tenant nell'admin

Ruoli invariati:
- `platform_owner`;
- `tenant_admin`;
- `tenant_cashier`.

`admin_users` resta source of truth per ruolo, tenant e stato attivo. Il layout admin verifica che un non-platform-owner appartenga al tenant corrente.

Le route `/admin/platform/**` hanno un **layout server-side platform-owner-only** aggiuntivo. Le pagine sensibili possono mantenere anche il proprio check locale come defense in depth.

Surface Lepefy interne:

```text
/admin/platform                 # console platform
/admin/platform/ai-usage        # cost accounting AI
/admin/platform/notifications   # diagnostics/test notifications
/admin/team                     # amministratori cross-tenant, platform_owner only
```

`/admin/team` NON è la futura gestione staff self-service del tenant: legge utenti e tenant cross-platform e deve restare platform-only. Un'eventuale `Équipe` tenant dovrà essere una surface distinta, senza tenant selector e senza possibilità di creare `platform_owner`.

`public.platform_branding` resta singleton service-role-only per l'identità visuale Lepefy dell'admin.

---

## 4. Platform billing e subscription tenant

Il billing SaaS è separato semanticamente dalla configurazione del tenant.

Migration **`084_platform_billing_boundary.sql`** introduce in modo additivo:

```text
platform_billing_settings
platform_plans
platform_plan_features
tenant_subscriptions
```

Responsabilità:
- `platform_billing_settings`: coordinate bancarie/supporto di Lepefy, non proprietà tenant;
- `platform_plans`: catalogo commerciale SaaS Lepefy (nome, prezzo, valuta, attivo);
- `platform_plan_features`: entitlement/moduli inclusi nel piano;
- `tenant_subscriptions`: assegnazione tenant→piano, status, paid_until, payment link tenant-specifico.

La migration crea il piano iniziale `food-platform` a 89 EUR/mese con feature:
- Boutique;
- Événementiel;
- Carte digitale;
- Intelligence IA.

Esegue backfill additivo dagli attuali campi billing in `tenants`. Le colonne legacy su `tenants` NON vengono rimosse in questa fase.

`src/lib/admin/platformBilling.ts` è il resolver canonico della snapshot billing tenant. Prima prova le nuove tabelle Platform Billing; se la migration non è ancora applicata usa i campi legacy per mantenere la pagina operativa.

`/admin/billing` non deve hardcodare prezzo o moduli. Mostra piano, prezzo, entitlement, rinnovo e metodi di pagamento dalla snapshot billing. Il tenant può vedere/pagare il proprio abbonamento, ma non modifica configurazione commerciale globale Lepefy.

La Console Platform mostra un riepilogo di tenants/admin/plans e link agli strumenti platform. Non è ancora un CRUD completo di piani: modifiche commerciali persistenti devono rimanere platform-owner-only.

---

## 5. Cart e checkout Shop

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

Route recovery canonica: `/checkout/reprendre/[id]`; legacy `/orders/en-attente/[id]` redirige lì.

External payments unresolved sono gestiti separatamente dagli ordini nell'admin Shop.

---

## 6. Pagamenti condivisi

Componente centrale: `apps/storefront/src/components/payments/StripePaymentStep.tsx`. Verificare tutti i caller shop/event/rental/card prima di modificarlo.

`payment_funnel_logs` è cross-module.

---

## 7. Événementiel — prenotazioni e pagamenti esterni

Checkout evento ha state machine propria e non usa `checkout_sessions` Shop.

`event_reservations` nasce solo dopo conferma prevista dal relativo flow. Quantità in `event_reservation_items`.

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

## 8. Scanner / Service repas

Surface canonica:

```text
/scan?event_id=<event-id>
```

Legacy `/admin/evenementiel/scan` redirige a `/scan`.

Flusso:

```text
camera -> preview reservation -> conferma formule -> success -> scanner
```

Camera primaria, ricerca manuale fallback, STOP esplicito su biglietto esaurito, audit redemption e KPI per formula. Online-only.

Ledger canonico:

```text
reservation -> reservation_items -> item_redemptions
```

`event_reservation_item_redemptions` è source of truth per redemption, parziali e soft-void. `event_reservation_redemptions` è legacy.

Migration `082_event_checkin_operations.sql` aggiunge finestra check-in nullable.

Undo:
- cashier: propria redemption entro 5 minuti;
- tenant_admin/platform_owner: override più ampio secondo policy;
- sempre soft-void.

---

## 9. AI usage e unit economics

Accounting tecnico interno:
- `ai_usage_log`;
- `ai_pricing`;
- `ai_usage_monthly_by_tenant`.

Provider, model, token e costo industriale sono dati Lepefy e non valore commerciale tenant.

`/admin/platform/ai-usage`: platform_owner-only, storico costi/provider e dettaglio tecnico.

`src/lib/ai/productUsage.ts` mappa endpoint tecnici verso feature prodotto tenant (Nala, search intelligente, descrizioni, immagini, indexation, knowledge base, fallback).

`/admin/ai-usage`: storico 12 mesi e breakdown feature per tenant, senza costi/provider/model/token/endpoint.

I `creditWeight` sono predisposizione architetturale; nessuna quota, overage o supplemento AI è applicato oggi.

---

## 10. Billing UI tenant

`/admin/billing` è focalizzata su:
- piano assegnato;
- moduli inclusi;
- status/paid_until;
- payment link Stripe tenant-specifico;
- coordinate bancarie Lepefy da `platform_billing_settings`;
- riepilogo utilizzo AI con link `/admin/ai-usage`.

Prezzo e moduli non devono essere hardcoded nella UI.

---

## 11. Login admin

Password/OTP supportano `next` solo relativo e same-origin. Non esiste ancora SSO esplicito cross-subdomain shop/events; è scope auth/security separato.

---

## 12. Digital Card

`/card` è hub mobile tenant. Location usa `tenant.google_maps_url`; niente iframe/API Google Maps. Quick Pay usa payment engine condiviso ma non è un ordine Shop.

---

## 13. Shipping

Packlink principale. Packaging, peso, splitting, quote, VAT, surcharge, country e tenant rules sono business logic sensibile server-side.

---

## 14. Notifiche

`docs/NOTIFICATION_JOURNEY_V1.md` è la spec di riferimento. n8n è trasporto/orchestrazione; stato e recipient resolution restano source of truth nell'app. `tenant_notification_recipients` è source of truth destinatari interni.

---

## 15. Social sharing Events

`event_gallery_photos` è source of truth immagini; `is_social_share` marca foto approvate. Social card 9:16 server-side via endpoint dedicato.

---

## 16. Database / migrations recenti

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
```

`084` è additive-only: non rimuove i campi billing legacy da `tenants` e consente fallback applicativo fino all'applicazione remota.

---

## 17. Supabase / auth

Browser: `src/lib/supabase/client.ts`. Server/service: `src/lib/supabase/server.ts`. Operazioni service-role server-only. Checkout guest supportato. Signed link Payment Recovery usa token HMAC esistente.

Le tabelle Platform Billing sono RLS-enabled senza policy browser e accessibili via service_role.

---

## 18. UI conventions

Admin/storefront principale in francese. Tabler Icons, mobile-first, touch target ~44px+, focus visibile, safe-area, reduced motion, niente dati fake. Storefront usa branding tenant; admin usa branding piattaforma.

---

## 19. File/moduli ad alto impatto

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
apps/storefront/src/lib/ai/*
apps/storefront/src/lib/notifications/*
apps/storefront/src/app/api/checkout/*
apps/storefront/src/app/api/checkout-sessions/*
apps/storefront/src/app/api/admin/evenementiel/*
apps/storefront/src/app/api/webhooks/stripe/*
apps/storefront/src/app/admin/*
packages/types/*
supabase/migrations/*
```

---

## 20. Known technical debt

- collisione storica prefisso migration `071`: non rinominare retroattivamente;
- telefono checkout non uniformemente server-enforced;
- legacy `CheckoutForm.tsx`: verificare caller prima della rimozione;
- abandoned-checkout outbound automatico non abilitato senza policy consenso/timing;
- admin Shop external-payment confirm/cancel richiede controllo concurrency dedicato;
- `event_reservation_redemptions` è legacy storico;
- tenant resolution resta deployment/env-based (`NEXT_PUBLIC_TENANT_SLUG`);
- URL Events resta temporaneamente env-based;
- SSO esplicito cross-subdomain shop/events non introdotto;
- colonne billing legacy in `tenants` restano temporaneamente per compatibilità dopo migration 084 e potranno essere rimosse solo in migration futura dopo verifica completa;
- Console Platform non è ancora CRUD completo di piani/tenant;
- tenant Team self-service non esiste ancora; `/admin/team` resta volutamente platform-only;
- AI credits sono semanticamente predisposti ma non monetizzati/applicati.

---

## 21. Stato strutturale corrente

### Admin / piattaforma
- Admin Core condiviso, workspace Shop/Events host-based;
- platform branding separato;
- `/admin/platform/**` protetto da layout platform-owner-only;
- `/admin/platform` è la console interna Lepefy;
- piano/prezzo/feature SaaS persistenti in Platform Billing, non hardcoded nel tenant admin;
- coordinate bancarie Lepefy separate dal record tenant;
- `/admin/team` resta cross-tenant platform-only;
- `/admin/ai-usage` tenant e `/admin/platform/ai-usage` cost accounting interno restano separati.

### Shop
Purchase intent persistente, `awaiting_verification`, recovery firmata, dashboard ordini operativa.

### Events
Queue cross-evento external payments, fiche pagamento dedicata, scanner robusto e audit redemption.

---

## 22. Checklist delivery

Prima di consegnare codice:
- target/base SHA verificati;
- diff limitato allo scope;
- tenant isolation e auth/roles preservati;
- nessun secret esposto;
- project context aggiornato quando cambia architettura;
- migration remota verificata quando necessaria;
- remote validation sullo SHA finale;
- Vercel `READY` quando applicabile.

---

# Fine snapshot v6.1

**Base audit:** `main @ platform/tenant boundary hardening`  
**Data:** 27 agosto 2026  
**Obiettivo:** descrivere lo stato architetturale corrente, non la cronologia delle conversazioni.
