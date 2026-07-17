# Lepefy Food Platform — Project Context

> Documento di riferimento per Claude Code, onboarding sviluppatori, e continuità tra sessioni.
> Aggiornato: 17 Luglio 2026 — chiuso il ciclo di audit e redesign frontend/UI-UX dello storefront (Fase 1: de-hardcoding token + accessibilità; Fase 2: unificazione ProductCard + immagini/icone/skeleton/tipografia; Fase 3: font Bricolage Grotesque, colore primario blu `#1267C7`, elemento signature "cartellino da bottega"). Dettaglio completo in §12bis. Base di questa revisione: v3.3 (16 Luglio), invariata su tutto il resto non toccato dal redesign.

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
| **Frontend** | Next.js 14.2.3 (App Router) | Storefront + API routes, SSR — versione confermata in `apps/storefront/package.json` |
| **Stile** | Tailwind CSS 3.4.3 | Design system tokenizzato (audit UI/UX Luglio 2026, §12bis): colori tenant via CSS vars (`--color-primary`, `--color-secondary`, `--color-primary-dark/-light/-hover` derivati via `color-mix()`), scala `--radius-sm/md/lg/full`, `--shadow-card`, scala tipografica dichiarata in `tailwind.config.ts`. Font: Inter (body, `next/font/google`) + Bricolage Grotesque (display/titoli, font di piattaforma non tenant-specifico) |
| **State** | Zustand 4.5.2 | Cart store con persist + `shippingPayload()` |
| **Database** | Supabase (PostgreSQL) | `lepefy-food-platform`, RLS attivo su tutte le tabelle |
| **Auth** | Supabase Auth | **Admin: ✅ implementata** (pagine via route group `(protected)` **+ API routes via `requireAdmin()`**, vedi §2.1) · Clienti: Phase 2 |
| **Storage** | Supabase Storage | Bucket `assets` pubblico (logo, PWA icon, etichette, PDF etichette) |
| **Hosting** | Vercel (free plan) | Root Directory: `apps/storefront` — ⚠️ Root Directory impedisce l'esecuzione dell'Edge middleware (`middleware.ts` è di proposito un `export {}` vuoto) |
| **Pagamenti** | Stripe Elements + Satispay | Satispay via Stripe nativo, nessun codice extra. ⚠️ Nessuno Stripe Connect: gli incassi arrivano sull'account piattaforma Lepefy, il giroconto al tenant è manuale |
| **Spedizione** | Packlink PRO API | Quote real-time, importo certificato da token HMAC (§6/§7) — ⚠️ ancora in sandbox, da passare a `api.packlink.com` |
| **Email/Automation** | n8n self-hosted | Hetzner CX23, Ubuntu 24.04, Docker + Caddy, SMTP Brevo |
| **PWA** | `manifest.ts` dinamico + SW + `/api/pwa-icon` | Icona dinamica per tenant via API route (sharp) |
| **Rendering etichette** | Gotenberg (Docker, Hetzner) | **✅ Deploy completo e verificato end-to-end** (`lib/labels/gotenberg.ts`) — container attivo su Hetzner, `gotenberg.lepefy.com` con Caddy basic auth + SSL Let's Encrypt, header Authorization aggiunto, PDF reale generato e verificato da un job vero, vedi §16 |
| **AI immagini prodotto** | Gemini 2.5 Flash + `gemini-2.5-flash-image` | SDK `@google/genai`, pipeline a due step |
| **AI descrizioni prodotto** | Gemini 2.5 Flash (testo) | ✅ Completo, batch eseguito su tutto il catalogo — vedi §13bis |
| **AI rate limiting + cost tracking** | Tabelle `ai_pricing`/`ai_usage_log` (Supabase) | ✅ Completo su tutte le route AI (admin + pubbliche) — vedi §13bis |
| **AI ricerca semantica** | pgvector + `gemini-embedding-001` | ✅ Completo, batch embeddings eseguito su tutto il catalogo — vedi §13bis |
| **Monorepo** | pnpm workspaces (`pnpm@8.15.0`) | `apps/storefront` + `packages/types` |
| **TypeScript** | Strict | Types condivisi in `packages/types` |

**Colori brand ChloeFood (attuali, in produzione dal redesign Fase 3 — vedi §12bis):**
- Primary: **`#1267C7` (blu)** — valore in `tenants.primary_color` per il tenant `chloefood`, letto dinamicamente da `getTenant()`; nessun hex hardcodato nel codice, solo `var(--color-primary)` e derivati
- Secondary: `#F2C811` (giallo/oro) — usato anche come colore del componente signature `ShopTag` (cartellino da bottega, §12bis)
- Accent light: `#E1F5EE`

**✅ Brand charter v2 — decisione presa e implementata (17/07):** il colore primario è passato dal verde `#1D9E75` al blu `#1267C7`, allineando lo storefront al colore dominante del wordmark nel logo reale (`chloe_food_logo.svg`), verificato durante il redesign: il logo era già a dominanza blu con verde solo su foglie/swoosh e oro sulle posate — il sito precedente (tutto verde) divergeva dal proprio logo. Il cambio è stato applicato come **dato** (update `tenants.primary_color`), non come hex hardcodato in nessun componente. Charter completa (20 pagine, `Charte_graphique_Chloe_Food_1.pdf`) resta di riferimento solo per asset grafici extra (packaging, materiali stampa) non ancora affrontati.

### 2.1 Revisione di sicurezza — ✅ 4 criticità risolte (deployate 2026-07-02)

Una code review tecnica (`docs/PROJECT_REVIEW.md`) ha identificato e la piattaforma ha **corretto e deployato in produzione** 4 falle critiche/alte:

1. **API admin senza autenticazione (CRITICO).** Le route `POST /api/admin/catalogue`, `PATCH/DELETE /api/admin/catalogue/[id]`, `PATCH /api/admin/orders/[id]`, `POST /api/admin/generate-product-image`, `POST /api/admin/upload-product-image` usavano `createServiceClient()` (bypassa RLS) senza mai verificare sessione o whitelist `ADMIN_EMAILS` — chiunque conoscesse l'URL poteva scrivere. **Fix:** nuovo helper `src/lib/auth/requireAdmin.ts`, chiamato in testa a ogni route admin (incluse ora anche le route etichette `/api/admin/labels/*` e upload asset), risponde 401/403 senza sessione valida.
2. **Checkout fidato del client (CRITICO).** Prezzo e costo di spedizione arrivavano dal browser — un payload modificato poteva far pagare 0,01 € l'intero carrello. **Fix:** `api/checkout/route.ts` rilegge prezzo/nome/`storage_type` dal DB per `productId` (filtrato per tenant + prodotti attivi); il costo di spedizione è certificato da un token HMAC-SHA256 (`src/lib/shipping/quoteToken.ts`) emesso da `/api/shipping/quote` che lega importo/paese/CAP/scadenza (1h) — il checkout lo verifica e confronta con l'indirizzo; il pickup è forzato a spedizione 0 lato server.
3. **Policy RLS troppo permissive (ALTO).** `orders_insert_any`/`order_items_insert_any` con `with check (true)` permettevano insert arbitrari con la anon key pubblica. **Fix:** `016_security_hardening.sql` rimuove le due policy — tutti gli insert reali passano dal service role.
4. **Idempotenza webhook fragile (ALTO).** Il check "ordine già esistente?" era check-then-insert, vulnerabile a doppio retry Stripe concorrente. **Fix:** stessa migration 016, indice unico parziale su `orders.stripe_payment_intent_id`; il webhook tratta la unique violation (23505) come ordine già creato da un retry concorrente.

**Debito residuo noto (non ancora corretto):** nessuna gestione stock reale al checkout (stock default 999, mai decrementato); `FROM_ADDRESS` ancora hardcoded `IT 42122` in `api/shipping/quote/route.ts` nonostante esista `warehouse_location`; il breakdown spedizione (`_internal`: corriere, IVA, surcharge 3€/pacco) è visibile nei devtools nonostante la doc affermi sia nascosto; file morti `src/app/admin/orders/[id]/` e `src/app/admin/orders/id/` (vedi §8); `xlsx@0.18.5` ha vulnerabilità note senza fix; `@supabase/ssr@0.3` datato; zero test automatizzati. Dettaglio completo in `docs/PROJECT_REVIEW.md`.

---

## 3. Struttura repository

```
lepefy-food-platform/
├── apps/
│   └── storefront/                    # Next.js 14 App Router
│       ├── middleware.ts              # export {} vuoto — NON usato (Root Directory Vercel lo impedisce)
│       ├── src/
│       │   ├── app/
│       │   │   ├── (shop)/            # Layout storefront pubblico
│       │   │   │   ├── page.tsx       # Homepage (bottom nav, hero compatto, scroll orizzontale per categoria)
│       │   │   │   ├── products/      # Catalogo con ricerca real-time debounced (URL params)
│       │   │   │   ├── cart/          # Carrello
│       │   │   │   ├── checkout/      # Checkout Stripe Elements
│       │   │   │   └── orders/[id]/   # Tracking ordine (token HMAC)
│       │   │   ├── card/               # Biglietto da visita digitale (chloefood.com/card)
│       │   │   ├── admin/
│       │   │   │   ├── login/         # Fuori dal route group protetto (evita redirect loop)
│       │   │   │   ├── orders/[id]/   # ⚠️ NON è una route (nessun page.tsx) — cartella di componenti condivisi
│       │   │   │   │                  #    (OrderDetail.tsx, PickingList.tsx) importati dalla pagina protetta sottostante
│       │   │   │   ├── orders/id/     # ⚠️ CODICE MORTO — copia precedente di PickingList.tsx, nessun import nel repo
│       │   │   │   └── (protected)/   # ✅ Protetto via Supabase Auth + ADMIN_EMAILS whitelist
│       │   │   │       ├── page.tsx              # Lista ordini + KPI (totale/mese + delta)
│       │   │   │       ├── orders/[id]/           # Dettaglio ordine — importa OrderDetail.tsx + PickingList.tsx da ../../../orders/[id]/
│       │   │   │       │                          #   ⚠️ NON esiste una route/picking-list separata: la stessa pagina
│       │   │   │       │                          #   renderizza sia il dettaglio (div.no-print) sia la PickingList,
│       │   │   │       │                          #   e `@media print` nasconde .no-print al momento della stampa
│       │   │   │       ├── catalogue/             # Lista prodotti (drag&drop img, AI gen, stock inline)
│       │   │   │       ├── catalogue/[id]/        # Modifica prodotto esistente
│       │   │   │       ├── catalogue/nouveau/      # Creazione nuovo prodotto (riusa ProductEditClient)
│       │   │   │       ├── products/[id]/etichetta/         # Lista job etichetta per prodotto
│       │   │   │       ├── products/[id]/etichetta/[jobId]/ # Editor draft etichetta (template/palette/origin-style/preview live/autosave)
│       │   │   │       ├── billing/              # Pannello abbonamento (Stripe Payment Link + bonifico)
│       │   │   │       └── parametres/           # Impostazioni boutique, QR biglietto digitale
│       │   │   ├── admin/_components/AdminSidebar.tsx   # Sidebar navigazione admin (fuori dal route group, condivisa)
│       │   │   ├── admin/(protected)/AdminNav.tsx, AdminFilters.tsx, OrdersTable.tsx  # Componenti dashboard ordini
│       │   │   └── api/
│       │   │       ├── checkout/                    # Ricalcola prezzi/spedizione server-side, crea PaymentIntent
│       │   │       ├── shipping/quote/               # Calcolo spedizione + emissione token HMAC
│       │   │       ├── webhooks/stripe/              # Crea ordine dopo payment_intent.succeeded (idempotente)
│       │   │       ├── health/                       # Health check ({ ok, tenant, ts })
│       │   │       ├── pwa-icon/                     # Icona PWA dinamica per tenant (sharp resize)
│       │   │       ├── card/qr-code/                 # QR code biglietto digitale con logo overlay
│       │   │       ├── card/vcard/                   # Download vCard biglietto digitale
│       │   │       └── admin/                        # Tutte protette da requireAdmin()
│       │   │           ├── login/                    # Login admin, imposta cookie sessione
│       │   │           ├── catalogue/, catalogue/[id]/  # CRUD prodotti
│       │   │           ├── orders/[id]/              # Aggiorna stato/tracking
│       │   │           ├── generate-product-image/   # AI Gemini (maxDuration 60s)
│       │   │           ├── upload-product-image/     # Upload immagine prodotto storefront
│       │   │           ├── upload-label-asset/       # Upload sfondo/logo per etichette
│       │   │           └── labels/
│       │   │               ├── preview/              # Solo HTML (no Gotenberg), per iframe live
│       │   │               ├── generate/             # Chiama Gotenberg + upload PDF + aggiorna job → 'generated'
│       │   │               ├── jobs/                 # GET lista / POST crea draft (con duplicateFromId per ristampa)
│       │   │               └── jobs/[id]/             # PATCH autosave draft / DELETE draft
│       │   ├── lib/
│       │   │   ├── auth/
│       │   │   │   └── requireAdmin.ts   # Guard riusato da tutte le API admin (sessione + whitelist) — unica eccezione: admin/login/route.ts
│       │   │   ├── ai/
│       │   │   │   ├── embeddings.ts     # Genera embedding gemini-embedding-001 (ricerca semantica)
│       │   │   │   └── usageTracking.ts  # checkRateLimit()/logAiUsage() — vedi §13bis
│       │   │   ├── images/
│       │   │   │   └── removeBackground.ts  # Rimozione sfondo immagine prodotto (pipeline AI)
│       │   │   ├── shipping/
│       │   │   │   ├── calculateShipping.ts  # Engine spedizione principale
│       │   │   │   └── quoteToken.ts         # Firma/verifica HMAC del preventivo spedizione
│       │   │   ├── labels/                   # Sistema etichette — vedi §16 (maturo, non più "in sviluppo")
│       │   │   │   ├── calculateLayout.ts    # Grid N-up (cols/rows/perSheet) da dimensioni foglio/etichetta
│       │   │   │   ├── resolveBackground.ts  # Sfondo pannello: prodotto → categoria → palette ambient → fallback
│       │   │   │   ├── buildSheetHtml.tsx    # Sceglie template, renderToStaticMarkup, CSS foglio/crop marks
│       │   │   │   ├── gotenberg.ts          # htmlToPdf() — chiamata reale a GOTENBERG_URL
│       │   │   │   ├── palettes.ts           # 3 palette colore (verde_palma / blu_epices / terra_piccante)
│       │   │   │   ├── originFlags.tsx       # Bandiere SVG disegnate a mano (9 paesi, no emoji — compat Gotenberg)
│       │   │   │   ├── formatDate.ts         # Formattazione data IT
│       │   │   │   └── templates/            # ⚠️ TRE template, non due
│       │   │   │       ├── default.tsx       # "Classico" — due colonne, origin-style implementato
│       │   │   │       ├── fullbleed.tsx     # Sfondo a piena pagina — origin-style NON implementato (solo testo semplice)
│       │   │   │       └── banner.tsx        # "Fascia Dorata" — fascia logo a tutta larghezza, nutrizione a sx/nome al centro/foto a dx, origin-style implementato
│       │   │   ├── store/
│       │   │   │   └── localeStore.ts # Zustand store toggle lingua FR/IT storefront (persist)
│       │   │   ├── tenant/
│       │   │   │   ├── getTenant.ts             # Fetch tenant da slug (Next.js cache())
│       │   │   │   └── getTenantSocialLinks.ts  # Fetch link social per biglietto digitale
│       │   │   ├── utils/
│       │   │   │   ├── cn.ts          # Helper classnames
│       │   │   │   └── format.ts      # formatPrice/formatDate
│       │   │   └── supabase/
│       │   │       ├── client.ts      # Browser client
│       │   │       ├── server.ts      # createClient()/createServiceClient() — richiede API cookie get/set/remove E getAll/setAll
│       │   │       └── types.ts       # Database types generati
│       │   └── stores/
│       │       └── cartStore.ts       # Zustand cart store
│       └── public/
│           ├── sw.js                  # Service worker PWA
│           └── favicon.ico, icons/apple-touch-icon.png  # ⚠️ eccezione statica mono-tenant, da rimediare al 2° tenant
├── packages/
│   └── types/                         # Shared TypeScript interfaces (@lepefy/types)
│       ├── index.ts                   # Ri-esporta tutti i moduli sottostanti
│       ├── tenant.ts, product.ts, order.ts, customer.ts, socialLinks.ts
│       ├── ai.ts                      # Tipi AiPricing/AiUsageLogEntry — vedi §13bis
│       ├── labels.ts                  # ⚠️ NON legacy — file più aggiornato del package, allineato a migration 018–025
│       └── shipping.ts                # Legacy (zone/rate) — superato dal modello Packlink/shipping_provider, ma ancora esportato
└── supabase/
    └── migrations/                    # 001–028, numerazione non lineare (vedi §4)
```

---

## 4. Schema database (Supabase)

### Tabelle principali

| Tabella | Descrizione |
|---|---|
| `tenants` | Un record per boutique. Colori, slug, Stripe account, `shipping_provider`, `show_powered_by`, `ai_image_generation`, `whatsapp_number`, `catalogue_search_threshold`, campi billing, **`locales`** (lingue attive, prima = default), **`ai_description_generation`**, **`ai_semantic_search`**, **`ai_rate_limit_public_per_minute`/`ai_rate_limit_public_per_day`/`ai_rate_limit_admin_per_day`** |
| `categories` | Categorie prodotti per tenant (con supporto background per etichette) |
| `products` | Prodotti — `storage_type` (dry/fresh/frozen), `weight_grams`, `position`, `warehouse_location`, `name_alt`, `producer_id`/`importer_id`, campi etichetta (ingredienti, allergeni, nutrizione, paese origine), **`descriptions`** jsonb multilingue (`{"fr":"...","it":"..."}`), **`description_source`** (`ai`/`human`), **`embedding`** vector(768) per ricerca semantica |
| `ai_pricing` | Listino prezzi AI configurabile — `provider` (`gemini`, futuro `anthropic`), `model`, prezzi input/output/immagine per milione token, `currency`. Aggiornato via SQL quando i provider cambiano prezzo, mai hardcoded nel codice |
| `ai_usage_log` | Log per-chiamata di ogni richiesta AI (tutte le route, admin e pubbliche) — token input/output, immagini generate, `estimated_cost_usd` calcolato dai prezzi correnti in `ai_pricing`, `status` (`success`/`error`/`rate_limited`). Base sia per il rate limiting (query su finestra temporale) sia per il cruscotto costi (vista `ai_usage_monthly_by_tenant`) |
| `orders` | Ordini creati SOLO dopo `payment_intent.succeeded` webhook; indice unico su `stripe_payment_intent_id` (idempotenza) |
| `order_items` | Righe ordine con `storage_type`, `warehouse_location`, `name_alt` copiati dal prodotto |
| `customers` | Linked a `auth.users` — Phase 2 |
| `addresses` | Indirizzi clienti |
| `checkout_sessions` | Sessioni temporanee checkout (eliminate dal webhook dopo creazione ordine) — contengono anche email/telefono carrelli incompleti, mai sfruttate per recupero carrello abbandonato (vedi §19) |
| `packaging_surcharges` | Configurazione surplus imballaggio per tenant (1 riga, incluse dimensioni box L×W×H) |
| `shipping_vat_rates` | IVA spedizione per paese (N righe per tenant) |
| `carriers` | Corrieri configurabili per tenant (dropdown admin) |
| `tenant_social_links` | Link social per biglietto da visita digitale |
| `producers` | Anagrafica produttori (sistema etichette) |
| `importers` | Anagrafica importatori (sistema etichette) — es. AFRICOOP Società Cooperativa |
| `label_print_jobs` | Job di stampa etichette — `status` (`draft`/`generated`), `duplicated_from_id` (ristampa), `palette`, `natural_badge`, `origin_style`, `pdf_url` |

**121 prodotti reali importati e poi riseminati** (`020_reseed_products_catalogue_v2.sql`, idempotente `ON CONFLICT (tenant_id, slug) DO UPDATE`) dal catalogo `ChloeFood_Template_Catalogue_v2`, 8 categorie: Épices, Légumes, Farines, Poissons, Sauces & Huiles, Snacks, Viandes séchées, Boissons. Ulteriori prodotti aggiunti da `022_new_products_from_labels.sql` (scoperti nei dati etichette ma assenti dal catalogo v2, seminati inattivi/prezzo 0 in attesa di attivazione admin).

### Migrations — stato reale confermato su filesystem (13/07)

⚠️ La numerazione **non è lineare** — diverse migration hanno commenti che spiegano esplicitamente il motivo (numero già occupato al momento della scrittura). Non mancano file: la sequenza sotto è quella realmente presente in `supabase/migrations/`.

| File | Contenuto |
|---|---|
| `001_initial_schema.sql` | Schema base: tenants (default colori `#1D9E75`/`#F2C811`), categories, products, orders, order_items, customers, addresses |
| `002_rls_policies.sql` | RLS su tutte le tabelle core + policy pubbliche di lettura |
| `003_shipping_packlink.sql` | `products.storage_type`; decisioni Packlink PRO (real-time, surcharge 3€) |
| `003b_packaging_dimensions.sql` | Dimensioni box L×W×H su `packaging_surcharges` (peso volumetrico) |
| `003c_shipping_provider.sql` | `tenants.shipping_provider` + `packlink_api_key` |
| `004_shipping_details.sql` | `orders.shipping_details` jsonb |
| `006_checkout_sessions.sql` | Tabella `checkout_sessions` |
| `006_fix_tracking_carrier.sql` | Rimuove default hardcoded `'poste_italiane'` su `orders.tracking_carrier` |
| `007_order_items_storage_type.sql` | `order_items.storage_type` |
| `008_carriers.sql` | Tabella `carriers` per tenant |
| `009_click_collect_hours.sql` | `tenants.click_collect_hours` |
| `010_products_picking_fields.sql` | `warehouse_location`, `name_alt` su `products` |
| `010_warehouse_location.sql` | Stessi campi denormalizzati anche su `order_items` (versione alternativa/duplicata della 010 precedente) |
| `011_tenant_billing.sql` | Colonne billing SaaS su `tenants` (subscription_status, subscription_paid_until, stripe_payment_link, IBAN/BIC) |
| `011_tenants_powered_by.sql` | `tenants.show_powered_by` |
| `013_catalogue_admin.sql` | `tenants.ai_image_generation` + grants |
| `014_sidebar_features.sql` | No-op — placeholder dichiarato per mantenere la sequenza numerica |
| `015_catalogue_ux.sql` | `tenants.catalogue_search_threshold` (default 500) |
| `016_security_hardening.sql` | ✅ Rimuove policy RLS insert-any su orders/order_items; indice unico su `stripe_payment_intent_id` (vedi §2.1) |
| `017_tenant_digital_card.sql` | `tenants.whatsapp_number` + tabella `tenant_social_links` |
| `018_label_system.sql` | Fondamenta sistema etichette: tabelle `producers`, `importers` (numerata 018 perché 017 già occupata) |
| `019_link_default_producer.sql` | Data fix una tantum: collega prodotti ChloeFood senza `producer_id`/`importer_id` al produttore/importatore di default |
| `020_reseed_products_catalogue_v2.sql` | Reseed completo `products` (121 prodotti) da catalogo v2, idempotente |
| `021_update_label_data_batch1.sql` | Bulk update dati etichetta (ingredienti/allergeni/nutrizione/origine) per 22 prodotti, da fonte Excel |
| `022_new_products_from_labels.sql` | Nuovi prodotti scoperti nei dati etichette, assenti dal catalogo v2 — seminati inattivi |
| `023_label_job_drafts.sql` | `label_print_jobs`: `status`, `duplicated_from_id`, `updated_at` |
| `023_label_print_jobs_drafts_reprint.sql` | Variante quasi duplicata della precedente — aggiunge anche GRANT UPDATE a `service_role`, trigger `updated_at`, indice `(tenant_id, product_id, status, updated_at)` |
| `024_label_palette_and_natural_badge.sql` | `label_print_jobs.palette` (verde_palma/blu_epices/terra_piccante, default blu_epices) + `natural_badge` boolean |
| `025_label_origin_style.sql` | `label_print_jobs.origin_style` (pill/block/medallion, default pill) |
| `026_ai_descriptions.sql` | `products.descriptions` jsonb + `products.description_source` (`ai`/`human`) + configurazione lingue tenant |
| `027_ai_rate_limiting_cost_tracking.sql` | Tabelle `ai_pricing` (listino prezzi per provider/model) e `ai_usage_log` (log per-chiamata) + funzione `check_ai_rate_limit` + vista `ai_usage_monthly_by_tenant` |
| `028_semantic_search.sql` | Estensione `vector`; `products.embedding` vector(768); indice HNSW cosine; funzione `match_products` |

**Non esistono file 005 e 012** — non sono stati saltati per errore, la numerazione riflette semplicemente collisioni risolte con suffissi (003b/003c) o rinomina all'atto della scrittura, come documentato nei commenti di intestazione di `018` e `023`.

**✅ Migration IA — numerazione confermata su filesystem reale (revisione 15/07).** Le tre feature sono finite su `026_ai_descriptions.sql` → `027_ai_rate_limiting_cost_tracking.sql` → `028_semantic_search.sql`, cioè i tre numeri immediatamente successivi a `025_label_origin_style.sql` (non collisioni con 023/024/025 come si temeva in una nota precedente di questo documento, ormai superata).

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
- RLS attivo su tutte le tabelle — il `service_role` bypassa RLS nelle API routes admin (ora tutte protette anche a livello applicativo da `requireAdmin()`, vedi §2.1)
- **Eccezioni statiche note (da rimediare prima del 2° tenant):** `favicon.ico` e `apple-touch-icon.png` in `public/` sono file statici mono-tenant, accettabili temporaneamente con un solo tenant attivo
- **Regola per asset dinamici:** trasformazioni immagine (icone, QR) sempre via API route (es. `/api/pwa-icon?size=192`, `/api/card/qr-code`) che legge `tenant.logo_url` / `tenant.primary_color` a runtime — mai file statici pre-generati
- **Limite architetturale noto (§18/§19):** il tenant è risolto da `NEXT_PUBLIC_TENANT_SLUG` a build time → ogni nuovo negozio richiede un deployment Vercel dedicato. Regge fino a ~5 tenant; evoluzione naturale è risolvere il tenant dal dominio (header `Host`) prima di onboardare il terzo cliente.

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

### Sicurezza preventivo (aggiunto nella revisione 2026-07-02)

`/api/shipping/quote` emette un token HMAC-SHA256 (`src/lib/shipping/quoteToken.ts`) che lega importo, paese, CAP e scadenza (1h). Il checkout verifica il token e lo confronta con l'indirizzo di consegna prima di accettare l'importo — il cliente non può più forzare un costo di spedizione arbitrario dal browser.

### File chiave

- `apps/storefront/src/lib/shipping/calculateShipping.ts` — engine principale
- `apps/storefront/src/lib/shipping/quoteToken.ts` — firma/verifica HMAC del preventivo
- `apps/storefront/src/app/api/shipping/quote/route.ts` — API endpoint
- `supabase/migrations/003_shipping_packlink.sql` — schema DB

### ⚠️ Da fare prima del go-live

- Cambiare `PACKLINK_API_BASE` da `apisandbox.packlink.com` a `api.packlink.com`
- `FROM_ADDRESS` è ancora hardcoded `IT 42122` in `api/shipping/quote/route.ts` nonostante esista `warehouse_location` — il secondo tenant spedirebbe erroneamente "da Reggio Emilia"
- Il breakdown `_internal` (corriere, IVA, surcharge) è restituito al client come `shippingDetails` ed è visibile nei devtools, incluso il markup di 3€/pacco — la documentazione lo descrive come nascosto ma non lo è a livello di rete
- **TODO segnalato ma non implementato:** aggiungere `carrierName` e `serviceName` all'oggetto `_internal` e a `shipping_details` in DB (Packlink li restituisce già come `"name"` e `"carrier_name"` nella risposta API) — aggiornare interfaccia `PacklinkService`

---

## 7. Checkout e pagamenti

### Flusso ordine (webhook-first, prezzi ricalcolati server-side)

```
Cliente → /checkout
  → POST /api/checkout          → rilegge prezzo/nome/storage_type dal DB per productId (tenant + attivi)
                                → verifica token HMAC spedizione, forza 0 su pickup
                                → crea checkout_session in DB
                                → crea PaymentIntent Stripe (metadata: session_id, tenant_id)
  → Stripe Elements             → cliente paga
  → POST /api/webhooks/stripe   → evento payment_intent.succeeded
                                → legge checkout_session
                                → crea order + order_items in DB (unique index idempotente su stripe_payment_intent_id)
                                → elimina checkout_session
                                → chiama n8n webhook (conferma ordine)
```

**Regola assoluta:** Gli ordini vengono creati **solo** dopo `payment_intent.succeeded`. Mai prima. Prezzo e spedizione **non** sono mai fidati dal client (fix 2026-07-02, vedi §2.1).

### Metodi di pagamento

| Metodo | Implementazione |
|---|---|
| Stripe (carte) | Stripe Elements, PaymentIntent |
| Satispay | Via Stripe nativo (nessun codice extra) |
| In-store (Click & Collect) | `payment_method = 'in_store'`, bottone "Marquer comme payé" in admin |

⚠️ Nessuno Stripe Connect: il PaymentIntent è creato sull'account piattaforma Lepefy nonostante esista `tenants.stripe_account_id` — il giroconto al tenant è presumibilmente manuale.

### Variabili d'ambiente Stripe (Vercel)

```
STRIPE_SECRET_KEY=sk_live_...          # ⚠️ DA SOSTITUIRE con chiavi ChloeFood
STRIPE_WEBHOOK_SECRET=whsec_...        # ⚠️ DA REGISTRARE su account ChloeFood
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

### Billing SaaS (abbonamento Lepefy → tenant)

Pannello `/admin/billing`: mostra stato abbonamento con due opzioni di pagamento — **Stripe Payment Link** (~1,59 € commissione/transazione) e **bonifico bancario** (0 commissioni, opzione raccomandata, causale bonifico auto-generata). Automazione billing completa (Customer Portal / webhook ricorrenti) valutata e **scartata volontariamente** per lo stage attuale: 1 solo tenant attivo, relazione diretta preferita a soluzione tecnica complessa. PayPal personale esplicitamente sconsigliato per raccolta pagamenti business.

⚠️ **Gap noto:** lo storefront non controlla mai `tenants.subscription_status` — un tenant con abbonamento scaduto continuerebbe a vendere indefinitamente. Nessun enforcement automatico implementato.

---

## 8. Admin dashboard

### Autenticazione — ✅ RISOLTA (pagine + API)

`/admin` era **pubblica** fino a metà giugno — problema critico ora risolto, ed esteso anche alle API dopo la revisione di sicurezza del 2026-07-02:

- **Causa del fallimento iniziale:** Root Directory Vercel = `apps/storefront` impedisce l'esecuzione dell'Edge middleware Next.js in monorepo
- **Soluzione pagine:** route group `(protected)` con `admin/layout.tsx` Server Component che chiama `supabase.auth.getUser()` e reindirizza se non autenticato; `admin/login/` fuori dal gruppo protetto per evitare redirect loop
- **Soluzione API:** helper `src/lib/auth/requireAdmin.ts` chiamato in testa a ogni route sotto `/api/admin/*` — prima della revisione le API scrivevano senza alcun controllo (vedi §2.1)
- **Whitelist:** variabile d'ambiente `ADMIN_EMAILS` — solo email designate accedono, non ogni utente registrato sullo storefront
- **Bug critico risolto:** `@supabase/ssr` 0.3.x richiede l'implementazione simultanea delle API cookie vecchie (`get/set/remove`) E nuove (`getAll/setAll`) — fornirne solo una rompe la sessione tra client e server
- **Recovery password:** flusso testato via Supabase Dashboard → Authentication → Users; Site URL in Auth settings deve puntare a `https://chloefood.com` (non `localhost`) per redirect corretto del link di recupero

### ⚠️ File morti da pulire (non urgente, debito noto)

`src/app/admin/orders/[id]/` **non è una route** (nessun `page.tsx`): è una cartella di componenti (`OrderDetail.tsx`, `PickingList.tsx`) importati via percorso relativo dalla vera pagina protetta `admin/(protected)/orders/[id]/page.tsx`. `src/app/admin/orders/id/PickingList.tsx` (cartella letterale `id`, senza parentesi quadre) è invece **codice morto**: nessun import nel repo, sembra una bozza precedente rimasta dopo lo spostamento in `[id]/`.

### Funzionalità implementate

- Lista ordini con KPI cards (totale ordini, fatturato **totale + mese corrente con indicatore delta**, ordini nuovi, "À expédier" cliccabile con filtro)
- Filtri: 4 dropdown selettivi con etichetta esplicita (Statut, Période, Livraison, Paiement)
- Colonna badge metodo di pagamento nella tabella ordini
- Badge visivo per ordini di oggi
- Badge bandiere SVG per ordini internazionali
- Indicatori storage: ❄ surgelé / 🌿 frais
- Dettaglio ordine: aggiornamento stato + codice tracking
- Select corriere configurabile con modale conferma cambio
- Toggle lingua FR/IT
- **Picking list stampabile** — ⚠️ non è una route separata: `admin/(protected)/orders/[id]/page.tsx` renderizza sia il dettaglio ordine (avvolto in `div.no-print`) sia `PickingList.tsx`; `@media print` nasconde `.no-print` al momento della stampa, mostrando solo la picking list; icona di stampa su ogni riga ordine
- **Gestione catalogo prodotti** (`/admin/catalogue`): sidebar con accordion per categoria, ricerca client-side (soglia `catalogue_search_threshold`), colonne ordinabili via URL params, toggle inline Actif, editing inline stock con indicatori colore, drag&drop upload immagine, generazione immagine AI (Gemini); **`/admin/catalogue/nouveau`** per creazione nuovo prodotto (riusa `ProductEditClient` con uno stub `emptyProduct`)
- **Sistema etichette** (`/admin/products/[id]/etichetta`) — vedi §16, ora maturo: multi-template, multi-palette, draft/ristampa, preview live, autosave
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

⚠️ **Fragilità nota:** la conferma ordine dipende da una chiamata n8n fire-and-forget dentro il webhook Stripe — se n8n è irraggiungibile, il cliente non riceve nulla e non esiste retry. Pattern consigliato: tabella outbox (`pending_notifications`) o provider email diretto come fallback.

### Variabili Vercel correlate

```
N8N_WEBHOOK_URL=https://n8n.lepefy.com
N8N_WEBHOOK_SECRET=...
TRACKING_SECRET=...    # Per HMAC token ordini — ora obbligatoria anche per la firma del preventivo spedizione
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

- **Hero editoriale (ridisegnato in Fase 3, §12bis):** layout a due colonne su desktop (testo/CTA + preview prodotti reali), impilato su mobile; sfondo `var(--color-primary)`/`var(--color-primary-dark)` con pattern decorativo triangolare ispirato all'anello tribale del logo (SVG inline, bassa opacità), non più cerchi piatti. Eyebrow sopra il titolo reso col componente signature `ShopTag`. Supporta ancora `tenant.hero_image_url` opzionale.
- **Notification bar** (36px, "ticker") sotto l'header con animazione CSS
- **Bottom navigation bar** (4 tab): 🏠 Accueil · 🛍️ Catalogue · 🛒 Panier (con badge, ora `var(--color-secondary)`) · 📦 Commandes
- Visibile solo su mobile (`md:hidden`), nascosta nel layout admin
- Homepage: scroll orizzontale per categoria (stile Netflix/App Store); grid su desktop
- **Ricerca real-time:** debounce 300ms + `router.replace` (URL params) + `useTransition`, mantenuta nel catalogo completo
- Footer: link "Powered by Lepefy" configurabile per tenant via `tenants.show_powered_by`, punta a `food.lepefy.com`; padding `env(safe-area-inset-bottom)` per non sovrapporsi alla bottom nav fissa su mobile

---

## 12bis. Design System & Redesign UI/UX (Audit Luglio 2026) — ✅ COMPLETO

Ciclo in tre fasi, avviato da un audit strategico dello storefront pubblico (`AUDIT_STOREFRONT_UIUX.md`, esterno al repo) e chiuso il 17/07. Obiettivo: modernizzare UI/UX mantenendo la piattaforma multi-tenant by design — nessun valore di brand hardcodato in nessuna fase.

**Fase 1 — De-hardcoding token + accessibilità.** Rimossi tutti gli hex fissi da `BottomNav.tsx`, HeroBanner (`page.tsx`), `AddToCartButton.tsx`, timeline tracking ordine (`orders/[id]/page.tsx`), `PWABanner.tsx` (trovato fuori scope durante lo sweep tipografico di Fase 2, conteneva sia colore che nome tenant hardcodati). Introdotto `--color-primary-dark` via `color-mix()`. Font Inter caricato realmente via `next/font/google` (era dichiarato in Tailwind ma mai importato). Touch target dei controlli quantità/carrello portati a 44×44px. Regola `:focus-visible` globale aggiunta in `globals.css`. Stato vuoto di `ProductGrid` allineato al pattern già curato del carrello vuoto.

**Fase 2 — Consolidamento design system.**
- *2.1:* Unificate in un solo componente `ProductCard.tsx` (prop `variant: 'grid' | 'shelf'`) le tre implementazioni duplicate prima sparse in `page.tsx`, `FeaturedProducts.tsx` e nel componente standalone; `AddToCartButton.tsx` standalone eliminato (era usato solo dalle card duplicate). Introdotti i token `--color-primary-hover`, `--radius-sm/md/lg/full`, `--shadow-card`.
- *2.2:* `<img>` residue migrate a `next/image` (thumbnail carrello, hero); emoji di stato (🛒🚚📦✅🏪🔒⏳) sostituite con icone Tabler coerenti con quelle già in `BottomNav`; introdotto skeleton loading su griglia catalogo (sostituisce il precedente `opacity-60`); dichiarata una scala `fontSize` ufficiale in Tailwind, eliminati i `text-[Npx]` arbitrari sparsi; rimosso un `CategoryFilter.tsx` duplicato mai importato.

**Fase 3 — Decisioni di brand validate su mockup interattivo.** Un mockup HTML (`Mockup_Fase3_Validazione_UIUX.html`, esterno al repo) con toggle live colore/font ha permesso di validare prima dell'implementazione:
- **Font display:** Bricolage Grotesque (`next/font/google`), applicato solo a titoli/segnaletica — decisione di piattaforma, non per-tenant, come già Inter per il body.
- **Colore primario ChloeFood:** blu `#1267C7` (vedi §2 e §1 — cambio di dato in `tenants.primary_color`, non di codice).
- **Elemento signature:** nuovo componente `src/components/ui/ShopTag.tsx` — "cartellino da bottega" (forma a tag con clip-path, piccola perforazione, leggera rotazione), colorato **sempre** via `var(--color-secondary)` (non oro hardcodato: nel mockup era descritto come fisso dal logo, corretto in implementazione per restare valido su qualunque tenant). Applicato su `ProductCard` (entrambe le varianti) e sull'eyebrow dell'hero.
- Verificato il contrasto AA di testo bianco su `var(--color-primary)`/`-dark` col nuovo blu prima del rilascio.

**Regola derivata da questo ciclo, valida per ogni redesign futuro:** un mockup di validazione può legittimamente usare colori "fissi" per velocità di iterazione, ma ogni colore che nel mockup sembra "proprio del brand ChloeFood" va ricontrollato in fase di implementazione — se non deriva già da un campo `tenant.*` esistente, deve mappare su un token esistente (`--color-primary`/`--color-secondary`) prima di andare in produzione, mai restare un valore fisso nuovo.

---

## 13. Catalogo prodotti (ChloeFood)

**Fonte:** catalogo "ChloeFood_Template_Catalogue_v2" (121 prodotti, 8 categorie: Épices, Légumes, Farines, Poissons, Sauces & Huiles, Snacks, Viandes séchées, Boissons), importato e poi **riseminato idempotentemente** via `020_reseed_products_catalogue_v2.sql`.

Mapping storage: Produits frais → `fresh`, Produits surgelés → `frozen`, tutti gli altri → `dry`.

**Regola stock:** `stock` rappresenta il numero di unità vendibili nell'unità di vendita dichiarata. ⚠️ Nessun controllo/decremento reale al checkout — è solo un cap lato client nel carrello (default 999 se non impostato), problema concreto per fresco/surgelato.

**Generazione immagini AI:** pipeline Gemini a due step — Step 1 `gemini-2.5-flash` genera un prompt fotografico dettagliato; Step 2 `gemini-2.5-flash-image` genera l'immagine. SDK `@google/genai`. Upload su Supabase Storage. Architettura a tre livelli per accuratezza: tabella lookup hardcoded per prodotti critici, generazione Flash-guidata per prodotti semi-noti, template fissi per categoria per prodotti generici.

**Dati etichetta:** `021_update_label_data_batch1.sql` ha popolato in bulk ingredienti/allergeni/nutrizione/paese origine per 22 prodotti da fonte Excel; `022_new_products_from_labels.sql` ha aggiunto prodotti scoperti nei dati etichetta ma assenti dal catalogo v2 (seminati inattivi/prezzo 0).

---

## 13bis. Intelligenza artificiale — Descrizioni, Rate Limiting/Cost Tracking, Ricerca Semantica

Tre feature sviluppate in sequenza (luglio 2026), tutte **✅ completate e in produzione** su ChloeFood, pensate fin dall'inizio come multi-tenant e multi-provider (campo `provider` esplicito su ogni chiamata AI, oggi sempre `'gemini'`, pronto per un futuro secondo provider es. Anthropic).

### Descrizioni prodotto AI multilingue — ✅ completo, batch eseguito su tutto il catalogo

- `products.descriptions` jsonb (`{"fr": "...", "it": "..."}`), chiavi determinate da `tenants.locales` (mai lingue hardcoded nel codice)
- Route `POST /api/admin/generate-product-description`: una chiamata `gemini-2.5-flash` (`responseMimeType: 'application/json'`, `maxOutputTokens: 4096`, `thinkingConfig: { thinkingBudget: 0 }`) genera tutte le lingue del tenant in un colpo solo. Guardrail esplicito nel prompt: mai allergeni, claim nutrizionali/salutistici, origine non fornita — solo descrizione sensoriale/culturale/d'uso. La route non scrive in DB: propone, il salvataggio dal form conferma
- UI in `ProductEditClient.tsx`: due textarea (una per locale), bottone "✨ Générer avec IA", badge `IA` + filtro "Descriptions à revoir" in `CatalogueTable.tsx` quando `description_source = 'ai'`
- Toggle lingua `FR | IT` nello storefront (si nasconde da solo se il tenant è monolingua), store Zustand con persist
- Script batch `scripts/generate-product-descriptions.mjs` + workflow `generate-product-descriptions.yml`: batch completo sui 121 prodotti eseguito con successo

**Bug risolti durante lo sviluppo (lezioni utili per i prossimi script batch AI):**
1. **Risposta Gemini troncata a metà JSON** (`finishReason: MAX_TOKENS`) — causa: `maxOutputTokens` troppo basso (1024) per un modello "thinking" che consuma budget anche per il ragionamento interno prima del testo visibile. Fix: alzato a 4096 + `thinkingBudget: 0` (non serve ragionamento esteso per 2-4 frasi).
2. **Skip filter dei batch non funzionante** — un filtro `SKIP_EXISTING` applicato lato query PostgREST su una colonna jsonb non matchava correttamente (bug reale: query REST su `descriptions='{}'` restituiva 0 prodotti nonostante 107/113 fossero effettivamente vuoti). **Regola ora applicata a tutti gli script batch AI:** filtro skip sempre lato JavaScript dopo il fetch, mai lato query REST su jsonb; logging diagnostico esplicito (totale fetchati vs totale dopo filtro) per diagnosi rapida futura.
3. **Workflow GitHub Actions dimenticato** — lo script `.mjs` era stato creato ma il file `.yml` gemello no. Verificare sempre che entrambi i file esistano dopo un prompt che li prevede entrambi.

### Rate limiting + cost tracking AI — ✅ completo su tutte le route AI

- `ai_pricing`: listino prezzi per `provider`+`model`, configurabile via SQL (seed iniziale: `gemini-2.5-flash` $0.30/$2.50 per milione token, `gemini-2.5-flash-image` stesso + $0.039/immagine, `gemini-embedding-001` $0.15/milione token — verificare aggiornamento se i prezzi Google cambiano)
- `ai_usage_log`: una riga per chiamata AI, con token/immagini/costo stimato/`status`. Vista `ai_usage_monthly_by_tenant` per il riepilogo mensile
- Funzione SQL `check_ai_rate_limit` + helper `apps/storefront/src/lib/ai/usageTracking.ts` (`checkRateLimit`/`logAiUsage`), applicati a: `generate-product-image`, `generate-product-description` (route admin, limite giornaliero come rete di sicurezza contro loop/bug) e `search-semantic` (route pubblica, limite al minuto + giornaliero — è l'endpoint più esposto, nessuna sessione admin di mezzo)
- Limiti configurabili per tenant: `tenants.ai_rate_limit_public_per_minute` (default 20), `ai_rate_limit_public_per_day` (default 500), `ai_rate_limit_admin_per_day` (default 200)
- **Lezione applicata:** in caso di errore/JSON troncato, i token vanno letti da `usageMetadata` PRIMA del tentativo di parsing (la risposta HTTP è comunque arrivata) — altrimenti le righe di log con `status='error'` risultano con token/costo a zero/NULL, perdendo visibilità proprio sui casi che tendono a consumare più output token
- **Gap noto colmato:** il rate limiting/cost tracking era stato applicato inizialmente solo alle route Next.js (`route.ts`); gli script batch `.mjs` (standalone, REST diretto, non possono importare l'helper TS) necessitano di una funzione `logAiUsage` locale duplicata in ciascuno script — applicato retroattivamente a tutti e tre gli script batch AI
- Pannello "Utilisation IA" in `/admin/billing`: tabella provider/endpoint/chiamate/costo mensile

### Ricerca semantica catalogo — ✅ completo, batch eseguito su tutto il catalogo

- `products.embedding` vector(768), modello **`gemini-embedding-001`** (⚠️ non `text-embedding-004`, dismesso dal provider il 14/01/2026)
- Indice HNSW cosine, funzione SQL `match_products(query_embedding, p_tenant_id, match_count, min_similarity)` — filtro `tenant_id` + `active` sempre dentro la funzione, mai delegato al client
- Sync automatico dell'embedding al salvataggio prodotto (best-effort, un fallimento non blocca il salvataggio), testo embeddato = nome + categoria + tutte le `descriptions` disponibili (multilingue, un vettore unico cross-lingua)
- Route pubblica `GET /api/search/semantic`: rate limit applicato PRIMA della chiamata embedding (vedi sopra); se bloccata o fallita, degradazione silenziosa — il cliente non vede mai un errore di rate limit
- **Ricerca ibrida a cascata** in `CatalogClient.tsx`: la ricerca testuale `ilike` esistente resta invariata e parte per prima; solo se restituisce meno di 3 risultati scatta la chiamata semantica, mostrata sotto un'intestazione "Résultats similaires" — risolve casi come "fufu" che non matcha testualmente "Farine de manioc" ma è semanticamente vicino
- Script batch `scripts/generate-product-embeddings.mjs` + workflow `generate-product-embeddings.yml`: batch completo sui 121 prodotti eseguito con successo (stesse fix preventive su skip-filter/logging del punto precedente, applicate fin dall'inizio)

### Costi AI — ordine di grandezza verificato

Batch descrizioni completo (121 prodotti × 2 lingue): sotto $1. Batch embeddings completo: sotto $0.01. Pipeline immagini prodotto (già in produzione prima di queste feature): ~$0.04/prodotto, ~$5 per batch completo — resta la voce di costo AI più alta. Ricerca semantica a runtime: query cliente ~$0.00003 ciascuna, irrilevante anche a volumi alti. Tutto ampiamente dentro il margine dei 89€/mese per tenant.

### Idea futura non implementata — Query embedding cache

Tabella `ai_query_embedding_cache` (query normalizzata lowercase/trim + locale come chiave, vector(768), `hit_count`, `last_used_at`), condivisa a livello **piattaforma** (non per-tenant — l'embedding del testo non dipende dal tenant). Lookup prima di chiamare Gemini in `/api/search/semantic`: hit → riusa il vettore salvato, zero chiamate Gemini; miss → chiama Gemini come oggi e salva in cache. Nessun TTL prospettato (query catalogo food stabili nel tempo). Da valutare dopo aver osservato l'uso reale della ricerca semantica per capire quali query si ripetono davvero — non implementata, salvata per quando ci sarà volume sufficiente da giustificarla.

---

## 14. Biglietto da visita digitale

- Route `/card` (`chloefood.com/card`) — landing con link social (Instagram, Facebook, TikTok da `tenant_social_links`), dati boutique
- QR code dinamico via `/api/card/qr-code` con overlay logo nel colore brand del tenant (libreria `qrcode`, errorCorrectionLevel 'H')
- Download vCard via `/api/card/vcard`
- QR scaricabile da `/admin/parametres`
- Architettura rigorosamente multi-tenant: nessun colore/URL/telefono/piattaforma social hardcoded, tutto da `tenants` + `tenant_social_links`
- Pricing concordato con Dalice: 100 € totali per landing page + biglietto digitale + QR (stampa fisica esclusa)

---

## 15. Landing page pre-lancio (`chloefood.com`)

Pagina statica trilingue (FR/IT/EN) pubblicata mentre l'e-commerce completo attende le foto prodotto dalla cliente. Contenuti: hero con logo, statistiche (120+ prodotti, 7+ paesi, 4 categorie, spedizione 48h), testimonianze placeholder, percorso prodotto narrativo (4 step), griglia categorie (8 voci), sezione USP, info boutique con orari, CTA finale. Pulsante WhatsApp flottante (numero 393296958822) con messaggio pre-compilato per lingua, icona SVG ufficiale WhatsApp. Riferimenti Packlink rimossi su richiesta cliente, sostituiti con Poste Italiane/BRT/FedEx/TNT. "ETS" rimosso da tutte le occorrenze del nome brand → solo "Chloé Food". Testi generalizzati da "camerunese" a "africano" in tutte e tre le lingue.

**Nuovo logo (in valutazione):** versione JPEG completa integrata nell'hero, versione icona usata per favicon/PWA icon; colore hero portato a blu `#1267C7` in linea con la brand charter v2 — nessuna occorrenza di questo blu altrove nel codice, vedi conflitto colore in §2.

---

## 16. Sistema etichette prodotto — ✅ FUNZIONALMENTE MATURO (non più "in sviluppo base")

Sistema per generare e stampare etichette prodotto (formato tipografico, non browser print). **Verificato nel codice (13/07): l'implementazione è molto più avanzata di quanto documentato in precedenza** — multi-template, multi-palette, stile origine configurabile, workflow draft/ristampa completo.

### Architettura reale

- **Modello legale a tre livelli:** produttore → importatore → distributore/tenant (tabelle `producers`, `importers`), dati produttore a livello prodotto
- **Output:** PDF per tipografo, layout N-up su A4 (dimensione etichetta configurabile), generato da `lib/labels/gotenberg.ts` → `htmlToPdf()` chiama realmente `${GOTENBERG_URL}/forms/chromium/convert/html`
- **Tre template** (`templates/`, selezionabili in `LabelJobEditorClient.tsx`): `default.tsx` ("Classico", due colonne, stile origine implementato), `fullbleed.tsx` (sfondo a piena pagina — ⚠️ lo stile bandiera/origine **non** è implementato qui, solo testo semplice "Origine: ...") e `banner.tsx` ("Fascia Dorata" — fascia logo a tutta larghezza, nutrizione a sinistra/nome al centro/foto a destra, stile origine implementato come in `default.tsx`)
- **Tre palette colore** (`lib/labels/palettes.ts`): `verde_palma`, `blu_epices` (default), `terra_piccante` — ciascuna con primary/secondary/accent/ambient + helper per sfondi sfumati e strip decorativo "kente"
- **Bandiere origine disegnate a mano** (`originFlags.tsx`, SVG per 9 paesi: Camerun, Senegal, Ghana, Nigeria, Costa d'Avorio, Mali, Guinea, Ciad, Etiopia) — scelta deliberata al posto delle emoji per evitare problemi di rendering colore-font in Chromium headless (Gotenberg)
- **Stile origine configurabile:** `pill` / `block` / `medallion` (`origin_style`, migration 025)
- **Badge "100% Naturale"** (`natural_badge`) indipendente per singola stampa
- **Sfondo personalizzabile** per categoria con override per singolo prodotto (immagine preferita, colore come fallback via `resolveBackground.ts`)
- **Workflow draft → generato → ristampa:** ogni job nasce `draft` (editabile, autosave via PATCH), diventa `generated` dopo la chiamata Gotenberg riuscita (immutabile), e può essere duplicato (`duplicated_from_id`) per una ristampa che esclude lotto/date di produzione dal clone

### Route reali (correggono versioni precedenti della documentazione)

- Admin: `/admin/products/[id]/etichetta` (lista job) e `/admin/products/[id]/etichetta/[jobId]` (editor draft — template/palette/origin-style/sezioni, lotto/date/quantità, preview live debounced, autosave debounced, bottone "Générer le PDF"; se il job non è più `draft` la pagina redirige alla lista con `?msg=already_generated`)
- API: `/api/admin/labels/preview` (solo HTML, no Gotenberg — per iframe live), `/api/admin/labels/generate` (Gotenberg + upload Storage + job → `generated`), `/api/admin/labels/jobs` (GET lista / POST crea draft, con `duplicateFromId`), `/api/admin/labels/jobs/[id]` (PATCH autosave / DELETE draft)
- Tutte protette da `requireAdmin()`

### Stato attuale / bug aperti

- ✅ Migrations 018, 019, 023, 024, 025 applicate (schema + data fix + feature palette/origin-style)
- ✅ **Errore 400 su `/api/labels/preview`** — RISOLTO. Causa: import "nudo" di `react-dom/server` intercettato dal Next.js App Router. Fix: import cambiato in `react-dom/server.node` + `export const runtime = 'nodejs'` nelle route preview/generate
- **✅ Integrazione Gotenberg completa e verificata end-to-end (14/07, fuori dall'audit repo — deploy live, non verificabile leggendo il codice):** container Docker attivo su Hetzner nella stessa rete di n8n/Caddy, sottodominio `gotenberg.lepefy.com` con certificato SSL Let's Encrypt automatico e Caddy `basic_auth`, header `Authorization: Basic` aggiunto a `gotenberg.ts` (env var `GOTENBERG_URL`/`GOTENBERG_AUTH`, formato `user:password` Base64-encoded), entrambe settate su Vercel. Endpoint `/forms/chromium/convert/html` testato sia via curl diretto sia da un job reale in `/admin/products/[id]/etichetta/[jobId]` → PDF generato correttamente (layout N-up A4, QR code, badge, blocco legale). Nota tecnica risolta durante il deploy: Gotenberg richiede il file HTML nominato esattamente `index.html` nel form-data.
- ⚠️ **Data quality flag:** i valori nutrizionali usati nell'etichetta BOBOLO Sous Vide corrispondevano alla scheda prodotto Foufou, non Bobolo — richiede verifica dal produttore prima di ristampare
- **Dati Excel etichette (~24 prodotti):** confermati dati legali reali — ragione sociale "Chloé Food ETS", indirizzo "Via Angelo Zanti, 1C - 42122 Reggio Emilia", email `chloefood.ets@gmail.com`; importatore ricorrente **AFRICOOP Società Cooperativa** (Modena). Problemi noti: campi lotto/data corrotti (seriali Excel tipo `42026.0`) in ~8 schede, titoli scheda non corrispondenti per errori di copia-incolla, valori nutrizionali espressi in percentuale in 2 schede da chiarire col produttore

### Idea Phase 2 — uso IA nel sistema etichette (non ancora implementata, salvata per dopo)

1. Generazione sfondo etichetta per categoria/prodotto riusando la pipeline Gemini già esistente (stesso flag `tenant.ai_image_generation`)
2. Pass IA che legge documenti fornitore (Excel, foto etichetta) e propone valori nei campi del form etichetta — sempre da confermare/correggere manualmente, mai pubblicati direttamente
3. QA automatico di coerenza (es. nome prodotto contiene "latte" ma allergene lattosio non marcato) — segnala, non decide

**Esclusi sempre dall'IA:** valori nutrizionali, allergeni, dati legali produttore/importatore, lotto/date — mai dedotti o generati, sempre campo esplicito con default sicuro. Nessun output IA su questi campi pubblicato senza conferma umana esplicita.

**Priorità attuale:** con il sistema base ormai maturo (multi-template/palette/origin-style, workflow draft/ristampa) e Gotenberg confermato funzionante end-to-end (deploy live verificato, vedi sopra), il blocco residuo è **non tecnico**: verifica dei dati nutrizionali (in particolare Bobolo, valori sospetti — probabile scambio con la scheda Foufou nell'Excel originale) e del lotto/data prima della stampa fisica reale — competenza di ChloeFood nelle proprie verifiche interne, non un task di sviluppo.

---

## 17. Variabili d'ambiente complete (Vercel)

⚠️ Nessun `.env.example` è committato nel repo (il `README.md` ne referenzia uno — `apps/storefront/.env.local.example` — che non esiste su disco). Questa tabella resta l'unica fonte di verità per le variabili attese.

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

# Tracking + preventivo spedizione (HMAC)
TRACKING_SECRET=...
NEXT_PUBLIC_APP_URL=https://chloefood.com

# Admin auth
ADMIN_EMAILS=...

# Gotenberg (necessaria per /api/admin/labels/generate — throw esplicito se assente)
GOTENBERG_URL=...
GOTENBERG_AUTH=...
```

---

## 18. Checklist go-live

| Task | Responsabile | Stato |
|---|---|---|
| Importare ~120 prodotti reali da catalogo v2 | Robertin | ✅ FATTO |
| Aggiungere autenticazione a `/admin` (pagine) | Robertin | ✅ FATTO |
| Aggiungere autenticazione alle API `/api/admin/*` | Robertin | ✅ FATTO (revisione sicurezza 2026-07-02) |
| Ricalcolo server-side prezzi/spedizione al checkout | Robertin | ✅ FATTO (revisione sicurezza 2026-07-02) |
| Chiudere policy RLS insert-any + idempotenza webhook | Robertin | ✅ FATTO (migration 016) |
| Configurare dominio personalizzato `chloefood.com` | Robertin | ✅ FATTO |
| Risolvere errore 400 su `/api/admin/labels/preview` | Robertin | ✅ FATTO |
| Cambiare `PACKLINK_API_BASE` → `api.packlink.com` | Robertin | ⚠️ DA FARE |
| Correggere `FROM_ADDRESS` hardcoded IT 42122 in shipping quote | Robertin | ⚠️ DA FARE |
| Sostituire chiavi Stripe test con chiavi live ChloeFood | ChloeFood | ⚠️ DA FARE |
| Registrare webhook Stripe sull'account ChloeFood | ChloeFood | ⚠️ DA FARE |
| Confermare trattamento IVA spedizione con commercialista | ChloeFood | ⚠️ DA FARE |
| Eliminare ordini di test dal DB | Robertin | ⚠️ DA FARE |
| Test E2E: ordine IT + ordine FR + Click & Collect | Robertin | ⚠️ DA FARE |
| Installare/confermare Gotenberg raggiungibile su Hetzner + Caddy auth | Robertin | ✅ FATTO (verificato end-to-end 14/07: deploy Hetzner + PDF reale generato da job vero) |
| Verificare dati nutrizionali/lotto con produttori prima di stampare etichette (in particolare Bobolo, valori sospetti) | ChloeFood / produttori | ⚠️ DA FARE — competenza ChloeFood, non blocco tecnico |
| Rimuovere file morti `admin/orders/id/` e cartella componenti condivisi non-route | Robertin | ⚠️ DA FARE (non bloccante) |
| Decisione brand charter v2 (verde vs blu) | Dalice | ✅ FATTO — blu `#1267C7` approvato e in produzione (17/07, vedi §12bis) |
| Completare contratto SaaS (dati fiscali, foro, DPA) | Robertin | ⚠️ DA FARE |

---

## 19. Roadmap Phase 2 (post go-live)

**Nota:** le tre feature IA trasversali (descrizioni multilingue, rate limiting/cost tracking, ricerca semantica) sono state completate — non compaiono più come "Non avviato" in questa tabella, dettaglio in §13bis.

| Feature | Categoria | Priorità | Stato |
|---|---|---|---|
| Autenticazione clienti (Supabase Auth) + pagina `/orders` storico | Contrattuale | P0 | Non avviato |
| Enforcement `subscription_status` (blocco soft storefront tenant scaduto) | Tecnico | P0 | Non avviato — mai controllato oggi |
| Gestione stock reale al checkout (decremento, blocco esaurito) | Tecnico | P0 | Non avviato |
| Sistema etichette prodotto — deploy Gotenberg su Hetzner | Tecnico | P0 | ✅ FATTO — verificato end-to-end (14/07) |
| Draft Packlink automatico al pagamento ("effet waouhhh") | Tecnico | P1 | Non avviato |
| `carrierName` + `serviceName` in `shipping_details` DB | Tecnico | P1 | Non avviato |
| Stripe Connect (destination charges, giroconto automatico tenant) | Tecnico/Business | P1 | Non avviato |
| Risoluzione tenant per dominio (un solo deployment multi-tenant) | Tecnico | P1 | Non avviato — collo di bottiglia oltre ~5 tenant |
| Recupero carrelli abbandonati (dati già in `checkout_sessions`) | Business | P1 | Non avviato — infrastruttura dati già presente |
| Email transazionali robuste (outbox / provider diretto, fallback a n8n) | Tecnico | P1 | Non avviato |
| IA nel sistema etichette (sfondi, estrazione dati bozza, QA coerenza) | Tecnico | P2 | Idea salvata, non implementata |
| Query embedding cache (risparmio chiamate Gemini su ricerca semantica) | Tecnico | P2 | Idea salvata, non implementata — vedi §13bis |
| i18n (`next-intl` + `tenants.locale`) prima di espandere fuori da area francofona | Tecnico | P2 | Non avviato |
| Sostituire `xlsx@0.18.5` (vulnerabilità note) con alternativa (es. `exceljs`) | Tecnico | P2 | Non avviato |
| Test automatizzati (almeno `calculateShipping.ts` + webhook, Vitest) | Tecnico | P2 | Non avviato |
| Google Play Store via TWA/PWABuilder | Growth | P1 | Non avviato |
| Apple App Store via Capacitor | Growth | P2 | Non avviato |
| Onboarding secondo tenant (self-service, wizard) | SaaS | P1 | Guida `Lepefy_Onboarding_Tenant_v1.docx` pronta; asset statici mono-tenant + limite build-time tenant da rimediare prima |
| Rate limiting su `/api/checkout` e `/api/shipping/quote` | Tecnico | P1 | Non avviato |

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
- **Mai fidarsi del client per prezzo/spedizione.** Regola aggiunta dopo la revisione di sicurezza 2026-07-02: prezzo e `storage_type` sempre riletti dal DB, spedizione sempre verificata via token HMAC.
- **Multi-tenancy vigilance — regola permanente.** Ogni valore hardcodato (`'chloefood'`, `'Packlink'`, carrier names, icone PWA statiche, indirizzi mittente spedizione) è un bug. Sempre usare `tenant.id`/`getTenant()` e logica switch-based/API route dinamica. Se una soluzione non è multi-tenant compatibile, va segnalato esplicitamente prima di procedere, proponendo l'alternativa corretta.
- **API admin sempre protette.** Ogni nuova route sotto `/api/admin/*` deve chiamare `requireAdmin()` in testa — prima della revisione del 2026-07-02 questo non era garantito.
- **Supabase permissions.** Sempre `GRANT USAGE ON SCHEMA public TO anon, authenticated` + `GRANT SELECT` esplicito per tabella + `GRANT UPDATE ... TO service_role` per tabelle scritte da API route admin. Testare con `SET role anon;`.
- **TypeScript strict.** Build errors tracciati dai Vercel build logs. Fix sistematici via prompt Claude Code, non patch one-off.
- **Repo pubblico.** Necessario per Vercel free plan. Non inserire mai segreti nel codice.
- **Dati sensibili (nutrizionali, allergeni, legali, lotto/date) mai generati o dedotti dall'IA** — sempre campo esplicito con default sicuro, conferma umana obbligatoria prima della pubblicazione.
- **Script batch AI (`.mjs`)** — filtro `SKIP_EXISTING` sempre lato JavaScript dopo il fetch (mai lato query PostgREST su colonne jsonb), logging diagnostico esplicito (totale fetchati vs dopo filtro), workflow `.yml` gemello creato nello stesso prompt dello script, `maxOutputTokens` generoso + `thinkingBudget: 0` per Gemini 2.5 Flash su task semplici, `usageMetadata` letto prima del tentativo di parsing così i token sono loggati anche sugli errori. Vedi §13bis per il dettaglio dei bug reali incontrati.
- **Vercel monorepo + middleware.** Root Directory = `apps/storefront` impedisce l'Edge middleware: l'auth va gestita a livello di route group `(protected)` con Server Component, non middleware (`middleware.ts` resta un `export {}` vuoto di proposito).
- **`@supabase/ssr` 0.3.x** — implementare sempre sia le API cookie vecchie che nuove insieme, o le sessioni si rompono tra client e server.

---

## 21. Documenti di riferimento nel progetto

| File | Contenuto |
|---|---|
| `docs/PROJECT_REVIEW.md` | Revisione tecnica/business completa — 4 falle di sicurezza risolte (2026-07-02), debito residuo, roadmap raccomandata; base delle sezioni §2.1, §18, §19 aggiornate qui |
| `INTEGRATION.md` | Guida integrazione sistema spedizione Packlink |
| `Lepefy_Roadmap_Tecnica.docx` | Roadmap completa Phase 1/2/3, stack, checklist go-live, rischi |
| `Maquette/` | Design reference originale ChloeFood |
| `ClaudeCode_Prompt_MobileLayout.md` | Prompt Claude Code per bottom nav + homepage (file esterno, non nel repo) |
| `ClaudeCode_Prompt_SistemaEtichette.md` | Prompt Claude Code originale per sistema etichette (file esterno, non nel repo — referenziato ma non versionato) |
| `ClaudeCode_Prompt_ProducerImporterUI.md` | Prompt Claude Code per UI produttori/importatori, referenziato nel commento della migration 019 (file esterno, non nel repo) |
| `Lepefy_Onboarding_Tenant_v1.docx` | Guida interna onboarding secondo tenant |
| `Contrat_SaaS_LepefyLabs_ChloeFood.docx` | Contratto SaaS bilingue FR/IT (versione precedente) |
| Contratto SaaS 16 articoli (diritto italiano) | Versione estesa — mancano dati fiscali, foro, email contrattuale, DPA |
| `Charte_graphique_Chloe_Food_1.pdf` | Nuova brand charter v2 (20 pagine) — in valutazione, nessun codice ancora allineato |
| `chloe_food_logo.svg` | Logo vettoriale ricostruito (bug viewBox corretto) — riferimento usato per validare che il blu `#1267C7` è il colore dominante reale del wordmark, vedi §12bis |
| `AUDIT_STOREFRONT_UIUX.md` | Audit strategico storefront pubblico che ha originato il redesign in 3 fasi — file esterno, non nel repo |
| `Mockup_Fase3_Validazione_UIUX.html` | Mockup interattivo (toggle colore/font live) usato per validare le decisioni di Fase 3 prima dell'implementazione — file esterno, non nel repo |
| `ClaudeCode_Prompt_Fase1_DehardcodingA11y.md` / `Fase2.1_ProductCardTokens.md` / `Fase2.2_ImmaginiIconeTipografia.md` / `Fase3_Implementazione.md` | Prompt Claude Code dei tre cicli del redesign UI/UX — file esterni, non nel repo |

---

## 22. Changelog di questa revisione (v3.2, 15 Luglio 2026)

Verifica riga-per-riga di v3.1 contro il filesystem reale del repo (branch `claude/lepefy-context-audit-i2teds`). Correzioni apportate:

- **§4** — numerazione migration IA confermata: `026_ai_descriptions.sql`, `027_ai_rate_limiting_cost_tracking.sql`, `028_semantic_search.sql` (non collisioni con 023–025 come temuto in v3.1). Tabella migration aggiornata da 001–025 a 001–028.
- **§3** — corretta la struttura repo: `lib/` mancava intere sottocartelle reali (`ai/embeddings.ts`, `ai/usageTracking.ts`, `images/removeBackground.ts`, `store/localeStore.ts`, `tenant/getTenantSocialLinks.ts`, `utils/`); `packages/types/` mancava `index.ts` e `ai.ts`; aggiunti `admin/_components/AdminSidebar.tsx` e i componenti dashboard (`AdminNav.tsx`, `AdminFilters.tsx`, `OrdersTable.tsx`) non elencati prima.
- **§3/§8** — corretta l'affermazione errata di una route dedicata `/admin/orders/[id]/picking-list`: non esiste come route separata. La picking list è renderizzata nella stessa pagina `admin/(protected)/orders/[id]/page.tsx` di fianco al dettaglio ordine, con `@media print` che nasconde il blocco `.no-print` in fase di stampa.
- **§16** — il sistema etichette ha **tre** template, non due: oltre a `default.tsx` e `fullbleed.tsx` esiste `banner.tsx` ("Fascia Dorata"), anch'esso con stile origine implementato (a differenza di `fullbleed.tsx`, che resta l'unico senza bandiera/stile origine).

Il resto del documento (stack tecnologico, sicurezza, shipping, checkout, admin auth, PWA, roadmap) è stato controllato a campione contro `package.json`, `pnpm-workspace.yaml`, le route API reali e `docs/PROJECT_REVIEW.md` e risulta accurato — nessuna ulteriore discrepanza rilevata in questa passata.

---

## 23. Changelog v3.3 (16 Luglio 2026) — conferma deploy Gotenberg fuori-repo

L'audit v3.2 aveva correttamente lasciato lo stato del deploy Gotenberg come "non verificabile da repo" — è una limitazione intrinseca di un audit basato solo sul codice: uno stato di infrastruttura live (container Docker su Hetzner, DNS, certificato SSL, reverse proxy) non è deducibile leggendo `gotenberg.ts`. Questa revisione aggiorna quel punto con una verifica diretta effettuata fuori-repo (sessione SSH sul VPS + test curl + generazione PDF reale da un job in produzione):

- **§2** (stack), **§16** (dettaglio etichette), **§18** (checklist go-live), **§19** (roadmap Phase 2) — tutte le occorrenze "deploy da verificare/confermare" sostituite con conferma di deploy completo e funzionante end-to-end.
- **§18** — riga verifica dati nutrizionali/lotto: responsabile corretto da "Robertin" a "ChloeFood / produttori" (è una verifica di competenza del tenant sui propri dati prodotto, non un task di sviluppo piattaforma).
- Nessuna modifica al resto del documento (struttura repo, template etichette, migration IA) rispetto a v3.2 — quella parte resta l'audit di riferimento.

---

## 24. Changelog v3.4 (17 Luglio 2026) — redesign UI/UX storefront completato

Chiuso il ciclo di audit e redesign frontend avviato con `AUDIT_STOREFRONT_UIUX.md`, eseguito in tre fasi (dettaglio completo in §12bis, nuova sezione):

- **§1/§2** — colori brand ChloeFood aggiornati: primary passato da verde `#1D9E75` a blu `#1267C7` (cambio di dato in `tenants.primary_color`, non di codice). Charter v2 non più "in valutazione": decisione presa e implementata.
- **§2** — riga "Stile" aggiornata per riflettere il design system tokenizzato (radius, shadow, scala tipografica, coppia Inter/Bricolage Grotesque).
- **§12** — hero riscritto: non più "banner emozionale verde scuro con cerchi", ma layout editoriale a due colonne con pattern triangolare ispirato al logo e componente signature `ShopTag` nell'eyebrow.
- **§12bis (nuova sezione)** — documentazione completa delle tre fasi del redesign: de-hardcoding e accessibilità, unificazione `ProductCard` e consolidamento token, decisioni di brand validate su mockup (font, colore, elemento signature).
- **§18** — riga "Decisione brand charter v2" spostata da PENDENTE a FATTO.
- **§21** — aggiunti alla tabella documenti: audit, mockup di validazione, i quattro prompt Claude Code del redesign.

Nessuna modifica alle sezioni non toccate dal redesign (spedizione, checkout, admin auth, IA, etichette, n8n) rispetto a v3.3.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.4 — 17 Luglio 2026 (base: v3.3; + redesign UI/UX storefront completato in 3 fasi, vedi §12bis e §24)*
