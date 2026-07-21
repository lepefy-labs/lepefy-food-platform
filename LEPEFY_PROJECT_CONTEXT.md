# Lepefy Food Platform — Project Context

> Documento di riferimento per Claude Code, onboarding sviluppatori, e continuità tra sessioni.
> Aggiornato: 20 Luglio 2026 (v3.8) — **audit performance frontend + 5 prompt di ottimizzazione + fix urgente stock/overselling**, tutti confermati caricati su `main` via GitHub web UI (workflow diretto di Robertin per questo lavoro — non passa dal problema di branch non mergiati descritto sotto per i redesign UI/UX). Dettaglio completo in §17bis (nuova sezione). In sintesi: query Supabase mirate (mai più `select('*')` su prodotti/ordini), fetch paralleli, paginazione server-side del catalogo, ISR su home e pagina prodotto via client Supabase pubblico, lazy-load di Stripe.js, e — separatamente dall'audit performance ma scoperto durante quel lavoro — **il primo controllo/decremento stock reale mai esistito nel checkout**, con decremento atomico race-safe e gestione del caso "pagato ma stock nel frattempo esaurito" (rimborso Stripe automatico + notifica admin via n8n). **Il test di race condition in staging resta da eseguire** — il fix è in produzione ma non ancora verificato empiricamente, vedi §17bis e §18.
>
> Aggiornamento 18 Luglio 2026 (v3.7) — **verifica indipendente contro git/filesystem reale** (branch `claude/update-lepefy-project-context-fke5jo`), non solo stato riportato in chat. Due correzioni rilevanti rispetto a v3.6: (1) la **KPI "Aujourd'hui"**, segnalata come "prompt scritto ma non eseguito", **risulta invece già eseguita** nel codice (`admin/(protected)/page.tsx`) — il commit che l'ha implementata precede cronologicamente quello che ha scritto v3.6, semplicemente lo stato in chat non era stato aggiornato di conseguenza; (2) **`main` non contiene né il redesign admin (Fase 0–4, §8bis) né il redesign storefront (§12bis)** — `git merge-base main HEAD` coincide con la punta di `main` stessa (ultimo commit 16/07 alle 11:47): **tutto** il lavoro di entrambi gli audit (storefront 16–17/07, admin 17–18/07) esiste solo su questo branch, mai mergiato. La precedente affermazione "branch pushato e mergiato su `main`" (§12bis/§25, v3.4–v3.6) **non è supportata dallo stato reale del repository** — verificato anche puntualmente: `ShopTag.tsx` non esiste su `main`, e `BottomNav.tsx` su `main` contiene ancora l'hex hardcoded `#1D9E75`. Non è verificabile da qui se Vercel effettivamente deploya da `main` o da questo branch (nessun `vercel.json` nel repo) — **da confermare con Robertin prima di dare per assodato lo stato di produzione**. Scoperta anche una funzionalità non documentata: `AdminMobileNav.tsx`, un drawer di navigazione mobile per l'admin (vedi §8bis). Base di questa revisione: v3.6, con le correzioni sopra.

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
| **Stile** | Tailwind CSS 3.4.3 | Token system via CSS vars (`--color-primary`, `--color-secondary`, `--radius-*`, `--shadow-card`, `--font-body`/`--font-display`), iniettate per tenant da `layout.tsx` — vedi §12bis |
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

**Colori brand ChloeFood (valore DB attuale — aggiornato 17/07):**
- Primary: **`#1267C7` (blu)** — live in `tenants.primary_color`, query eseguita manualmente da Robertin (era `#1D9E75` fino a questa revisione)
- Secondary: `#F2C811` (giallo/moutarde)
- Accent light: `#E1F5EE` — ⚠️ non toccato dalla migrazione colore, nota di coerenza visiva ancora aperta (vedi §12bis)

**✅ Codice storefront ora interamente token-based su questo branch di lavoro (Fase 1–3 — vedi §12bis per il dettaglio completo). ⚠️ Correzione v3.7: non risulta invece mergiato su `main`** (verificato via `git merge-base`, contrariamente a quanto affermato nelle revisioni precedenti — vedi §12bis per l'evidenza). Prima di questo lavoro, il verde `#1D9E75` era hardcoded in punti multipli (BottomNav, PWABanner, AddToCartButton, HeroBanner, pagina tracking ordine) invece di derivare da `tenant.primary_color` — bug di multi-tenancy reale, non solo teorico: un cambio colore via DB non si sarebbe propagato ovunque. **Tutti questi punti sono stati corretti**: l'intero storefront pubblico deriva ora da variabili CSS iniettate da `layout.tsx` (`--color-primary`, `--color-primary-light`, `--color-primary-dark`, `--color-primary-hover`, `--color-secondary`, più `--radius-*`/`--shadow-card`/`--font-body`/`--font-display`, vedi §12bis) — il cambio di `tenant.primary_color` in DB (eseguito il 17/07) si è propagato correttamente ovunque, incluso ai nuovi elementi introdotti (cartellino signature `ShopTag`, pattern decorativo hero).

**⚠️ Nota di coerenza aperta:** `tenant.accent_light` (`#E1F5EE`, verde menta) non è stato aggiornato insieme al primary e resta visivamente scollegato dal nuovo blu nei punti che lo usano ancora come sfondo chiaro (es. contenitore icona prodotto in `ProductCard`). Non bloccante, ma da valutare — vedi §19.

**✅ Brand charter v2 — le 3 decisioni derivate sono implementate nel codice di questo branch. ⚠️ "Deployate" corretto in v3.7: non risulta mergiato su `main`, vedi §12bis.** Dalice ha ricevuto una nuova charter grafica (20 pagine) con logo, palette e materiali completamente diversi — colore primario proposto **blu `#1267C7`**. Charter incompleta all'origine (mancano varianti icona/monocromatiche, riferimenti Pantone, dati placeholder errati come dominio e nome fittizio "TSANA"), ma le tre decisioni di design derivate ne sono state validate su mockup interattivo (`Mockup_Fase3_Validazione_UIUX.html`, allegato non versionato nel repo) e implementate in codice su questo branch:
1. **Font titoli/segnaletica: Bricolage Grotesque** (corpo testo resta Inter) — caricato via `next/font/google`, decisione di piattaforma applicata a tutti i tenant, non tenant-specifica.
2. **Colore primario → blu `#1267C7`** — era una decisione di **dato**, non di codice: nessuna occorrenza di questo hex è mai stata scritta nel codice, il codice legge sempre `tenant.primary_color`. **Query SQL eseguita il 17/07.**
3. **Elemento signature "cartellino da bottega"** (`ShopTag.tsx`) — nel mockup era descritto come oro fisso "dal logo"; **deliberatamente non implementato così**, perché quel ragionamento è specifico a ChloeFood. In produzione usa `var(--color-secondary)` (già `#F2C811`, visivamente equivalente per ChloeFood), quindi resta corretto per qualunque tenant futuro.

Il nuovo logo (JPEG, versione completa + versione icona) resta integrato solo sulla landing page `chloefood.com` (hero, favicon, PWA icon, colore hero blu) — quella parte non fa parte di questo audit (`apps/storefront`) ed è rimasta invariata.

### 2.1 Revisione di sicurezza — ✅ 4 criticità risolte (deployate 2026-07-02)

Una code review tecnica (`docs/PROJECT_REVIEW.md`) ha identificato e la piattaforma ha **corretto e deployato in produzione** 4 falle critiche/alte:

1. **API admin senza autenticazione (CRITICO).** Le route `POST /api/admin/catalogue`, `PATCH/DELETE /api/admin/catalogue/[id]`, `PATCH /api/admin/orders/[id]`, `POST /api/admin/generate-product-image`, `POST /api/admin/upload-product-image` usavano `createServiceClient()` (bypassa RLS) senza mai verificare sessione o whitelist `ADMIN_EMAILS` — chiunque conoscesse l'URL poteva scrivere. **Fix:** nuovo helper `src/lib/auth/requireAdmin.ts`, chiamato in testa a ogni route admin (incluse ora anche le route etichette `/api/admin/labels/*` e upload asset), risponde 401/403 senza sessione valida.
2. **Checkout fidato del client (CRITICO).** Prezzo e costo di spedizione arrivavano dal browser — un payload modificato poteva far pagare 0,01 € l'intero carrello. **Fix:** `api/checkout/route.ts` rilegge prezzo/nome/`storage_type` dal DB per `productId` (filtrato per tenant + prodotti attivi); il costo di spedizione è certificato da un token HMAC-SHA256 (`src/lib/shipping/quoteToken.ts`) emesso da `/api/shipping/quote` che lega importo/paese/CAP/scadenza (1h) — il checkout lo verifica e confronta con l'indirizzo; il pickup è forzato a spedizione 0 lato server.
3. **Policy RLS troppo permissive (ALTO).** `orders_insert_any`/`order_items_insert_any` con `with check (true)` permettevano insert arbitrari con la anon key pubblica. **Fix:** `016_security_hardening.sql` rimuove le due policy — tutti gli insert reali passano dal service role.
4. **Idempotenza webhook fragile (ALTO).** Il check "ordine già esistente?" era check-then-insert, vulnerabile a doppio retry Stripe concorrente. **Fix:** stessa migration 016, indice unico parziale su `orders.stripe_payment_intent_id`; il webhook tratta la unique violation (23505) come ordine già creato da un retry concorrente.

**Debito residuo noto (non ancora corretto):** `FROM_ADDRESS` ancora hardcoded `IT 42122` in `api/shipping/quote/route.ts` nonostante esista `warehouse_location`; il breakdown spedizione (`_internal`: corriere, IVA, surcharge 3€/pacco) è visibile nei devtools nonostante la doc affermi sia nascosto; file morti `src/app/admin/orders/[id]/` e `src/app/admin/orders/id/` (vedi §8); `xlsx@0.18.5` ha vulnerabilità note senza fix; `@supabase/ssr@0.3` datato; zero test automatizzati. Dettaglio completo in `docs/PROJECT_REVIEW.md`.

**✅ Gestione stock reale al checkout — RISOLTO (20/07, fix urgente separato dall'audit performance, vedi §17bis).** Fino a questa fix, il punto precedente di questo elenco era "nessuna gestione stock reale al checkout (stock default 999, mai decrementato)" — confermato **letteralmente vero**: né il checkout né alcun trigger DB verificavano o decrementavano mai `products.stock`. Ora: controllo pre-pagamento in `/api/checkout` (fail-fast, nessun addebito se stock insufficiente) + decremento atomico race-safe (`UPDATE ... WHERE stock >= qty RETURNING`, migration `029_atomic_stock_decrement.sql`) nel punto corretto per ciascun flusso (webhook Stripe per il flusso online, sincrono in `/api/checkout` per il flusso in-store) + rimborso Stripe automatico e notifica admin via n8n per il caso limite "pagato ma stock esaurito nel frattempo". **⚠️ Il test di race condition in staging (due checkout quasi simultanei sull'ultimo pezzo) non è ancora stato eseguito** — il fix è live ma non verificato empiricamente, vedi §17bis e §18.

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
| `029_atomic_stock_decrement.sql` | Funzione PL/pgSQL per decremento stock atomico/condizionale (`UPDATE ... WHERE stock >= qty RETURNING`, transazionale); aggiunge `'stock_conflict'` al constraint `orders.status` (ricostruito includendo esplicitamente anche `ready_for_pickup`, che era in uso nel codice admin ma non risultava mai aggiunto da nessuna migration — vedi §17bis) |

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
- **✅ Audit dedicato eseguito su questa regola per lo storefront pubblico (Fase 1–3, §12bis), ⚠️ ma solo su questo branch di lavoro, non su `main`.** Prima dell'audit la regola era violata in più punti concreti (colori hardcoded in BottomNav/PWABanner/AddToCartButton/HeroBanner/tracking ordine, nome tenant hardcoded `"Chloé Food"` in PWABanner). Tutti corretti su questo branch; il pattern qui è: solo `var(--color-*)` o classi Tailwind mappate nei componenti storefront, mai hex literal — ma `main` risulta ancora con gli hex hardcoded originali (verificato v3.7, vedi §12bis). Vedi §12bis per il dettaglio e per il lavoro analogo ancora da fare fuori da `apps/storefront` se in futuro si aggiungerà un secondo tenant con branding diverso
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

### ⚠️ File morti — ✅ rimossi (Fase 0 redesign admin, §8bis)

`AdminNav.tsx` (soppiantato da `AdminSidebar.tsx`), `AdminOrdersClient.tsx` (dashboard client-side parallela, mai più montata) e `src/app/admin/orders/id/PickingList.tsx` (cartella letterale `id`, bozza abbandonata) sono stati eliminati, verificato via grep globale sugli import prima della cancellazione. Resta com'era, e non è un problema: `src/app/admin/orders/[id]/` **non è una route** (nessun `page.tsx`), è una cartella di componenti (`OrderDetail.tsx`, `PickingList.tsx`) importati via percorso relativo dalla vera pagina protetta `admin/(protected)/orders/[id]/page.tsx` — pattern confermato corretto, non toccato dal redesign.

⚠️ **Bug pre-esistente trovato e corretto durante il redesign**: l'icona di stampa "Liste de préparation" nella tabella ordini puntava a `/admin/orders/[id]/picking-list`, una route mai esistita — 404 silenzioso presente da prima di questo lavoro. Corretto in Fase 3 creando la route mancante (vedi §8bis).

### Funzionalità implementate

- Lista ordini con **KPI cards** — dettaglio aggiornamenti in §8bis, in sintesi: fatturato totale + mese corrente con delta, "À expédier" cliccabile con filtro; prima card **"Aujourd'hui"** (conteggio ordini di oggi, "X au total" come sotto-riga) — ✅ eseguita, verificato nel codice (`admin/(protected)/page.tsx`), correzione rispetto a v3.6 che la segnalava ancora pendente
- Filtri: **6** (Statut con conteggi per stato, date range nativo `<input type="date">` ×2 al posto del preset fisso, Livraison, Paiement) — aggiornati in Fase 0 e nell'addendum filtri, vedi §8bis
- Tabella ordini: **responsive tablet-first** con colonne raggruppate, righe espandibili mantenute, ordinamento data/montant, **dark mode** scoped al solo layout admin, **selezione multipla + bulk bar** (export CSV, stampa massiva liste di preparazione, cambio stato con guardrail) — dettaglio completo in §8bis
- Colonna badge metodo di pagamento nella tabella ordini (ora componente condiviso `StatusBadge.tsx`, non più duplicato inline)
- Badge visivo per ordini di oggi
- Badge bandiere SVG per ordini internazionali
- Indicatori storage: ❄ surgelé / 🌿 frais
- Dettaglio ordine: aggiornamento stato + codice tracking — **ora con blocco**: non si può salvare stato "Expédié" senza `tracking_code` valorizzato, vedi §8bis
- Select corriere configurabile con modale conferma cambio
- Toggle lingua FR/IT
- **Navigazione mobile** (`AdminMobileNav.tsx`, non documentata nelle revisioni precedenti): la sidebar admin è `hidden md:block`, quindi sotto `md` non esisteva alcun modo di navigare tra le sezioni admin — colmato con un drawer a comparsa da sinistra (bottone hamburger in header, overlay, chiusura su `Escape`/click fuori/cambio route), riusa lo stesso `AdminSidebar.tsx` del desktop
- **Picking list stampabile** — ora raggiungibile anche come route dedicata `admin/(protected)/orders/[id]/picking-list/page.tsx` (bug fix Fase 3, vedi sopra) oltre che dalla pagina dettaglio esistente; nuova route gemella `admin/(protected)/orders/picking-list?ids=...` per la stampa massiva da selezione multipla
- Aggiornamento **live via polling** (18s, sospeso a tab nascosta) + toast + avviso in-tab (Notification API) su nuovo ordine — **non** vera push PWA, vedi §8bis e §19
- **Gestione catalogo prodotti** (`/admin/catalogue`): sidebar con accordion per categoria, ricerca client-side (soglia `catalogue_search_threshold`), colonne ordinabili via URL params, toggle inline Actif, editing inline stock con indicatori colore, drag&drop upload immagine, generazione immagine AI (Gemini); **`/admin/catalogue/nouveau`** per creazione nuovo prodotto (riusa `ProductEditClient` con uno stub `emptyProduct`) — ⚠️ fuori dal perimetro del redesign Fase 0–4, non toccato
- **Sistema etichette** (`/admin/products/[id]/etichetta`) — vedi §16, ora maturo: multi-template, multi-palette, draft/ristampa, preview live, autosave — ⚠️ fuori dal perimetro del redesign Fase 0–4, non toccato
- **Pannello billing** (`/admin/billing`) — non toccato
- **Impostazioni boutique** (`/admin/parametres`) — include download QR code biglietto da visita digitale — non toccato

---

## 8bis. Audit e redesign UI/UX pannello admin (Fase 0–4 + 2 addenda) — ⚠️ implementato, non su `main`

**Stato:** tutte le fasi implementate con build/typecheck verdi ad ogni passaggio. **Verificato ora (v3.7) direttamente su git/filesystem, non solo su checklist riportate in chat**: `git merge-base main HEAD` coincide con la punta di `main`, cioè **nessun commit di questo lavoro è mai stato mergiato su `main`** — esiste solo su questo branch. Questo vale anche per il redesign storefront (§12bis), nonostante affermazioni precedenti del contrario — vedi intestazione documento. Diverse verifiche manuali "da fare sulla preview Vercel autenticata" (il container di build non ha le env Supabase) restano non confermate — dettaglio in "Cosa resta aperto" sotto. **Da verificare con Robertin quale branch sia effettivamente collegato al deploy Vercel prima di considerare questo lavoro live.**

Origine: `AUDIT_ADMIN_UIUX.md` (17/07), scope dichiarato: dashboard commandes (`(protected)/page.tsx`), `OrdersTable.tsx`, `AdminFilters.tsx`, `AdminSidebar.tsx`, design token (`globals.css`, `tailwind.config.ts`) — **`/admin/catalogue`, sistema etichette, billing, paramètres esplicitamente fuori scope**. Mockup di validazione: `admincommandesredesign.html` (allegato di sessione, non versionato nel repo, come il suo equivalente storefront in §12bis).

### Fase 0 — fondamenta

Token semantici di stato (`--status-info/warn/success/danger-{bg,fg,dot}`) in `globals.css`, indipendenti dal tenant per design (lo stato di un ordine ha lo stesso significato in ogni negozio). Componente condiviso `StatusBadge.tsx` (`admin/_components/ui/`), sostituisce due implementazioni duplicate identiche (`OrdersTable.tsx` e il poi-eliminato `AdminOrdersClient.tsx`). Fix del filtro Statut (mancavano `new` e `ready_for_pickup` come opzioni filtrabili, pur esistendo come stati reali). Rimozione dei 3 file morti (vedi §8).

### Fase 1 — accessibilità (WCAG 2.2 AA)

- Nessun testo informativo sotto 12px (`text-[10px]` → `text-xs` su badge "Aujourd'hui", tag quantità, contatori — le emoji di conservazione ❄/🌿 restano piccole per design, ora con `aria-label`+`role="img"`)
- `text-gray-400` → `text-gray-500` su testo informativo (2.5:1 → 4.8:1); `gray-400` resta solo per icone/placeholder
- `var(--color-primary)` **come colore di testo** (non solo sfondo) su bianco/chiaro sostituito con `--color-primary-dark` in 3 punti (`KpiCard` "Voir →", filtro attivo, voce attiva sidebar) — stesso problema di contrasto misurato dall'audit sui pulsanti pieni (~3.4:1 col verde ChloeFood), esteso per coerenza al testo
- Target size ≥24×24px su freccia espansione riga e bottone "Effacer" ricerca; `aria-expanded` sulla freccia; `aria-label` sul link picking-list
- `scope="col"` su tutti i `<th>`, testo `sr-only` sulle colonne senza etichetta visibile
- ⚠️ **Lighthouse/axe non eseguibile in sessione** (container senza env Supabase) — baseline da raccogliere su preview autenticata, mai confermata fatta
- Stesso pattern di contrasto esiste ancora in `OrderDetail.tsx`, `ProductEditClient.tsx`, `admin/login/page.tsx` — deliberatamente fuori scope, segnalato come mini-fase futura

### Fase 2 — tabella responsive tablet-first + dark mode

- Colonne da 10 a 7: Commande+Client fuse (email spostata nel pannello espanso), Transporteur confluito come sotto-riga di Montant, Paiement secondaria (`hidden lg:table-cell`)
- **Righe espandibili mantenute** — decisione esplicita di Robertin (17/07): il pattern "riga troncata → link a pagina dettaglio" mostrato nel mockup di validazione **non è stato implementato**, resta il pannello inline già esistente, arricchito con email + paiement quando nascosto
- Ordinamento client-side data/montant (`aria-sort` sul `<th>`)
- Card list `md:hidden` con tap-through al dettaglio (pattern diverso dalle righe espandibili solo perché sotto `md` non c'è spazio per un pannello leggibile, non una contraddizione della decisione sopra)
- **Dark mode**: decisione tecnica esplicita di **non** migrare tutto a CSS custom properties come nel mockup (troppo invasivo sul codice reale, quasi interamente classi Tailwind letterali) — usato invece `darkMode: 'class'` di Tailwind, wrapper `.dark` scoped al solo `(protected)/layout.tsx` (mai su `<html>`, storefront non toccato), `AdminThemeProvider`+`ThemeToggleButton`, persistenza `localStorage`. Token `.dark` in `globals.css` per i componenti già CSS-var-based (`StatusBadge`); **`--color-primary-light` ricalcolato via `color-mix()` dal primario del tenant, non hardcoded** (stesso principio multi-tenant di §5); `--color-primary-dark` risistemato in `.dark` (schiarito verso il bianco, direzione invertita rispetto al chiaro) perché altrimenti illeggibile su fondo scuro. `PaymentBadge`/`FlagBadge`/badge "C&C" convertiti da `style` inline con hex fissi a `className` con varianti `dark:` (gli stili inline non rispondono mai alle classi Tailwind)
- ⚠️ `OrderDetail.tsx` eredita il wrapper `.dark` (sta dentro `(protected)`) ma non ha classi `dark:` — resta visivamente chiaro col tema scuro attivo, atteso non un bug, da comunicare prima di mostrarlo a Dalice
- ⚠️ Verifica visuale 768/1023px e Lighthouse in dark mode segnalate "da fare su preview", mai confermate esplicitamente chiuse

### Fase 3 — selezione multipla e azioni bulk

- Checkbox riga + "seleziona tutto" (stato `indeterminate`), selezione azzerata al cambio ricerca/filtri
- Bulk bar sticky (`role="toolbar"`): **Export CSV** (client-side puro, Blob + BOM UTF-8 per gli accenti francesi in Excel — **non XLSX**: `xlsx@0.18.5` ha vulnerabilità note senza fix, coerente con la voce roadmap §19 che ne raccomandava già la sostituzione; **deviazione dalla decisione presa con Dalice il 17/07** che indicava XLSX come formato unico — accettata da Robertin il 18/07, non risulta ricomunicata a Dalice), **stampa massiva liste di preparazione** (route `orders/picking-list?ids=...`, un solo tab, `page-break-before` tra ordini), **cambio stato bulk** con guardrail multipli
- **Guardrail bulk status** (aggiunti dopo revisione, non nella prima versione): solo da stato `preparing`; ordini `pickup` (Click & Collect) vanno sempre a `ready_for_pickup`, **mai** a `shipped`; ordini `delivery` senza `tracking_code` **non vengono più saltati silenziosamente** — si apre un pannello (`BulkTrackingModal.tsx`) per inserire trasportatore+codice riga per riga prima di procedere. Nessuna cancellazione/rimborso bulk (tocca Stripe, va gestito singolarmente)
- API `bulk-status`: `requireAdmin()` + rilettura server-side dello stato reale (mai fidarsi della selezione del client) + `tenant_id` esplicito nella query (il service client bypassa RLS)
- **Dettaglio ordine singolo**: salvataggio bloccato se si imposta "Expédié" senza `tracking_code` valorizzato (stesso vincolo di business della bulk, applicato anche al percorso singolo)

### Fase 4 — aggiornamenti live (polling, non Realtime) + KPI

- **Decisione presa dopo aver verificato i volumi reali di ChloeFood** (1, raramente 2 admin in parallelo; <10 ordini/giorno il 18/07): **polling leggero** (18s, sospeso a tab nascosta, giro extra su `visibilitychange`) invece di Supabase Realtime vero. Un primo prompt con Realtime + nuova tabella `tenant_admins` + policy RLS `SELECT` su `orders` è stato scritto e **scartato prima dell'esecuzione** — resta come riferimento se il volume o il numero di admin concorrenti crescerà
- Endpoint `/api/admin/orders/poll` riusa `requireAdmin()`, nessuna nuova superficie di accesso
- **Guardia anti-interruzione**: se l'operatore ha il pannello tracking bulk aperto (`isEditing`), il poll continua a girare ma il `router.refresh()` viene rimandato finché il pannello non si chiude, per non perdere lavoro in corso
- `NotificationBell.tsx`: avviso di sistema **solo mentre la scheda è aperta** (Notification API, non service worker) — esplicitamente **non** le notifiche push vere promesse a Dalice il 17/07, vedi sotto e §19
- ✅ **KPI "Aujourd'hui"**: prevista dal piano originale dell'audit, persa nella riscrittura della fase attorno alla decisione Realtime→polling, poi **eseguita** — sostituisce "Commandes totales" come prima card, con il totale mantenuto come sotto-riga (`${totalCount} au total`). Correzione v3.7: la revisione precedente (v3.6) la segnalava ancora pendente, ma il commit che l'ha implementata (18/07, 23:03) precede quello che ha scritto v3.6 (18/07, 23:42) — la chat non era stata aggiornata di conseguenza, non un errore del codice

### Addendum 1 — filtri: date range nativo + conteggi

Completa l'audit §3.5 (solo il punto 1, filtro Statut, era stato coperto in Fase 0): filtro "Période" sostituito da due `<input type="date">` nativi (`dateFrom`/`dateTo`, zero librerie), filtro Statut con conteggio per stato (es. "En préparation (3)", nessun `(0)` per stati vuoti). Dati derivati da query già esistenti, nessuna nuova query pesante.

### Addendum 2 — navigazione mobile (`AdminMobileNav.tsx`)

Non presente nel piano originale dell'audit né nelle revisioni precedenti di questo documento — scoperta durante la verifica v3.7 contro il codice reale (commit 18/07, 23:20). Prima di questa aggiunta, `AdminSidebar` era `hidden md:block`: sotto la soglia `md`, l'admin non aveva alcun modo di raggiungere catalogue/etichette/billing/paramètres se non digitando l'URL a mano. `AdminMobileNav.tsx` apre un drawer da sinistra (bottone hamburger nell'header, overlay cliccabile, chiusura su `Escape` e al cambio route) che riusa lo stesso `AdminSidebar.tsx` del desktop — nessuna duplicazione di markup di navigazione.

### Decisioni prese in sessione (18/07) — divergono dal piano originale dell'audit

| Tema | Decisione audit/17-07 | Decisione effettiva 18/07 | Note |
|---|---|---|---|
| Export bulk | XLSX (decisione col committente) | **CSV** | Vulnerabilità nota `xlsx@0.18.5`; accettato da Robertin, **non risulta comunicato a Dalice** |
| Notifiche | Push vera (Web Push/service worker, decisione col committente) | **Rimandata in roadmap** | Solo avviso in-tab implementato; vedi §19 |
| Aggiornamenti live | Supabase Realtime | **Polling 18s** | Basato sui volumi reali verificati in sessione, non sulla raccomandazione originale dell'audit |
| Righe tabella | Mockup: troncate + link dettaglio | **Espandibili, mantenute** | Decisione esplicita di Robertin, 17/07 |

### Cosa resta aperto

- **Merge su `main`** del lavoro Fase 0–4 — verificato in v3.7 che **non è mai avvenuto** (`git merge-base main HEAD` = punta di `main`), non solo "non confermato in sessione" come detto in v3.6. Stesso discorso per il redesign storefront (§12bis). Da chiarire con Robertin quale branch Vercel deploya realmente
- Diverse verifiche manuali su preview Vercel autenticata segnalate ma non esplicitamente richiuse: Lighthouse/axe baseline (Fase 1), verifica visuale 768/1023px + Lighthouse dark mode (Fase 2), fix 404 picking-list + 3 azioni bulk + page-break multi-ordine + accenti CSV in Excel (Fase 3), comportamento guardia anti-interruzione poller su tre scenari (Fase 4)
- **Comunicare a Dalice** la deviazione CSV (invece di XLSX) e il rinvio delle notifiche push vere, essendo entrambe decisioni prese con lei il 17/07 e cambiate il giorno dopo senza il suo coinvolgimento diretto in sessione
- Estrazione componenti condivisi rimasta parziale: solo `StatusBadge.tsx` estratto; `Badge.tsx` (generico), `KpiCard.tsx`, `Toast.tsx`, `BulkBar.tsx` restano inline nei rispettivi file (§4 dell'audit li raccomandava come componenti condivisi) — debito di organizzazione, zero impatto utente
- Test manuali WCAG mai eseguiti: zoom 200% (1.4.4), screen reader reale (VoiceOver/NVDA) — solo Lighthouse/axe automatici pianificati
- Stesso pattern di contrasto/target-size delle Fasi 1-2 esiste ancora in `OrderDetail.tsx`, `ProductEditClient.tsx`, `admin/login/page.tsx` — fuori scope per scelta, non per svista
- Se in futuro serve davvero il Realtime (più admin concorrenti, volume cresciuto): il prompt scartato in Fase 4 (RLS `tenant_admins` + `postgres_changes`) resta un punto di partenza valido, non va ripreso "perché più elegante"

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
- Banner installazione Android animato — colore `var(--color-secondary)` e nome `tenant.name` (corretti in Fase 1/2.2 dell'audit UI/UX, §12bis: prima erano hardcoded `#F2C811` e `"Chloé Food"` rispettivamente, con un `TODO multi-tenant` esplicito nel codice mai risolto fino ad allora)
- Visibile solo su mobile, scompare dopo installazione
- **Icona PWA dinamica:** route `/api/pwa-icon?size=192` con `sharp` per resize server-side, legge `tenant.logo_url` a runtime (nessun file statico per tenant)
- ⚠️ Nota tecnica: la route attualmente serve lo stesso asset indipendentemente da `size`/`purpose` — nessuna vera distinzione tra icona maskable e "any" a runtime; raccomandato usare la versione maskable (con safe-zone) come master unico
- Google Play via TWA/PWABuilder (~25€ una tantum) — roadmap, non avviato

---

## 12. Layout app mobile

- **Hero compatto:** logo 44px + testo, sostituisce il vecchio hero centrato a blocco largo
- **Notification bar** (36px) sotto l'header con animazione ticker CSS
- **Banner emozionale (ridisegnato in Fase 3, vedi §12bis):** sfondo a gradiente `var(--color-primary-dark)` → `var(--color-primary)`, pattern decorativo a triangoli ripetuti (SVG, bassa opacità, non più i cerchi piatti verde scuro `#085041` della versione precedente), layout a due colonne su desktop (testo + doppio CTA + trust-row a sinistra, mini-preview di prodotti reali in evidenza a destra) impilato su mobile; eyebrow ora il cartellino signature `ShopTag`; supporta `tenant.hero_image_url` opzionale (quando presente sostituisce pattern+gradiente con l'immagine + overlay scuro)
- **Bottom navigation bar** (4 tab, icone Tabler non emoji): Accueil · Catalogue · Panier (con badge) · Commandes
- Visibile solo su mobile (`md:hidden`), nascosta nel layout admin
- Homepage: scroll orizzontale per categoria (stile Netflix/App Store); grid su desktop
- **Ricerca real-time:** debounce 300ms + `router.replace` (URL params) + `useTransition`, mantenuta nel catalogo completo
- Footer: link "Powered by Lepefy" configurabile per tenant via `tenants.show_powered_by`, punta a `food.lepefy.com`; padding `env(safe-area-inset-bottom)` per non sovrapporsi alla bottom nav fissa su mobile

---

## 12bis. Audit e redesign UI/UX storefront (Fase 1–3) — ⚠️ non su `main`, contrariamente a quanto documentato finora

**Stato:** lavoro completo (typecheck verde su tutte le fasi). **Correzione v3.7:** le revisioni precedenti (v3.4–v3.6) affermavano "mergiato su `main` e deployato" tramite un branch dedicato `claude/lepefy-storefront-audit-69xss0`. Verifica diretta contro il repository reale in questa sessione mostra che **quel branch non esiste** (né in locale né su `origin`) e che **`main` non contiene queste modifiche**: `git merge-base main HEAD` coincide con la punta di `main` (ultimo commit 16/07 11:47, precedente a tutto questo lavoro), `ShopTag.tsx` non esiste su `main`, e `BottomNav.tsx` su `main` ha ancora l'hex hardcoded `#1D9E75`. Tutti i commit del redesign risultano invece su questo stesso branch di lavoro condiviso (`claude/update-lepefy-project-context-fke5jo`), insieme al lavoro successivo sull'admin (§8bis) — coerente con il workflow reale di Robertin (upload diretto via GitHub web UI su un unico branch aperto, non PR separate per feature). **Non verificabile da qui se `chloefood.com` deploya effettivamente da `main` o da questo branch** (nessun `vercel.json` nel repo) — da confermare con Robertin prima di considerare questo lavoro live in produzione. Perimetro: solo `apps/storefront`, `apps/admin` (route `src/app/admin/**`) esplicitamente escluso in ogni fase.

Origine: audit strategico dello storefront pubblico (home, catalogo, scheda prodotto, carrello, checkout, tracking ordine), poi implementato in 3 fasi + una passata di allineamento a un mockup di validazione approvato (`Mockup_Fase3_Validazione_UIUX.html`, allegato di sessione, non versionato nel repo).

### Fase 1 — de-hardcoding colori, font reale, accessibilità

- Rimossi gli hex hardcoded (`#1D9E75`/`#F2C811`) in `BottomNav.tsx`, `AddToCartButton.tsx` (poi eliminato in Fase 2.1), `HeroBanner` (`page.tsx`), pagina tracking ordine (`orders/[id]/page.tsx`) — sostituiti con `var(--color-primary)`/`var(--color-secondary)`
- Font **Inter** dichiarato in `tailwind.config.ts` ma mai davvero caricato prima di questa fase — ora caricato via `next/font/google` in `layout.tsx`
- Nuovo token `--color-primary-dark` (`color-mix(in srgb, var(--color-primary) 75%, black)`) — varianti scure derivate senza bisogno di nuove colonne DB
- `:focus-visible` globale coerente (era assente su bottoni/link, solo gli input l'avevano)
- Touch target dei pulsanti quantità/aggiungi portati a 44×44px (WCAG)

### Fase 2.1 — unificazione ProductCard + estensione token

- **Le 3 implementazioni parallele della card prodotto** (`components/catalog/ProductCard.tsx`, più due copie inline in `page.tsx` e `FeaturedProducts.tsx` con `<img>` raw e colori hardcoded) **unificate in una sola**, con prop `variant: 'grid' | 'shelf'`
- `AddToCartButton.tsx` eliminato (era usato solo dalle due copie ora rimosse, zero altri riferimenti)
- Nuovi token: `--color-primary-hover`, `--radius-sm/md/lg/full`, `--shadow-card`, mappati su classi Tailwind (`rounded-sm/md/lg/full`, `shadow-card`) — applicati per allora solo alla ProductCard

### Fase 2.2 — immagini, icone, skeleton, tipografia, pulizia duplicati

- `<img>` raw residue migrate a `next/image` (thumbnail carrello, sfondo hero)
- Emoji di stato (🛒🚚📦✅🏪🔒⏳📍🕐💳📋) sostituite con icone `@tabler/icons-react` (già dipendenza esistente) in tracking ordine, conferma ordine, carrello, checkout
- Skeleton loading (`ProductCardSkeleton` in `ProductGrid.tsx`) al posto del semplice `opacity-60` durante la ricerca catalogo
- Scala tipografica: un solo step aggiuntivo `2xs` (10px) sopra la scala Tailwind di default — i `text-[Npx]` arbitrari sparsi nel codice migrati al riuso di `2xs/xs/sm/xl/2xl`
- **`CategoryFilter.tsx` eliminato** — duplicato mai importato (verificato via grep sugli import); il filtro categorie realmente reso è quello inline in `CatalogClient.tsx`. `src/lib/utils/cn.ts` è rimasto come dipendenza orfana di quel componente eliminato (nessun altro import nel repo) — non rimosso, essendo un helper generico

### Fase 3 — font display, elemento signature, hero editoriale (validati su mockup)

- **Font Bricolage Grotesque** caricato accanto a Inter, nuovi token `--font-body`/`--font-display` in `globals.css`, classe `font-display` applicata a H1 hero, H2 sezioni home, H1 catalogo (rinominato "Catalogue" → "Sélection de la boutique"), wordmark header, testo del cartellino
- **Nuovo componente signature `src/components/ui/ShopTag.tsx`** — il "cartellino da bottega" (clip-path a tag con perforazione dipinta, leggera rotazione), colorato `var(--color-secondary)` — **non** l'oro fisso descritto nel mockup come "dal logo": quel ragionamento è specifico a ChloeFood e non generalizzabile, vedi §2. Applicato su `ProductCard` (etichetta derivata da `storage_type` reale → "Frais"/"Surgelé"/"Épicerie", fallback categoria, mai una stringa fissa uguale per tutti i prodotti) e nell'eyebrow dell'hero (testo rimasto `tenant.tagline`, tenant-driven, non sostituito dal copy fisso del mockup)
- **Hero ridisegnato**: gradiente `primary-dark → primary`, pattern a triangoli via SVG/`<pattern>` (nessuna immagine raster), layout a due colonne su desktop con preview di prodotti reali (featured, non placeholder), impilato su mobile; copy H1/sottotitolo aggiornata, doppio CTA ("Découvrir le catalogue" + "Notre histoire" — quest'ultimo **punta temporaneamente a `/products` per mancanza di una pagina di destinazione reale, marcato `TODO` nel codice**, decisione di prodotto aperta), trust-row a 3 voci
- **Verifica contrasto per il futuro blu `#1267C7`** (calcolata, non stimata): testo bianco su `--color-primary` 5.54:1, su `--color-primary-dark` 8.36:1, testo `--color-primary` su bianco 5.54:1 — tutti ≥ AA. Nota di coerenza dati non bloccante: `tenant.accent_light` (verde menta) non fa parte della migrazione colore e resterebbe visivamente scollegato dal nuovo blu se non aggiornato in parallelo

### Migrazione dati — ✅ eseguita il 17/07

```sql
-- Eseguita manualmente su Supabase il 17/07:
UPDATE tenants SET primary_color = '#1267C7' WHERE slug = 'chloefood';

-- Non ancora eseguita — valutare in roadmap (§19), non bloccante:
-- UPDATE tenants SET accent_light = '#E3EFFB' WHERE slug = 'chloefood';
```

### Cosa resta aperto

- **CTA "Notre histoire"** senza destinazione reale (punta a `/products`) — decisione di prodotto spostata in roadmap, §19
- `tenant.accent_light` non aggiornato in coerenza col nuovo blu (non bloccante, vedi §2)
- Copy H1/sottotitolo hero restano stringhe FR fisse uguali per ogni tenant (preesistente, non introdotto né risolto da questo audit)
- Nessun campo prodotto per una vera "origine/provenienza" (usato `storage_type` + `weight_grams` come miglior proxy reale disponibile)

---

## 13. Catalogo prodotti (ChloeFood)

**Fonte:** catalogo "ChloeFood_Template_Catalogue_v2" (121 prodotti, 8 categorie: Épices, Légumes, Farines, Poissons, Sauces & Huiles, Snacks, Viandes séchées, Boissons), importato e poi **riseminato idempotentemente** via `020_reseed_products_catalogue_v2.sql`.

Mapping storage: Produits frais → `fresh`, Produits surgelés → `frozen`, tutti gli altri → `dry`.

**Regola stock:** `stock` rappresenta il numero di unità vendibili nell'unità di vendita dichiarata. **✅ Controllo e decremento reale al checkout implementati (20/07)** — vedi §2.1 e §17bis per il dettaglio del fix. Il cap lato client nel carrello resta come prima barriera UX (fail-fast prima ancora di arrivare al checkout), ma non è più l'unica protezione.

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

## 17bis. Ottimizzazione performance frontend + fix urgente stock/overselling (20 Luglio 2026)

Due lavori distinti, condotti in sequenza nella stessa sessione: un audit performance con 5 prompt di implementazione (`AUDIT_PERFORMANCE_FRONTEND.md`), e — scoperto come debito già noto (§2.1/§13) ma reso urgente dall'introduzione di ISR — un fix del tutto separato per il controllo/decremento stock al checkout, mai esistito prima. **Tutto confermato caricato su `main` via GitHub web UI** (workflow diretto di Robertin).

### Audit e roadmap (5 prompt)

**Prompt 1 — Query mirate + fetch parallelo home.** `select('*')` → colonne esplicite su `/products` e `/products/[slug]` (mai `embedding`, `descriptions` solo dove serve). Home: loop sequenziale `for...await` sostituito con `Promise.all` per categoria. `loading.tsx` su home/catalogo/pagina prodotto (riuso dello skeleton già esistente in `ProductGrid`). Nota tecnica: PostgREST infetta un tipo strutturale più stretto quando la `select()` elenca colonne esplicite invece di `'*'` — richiede occasionalmente un cast `as unknown as X`, pattern già presente altrove nel codebase, non nuovo.

**Prompt 2 — Immagini + caching.** Logo tenant `<img>` → `next/image` (header pubblico e admin), `width`/`height` come hint di aspect-ratio (il rendering reale resta governato da classi Tailwind `h-*/w-auto`, nessuna distorsione per loghi con proporzioni diverse). `next.config.mjs`: `formats: ['avif','webp']`, `minimumCacheTTL` 7 giorni. Resize server-side via `sharp` sull'upload manuale immagine prodotto (`upload-product-image`), con **cache-busting** (`?v=${Date.now()}` sull'`image_url` salvato) per evitare che il `minimumCacheTTL` lungo serva foto stale dopo un re-upload sullo stesso path. `sharp` aggiunto come dipendenza diretta (richiede `experimental.serverComponentsExternalPackages: ['sharp']` in `next.config.mjs` — nome corretto per Next.js 14.2.3, non `serverExternalPackages` che è la chiave Next.js 15). ⚠️ **Rischio segnalato e non risolto:** `tenants.logo_url` non ha vincolo di dominio — un tenant futuro con logo su un host esterno non in `images.remotePatterns` romperebbe l'header con un errore runtime "hostname not configured".

**Prompt 3 — Paginazione server-side catalogo.** `PAGE_SIZE = 24`, bottone "Charger plus" con **accumulo** (non sostituzione) dei prodotti già mostrati, nuovo endpoint `GET /api/products` (route handler, coerente con lo stile del resto del codebase — nessuna Server Action nel repo). URL riflette `?page=` via `window.history.replaceState()` — **non** `router.push`/`replace` di Next.js, deliberatamente: quest'ultimo avrebbe ri-eseguito il Server Component ad ogni click (nuovo fetch Supabase ridondante), vanificando il senso dell'endpoint leggero. Nuovo file condiviso `src/lib/catalog/pagination.ts` (`PRODUCTS_PAGE_SIZE` + `buildProductsQuery()`) per evitare divergenza tra la query SSR e quella di `/api/products`. **Testato su mobile, nessun problema riscontrato.**

**Prompt 4 — Client Supabase pubblico + ISR.** Nuovo `src/lib/supabase/public.ts` (senza `cookies()`) usato da `getTenant()`, home e `/products/[slug]` (`revalidate = 300`, `generateStaticParams`). **Scoperta corretta durante l'esecuzione:** il baseline originale dell'audit ("36/36 route dynamic") era un errore di conteggio — il numero reale era **44 dynamic + 1 static su 45**. Dopo il prompt: **6 statiche, 1 ISR (`/products/[slug]`), 39 dynamic** su 46 route totali (build verificata con un mock-server Supabase locale, non solo stimata). Effetto collaterale scoperto: passare `getTenant()` al client pubblico rimuoveva silenziosamente l'unico trigger di dinamismo per diverse route che non ne avevano bisogno proprio (dipendevano dal layout radice, non da sé stesse) — `force-dynamic` esplicito ripristinato dove serviva, con una nota tecnica: il marcatore non è affidabile se co-locato in un file `'use client'` insieme al componente pagina, va spostato su un layout server-side ancestor. **Scoperta critica non anticipata dal prompt:** un errore non gestito in `generateStaticParams` fa fallire l'intero `next build`, non solo quella route — mitigato con `try/catch` → fallback a ISR on-demand su `generateStaticParams` e `manifest.ts`; nessun fallback aggiunto per `/` e `/card` (nessun "tenant di riserva" onesto da mostrare — un fallimento di build durante un vero outage Supabase resta un rischio accettato, non nascosto).

**Prompt 5 — Stripe lazy + cleanup.** `loadStripe()` in `CheckoutForm.tsx` era invocato a livello di modulo (bundle Stripe.js caricato anche per chi sceglie ritiro in negozio) — reso lazy (`getStripe()`, chiamato solo nel ramo `PaymentMode: 'stripe'`, verificato per lettura del codice come strutturalmente irraggiungibile dal ramo `in_store`). `select('*')` mirata su `/order-confirmation` (sia Server Component che il ramo di polling client-side in `OrderConfirmationClient.tsx`). Cache-busting applicato anche a `generate-product-image` (stesso pattern del Prompt 2). **Rate limiting su `/api/products` — deliberatamente non implementato:** nessun costo per chiamata (a differenza di `/api/search/semantic`), dati già pubblici, nessun Redis/Upstash nello stack — solo hardening di validazione input (cap superiore su `page`, lunghezza massima query di ricerca, riusando la stessa convenzione di `MAX_QUERY_LENGTH` già in `/api/search/semantic`). **Nota sui numeri di bundle:** `First Load JS` di `/checkout` e `/order-confirmation` risulta invariato nel build — atteso: `loadStripe()` non include mai il codice Stripe.js nel bundle webpack, inietta uno `<script>` esterno a runtime; il guadagno del lazy-load (una richiesta di rete + script terzi in meno per il flusso in-store) non è visibile in quella metrica.

### Fix urgente — stock/overselling al checkout

**Perché era urgente:** nessuna route né trigger DB verificava o decrementava mai lo stock — un cliente poteva pagare per un prodotto già esaurito, e l'introduzione di ISR (Prompt 4, `revalidate = 300`) allungava fino a 5 minuti la finestra in cui la pagina prodotto poteva mostrare "disponibile" per qualcosa che non lo era più.

**Architettura reale ricostruita (diversa dall'ipotesi iniziale):** il flusso Stripe non crea mai un ordine `pending` — il carrello viene salvato in `checkout_sessions`, il `PaymentIntent` creato, e solo il webhook `payment_intent.succeeded` crea la riga `orders` + `order_items` (mai prima). Il flusso in-store (pagamento al ritiro) crea l'ordine sincronamente in `/api/checkout`, nessun gap temporale.

- **Controllo pre-pagamento** in `/api/checkout` (condiviso da entrambi i flussi): stock verificato per prodotto con quantità aggregate (gestisce righe carrello duplicate), 400 con nomi prodotto se insufficiente — nessuna `checkout_session`/`PaymentIntent`/ordine creato in quel caso.
- **Decremento atomico race-safe**: funzione PL/pgSQL, `UPDATE products SET stock = stock - qty WHERE id = pid AND stock >= qty` con `GET DIAGNOSTICS` sul row count → `RAISE EXCEPTION` se zero righe, transazionale (un fallimento su un prodotto annulla i decrementi già fatti per gli altri prodotti dello stesso ordine). Chiamato nel webhook Stripe (dopo la creazione ordine, il pagamento è già incassato) e sincronamente in `/api/checkout` per il flusso in-store (prima della creazione ordine — se fallisce, 409, nessun addebito da annullare perché non c'è mai stato).
- **Caso limite — pagato ma stock esaurito nel frattempo** (solo possibile nel flusso Stripe, tra checkout e conferma webhook): nuovo stato `orders.status = 'stock_conflict'`, rimborso Stripe automatico (`stripe.refunds.create`, nessuna funzione di rimborso preesistente nel codebase, implementata qui), notifica admin via n8n (stesso meccanismo esistente — POST a `${N8N_WEBHOOK_URL}/webhook/order-stock-conflict`, pattern coerente con le notifiche ordine esistenti). **Nessuna notifica automatica al cliente** — testo da concordare con Dalice, deliberatamente fuori scope.
- **Scoperta laterale durante la migration:** `ready_for_pickup` è usato attivamente in tutto il codice admin (bulk-status, filtri, dropdown) ma nessuna migration lo aveva mai aggiunto al constraint `orders.status` — doveva essere stato modificato manualmente sul DB reale, fuori da ogni migration tracciata. Un semplice `DROP + CREATE` del constraint l'avrebbe rimosso silenziosamente, rompendo quel flusso; la migration 029 lo include esplicitamente.

**⚠️ Non ancora fatto:** test di race condition in staging (due checkout quasi simultanei sull'ultimo pezzo di un prodotto) — il fix è live su `main` ma verificato solo per lettura di codice, non empiricamente. Piano di test concordato ma non ancora eseguito: prodotto dedicato `stock = 1`, due tab/browser, checkout in-store quasi simultaneo (più semplice da forzare del flusso Stripe, nessuna carta reale richiesta); per il flusso Stripe, forzare il conflitto decrementando manualmente lo stock via SQL mentre un pagamento test è "in volo" tra conferma carta e arrivo webhook.

**Follow-up minori non bloccanti, per un'eventuale sesta iterazione:** `StatusBadge.tsx` mostra `stock_conflict` come testo grezzo su sfondo grigio neutro (fallback esistente, non un crash — solo polish); resize di `generate-product-image` mai verificato con accesso reale all'API Gemini (nessun accesso disponibile nell'ambiente di esecuzione dei prompt finora); cache-busting non applicato a `/card/vcard` e `manifest.webmanifest` (lasciati `force-dynamic`, rischio di staleness basso e diverso in natura, candidati futuri se si vorrà renderli ISR).

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
| Rimuovere file morti admin (`AdminNav.tsx`, `AdminOrdersClient.tsx`, `orders/id/`) | Robertin | ✅ FATTO (Fase 0 redesign admin, §8bis) |
| Decisione brand charter v2 (font, colore, elemento signature) | Dalice | ✅ FATTO — Bricolage Grotesque, blu `#1267C7`, cartellino `ShopTag`: validati su mockup, implementati e deployati (§12bis) |
| Pushare il branch redesign storefront | Robertin | ⚠️ Commit presenti solo su questo branch — **non mergiati su `main`** (correzione v3.7, verificato via `git merge-base`; smentisce lo stato "FATTO" delle revisioni precedenti) — vedi §12bis |
| Eseguire query SQL colore primario ChloeFood | Robertin | ✅ FATTO (17/07, operazione DB indipendente da git) — ma il codice che lo consuma tramite `var(--color-primary)` è solo su questo branch, non su `main` (vedi riga sopra) |
| Redesign admin (Fase 0–4 + 2 addenda) — accessibilità, responsive, dark mode, bulk actions, polling, nav mobile | Robertin | ⚠️ Implementato, ma **non mergiato su `main`** (correzione v3.7, verificato via git — non solo "non confermato in sessione" come detto in v3.6) — vedi §8bis |
| Eseguire KPI "Aujourd'hui" (prompt già scritto) | Robertin | ✅ FATTO — correzione v3.7, verificato nel codice (v3.6 la segnalava per errore ancora pendente) |
| Confermare quale branch è collegato al deploy Vercel di `chloefood.com` | Robertin | ⚠️ DA FARE — punto critico aperto da v3.7, nessun `vercel.json` nel repo per verificarlo da qui |
| Comunicare a Dalice la deviazione export CSV (invece di XLSX) e il rinvio delle notifiche push | Robertin | ⚠️ DA FARE — vedi §8bis |
| Completare contratto SaaS (dati fiscali, foro, DPA) | Robertin | ⚠️ DA FARE |
| Audit performance frontend + 5 prompt di ottimizzazione (query, immagini, paginazione, ISR, Stripe lazy) | Robertin | ✅ FATTO — confermato live su `main` (20/07), vedi §17bis |
| Fix urgente stock/overselling al checkout (controllo pre-pagamento + decremento atomico + rimborso automatico) | Robertin | ✅ FATTO — live su `main` (20/07), vedi §17bis e §2.1 |
| Test race condition stock in staging (verifica empirica del fix sopra) | Robertin | ⚠️ DA FARE — piano di test concordato, non ancora eseguito, vedi §17bis |

---

## 19. Roadmap Phase 2 (post go-live)

**Nota:** le tre feature IA trasversali (descrizioni multilingue, rate limiting/cost tracking, ricerca semantica) sono state completate — non compaiono più come "Non avviato" in questa tabella, dettaglio in §13bis.

| Feature | Categoria | Priorità | Stato |
|---|---|---|---|
| Autenticazione clienti (Supabase Auth) + pagina `/orders` storico | Contrattuale | P0 | Non avviato |
| Enforcement `subscription_status` (blocco soft storefront tenant scaduto) | Tecnico | P0 | Non avviato — mai controllato oggi |
| Gestione stock reale al checkout (decremento, blocco esaurito) | Tecnico | P0 | ✅ FATTO (fix urgente 20/07) — ⚠️ test race condition in staging ancora da eseguire, vedi §17bis |
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
| Sostituire `xlsx@0.18.5` (vulnerabilità note) con alternativa (es. `exceljs`) | Tecnico | P2 | Non avviato — nel frattempo l'export bulk admin (§8bis) usa CSV puro proprio per questo motivo |
| Notifiche push vere per l'admin (Web Push API, service worker, VAPID, `push_subscriptions`, trigger da webhook Stripe) | Tecnico | P1 | Decisa con Dalice il 17/07, **rimandata** il 18/07 — solo avviso in-tab (Notification API, richiede la scheda aperta) implementato, vedi §8bis |
| Realtime vero per l'admin (Supabase Realtime + RLS `tenant_admins` su `orders`) invece del polling attuale | Tecnico | P2 | Prompt scritto e scartato consapevolmente (18/07) — volumi attuali non lo giustificano; riprendere solo se crescono admin concorrenti o ordini/giorno, vedi §8bis |
| Estrarre `Badge.tsx`/`KpiCard.tsx`/`Toast.tsx`/`BulkBar.tsx` come componenti condivisi admin (oggi inline) | Tecnico | P2 | Non avviato — raccomandazione audit §4, debito di organizzazione, zero impatto utente |
| Test automatizzati (almeno `calculateShipping.ts` + webhook, Vitest) | Tecnico | P2 | Non avviato |
| Google Play Store via TWA/PWABuilder | Growth | P1 | Non avviato |
| Apple App Store via Capacitor | Growth | P2 | Non avviato |
| Onboarding secondo tenant (self-service, wizard) | SaaS | P1 | Guida `Lepefy_Onboarding_Tenant_v1.docx` pronta; asset statici mono-tenant + limite build-time tenant da rimediare prima |
| Rate limiting su `/api/checkout` e `/api/shipping/quote` | Tecnico | P1 | Non avviato |
| Decidere destinazione reale del CTA hero "Notre histoire" (oggi placeholder `/products`) | Contenuto/Prodotto | P1 | Non avviato — vedi §12bis |
| Allineare `tenant.accent_light` al nuovo primary blu (coerenza visiva, non bloccante) | Tecnico | P2 | Non avviato — query pronta, vedi §12bis |
| Notifica automatica al cliente per conflitto stock (pagato ma esaurito) — testo da concordare con Dalice | Contenuto/Prodotto | P1 | Non avviato — deliberatamente fuori scope del fix urgente, vedi §17bis |
| Styling dedicato badge admin per stato ordine `stock_conflict` (oggi testo grezzo su grigio neutro) | Tecnico | P2 | Non avviato — cosmetico, zero rischio funzionale, vedi §17bis |
| Verificare risoluzione reale immagini `generate-product-image` (Gemini) e applicare resize se >1600px | Tecnico | P2 | Non avviato — non verificabile senza accesso reale all'API Gemini nell'ambiente di esecuzione prompt, vedi §17bis |
| Cache-busting su `/card/vcard` e `manifest.webmanifest` (stesso pattern già applicato alle immagini prodotto) | Tecnico | P2 | Non avviato — route lasciate `force-dynamic`, rischio di staleness basso, vedi §17bis |
| Vincolo di dominio su `tenants.logo_url` (oggi nessun controllo — un host esterno non whitelisted romperebbe l'header) | Tecnico | P1 | Non avviato — rischio reale ma preesistente, segnalato durante l'audit performance, vedi §17bis |

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
| `Charte_graphique_Chloe_Food_1.pdf` | Nuova brand charter v2 (20 pagine) — decisioni derivate (font, elemento signature) implementate, colore primario ancora da migrare via SQL (§12bis) |
| `chloe_food_logo.svg` | Logo vettoriale ricostruito (bug viewBox corretto) |
| `Mockup_Fase3_Validazione_UIUX.html` | Mockup interattivo di validazione Fase 3 (toggle colore verde/blu, toggle font Bricolage/Fraunces) — allegato di sessione, non versionato nel repo; decisioni approvate implementate in `apps/storefront`, vedi §12bis |
| `AUDIT_ADMIN_UIUX.md` | Audit UI/UX del pannello admin (17/07) — origine del redesign Fase 0–4, allegato di sessione, non versionato nel repo; vedi §8bis |
| `admincommandesredesign.html` | Mockup interattivo di validazione redesign admin (tabella responsive, dark mode, bulk bar) — allegato di sessione, non versionato nel repo; decisioni approvate implementate parzialmente (righe espandibili mantenute contro il mockup, vedi §8bis) |

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

## 24. Changelog v3.4 (17 Luglio 2026) — audit e redesign UI/UX storefront (Fase 1–3)

> ⚠️ **Nota v3.7:** il "branch `claude/lepefy-storefront-audit-69xss0`" citato sotto non risulta mai esistito nel repository remoto verificabile da questa sessione, e le affermazioni di questo changelog e di v3.5 sul push/merge su `main` **non sono confermate dallo stato reale di git** — vedi intestazione documento e §12bis per il dettaglio.

Verifica del documento contro lo stato reale del branch `claude/lepefy-storefront-audit-69xss0` (5 commit, tutti locali, **mai pushati**) dopo un audit UI/UX completo dello storefront pubblico seguito da implementazione in 3 fasi più una passata di allineamento a un mockup di validazione approvato. Dettaglio completo in §12bis (sezione nuova). Correzioni apportate al resto del documento:

- **§2** — la nota "il verde `#1D9E75` è l'unico colore nel codice" era vera fino a questa fase ma descriveva anche un problema (hardcoding sparso, non solo un dato): riscritta per distinguere il valore DB attuale (invariato) dallo stato del codice (ora interamente token-based). Aggiunto il dettaglio delle 3 decisioni brand-charter-v2 effettivamente prese (font, colore come task dato, elemento signature) con la query SQL preparata e non eseguita.
- **§3** (tabella stack) — corretti i nomi dei CSS vars (`--primary`/`--secondary` → `--color-primary`/`--color-secondary`, mai stati questi i nomi reali nel codice).
- **§5** — aggiunta nota sul de-hardcoding completato per lo storefront pubblico.
- **§11** — colore/nome del banner PWA erano hardcoded (con un `TODO multi-tenant` esplicito mai risolto, scoperto durante l'audit) — ora corretti, sezione aggiornata.
- **§12** — la descrizione dell'hero ("verde scuro `#085041` con cerchi") era quella pre-redesign, ora obsoleta — riscritta per riflettere gradiente/pattern a triangoli/layout a due colonne introdotti in Fase 3.
- **§12bis** — nuova sezione, riepiloga le 3 fasi dell'audit UI/UX + la passata di allineamento al mockup, cosa è stato corretto, cosa resta aperto, la query SQL da eseguire.
- **§18** — riga "Decisione brand charter v2" aggiornata da "pendente" a "deciso" per font/elemento signature; aggiunte 3 righe nuove (push del branch, esecuzione query colore, destinazione CTA "Notre histoire").
- **§21** — aggiunto il mockup di validazione alla tabella documenti di riferimento.

Nessuna modifica alle sezioni non toccate da questo lavoro (shipping, checkout, admin auth, n8n, sistema etichette, feature IA, roadmap Phase 2) — verificate a campione, restano accurate rispetto a v3.3.

---

## 25. Changelog v3.5 (17 Luglio 2026) — branch pushato, colore live, CTA in roadmap

Chiusura operativa del redesign UI/UX documentato in v3.4: i due blocchi che risultavano ancora "solo pronti in locale" sono stati eseguiti manualmente da Robertin (workflow abituale: nessun ambiente locale, esecuzione via GitHub web UI + Supabase).

- **§1 (intestazione)** — branch `claude/lepefy-storefront-audit-69xss0` confermato pushato e mergiato su `main`; query colore confermata eseguita.
- **§2** — colore primario ChloeFood aggiornato da `#1D9E75` a **`#1267C7`** come valore DB live (non più "pronto ma non eseguito"). Aggiunta nota di coerenza su `tenant.accent_light`, non toccato dalla migrazione.
- **§12bis** — stato sezione da "⚠️ branch locale, non pushato" a "✅ live in produzione"; blocco migrazione dati aggiornato da "preparata, non eseguita" a "eseguita"; "Cosa resta aperto" ridotto al solo CTA hero + nota accent_light (push e query rimossi, essendo risolti).
- **§18** — righe push branch e query SQL segnate FATTO; riga CTA hero rimossa dalla checklist go-live e spostata in roadmap (vedi sotto), su richiesta esplicita: non è un blocco per il go-live, è una decisione di prodotto a sé.
- **§19** — aggiunte due righe roadmap Phase 2: decisione destinazione CTA "Notre histoire" (P1) e allineamento `accent_light` al nuovo blu (P2, non bloccante).

Nessuna modifica alle sezioni non toccate da questo aggiornamento rispetto alla revisione di v3.4 verificata da Claude Code.

---

## 26. Changelog v3.6 (18 Luglio 2026) — audit e redesign UI/UX pannello admin (Fase 0–4)

Aggiunto il resoconto completo di una sessione separata dedicata al pannello admin (`(protected)/page.tsx`, `OrdersTable.tsx`, `AdminFilters.tsx`, `AdminSidebar.tsx`), partita da un audit UI/UX (`AUDIT_ADMIN_UIUX.md`) e proseguita in 5 fasi + 2 addenda. **Differenza importante rispetto a v3.5**: questa revisione documenta lo stato riportato in chat dal committente (checklist di fine-fase confermate), non una verifica indipendente di Claude Code contro git/filesystem come le revisioni precedenti — vale la stessa cautela di "non ancora confermato" ovunque segnalato.

- **§8** — rimossa la nota "file morti da pulire" (ora eliminati); aggiornata la lista funzionalità con tabella responsive, dark mode, bulk actions, polling, blocco tracking obbligatorio; segnalato il bug pre-esistente della route picking-list (mai esistita, ora corretta) trovato durante il redesign, non dal lavoro precedente.
- **§8bis** — nuova sezione, riepiloga le 5 fasi + 2 addenda del redesign admin: cosa è stato fatto, le decisioni tecniche prese in sessione che divergono dal piano originale dell'audit (CSV invece di XLSX, notifiche rimandate, polling invece di Realtime), e un elenco esplicito di verifiche manuali segnalate ma mai confermate chiuse.
- **§18** — riga file morti admin segnata FATTO; aggiunte righe per il redesign admin (stato "implementato, deploy non confermato"), l'esecuzione pendente della KPI "Aujourd'hui", e la comunicazione a Dalice ancora da fare sulle due deviazioni.
- **§19** — aggiunta la voce "notifiche push vere per l'admin" (decisa con Dalice il 17/07, rimandata il 18/07); aggiunta la voce "Realtime vero per l'admin" come possibile upgrade futuro del polling attuale, con la condizione esplicita per cui vale la pena riprenderlo; aggiunta la voce estrazione componenti condivisi admin; annotata la riga esistente su `xlsx@0.18.5` con il collegamento alla scelta CSV fatta nel frattempo.
- **§21** — aggiunti `AUDIT_ADMIN_UIUX.md` e `admincommandesredesign.html` alla tabella documenti di riferimento.

Nessuna modifica alle sezioni relative allo storefront pubblico (§12bis e altre) rispetto a v3.5 — quel lavoro resta confermato live, non riverificato in questa sessione.

---

## 27. Changelog v3.7 (18 Luglio 2026) — verifica indipendente su git/filesystem, due correzioni

A differenza di v3.6 (basata sullo stato riportato in chat), questa revisione verifica il documento **direttamente contro il repository reale** (`git log`, `git merge-base`, `git diff main..HEAD`, lettura diretta dei file sorgente) sul branch `claude/update-lepefy-project-context-fke5jo`. Due correzioni rilevanti:

1. **KPI "Aujourd'hui" — da "non eseguita" a "eseguita".** v3.6 la segnalava ancora pendente ("prompt dato a Claude Code, in attesa"). Il codice mostra invece che è già implementata in `admin/(protected)/page.tsx` (prima KPI card, conteggio ordini di oggi + totale come sotto-riga). Causa della discrepanza: il commit che l'ha implementata (18/07, 23:03) precede cronologicamente il commit che ha scritto v3.6 (18/07, 23:42) — la chat riportata a Claude Code non rifletteva più lo stato reale del codice al momento della stesura. **§8, §8bis, §18 aggiornati.**

2. **Nessuno dei due redesign (storefront §12bis, admin §8bis) risulta mergiato su `main`.** Le revisioni v3.4–v3.6 affermavano che il branch storefront `claude/lepefy-storefront-audit-69xss0` fosse stato "pushato e mergiato su `main`". Verifica reale: quel branch non esiste (né locale né su `origin`); `git merge-base main HEAD` coincide con la punta di `main` stessa (ultimo commit 16/07 11:47); `ShopTag.tsx` non esiste su `main`; `BottomNav.tsx` su `main` ha ancora l'hex hardcoded `#1D9E75`. In realtà **tutto** il lavoro di entrambi gli audit (storefront 16–17/07, admin 17–18/07, 27 commit "Add files via upload" più le 3 delete) è finito su questo unico branch di lavoro, mai mergiato — coerente col workflow reale di Robertin (upload diretto GitHub web UI, non PR per feature). **Non verificabile da qui quale branch Vercel deploya effettivamente** (nessun `vercel.json` committato) — punto critico da chiarire con Robertin, aggiunto come voce propria in checklist go-live (§18). **Intestazione, §2, §5, §12bis, §8bis, §18 aggiornati**, changelog storici (§24) annotati con nota di correzione senza riscrivere la cronologia.

Scoperta aggiuntiva, non un errore ma un'omissione: **`AdminMobileNav.tsx`** (drawer di navigazione mobile per l'admin, commit 18/07 23:20) non era mai stato documentato — colma un gap reale (sidebar admin `hidden md:block`, nessuna navigazione alternativa sotto `md` prima di questo componente). Aggiunto a §8 e §8bis (nuovo "Addendum 2").

Nessuna modifica al resto del documento (shipping, checkout, n8n, sistema etichette, feature IA, roadmap Phase 2) — verificato a campione, resta accurato rispetto a v3.6.

---

## 28. Changelog v3.8 (20 Luglio 2026) — audit performance frontend, 5 prompt, fix urgente stock

Aggiunge il resoconto di due lavori distinti condotti in sequenza: un audit performance (`AUDIT_PERFORMANCE_FRONTEND.md`) con 5 prompt di implementazione, e un fix urgente per il controllo/decremento stock al checkout — funzionalità mai esistita prima, scoperta come debito già noto in §2.1/§13 ma resa urgente dall'introduzione di ISR nel Prompt 4. **A differenza di v3.4–v3.6 (i cui redesign non risultavano mai mergiati su `main`, vedi v3.7), questo lavoro è stato confermato da Robertin come caricato su `main`** via il consueto workflow GitHub web UI, ad ogni prompt eseguito — non c'è quindi l'incertezza branch-vs-main che ha afflitto le revisioni precedenti.

- **Intestazione** — aggiunto blocco di riepilogo v3.8 sopra quello v3.7 esistente (mantenuto per continuità storica, non riscritto).
- **§2.1** — riga "nessuna gestione stock reale al checkout" del debito residuo spostata da "non ancora corretto" a un paragrafo dedicato "✅ RISOLTO", con richiamo esplicito al test di race condition ancora da eseguire.
- **§4** — aggiunta la migration `029_atomic_stock_decrement.sql` alla tabella, inclusa la scoperta laterale su `ready_for_pickup` mai aggiunto al constraint `orders.status` da nessuna migration precedente.
- **§13** — "Regola stock" aggiornata da "nessun controllo/decremento reale" a "implementato", con rimando a §2.1/§17bis.
- **§17bis** — nuova sezione, il resoconto completo di entrambi i lavori: per l'audit performance, il dettaglio dei 5 prompt (query mirate, immagini/caching, paginazione, ISR/client pubblico, Stripe lazy) con le scoperte/correzioni emerse durante l'esecuzione (baseline route dynamic corretto da 36 a 44, effetto collaterale del client pubblico su route che diventavano staticamente cacheable per errore, il bug non anticipato di `generateStaticParams` che fa fallire l'intero build); per il fix stock, l'architettura reale ricostruita (diversa dall'ipotesi iniziale), il meccanismo di decremento atomico, la gestione del caso limite pagato-ma-esaurito, e cosa resta da testare.
- **§18** — aggiunte 3 righe: audit performance (FATTO), fix stock (FATTO), test race condition in staging (DA FARE).
- **§19** — riga "Gestione stock reale al checkout" aggiornata da "Non avviato" a "FATTO, test pendente"; aggiunte 5 nuove voci emerse durante il lavoro (notifica cliente per conflitto stock, styling badge admin, verifica resize immagini AI, cache-busting `/card/vcard`+manifest, vincolo dominio `logo_url`).

Nessuna modifica alle sezioni non toccate da questo lavoro (shipping, sistema etichette, feature IA, redesign UI/UX admin/storefront con il loro stato branch/`main` invariato) — verificate a campione, restano accurate rispetto a v3.7.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.8 — 20 Luglio 2026 (base: v3.7; audit performance frontend con 5 prompt di ottimizzazione + fix urgente stock/overselling al checkout, entrambi confermati live su `main` — test race condition in staging ancora da eseguire — vedi §17bis)*
