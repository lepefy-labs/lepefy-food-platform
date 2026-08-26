# Lepefy Food Platform — Project Context

> **Documento operativo di riferimento per Codex / Claude Code / sviluppatori.**
>
> **Aggiornato:** 26 agosto 2026 — **v5.6 Current-State Snapshot**
>
> **Source of truth:** codice del repository `lepefy-labs/lepefy-food-platform`. Per lo stato deployed prevalgono sempre branch/commit effettivamente promossi e migration realmente applicate. Se questo documento e il codice divergono, **vince il codice**.

---

## 1. Cos'è Lepefy Food Platform

Lepefy Food è una piattaforma SaaS e-commerce **multi-tenant** per attività food, con storefront commerce, back-office tenant, pagamenti e checkout, shipping/logistica, loyalty/referral, digital card, assistente shopping Nala e modulo Événementiel con eventi, servizi e rental.

Il tenant di riferimento più usato è `chloefood`, ma il codice non deve hardcodare Chloe Food salvo seed/configurazioni esplicitamente tenant-specifiche.

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

Package manager: **pnpm workspaces**. Stack principale: Next.js 14.2.35, React 18.3.1, TypeScript, Tailwind, Supabase, Stripe, Zustand, React Hook Form, Zod, Tabler Icons, Playwright, `html5-qrcode`, Google GenAI e React Markdown.

---

## 3. Multi-tenancy e branding

Storefront tenant risolto principalmente da `NEXT_PUBLIC_TENANT_SLUG`, quindi `getTenant()`, CSS custom properties tenant e query filtrate per `tenant_id`.

L'URL storefront pubblico canonico è configurato per tenant tramite `tenants.storefront_url`; `NEXT_PUBLIC_STOREFRONT_URL` resta fallback legacy.

`/admin/**` usa **platform branding** (`public.platform_branding`) indipendente dai colori tenant.

---

## 4. Route groups principali

```text
apps/storefront/src/app/(shop)/          # shop/cart/checkout/compte/orders
apps/storefront/src/app/card/            # digital card / quick pay
apps/storefront/src/app/(evenementiel)/  # modulo pubblico eventi
apps/storefront/src/app/admin/           # back-office
apps/storefront/src/app/api/             # API e webhook
```

---

## 5. Catalogo `/products`

Superficie commerce primaria mobile-first. Preservare search sticky, `Nos univers`, product grid densa, ProductCard mobile, quick-add accessibile, pricing promo da dati reali e `prefers-reduced-motion`. La PWA è orientata al catalogo.

---

## 6. Cart — stato, sync e UX

Il cart usa Zustand con persistenza guest e sync server-side per utenti autenticati con optimistic concurrency (`expectedVersion`). `/cart` modifica basket e avvia checkout; shipping, indirizzo e contatti appartengono al checkout. Nala è esclusa dal purchase funnel.

---

## 7. Checkout shop — purchase-intent architecture

Modello canonico:

```text
cart -> checkout_session -> pagamento confermato -> order
```

Una checkout session **non è un ordine**. Non creare `orders` pending per checkout incompleti.

Lifecycle principale:

```text
open -> completed | cancelled | expired
open + external provider handoff -> awaiting_verification
awaiting_verification -> completed | cancelled | open
```

Per cliente autenticato e tenant esiste al massimo una sessione `open`. Guest resume tramite token firmato. PaymentIntent Stripe viene riusato/aggiornato quando possibile. La route canonica recovery è `/checkout/reprendre/[id]`; legacy `/orders/en-attente/[id]` redirige lì.

Stock non riservato alla nascita della checkout session; pricing, stock, shipping quote/token, discount, PaymentIntent e completion restano server-side.

`payment_funnel_logs` e `checkout_funnel_30d` coprono lifecycle/recovery. `/admin/checkout-funnel` è la dashboard conversion/recovery.

Payment Recovery v1 è manuale, transazionale e limitato alle external-link unresolved. L'alert tenant per `awaiting_verification` è best-effort e idempotente.

---

## 8. Telefono checkout

UI obbligatoria ma alcune API shop modellano ancora `phone?: string | null`: technical debt da trattare in uno scope checkout dedicato.

---

## 9. Nala

Identità: `Nala`, “Assistant shopping par Lepefy”, primary `#6D5AF6`, tenant-independent. Non appare in `/cart`, `/checkout*` e superfici purchase funnel correlate.

---

## 10. Pagamenti condivisi

Componente centrale: `apps/storefront/src/components/payments/StripePaymentStep.tsx`. Non modificarlo senza verificare tutti i caller shop/event/rental/card. `payment_funnel_logs` è cross-module.

---

## 11. Admin — shell e ruoli

Ruoli applicativi: `platform_owner`, `tenant_admin`, `tenant_cashier`. `admin_users` è la fonte per ruolo/tenant/active; authorization server-side obbligatoria anche se una voce è nascosta in UI.

---

## 12. Admin Commandes / external payment operations

`/admin` è workspace operativo. La queue **Paiements en attente** riguarda external-link senza `order_id`, separata dagli ordini. Stato canonico dopo provider handoff: `awaiting_verification`.

Workflow fulfillment:

```text
new -> preparing -> shipped -> delivered
new -> preparing -> ready_for_pickup -> delivered
```

Payment status e fulfillment status restano separati.

---

## 13. Événementiel

Route group `apps/storefront/src/app/(evenementiel)/`. Checkout evento ha state machine propria e non va confuso con `checkout_sessions` shop.

### Social sharing

`event_gallery_photos` è source of truth immagini. `is_social_share` marca foto approvate. Social card 9:16 server-side:

```text
/api/evenementiel/events/[slug]/social-card?photo=<gallery-photo-id>
```

Condivisione tramite Web Share API con file; fallback share URL/download PNG.

### Prenotazioni e biglietti

`event_reservations` nasce solo dopo conferma del pagamento/confirmation flow previsto. Il QR token resta stabile per tutta la vita della prenotazione. Le quantità acquistate sono in `event_reservation_items`; modifiche operative allo scanner non devono rigenerare QR né riscrivere prenotazioni live.

### Scanner evento

Superficie operativa:

```text
/admin/evenementiel/scan?event_id=<event-id>
```

Lo scanner è **vincolato all'evento**: lookup, conferma, ricerca fallback e undo verificano tenant + `event_id`. Un QR appartenente a un altro evento viene rifiutato prima della redemption.

Il modello operativo corrente è una postazione unica orientata al **service repas / retrait des formules**:

```text
camera scan -> preview prenotazione -> conferma formule -> success -> ritorno scanner
```

La camera è l'azione primaria. La ricerca manuale è fallback e può risolvere una prenotazione per nome, e-mail, telefono, QR o riferimento completo senza modificare il ledger.

Preview canonica distingue almeno:

```text
valido
parzialmente utilizzato
interamente utilizzato
annullato
rimborsato
evento draft/cancelled
fuori finestra check-in configurata
```

Un biglietto interamente utilizzato mostra uno stato di arresto esplicito e non presenta quantità redimibili. La prenotazione deve essere `confirmed`; l'RPC di redemption mantiene lock e controllo atomico del residuo per impedire double redemption tra più device.

Il modello dati operativo è:

```text
reservation -> reservation_items (diritti/formule) -> item_redemptions (ledger)
```

`event_reservation_item_redemptions` è la **source of truth canonica** per redemption/audit. Supporta quantità parziali e soft-void. La tabella legacy `event_reservation_redemptions` resta solo storico compatibile e non deve essere usata per nuovi KPI; migration `082` interrompe la creazione di nuove righe aggregate.

Il client scanner è online-only per le azioni operative: perdita di connettività blocca scan, ricerca, conferma e undo; non esiste redemption offline. Le API scanner sono `force-dynamic`/`force-no-store` e il client usa fetch `no-store` per le preview.

I KPI live derivano da prenotazioni confermate, reservation items e ledger granulare. `Suivi du service` include totali globali e breakdown per formula (servite/restanti/terminate), quindi rispetta anche gli undo.

### Finestra check-in

Migration `082_event_checkin_operations.sql` aggiunge:

```text
events.checkin_opens_at timestamptz null
events.checkin_closes_at timestamptz null
```

Regola di rollout fondamentale: `NULL` significa **nessuna restrizione temporale**. Gli eventi/prenotazioni già live mantengono quindi il comportamento precedente senza backfill. Il codice legge gli eventi con `select('*')` e tratta campi assenti come `NULL`, così un deploy applicativo precedente all'applicazione della migration non invalida i QR esistenti.

Se configurata, la finestra è verificata sia nel preview sia nuovamente server-side al POST di redemption. Non affidarsi al client per il controllo temporale.

### Undo / audit operatori

Policy scanner:

- `tenant_cashier`: può annullare soltanto una propria redemption e solo entro 5 minuti;
- `tenant_admin` / `platform_owner`: possono correggere redemption più vecchie o di altri operatori; in tali casi il motivo è obbligatorio;
- l'undo è sempre soft-void, mai delete fisico del ledger.

---

## 14. Digital Card `/card`

Hub mobile tenant. Location usa `tenant.google_maps_url`; niente iframe/API Maps o geografia simulata. Quick Pay usa payment engine condiviso ma resta dominio indipendente dagli ordini shop.

---

## 15. Shipping

Packlink resta integrazione principale. Packaging, peso, splitting, quote, VAT, surcharge, country e tenant rules sono business logic sensibile; frontend non source of truth del costo.

---

## 16. Notifiche

Spec: `docs/NOTIFICATION_JOURNEY_V1.md`. n8n è trasporto/orchestrazione; stato ordine/checkout, recipient resolution e payload restano source of truth nell'app.

Eventi cliente ordine v1:

```text
order-confirmed
order-ready-for-pickup
order-shipped
order-completed
order-cancelled
```

`tenant_notification_recipients` è source of truth destinatari interni. Alert external payment usa webhook `external-payment-awaiting-verification`; Payment Recovery usa `payment-reminder` con cooldown e signed resume token esistente.

---

## 17. Database / migrations

La presenza di una migration nel repo **non prova** che sia applicata in ogni Supabase remoto. Per release che richiedono nuove colonne, applicare la migration DB prima di usare la relativa configurazione.

Numerazione recente:

```text
074_checkout_recovery_lifecycle.sql
075_external_payment_verification.sql
079_tenant_storefront_url.sql
080_external_payment_tenant_notifications.sql
081_event_gallery_social_share.sql
082_event_checkin_operations.sql
```

Migration `082` è backward-compatible:

- aggiunge solo due colonne nullable su `events`;
- nessun backfill di prenotazioni, reservation items o QR;
- `NULL` mantiene scanner senza vincolo temporale;
- mantiene firma/semantica atomica dell'RPC `redeem_event_reservation_items`;
- smette soltanto di alimentare la tabella aggregata legacy, mantenendone intatto lo storico.

---

## 18. Supabase / auth

Browser: `src/lib/supabase/client.ts`. Server/service: `src/lib/supabase/server.ts`. Operazioni service-role server-only. Checkout guest supportato. I signed link Payment Recovery usano il token HMAC esistente.

---

## 19. UI conventions

Lingua storefront principale: francese. Tabler Icons, mobile-first, touch target ~44px+, focus visibile, safe-area, reduced motion, niente dati fake, storefront branding tenant, admin branding piattaforma.

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
apps/storefront/src/app/api/checkout/*
apps/storefront/src/app/api/checkout-sessions/*
apps/storefront/src/app/api/admin/checkout-sessions/*
apps/storefront/src/app/api/admin/evenementiel/scan/*
apps/storefront/src/app/api/webhooks/stripe/*
apps/storefront/src/app/admin/*
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
- `event_reservation_redemptions` è legacy storico: nuovi analytics scanner devono usare ledger granulare/residui canonici.

---

## 22. Cambiamenti strutturali correnti

### Admin / piattaforma

Platform branding separato, shell condivisa, Commandes workspace operativo, `/admin/checkout-funnel`, Payment Recovery admin e Notification Test Console.

### Cart / checkout

Purchase-intent persistente, una open session per cliente autenticato, `awaiting_verification` durevole, PaymentIntent reuse, recovery route canonica, signed reminder link, audit lifecycle e alert tenant external payment.

### Événementiel

- social kit da gallery approvata;
- scanner evento vincolato a `event_id` e orientato al service repas;
- camera primaria, ricerca prenotazione senza QR come fallback;
- preview stato redimibilità prima della conferma, con STOP esplicito per biglietto esaurito;
- finestra check-in opzionale e backward-compatible;
- KPI live compatti con breakdown per formula;
- scanner online-only per operazioni di servizio;
- ledger `event_reservation_item_redemptions` canonico;
- undo cashier limitato a propria operazione entro 5 minuti; override admin tracciato.

---

## 23. Checklist prima di consegnare codice

### Repo
- [ ] target e base SHA verificati;
- [ ] diff limitato allo scope;
- [ ] nessun artefatto temporaneo.

### Business critical
- [ ] tenant isolation preservata;
- [ ] pricing/stock/payment invariati salvo scope approvato;
- [ ] auth/roles verificati;
- [ ] nessun secret esposto;
- [ ] migration applicata prima di attivare configurazioni dipendenti.

### Delivery
- [ ] remote validation sullo SHA finale;
- [ ] Vercel `READY` quando applicabile;
- [ ] project context aggiornato.

---

## 24. Regola di manutenzione

Aggiornare questo file quando cambiano architettura, route/module principali, workflow business, schema/migration significative, payment/checkout, auth, cart sync, shipping, tenant/platform config o feature cross-module. Non trasformarlo in changelog.

---

# Fine snapshot v5.6

**Base audit:** `main @ scanner service-meal current state`  
**Data:** 26 agosto 2026  
**Obiettivo:** descrivere la situazione architetturale reale del codebase, non la cronologia delle conversazioni.
