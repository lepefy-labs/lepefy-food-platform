# Lepefy Food Platform — Project Context
 
> Documento di riferimento per Claude Code, onboarding sviluppatori, e continuità tra sessioni.
> Aggiornato: Giugno 2026
 
---
 
## 1. Identità del progetto
 
**Lepefy Labs** (founder: Robertin Boukeng) costruisce una piattaforma SaaS multi-tenant di e-commerce per boutique alimentari africane in Europa. Il modello di business: Lepefy Labs mantiene la proprietà intellettuale del codice; ogni boutique paga un abbonamento mensile (attualmente 89 €/mese, minimo 6 mesi). I costi di transazione Stripe/Satispay sono a carico del cliente.
 
**Tenant pilota:** ChloeFood ETS — negozio di specialità alimentari camerunesi/africane, Reggio Emilia, Italia. Tagline: *"Les saveurs de chez nous"*. Bilinguismo IT/FR.
 
| | |
|---|---|
| **Repo GitHub** | `github.com/Lepefy-labs/lepefy-food-platform` (pubblico — vincolo Vercel free plan) |
| **Deploy** | `chloefood.vercel.app` |
| **Supabase project** | `lepefy-food-platform` — `https://lefihestoozeptzonhkt.supabase.co` |
| **n8n** | `https://n8n.lepefy.com` (self-hosted su Hetzner CX22, Caddy SSL) |
| **Contratto** | Firmato. 89 €/mese, minimo 6 mesi. Fee Stripe/Satispay: responsabilità ChloeFood |
 
---
 
## 2. Stack tecnologico
 
| Layer | Tecnologia | Dettaglio |
|---|---|---|
| **Frontend** | Next.js 14.2.3 (App Router) | Storefront + API routes, SSR |
| **Stile** | Tailwind CSS 3.4.3 | CSS vars per colori tenant (`--primary`, `--secondary`) |
| **State** | Zustand 4.5.2 | Cart store con persist + `shippingPayload()` |
| **Database** | Supabase (PostgreSQL) | `lepefy-food-platform`, RLS attivo su tutte le tabelle |
| **Auth** | Supabase Auth | Clienti: Phase 2 · Admin: **DA AGGIUNGERE urgente** |
| **Storage** | Supabase Storage | Bucket `assets` pubblico, logo ChloeFood caricato |
| **Hosting** | Vercel (free plan) | Root Directory: `apps/storefront` |
| **Pagamenti** | Stripe Elements + Satispay | Satispay via Stripe nativo, nessun codice extra |
| **Spedizione** | Packlink PRO API | Quote real-time — ⚠️ passare a `api.packlink.com` (prod) |
| **Email/Automation** | n8n self-hosted | Hetzner CX22, Ubuntu 24.04, Docker + Caddy |
| **PWA** | `manifest.ts` dinamico + SW | Banner installazione Android animato (#F2C811) |
| **Monorepo** | pnpm workspaces | `apps/storefront` + `packages/types` |
| **TypeScript** | Strict | Types condivisi in `packages/types` |
 
**Colori brand ChloeFood:**
- Primary: `#1D9E75` (verde)
- Secondary: `#F2C811` (giallo)
- Accent light: `#E1F5EE`
---
 
## 3. Struttura repository
 
```
lepefy-food-platform/
├── apps/
│   └── storefront/                    # Next.js 14 App Router
│       ├── src/
│       │   ├── app/
│       │   │   ├── (shop)/            # Layout storefront pubblico
│       │   │   │   ├── page.tsx       # Homepage (bottom nav, hero, featured)
│       │   │   │   ├── products/      # Catalogo prodotti
│       │   │   │   ├── cart/          # Carrello
│       │   │   │   ├── checkout/      # Checkout Stripe Elements
│       │   │   │   └── orders/[id]/   # Tracking ordine (token HMAC)
│       │   │   ├── admin/             # Dashboard admin (⚠️ NON protetta)
│       │   │   │   ├── page.tsx       # Lista ordini + KPI
│       │   │   │   └── orders/[id]/   # Dettaglio ordine + picking list
│       │   │   └── api/
│       │   │       ├── checkout/      # Crea PaymentIntent + checkout_session
│       │   │       ├── shipping/quote/ # Calcolo spedizione Packlink
│       │   │       ├── webhooks/stripe/ # Crea ordine dopo payment_intent.succeeded
│       │   │       └── admin/orders/[id]/ # Aggiorna stato/tracking + chiama n8n
│       │   ├── lib/
│       │   │   ├── shipping/
│       │   │   │   └── calculateShipping.ts  # Engine spedizione principale
│       │   │   └── supabase/
│       │   │       ├── server.ts      # createServiceClient()
│       │   │       └── types.ts       # Database types generati
│       │   └── stores/
│       │       └── cartStore.ts       # Zustand cart store
│       └── public/
│           └── sw.js                  # Service worker PWA
├── packages/
│   └── types/                         # Shared TypeScript interfaces
└── supabase/
    └── migrations/                    # 10 migrations (001–010)
```
 
---
 
## 4. Schema database (Supabase)
 
### Tabelle principali
 
| Tabella | Descrizione |
|---|---|
| `tenants` | Un record per boutique. Contiene colori, slug, Stripe account, `shipping_provider` |
| `categories` | Categorie prodotti per tenant |
| `products` | Prodotti con `storage_type` (dry/fresh/frozen), `weight_grams`, `position` |
| `orders` | Ordini creati SOLO dopo `payment_intent.succeeded` webhook |
| `order_items` | Righe ordine con `storage_type` copiato dal prodotto |
| `customers` | Linked a `auth.users` — Phase 2 |
| `addresses` | Indirizzi clienti |
| `checkout_sessions` | Sessioni temporanee checkout (eliminate dal webhook dopo creazione ordine) |
| `packaging_surcharges` | Configurazione surplus imballaggio per tenant (1 riga) |
| `shipping_vat_rates` | IVA spedizione per paese (N righe per tenant) |
 
### Migrations in ordine
 
| # | File | Contenuto |
|---|---|---|
| 001 | `001_initial_schema.sql` | Schema base: tenants, categories, products, orders, order_items, customers, addresses |
| 002 | `002_rls_policies.sql` | RLS policies su tutte le tabelle |
| 003 | `003_shipping_packlink.sql` | packaging_surcharges, shipping_vat_rates, products.storage_type — rimozione shipping_zones/rates |
| 004 | `004_carriers.sql` | Tabella carriers configurabili per tenant |
| 005 | `005_tenants_shipping_provider.sql` | Colonna `shipping_provider` su tenants (packlink/flat_rate/pickup_only) |
| 006 | `006_checkout_sessions.sql` | checkout_sessions per webhook-first order creation |
| 007 | `007_orders_shipping_details.sql` | Colonna `shipping_details` JSONB su orders |
| 008 | `008_products_warehouse.sql` | Colonne `warehouse_location`, `name_alt` su products (picking list) |
| 009 | `009_packaging_surcharge_dimensions.sql` | Colonne box dimensions su packaging_surcharges |
| 010 | `010_seed_products.sql` | *(da generare)* — import ~120 prodotti ChloeFood |
 
### Pattern permessi Supabase (critico)
 
```sql
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.[tabella] TO anon, authenticated;
-- Testare sempre con: SET role anon; SELECT * FROM [tabella];
```
 
---
 
## 5. Multi-tenancy — regole fondamentali
 
- Ogni query DB **deve** usare `tenant.id` caricato da `NEXT_PUBLIC_TENANT_SLUG`
- Mai hardcodare slug (`'chloefood'`), label corrieri, o valori tenant-specifici nel codice
- La logica del corriere è **switch-based** su `tenants.shipping_provider` (`packlink` / `flat_rate` / `pickup_only`)
- RLS attivo su tutte le tabelle — il `service_role` bypassa RLS nelle API routes admin
---
 
## 6. Sistema spedizione (Packlink PRO)
 
### Formula calcolo
 
```
num_pacchi    = ceil(peso_totale_g / (max_pack_kg × 1000))
packaging     = surcharge_amount × num_pacchi   (se per_parcel)
              = surcharge_amount                 (se per_order)
vat           = tax_price Packlink se > 0, altrimenti packlink_price × vat_rate (DB)
shippingTotal = packlink_price + vat + packaging
```
 
### Configurazione ChloeFood (Giugno 2026)
 
- Surcharge imballaggio: **3,00 € per pacco** (`per_parcel`)
- Peso massimo per pacco: **15 kg**
- IVA: IT/FR/BE/DE → 22% precauzionale · CH → 0%
- Filtri Packlink: `dropoff: false` (solo consegna a domicilio) + esclusione servizi B2B
- Tutti i prodotti (dry/fresh/frozen) trattati **identicamente** per la spedizione
- `vatSource` tracciato in `orders.shipping_details` (`'packlink'` vs `'db'`)
### File chiave
 
- `apps/storefront/src/lib/shipping/calculateShipping.ts` — engine principale
- `apps/storefront/src/app/api/shipping/quote/route.ts` — API endpoint
- `supabase/migrations/003_shipping_packlink.sql` — schema DB
### ⚠️ Da fare prima del go-live
 
Cambiare `PACKLINK_API_BASE` da `apisandbox.packlink.com` a `api.packlink.com`
 
---
 
## 7. Checkout e pagamenti
 
### Flusso ordine (webhook-first)
 
```
Cliente → /checkout
  → POST /api/checkout          → crea checkout_session in DB
                                → crea PaymentIntent Stripe (metadata: session_id, tenant_id)
  → Stripe Elements             → cliente paga
  → POST /api/webhooks/stripe   → evento payment_intent.succeeded
                                → legge checkout_session
                                → crea order + order_items in DB
                                → elimina checkout_session
                                → chiama n8n webhook (conferma ordine)
```
 
**Regola assoluta:** Gli ordini vengono creati **solo** dopo `payment_intent.succeeded`. Mai prima.
 
### Metodi di pagamento
 
| Metodo | Implementazione |
|---|---|
| Stripe (carte) | Stripe Elements, PaymentIntent |
| Satispay | Via Stripe nativo (nessun codice extra) |
| In-store (Click & Collect) | `payment_method = 'in_store'`, bottone "Marquer comme payé" in admin |
 
### Variabili d'ambiente Stripe (Vercel)
 
```
STRIPE_SECRET_KEY=sk_live_...          # ⚠️ DA SOSTITUIRE con chiavi ChloeFood
STRIPE_WEBHOOK_SECRET=whsec_...        # ⚠️ DA REGISTRARE su account ChloeFood
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```
 
---
 
## 8. Admin dashboard
 
### Funzionalità implementate
 
- Lista ordini con KPI cards (totale ordini, fatturato, ordini nuovi)
- Filtri: stato, metodo pagamento, tipo fulfillment, data
- Badge bandiere SVG per ordini internazionali
- Indicatori storage: ❄ surgelé / 🌿 frais
- Dettaglio ordine: aggiornamento stato + codice tracking
- Select corriere configurabile con modale conferma cambio
- Toggle lingua FR/IT
- Picking list stampabile (`/admin/orders/[id]/picking-list`) con `@media print`
### ⚠️ Sicurezza — CRITICO
 
`/admin` è **pubblica** — chiunque conosca l'URL vede gli ordini. Aggiungere autenticazione (almeno Supabase Auth con middleware) prima del go-live.
 
---
 
## 9. Customer order tracking
 
- Route: `/orders/[id]?token=xxx`
- Protezione: token HMAC-SHA256 (`orderId + email`)
- Timeline stati: `confirmé → en préparation → expédié → livré`
- Link tracking corriere incluso quando disponibile
- Link inviato dal workflow n8n nella email di conferma ordine
---
 
## 10. n8n automazioni (self-hosted)
 
**Infrastruttura:** Hetzner CX22 (Ubuntu 24.04, 2 vCPU, 4GB RAM) · Docker + Docker Compose · Caddy reverse proxy · SSL automatico · URL: `https://n8n.lepefy.com`
 
### Workflow attivi
 
| Workflow | Trigger | Azioni |
|---|---|---|
| **Conferma ordine** | POST `n8n.lepefy.com/webhook/order-confirmed` (da webhook Stripe) | Email conferma cliente (Resend) + notifica WhatsApp/Telegram a Chloé |
| **Notifica spedizione** | POST `n8n.lepefy.com/webhook/order-shipped` (da admin quando stato → shipped) | Email spedizione con tracking code + link pagina tracking |
 
### Variabili Vercel correlate
 
```
N8N_WEBHOOK_URL=https://n8n.lepefy.com
N8N_WEBHOOK_SECRET=...
TRACKING_SECRET=...    # Per HMAC token ordini
```
 
---
 
## 11. PWA
 
- `manifest.ts` dinamico per tenant (genera `/manifest.json` al runtime)
- Service worker (`public/sw.js`) con cache strategy
- Banner installazione Android animato, colore `#F2C811`
- Visibile solo su mobile, scompare dopo installazione
- Google Play via TWA/PWABuilder (~25€ una tantum) — roadmap
---
 
## 12. Layout app mobile
 
- **Bottom navigation bar** (4 tab): 🏠 Accueil · 🛍️ Catalogue · 🛒 Panier (con badge) · 📦 Commandes
- Visibile solo su mobile (`md:hidden`), nascosta nel layout admin
- Header mobile semplificato quando bottom nav è presente
- Tab Commandes Phase 1: form inserimento numero ordine + redirect tracking
- Homepage: hero con logo, sezione prodotti in evidenza, sezione categorie
---
 
## 13. Catalogo prodotti (ChloeFood)
 
**File:** `ChloeFood_Template_Catalogue_v2.xlsx` (~120 prodotti)
 
| Macro-categoria | Storage type |
|---|---|
| Produits frais | `fresh` |
| Produits surgelés | `frozen` |
| Produits secs | `dry` |
| Boissons | `dry` |
 
Sotto-categorie presenti: Légumes frais, Viandes fraîches, Poissons frais, Tubercules, Viandes surgelées, Poissons surgelés, Épices & condiments, Farines & féculents, Conserves & sauces, Huiles, Bières, Jus en verre, Jus en plastique, Autres boissons.
 
**Status import:** ⚠️ DA FARE — migration `010_seed_products.sql` non ancora eseguita.
 
---
 
## 14. Variabili d'ambiente complete (Vercel)
 
```bash
# Tenant
NEXT_PUBLIC_TENANT_SLUG=chloefood
 
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://lefihestoozeptzonhkt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
 
# Stripe — ⚠️ sostituire con chiavi LIVE ChloeFood
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
 
# Packlink PRO — ⚠️ cambiare URL a produzione
PACKLINK_API_KEY=...
PACKLINK_API_BASE=https://api.packlink.com   # ← era apisandbox.packlink.com
 
# n8n
N8N_WEBHOOK_URL=https://n8n.lepefy.com
N8N_WEBHOOK_SECRET=...
 
# Tracking
TRACKING_SECRET=...
NEXT_PUBLIC_APP_URL=https://chloefood.vercel.app
```
 
---
 
## 15. Checklist go-live
 
| Task | Responsabile | Stato |
|---|---|---|
| Importare ~120 prodotti reali da `ChloeFood_Template_Catalogue_v2.xlsx` | Robertin | ⚠️ DA FARE |
| Aggiungere autenticazione a `/admin` | Robertin | ⚠️ DA FARE |
| Cambiare `PACKLINK_API_BASE` → `api.packlink.com` | Robertin | ⚠️ DA FARE |
| Sostituire chiavi Stripe test con chiavi live ChloeFood | ChloeFood | ⚠️ DA FARE |
| Registrare webhook Stripe sull'account ChloeFood | ChloeFood | ⚠️ DA FARE |
| Confermare trattamento IVA spedizione con commercialista | ChloeFood | ⚠️ DA FARE |
| Eliminare ordini di test dal DB | Robertin | ⚠️ DA FARE |
| Test E2E: ordine IT + ordine FR + Click & Collect | Robertin | ⚠️ DA FARE |
| Configurare dominio personalizzato su Vercel | ChloeFood | Opzionale |
 
---
 
## 16. Roadmap Phase 2 (post go-live)
 
| Feature | Categoria | Priorità |
|---|---|---|
| Autenticazione clienti (Supabase Auth) + pagina `/orders` storico | Contrattuale | P0 |
| Draft Packlink automatico al pagamento ("effet waouhhh") | Tecnico | P1 |
| `carrierName` + `serviceName` in `shipping_details` DB | Tecnico | P1 |
| Google Play Store via TWA/PWABuilder | Growth | P1 |
| Apple App Store via Capacitor | Growth | P2 |
| Onboarding secondo tenant | SaaS | P1 |
| Rate limiting su `/api/checkout` e `/api/shipping/quote` | Tecnico | P1 |
| Test automatizzati (almeno `calculateShipping.ts` + webhook) | Tecnico | P2 |
 
### Phase 2 — Packlink draft feature (dettaglio)
 
Al pagamento, chiamare `POST /v1/draft` Packlink per creare una spedizione pre-compilata. Salvare `shipment_reference` in `orders.packlink_draft_ref`. Mostrare bottone "Créer expédition Packlink →" nella dashboard admin che apre direttamente il draft in Packlink. Richiede: API route `POST /api/orders/[id]/draft-packlink` + migration campo `orders.packlink_draft_ref`.
 
---
 
## 17. Principi di sviluppo
 
### Workflow preferito (Robertin)
 
1. Discussione + validazione con mockup/widget interattivi
2. Generazione prompt Claude Code con tutte le modifiche consolidate
3. Output come file completi (non diff), pronti per GitHub web UI
4. Nessun comando bash locale — tutto via GitHub web + Vercel auto-deploy
### Regole critiche
 
- **No ambiente locale.** Robertin lavora esclusivamente via GitHub web UI + Vercel. Tutti i file devono essere pronti per copia-incolla diretto.
- **Webhook-first sempre.** Gli ordini esistono solo dopo `payment_intent.succeeded`. Mai creare ordini in anticipo.
- **Multi-tenancy vigilance.** Ogni valore hardcodato (`'chloefood'`, `'Packlink'`, carrier names) è un bug. Sempre usare `tenant.id` e logica switch-based.
- **Supabase permissions.** Sempre `GRANT USAGE ON SCHEMA public TO anon, authenticated` + `GRANT SELECT` esplicito per tabella. Testare con `SET role anon;`.
- **TypeScript strict.** Build errors tracciati dai Vercel build logs. Fix sistematici via prompt Claude Code, non patch one-off.
- **Repo pubblico.** Necessario per Vercel free plan. Non inserire mai segreti nel codice.
---
 
## 18. Documenti di riferimento nel progetto
 
| File | Contenuto |
|---|---|
| `Lepefy_Roadmap_Tecnica.docx` | Roadmap completa Phase 1/2/3, stack, checklist go-live, rischi |
| `ChloeFood_Template_Catalogue_v2.xlsx` | Catalogo prodotti ~120 items da importare |
| `Maquette/` | Design reference originale ChloeFood |
| `ClaudeCode_Prompt_MobileLayout.md` | Prompt Claude Code per bottom nav + homepage |
| `INTEGRATION.md` | Guida integrazione sistema spedizione Packlink |
 
---
 
*Lepefy Labs — Lepefy Food Platform — Context document v1.0 — Giugno 2026*
 
