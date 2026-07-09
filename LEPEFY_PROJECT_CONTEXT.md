# Lepefy Food Platform — Project Context

> Documento di riferimento per Claude Code, onboarding sviluppatori, e continuità tra sessioni.
> Aggiornato: 9 Luglio 2026

---

## 1. Identità del progetto

**Lepefy Labs** (founder: Robertin Boukeng) costruisce una piattaforma SaaS multi-tenant di e-commerce per boutique alimentari africane in Europa. Il modello di business: Lepefy Labs mantiene la proprietà intellettuale del codice; ogni boutique paga un abbonamento mensile (89 €/mese, minimo 6 mesi). I costi di transazione Stripe/Satispay sono a carico del cliente.

**Tenant pilota:** ChloeFood ETS — negozio di specialità alimentari camerunesi/africane, Reggio Emilia, Italia (gestito dalla cliente **Dalice**). Tagline: *"Les saveurs de chez nous"*. Bilinguismo IT/FR (landing page anche in EN).

| | |
|---|---|
| **Repo GitHub** | `github.com/Lepefy-labs/lepefy-food-platform` (pubblico — vincolo Vercel free plan) |
| **Deploy storefront** | `chloefood.vercel.app` → dominio custom **`chloefood.com`** (attivo) |
| **Landing page pre-lancio** | pagina statica trilingue FR/IT/EN, WhatsApp CTA (393296958822), pubblicata su `chloefood.com` prima del rilascio dell'e-commerce completo |
| **Landing SaaS Lepefy** | `food.lepefy.com` — pagina di vendita per prospect boutique |
| **Supabase project** | `lepefy-food-platform` — `https://lefihestoozeptzonhkt.supabase.co` |
| **n8n** | `https://n8n.lepefy.com` (self-hosted su Hetzner CX23, IP `46.224.127.99`, Caddy SSL) |
| **Contratto** | SaaS in italiano (16 articoli) redatto — mancano dati fiscali Lepefy Labs, foro competente, email contrattuale, DPA sub-processori |

---

## 2. Stack tecnologico

| Layer | Tecnologia | Dettaglio |
|---|---|---|
| **Frontend** | Next.js 14.2.3 (App Router) | Storefront + API routes, SSR |
| **Stile** | Tailwind CSS 3.4.3 | CSS vars per colori tenant (`--primary`, `--secondary`) |
| **State** | Zustand 4.5.2 | Cart store con persist + `shippingPayload()` |
| **Database** | Supabase (PostgreSQL) | `lepefy-food-platform`, RLS attivo su tutte le tabelle |
| **Auth** | Supabase Auth | **Admin: ✅ implementata** (route group `(protected)`) · Clienti: Phase 2 |
| **Storage** | Supabase Storage | Bucket `assets` pubblico (logo, PWA icon, etichette) |
| **Hosting** | Vercel (free plan) | Root Directory: `apps/storefront` — ⚠️ Root Directory impedisce l'esecuzione dell'Edge middleware |
| **Pagamenti** | Stripe Elements + Satispay | Satispay via Stripe nativo, nessun codice extra |
| **Spedizione** | Packlink PRO API | Quote real-time — ⚠️ ancora in sandbox, da passare a `api.packlink.com` |
| **Email/Automation** | n8n self-hosted | Hetzner CX23, Ubuntu 24.04, Docker + Caddy, SMTP Brevo |
| **PWA** | `manifest.ts` dinamico + SW + `/api/pwa-icon` | Icona dinamica per tenant via API route (sharp) |
| **Rendering etichette** | Gotenberg (Docker, Hetzner) | ⚠️ non ancora installato — vedi §16 |
| **AI immagini prodotto** | Gemini 2.5 Flash + `gemini-2.5-flash-image` | SDK `@google/genai`, pipeline a due step |
| **Monorepo** | pnpm workspaces | `apps/storefront` + `packages/types` |
| **TypeScript** | Strict | Types condivisi in `packages/types` |

**Colori brand ChloeFood (attuali, in produzione):**
- Primary: `#1D9E75` (verde)
- Secondary: `#F2C811` (giallo)
- Accent light: `#E1F5EE`

**⚠️ Brand charter v2 (in valutazione, non ancora approvata):** Dalice ha ricevuto una nuova charter grafica (20 pagine) con logo, palette e materiali completamente diversi — colore primario proposto **blu `#1267C7`**. Analisi tecnica evidenziata: charter incompleta (mancano varianti icona/monocromatiche, riferimenti Pantone, dati placeholder errati come dominio e nome fittizio "TSANA"). Adottare il blu richiederebbe: migrazione CSS vars, asset Supabase Storage, aggiornamento record tenant in DB. **Decisione pendente** — in attesa di validazione v2 da parte del designer e conferma di Dalice. Un nuovo logo (JPEG, versione completa + versione icona) è stato nel frattempo integrato parzialmente sulla landing page `chloefood.com` (hero, favicon, PWA icon) con colore hero passato a blu, ma il resto della piattaforma (storefront, admin) resta verde `#1D9E75` fino a decisione definitiva.

---

## 3. Struttura repository

```
lepefy-food-platform/
├── apps/
│   └── storefront/                    # Next.js 14 App Router
│       ├── src/
│       │   ├── app/
│       │   │   ├── (shop)/            # Layout storefront pubblico
│       │   │   │   ├── page.tsx       # Homepage (bottom nav, hero compatto, scroll orizzontale per categoria)
│       │   │   │   ├── products/      # Catalogo con ricerca real-time debounced (URL params)
│       │   │   │   ├── cart/          # Carrello
│       │   │   │   ├── checkout/      # Checkout Stripe Elements
│       │   │   │   ├── card/          # Biglietto da visita digitale (chloefood.com/card)
│       │   │   │   └── orders/[id]/   # Tracking ordine (token HMAC)
│       │   │   ├── admin/
│       │   │   │   ├── login/         # Fuori dal route group protetto (evita redirect loop)
│       │   │   │   └── (protected)/   # ✅ Protetto via Supabase Auth + ADMIN_EMAILS whitelist
│       │   │   │       ├── page.tsx           # Lista ordini + KPI (totale/mese + delta)
│       │   │   │       ├── orders/[id]/        # Dettaglio ordine + picking list stampabile
│       │   │   │       ├── orders/[id]/picking-list/  # Layout dedicato senza navbar (print)
│       │   │   │       ├── catalogue/          # Gestione prodotti (drag&drop img, AI gen, stock inline)
│       │   │   │       ├── billing/            # Pannello abbonamento (Stripe Payment Link + bonifico)
│       │   │   │       ├── parametres/         # Impostazioni boutique, QR biglietto digitale
│       │   │   │       └── etichette/          # Sistema etichette prodotto (in sviluppo)
│       │   │   └── api/
│       │   │       ├── checkout/      # Crea PaymentIntent + checkout_session
│       │   │       ├── shipping/quote/ # Calcolo spedizione Packlink
│       │   │       ├── webhooks/stripe/ # Crea ordine dopo payment_intent.succeeded + checkout.session.completed (billing)
│       │   │       ├── admin/orders/[id]/ # Aggiorna stato/tracking + chiama n8n
│       │   │       ├── pwa-icon/      # Icona PWA dinamica per tenant (sharp resize)
│       │   │       ├── card/vcard/    # Download vCard biglietto digitale
│       │   │       ├── card/qr/       # QR code biglietto digitale con logo overlay
│       │   │       └── labels/preview|generate/ # Sistema etichette (in sviluppo, vedi §16)
│       │   ├── lib/
│       │   │   ├── shipping/
│       │   │   │   └── calculateShipping.ts  # Engine spedizione principale
│       │   │   ├── labels/            # calculateLayout.ts, resolveBackground.ts, gotenberg client (in sviluppo)
│       │   │   └── supabase/
│       │   │       ├── server.ts      # createClient() — richiede API cookie get/set/remove E getAll/setAll
│       │   │       └── types.ts       # Database types generati
│       │   └── stores/
│       │       └── cartStore.ts       # Zustand cart store
│       └── public/
│           ├── sw.js                  # Service worker PWA
│           └── favicon.ico, icons/apple-touch-icon.png  # ⚠️ eccezione statica mono-tenant, da rimediare al 2° tenant
├── packages/
│   └── types/                         # Shared TypeScript interfaces (include labels.ts)
└── supabase/
    └── migrations/                    # 001–018 (vedi §4)
```

---

## 4. Schema database (Supabase)

### Tabelle principali

| Tabella | Descrizione |
|---|---|
| `tenants` | Un record per boutique. Colori, slug, Stripe account, `shipping_provider`, `show_powered_by`, `ai_image_generation`, campi billing |
| `categories` | Categorie prodotti per tenant (con supporto background per etichette) |
| `products` | Prodotti — `storage_type` (dry/fresh/frozen), `weight_grams`, `position`, `warehouse_location`, `name_alt`, campi etichetta |
| `orders` | Ordini creati SOLO dopo `payment_intent.succeeded` webhook |
| `order_items` | Righe ordine con `storage_type` copiato dal prodotto |
| `customers` | Linked a `auth.users` — Phase 2 |
| `addresses` | Indirizzi clienti |
| `checkout_sessions` | Sessioni temporanee checkout (eliminate dal webhook dopo creazione ordine) |
| `packaging_surcharges` | Configurazione surplus imballaggio per tenant (1 riga) |
| `shipping_vat_rates` | IVA spedizione per paese (N righe per tenant) |
| `tenant_social_links` | Link social per biglietto da visita digitale |
| `producers` | Anagrafica produttori (sistema etichette) |
| `importers` | Anagrafica importatori (sistema etichette) — es. AFRICOOP Società Cooperativa |
| `label_settings` | Configurazione layout etichette per tenant |
| `label_print_jobs` | Storico job di stampa etichette (PDF generati via Gotenberg) |

**121 prodotti reali importati** (catalogo `ChloeFood_Template_Catalogue_v2.xlsx`, 8 categorie: Épices, Légumes, Farines, Poissons, Sauces & Huiles, Snacks, Viandes séchées, Boissons). 8 prodotti senza prezzo inseriti come `active = false`. 12 prodotti marcati `featured = true`.

### Migrations in ordine (⚠️ verificare numerazione esatta su Supabase — due chat separate hanno generato migration "011" con nomi diversi, `011_tenant_billing.sql` e `011_tenants_powered_by.sql`: probabile rinumerazione avvenuta in fase di applicazione, da confermare)

| # | File | Contenuto |
|---|---|---|
| 001 | `001_initial_schema.sql` | Schema base: tenants, categories, products, orders, order_items, customers, addresses |
| 002 | `002_rls_policies.sql` | RLS policies su tutte le tabelle |
| 003 | `003_shipping_packlink.sql` | packaging_surcharges, shipping_vat_rates, products.storage_type |
| 004 | `004_carriers.sql` | Tabella carriers configurabili per tenant |
| 005 | `005_tenants_shipping_provider.sql` | Colonna `shipping_provider` su tenants |
| 006 | `006_checkout_sessions.sql` | checkout_sessions per webhook-first order creation |
| 007 | `007_orders_shipping_details.sql` | Colonna `shipping_details` JSONB su orders |
| 008 | `008_products_warehouse.sql` | `warehouse_location`, `name_alt` su products (picking list) |
| 009 | `009_packaging_surcharge_dimensions.sql` | Colonne box dimensions su packaging_surcharges |
| 010 | `010_seed_products.sql` | ✅ **Eseguita** — import 121 prodotti reali ChloeFood |
| 011 | `011_tenant_billing.sql` / `011_tenants_powered_by.sql` | Colonne billing su tenants + colonna `show_powered_by` — **verificare conflitto numerazione** |
| 013 | `013_catalogue_admin.sql` | `warehouse_location` su products, `ai_image_generation` boolean su tenants |
| 014 | `014_sidebar_features.sql` | Placeholder sidebar |
| 015 | `015_catalogue_ux.sql` | `catalogue_search_threshold` su tenants |
| 017 | `017_label_system.sql` | Tabelle `producers`, `importers`, `label_settings`, `label_print_jobs` + estensioni a products/categories/tenants |
| 018 | `018_fix_grants.sql` | ✅ Fix `permission denied` — GRANT UPDATE su tenants/categories/products a `service_role` |
| 019 | `019_link_default_producer.sql` | Collega producer_id di default ai prodotti già esistenti |
| 020 | `020_reseed_products_catalogue_v2.sql` | Ripopola/aggiorna i 121 prodotti da `ChloeFood_Template_Catalogue_v2` (categoria Boissons + upsert idempotente) — da eseguire su Supabase |

⚠️ Numeri 012 e 016 non risultano documentati in nessuna chat — verificare se esistono o se sono stati saltati.

### Pattern permessi Supabase (critico)

```sql
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.[tabella] TO anon, authenticated;
GRANT UPDATE ON public.[tabella] TO service_role;  -- richiesto per ogni tabella scrivibile da API route admin
-- Testare sempre con: SET role anon; SELECT * FROM [tabella];
```

---

## 5. Multi-tenancy — regole fondamentali

- Ogni query DB **deve** usare `tenant.id` caricato da `NEXT_PUBLIC_TENANT_SLUG` + `getTenant()`
- Mai hardcodare slug (`'chloefood'`), colori, nomi, label corrieri, o valori tenant-specifici nel codice
- La logica del corriere è **switch-based** su `tenants.shipping_provider` (`packlink` / `flat_rate` / `pickup_only`)
- RLS attivo su tutte le tabelle — il `service_role` bypassa RLS nelle API routes admin
- **Eccezioni statiche note (da rimediare prima del 2° tenant):** `favicon.ico` e `apple-touch-icon.png` in `public/` sono file statici mono-tenant, accettabili temporaneamente con un solo tenant attivo
- **Regola per asset dinamici:** trasformazioni immagine (icone, QR) sempre via API route (es. `/api/pwa-icon?size=192`, `/api/card/qr`) che legge `tenant.logo_url` / `tenant.primary_color` a runtime — mai file statici pre-generati

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

### Configurazione ChloeFood

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

- Cambiare `PACKLINK_API_BASE` da `apisandbox.packlink.com` a `api.packlink.com`
- **TODO segnalato ma non implementato:** aggiungere `carrierName` e `serviceName` all'oggetto `_internal` e a `shipping_details` in DB (Packlink li restituisce già come `"name"` e `"carrier_name"` nella risposta API) — aggiornare interfaccia `PacklinkService`

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

### Billing SaaS (abbonamento Lepefy → tenant)

Pannello `/admin/billing`: mostra stato abbonamento con due opzioni di pagamento — **Stripe Payment Link** (~1,59 € commissione/transazione) e **bonifico bancario** (0 commissioni, opzione raccomandata, causale bonifico auto-generata). Automazione billing completa (Customer Portal / webhook ricorrenti) valutata e **scartata volontariamente** per lo stage attuale: 1 solo tenant attivo, relazione diretta preferita a soluzione tecnica complessa. PayPal personale esplicitamente sconsigliato per raccolta pagamenti business.

---

## 8. Admin dashboard

### Autenticazione — ✅ RISOLTA

`/admin` era **pubblica** fino a metà giugno — problema critico ora risolto:

- **Causa del fallimento iniziale:** Root Directory Vercel = `apps/storefront` impedisce l'esecuzione dell'Edge middleware Next.js in monorepo
- **Soluzione finale:** route group `(protected)` con `admin/layout.tsx` Server Component che chiama `supabase.auth.getUser()` e reindirizza se non autenticato; `admin/login/` fuori dal gruppo protetto per evitare redirect loop
- **Whitelist:** variabile d'ambiente `ADMIN_EMAILS` — solo email designate accedono, non ogni utente registrato sullo storefront
- **Bug critico risolto:** `@supabase/ssr` 0.3.x richiede l'implementazione simultanea delle API cookie vecchie (`get/set/remove`) E nuove (`getAll/setAll`) — fornirne solo una rompe la sessione tra client e server
- **Recovery password:** flusso testato via Supabase Dashboard → Authentication → Users; Site URL in Auth settings deve puntare a `https://chloefood.com` (non `localhost`) per redirect corretto del link di recupero

### Funzionalità implementate

- Lista ordini con KPI cards (totale ordini, fatturato **totale + mese corrente con indicatore delta**, ordini nuovi, "À expédier" cliccabile con filtro)
- Filtri: 4 dropdown selettivi con etichetta esplicita (Statut, Période, Livraison, Paiement) — sostituiscono i vecchi filtri a pillola non descrittivi
- Colonna badge metodo di pagamento nella tabella ordini
- Badge visivo per ordini di oggi
- Badge bandiere SVG per ordini internazionali
- Indicatori storage: ❄ surgelé / 🌿 frais
- Dettaglio ordine: aggiornamento stato + codice tracking
- Select corriere configurabile con modale conferma cambio
- Toggle lingua FR/IT
- **Picking list stampabile** (`/admin/orders/[id]/picking-list`) — layout dedicato senza navbar admin (fix bug stampa), `@media print`, icona di stampa su ogni riga ordine
- **Gestione catalogo prodotti:** sidebar con accordion per categoria, ricerca client-side (predisposta per passare a server-side oltre `catalogue_search_threshold`), colonne ordinabili (nome/prezzo/stock) via URL params, toggle inline Actif, editing inline stock con indicatori colore (rosso=0, ambra<10), drag&drop upload immagine, generazione immagine AI (Gemini, condizionata da `tenant.ai_image_generation`)
- **Pannello billing** (`/admin/billing`)
- **Impostazioni boutique** (`/admin/parametres`) — include download QR code biglietto da visita digitale

---

## 9. Customer order tracking

- Route: `/orders/[id]?token=xxx`
- Protezione: token HMAC-SHA256 (`orderId + email`)
- Timeline stati: `confirmé → en préparation → expédié → livré`
- Link tracking corriere incluso quando disponibile
- Link inviato dal workflow n8n nella email di conferma ordine
- **Phase 2 non ancora avviata:** Supabase Auth clienti + pagina storico ordini `/orders` con tab bottom bar 📦 Commandes come da maquette originale (attualmente Commandes Phase 1 = form inserimento numero ordine + redirect tracking)

---

## 10. n8n automazioni (self-hosted)

**Infrastruttura:** Hetzner **CX23** (Ubuntu 24.04) · Docker + Docker Compose · Caddy reverse proxy · SSL automatico · URL: `https://n8n.lepefy.com` · IP `46.224.127.99`

### Workflow attivi

| Workflow | Trigger | Azioni |
|---|---|---|
| **Conferma ordine** | POST `n8n.lepefy.com/webhook/order-confirmed` (da webhook Stripe) | Email conferma cliente (Brevo SMTP), Reply-To `chloefood.ets@gmail.com` |
| **Notifica spedizione** | POST `n8n.lepefy.com/webhook/order-shipped` (da admin quando stato → shipped) | Email spedizione con tracking code + link pagina tracking |

**Nota SMTP:** il campo User Brevo corretto è la stringa assegnata `smtp-brevo.com`, non l'email personale di login; porta 587 con SSL disabilitato (non 465).

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
- **Icona PWA dinamica:** route `/api/pwa-icon?size=192` con `sharp` per resize server-side, legge `tenant.logo_url` a runtime (nessun file statico per tenant)
- ⚠️ Nota tecnica: la route attualmente serve lo stesso asset indipendentemente da `size`/`purpose` — nessuna vera distinzione tra icona maskable e "any" a runtime; raccomandato usare la versione maskable (con safe-zone) come master unico
- Google Play via TWA/PWABuilder (~25€ una tantum) — roadmap, non avviato

---

## 12. Layout app mobile

- **Hero compatto:** logo 44px + testo, sostituisce il vecchio hero centrato a blocco largo
- **Notification bar** (36px) sotto l'header con animazione ticker CSS
- **Banner emozionale:** verde scuro `#085041` con pattern geometrico CSS (cerchi), supporta `tenant.hero_image_url` opzionale — sostituisce l'idea di uno slider, scartata per motivi UX
- **Bottom navigation bar** (4 tab): 🏠 Accueil · 🛍️ Catalogue · 🛒 Panier (con badge) · 📦 Commandes
- Visibile solo su mobile (`md:hidden`), nascosta nel layout admin
- Homepage: scroll orizzontale per categoria (stile Netflix/App Store, scroll manuale non automatico, card tagliate a bordo destro come affordance visiva); grid su desktop
- **Ricerca real-time:** debounce 300ms + `router.replace` (URL params, condivisibile, back button funzionante) + `useTransition`, estesa dalla homepage al catalogo completo (poi rimossa dalla homepage, mantenuta solo nel catalogo)
- Footer: link "Powered by Lepefy" configurabile per tenant via `tenants.show_powered_by`, punta a `food.lepefy.com`; padding `env(safe-area-inset-bottom)` per non sovrapporsi alla bottom nav fissa su mobile

---

## 13. Catalogo prodotti (ChloeFood)

**File:** `ChloeFood_Template_Catalogue_v2.xlsx` (121 prodotti, 8 categorie: Épices, Légumes, Farines, Poissons, Sauces & Huiles, Snacks, Viandes séchées, Boissons)

Mapping storage: Produits frais → `fresh`, Produits surgelés → `frozen`, tutti gli altri → `dry`.

**Status import:** ✅ **COMPLETATO** — `010_seed_products.sql` eseguita con successo. Migration idempotente (`ON CONFLICT (tenant_id, slug) DO UPDATE`). 8 prodotti senza prezzo inseriti come `active = false` (Thon, Plantains mûrs découpés, Huile rouge 5L, Croquettes, Caramel, Arachides grillées, 2 prodotti acqua). 12 prodotti marcati `featured = true`.

**Regola stock:** `stock` rappresenta il numero di unità vendibili nell'unità di vendita dichiarata (es. se venduto in pacchetti da 500g, stock = numero di pacchetti, non cartoni né kg).

**Generazione immagini AI:** pipeline Gemini a due step — Step 1 `gemini-2.5-flash` genera un prompt fotografico dettagliato (system instruction da esperto di cucina camerunese); Step 2 `gemini-2.5-flash-image` genera l'immagine. SDK `@google/genai`. Upload su Supabase Storage (`products/[slug]-ai.jpg`). Architettura a tre livelli per accuratezza: tabella lookup hardcoded per prodotti critici/specifici (Mitoumba, Bobolo, ecc.), generazione Flash-guidata per prodotti semi-noti, template fissi per categoria per prodotti generici.

---

## 14. Biglietto da visita digitale

- Route `/card` (`chloefood.com/card`) — landing con link social (Instagram, Facebook, TikTok da `tenant_social_links`), dati boutique
- QR code dinamico via `/api/card/qr` con overlay logo nel colore brand del tenant
- Download vCard via `/api/card/vcard`
- QR scaricabile da `/admin/parametres`
- Architettura rigorosamente multi-tenant: nessun colore/URL/telefono/piattaforma social hardcoded, tutto da `tenants` + `tenant_social_links`
- Pricing concordato con Dalice: 100 € totali per landing page + biglietto digitale + QR (stampa fisica esclusa)

---

## 15. Landing page pre-lancio (`chloefood.com`)

Pagina statica trilingue (FR/IT/EN) pubblicata mentre l'e-commerce completo attende le foto prodotto dalla cliente. Contenuti: hero con logo, statistiche (120+ prodotti, 7+ paesi, 4 categorie, spedizione 48h), testimonianze placeholder, percorso prodotto narrativo (4 step), griglia categorie (8 voci), sezione USP, info boutique con orari, CTA finale. Pulsante WhatsApp flottante (numero 393296958822) con messaggio pre-compilato per lingua, icona SVG ufficiale WhatsApp (non emoji, per accessibilità). Riferimenti Packlink rimossi su richiesta cliente, sostituiti con Poste Italiane/BRT/FedEx/TNT. "ETS" rimosso da tutte le occorrenze del nome brand → solo "Chloé Food". Testi generalizzati da "camerunese" a "africano" in tutte e tre le lingue.

**Nuovo logo (in valutazione):** versione JPEG completa integrata nell'hero, versione icona usata per favicon/PWA icon; colore hero portato a blu `#1267C7` in linea con la brand charter v2 — vedi conflitto colore in §2.

---

## 16. Sistema etichette prodotto — 🔧 IN SVILUPPO (lavoro più recente)

Sistema per generare e stampare etichette prodotto (formato tipografico, non browser print) partendo da una maquette fornita dalla cliente.

### Decisioni architetturali

- **Output:** PDF per tipografo, layout N-up su A4 (dimensione etichetta configurabile, default 100×75mm)
- **Rendering:** **Gotenberg** (Docker, self-hosted su Hetzner, stessa VPS di n8n) — scelto al posto di Satori/`@vercel/og` per limiti CSS nel replicare la maquette
- **Modello legale a tre livelli:** produttore → importatore → distributore/tenant (tabelle `producers`, `importers`)
- **Dati produttore a livello prodotto** (non tenant)
- **`label_logo_url`** campo dedicato, separato dal `logo_url` generale del tenant
- **Sfondo personalizzabile** per categoria con override per singolo prodotto (immagine preferita, colore come fallback)
- **Multi-template:** fissato alla maquette fornita in v1, supporto multi-template pianificato per Phase 2

### File principali (da `ClaudeCode_Prompt_SistemaEtichette.md`)

- Migration `017_label_system.sql` — tabelle `producers`, `importers`, `label_settings`, `label_print_jobs` + estensioni a `products`, `categories`, `tenants`
- `packages/types/labels.ts` — tipi condivisi
- `lib/labels/calculateLayout.ts`, `lib/labels/resolveBackground.ts`
- `templates/default.tsx` — componente React che replica la maquette, tutti i dati da tenant/prodotto/categoria a runtime
- `buildSheetHtml.tsx` (via `renderToStaticMarkup`) + client Gotenberg
- API routes `/api/labels/preview` (solo HTML, non chiama Gotenberg) e `/api/labels/generate` (Gotenberg + upload Supabase Storage + insert `label_print_jobs`)
- Pagine admin sotto `/admin/etichette` seguendo le convenzioni di `ProductEditClient.tsx`

### Stato attuale / bug aperti

- ✅ Migration `017` applicata
- ✅ Migration `018_fix_grants.sql` applicata — risolto `permission denied` su upload logo (mancavano GRANT UPDATE su `tenants`, `categories`, `products` a `service_role`)
- ⚠️ **Gotenberg non ancora installato su Hetzner** — richiede reverse proxy Caddy con autenticazione per essere raggiungibile da Vercel (bind solo localhost non sufficiente)
- ✅ **Errore 400 su `/api/labels/preview`** — risolto (non era correlato a Gotenberg, che la preview non chiama)
- ⚠️ **Data quality flag:** i valori nutrizionali usati nell'etichetta BOBOLO Sous Vide corrispondevano alla scheda prodotto Foufou, non Bobolo — richiede verifica dal produttore prima di ristampare
- **Dati Excel etichette (~24 prodotti):** confermati dati legali reali — ragione sociale "Chloé Food ETS", indirizzo "Via Angelo Zanti, 1C - 42122 Reggio Emilia", email `chloefood.ets@gmail.com`; importatore ricorrente **AFRICOOP Società Cooperativa** (Modena). Problemi noti: campi lotto/data corrotti (seriali Excel tipo `42026.0`) in ~8 schede, titoli scheda non corrispondenti per errori di copia-incolla, valori nutrizionali espressi in percentuale in 2 schede da chiarire col produttore.

### Idea Phase 2 — uso IA nel sistema etichette (non ancora implementata, salvata per dopo)

1. Generazione sfondo etichetta per categoria/prodotto riusando la pipeline Gemini già esistente (stesso flag `tenant.ai_image_generation`)
2. Pass IA che legge documenti fornitore (Excel, foto etichetta) e propone valori nei campi del form etichetta (ingredienti, conservazione, ecc.) — sempre da confermare/correggere manualmente, mai pubblicati direttamente
3. QA automatico di coerenza (es. nome prodotto contiene "latte" ma allergene lattosio non marcato) — segnala, non decide

**Esclusi sempre dall'IA:** valori nutrizionali, allergeni, dati legali produttore/importatore, lotto/date — mai dedotti o generati, sempre campo esplicito con default sicuro. Nessun output IA su questi campi pubblicato senza conferma umana esplicita.

**Priorità attuale:** far funzionare il sistema etichette base (debug preview 400 in corso) prima di procedere con le funzionalità IA.

---

## 17. Variabili d'ambiente complete (Vercel)

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
NEXT_PUBLIC_APP_URL=https://chloefood.com

# Admin auth
ADMIN_EMAILS=...

# Gotenberg (da aggiungere una volta installato su Hetzner)
GOTENBERG_URL=...
GOTENBERG_AUTH=...
```

---

## 18. Checklist go-live

| Task | Responsabile | Stato |
|---|---|---|
| Importare ~120 prodotti reali da `ChloeFood_Template_Catalogue_v2.xlsx` | Robertin | ✅ FATTO |
| Aggiungere autenticazione a `/admin` | Robertin | ✅ FATTO |
| Configurare dominio personalizzato `chloefood.com` | Robertin | ✅ FATTO |
| Cambiare `PACKLINK_API_BASE` → `api.packlink.com` | Robertin | ⚠️ DA FARE |
| Sostituire chiavi Stripe test con chiavi live ChloeFood | ChloeFood | ⚠️ DA FARE |
| Registrare webhook Stripe sull'account ChloeFood | ChloeFood | ⚠️ DA FARE |
| Confermare trattamento IVA spedizione con commercialista | ChloeFood | ⚠️ DA FARE |
| Eliminare ordini di test dal DB | Robertin | ⚠️ DA FARE |
| Test E2E: ordine IT + ordine FR + Click & Collect | Robertin | ⚠️ DA FARE |
| Risolvere errore 400 su `/api/labels/preview` | Robertin | ✅ FATTO |
| Installare Gotenberg su Hetzner + Caddy auth | Robertin | ⚠️ DA FARE |
| Verificare dati nutrizionali/lotto con produttori prima di stampare etichette | Robertin / produttori | ⚠️ DA FARE |
| Decisione brand charter v2 (verde vs blu) | Dalice | ⚠️ PENDENTE |
| Completare contratto SaaS (dati fiscali, foro, DPA) | Robertin | ⚠️ DA FARE |

---

## 19. Roadmap Phase 2 (post go-live)

| Feature | Categoria | Priorità | Stato |
|---|---|---|---|
| Autenticazione clienti (Supabase Auth) + pagina `/orders` storico | Contrattuale | P0 | Non avviato |
| Sistema etichette prodotto (Gotenberg) | Tecnico | P0 | 🔧 In sviluppo |
| Draft Packlink automatico al pagamento ("effet waouhhh") | Tecnico | P1 | Non avviato |
| `carrierName` + `serviceName` in `shipping_details` DB | Tecnico | P1 | Non avviato |
| IA nel sistema etichette (sfondi, estrazione dati bozza, QA coerenza) | Tecnico | P2 | Idea salvata, non implementata |
| Google Play Store via TWA/PWABuilder | Growth | P1 | Non avviato |
| Apple App Store via Capacitor | Growth | P2 | Non avviato |
| Onboarding secondo tenant | SaaS | P1 | Guida `Lepefy_Onboarding_Tenant_v1.docx` pronta; asset statici mono-tenant da rimediare prima |
| Rate limiting su `/api/checkout` e `/api/shipping/quote` | Tecnico | P1 | Non avviato |
| Test automatizzati (almeno `calculateShipping.ts` + webhook) | Tecnico | P2 | Non avviato |

### Phase 2 — Packlink draft feature (dettaglio)

Al pagamento, chiamare `POST /v1/draft` Packlink per creare una spedizione pre-compilata. Salvare `shipment_reference` in `orders.packlink_draft_ref`. Mostrare bottone "Créer expédition Packlink →" nella dashboard admin che apre direttamente il draft in Packlink. Richiede: API route `POST /api/orders/[id]/draft-packlink` + migration campo `orders.packlink_draft_ref`.

---

## 20. Principi di sviluppo

### Workflow preferito (Robertin)

1. Discussione + validazione con mockup/widget interattivi
2. Generazione prompt Claude Code con tutte le modifiche consolidate, salvato come `.md` in `/mnt/user-data/outputs/`
3. Output come file completi (non diff), pronti per GitHub web UI
4. Nessun comando bash locale — tutto via GitHub web + Vercel auto-deploy
5. Robertin esegue separatamente e riporta i risultati (build error, screenshot) per l'iterazione successiva

### Regole critiche

- **No ambiente locale.** Robertin lavora esclusivamente via GitHub web UI + Vercel. Tutti i file devono essere pronti per copia-incolla diretto.
- **Webhook-first sempre.** Gli ordini esistono solo dopo `payment_intent.succeeded`. Mai creare ordini in anticipo.
- **Multi-tenancy vigilance — regola permanente.** Ogni valore hardcodato (`'chloefood'`, `'Packlink'`, carrier names, icone PWA statiche) è un bug. Sempre usare `tenant.id`/`getTenant()` e logica switch-based/API route dinamica. Se una soluzione non è multi-tenant compatibile, va segnalato esplicitamente prima di procedere, proponendo l'alternativa corretta.
- **Supabase permissions.** Sempre `GRANT USAGE ON SCHEMA public TO anon, authenticated` + `GRANT SELECT` esplicito per tabella + `GRANT UPDATE ... TO service_role` per tabelle scritte da API route admin. Testare con `SET role anon;`.
- **TypeScript strict.** Build errors tracciati dai Vercel build logs. Fix sistematici via prompt Claude Code, non patch one-off.
- **Repo pubblico.** Necessario per Vercel free plan. Non inserire mai segreti nel codice.
- **Dati sensibili (nutrizionali, allergeni, legali, lotto/date) mai generati o dedotti dall'IA** — sempre campo esplicito con default sicuro, conferma umana obbligatoria prima della pubblicazione.
- **Vercel monorepo + middleware.** Root Directory = `apps/storefront` impedisce l'Edge middleware: l'auth va gestita a livello di route group `(protected)` con Server Component, non middleware.
- **`@supabase/ssr` 0.3.x** — implementare sempre sia le API cookie vecchie che nuove insieme, o le sessioni si rompono tra client e server.

---

## 21. Documenti di riferimento nel progetto

| File | Contenuto |
|---|---|
| `Lepefy_Roadmap_Tecnica.docx` | Roadmap completa Phase 1/2/3, stack, checklist go-live, rischi |
| `ChloeFood_Template_Catalogue_v2.xlsx` | Catalogo prodotti 121 items — ✅ importato |
| `Maquette/` | Design reference originale ChloeFood |
| `ClaudeCode_Prompt_MobileLayout.md` | Prompt Claude Code per bottom nav + homepage |
| `ClaudeCode_Prompt_SistemaEtichette.md` | Prompt Claude Code per sistema etichette (in sviluppo) |
| `Lepefy_Onboarding_Tenant_v1.docx` | Guida interna onboarding secondo tenant |
| `Contrat_SaaS_LepefyLabs_ChloeFood.docx` | Contratto SaaS bilingue FR/IT (10 articoli, versione precedente) |
| Contratto SaaS 16 articoli (diritto italiano) | Versione estesa — mancano dati fiscali, foro, email contrattuale, DPA |
| `Charte_graphique_Chloe_Food_1.pdf` | Nuova brand charter v2 (20 pagine) — in valutazione |
| `chloe_food_logo.svg` | Logo vettoriale ricostruito (bug viewBox corretto) |
| `INTEGRATION.md` | Guida integrazione sistema spedizione Packlink |

---

*Lepefy Labs — Lepefy Food Platform — Context document v2.0 — 9 Luglio 2026*
