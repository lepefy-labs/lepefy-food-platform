# Ottimizzazione Vercel CPU — ciclo P0 + P1 (ottobre 2026)

**Base**: `main` @ `57b48295` (16/10/2026). **Diagnosi di partenza**: audit Vercel CPU del 16/10/2026 (documento di lavoro non versionato; i dati rilevanti sono riportati qui).
**Perimetro**: P0 test in produzione, P1 prefetch, P1 quantity groups, P1 pagine legali. Fuori perimetro (cicli successivi): catalogo `/` cacheabile, ISR prodotti, regione, n8n, modello multi-tenant, migrazioni, piano Vercel, monitoraggio, pagamenti.

> Nessun risparmio di CPU è attribuito prima della misura. I valori post-intervento sono `DA MISURARE` finché non sono raccolti con la procedura del §6.

---

## 1. Baseline (prima del deploy)

Fonte: dashboard Vercel in sola lettura (piano Hobby: Observability 12 h, Firewall 24 h, Usage 30 giorni), `gh run list`.

### 1.1 Progetto `chloefood`, giornaliero (Usage, giorni UTC)

| Giorno | Active CPU | Invocazioni | Run `storefront-confirmation` | Commit su `main` |
|---|---:|---:|---:|---:|
| media 16/09–08/10 | ~7 min | ~2–6k | 0–2 | — |
| 09/10 | 14m38s | 9.098 | 1 | 6 |
| 10/10 | 25m01s | 17.224 | 0 | 27 |
| 11/10 | 21m56s | 11.218 | 5 | 6 |
| 12/10 | 26m11s | 14.705 | 4 | 14 |
| 13/10 | 16m55s | 6.516 | 2 | 14 |
| 14/10 | 22m24s | 17.209 | 7 | 8 |
| 15/10 | 24m04s | 15.818 | 9 | 11 |

Team (tutti i progetti, 16/09–16/10): **6h 58m** Active CPU su 4h incluse; chloefood 5h 17m (75,8 %).

### 1.2 Per route — finestra 12 h (Observability, 16/10 mattina, prima del deploy)

| Metrica | Valore |
|---|---:|
| Invocazioni totali | 7,6K |
| Active CPU P75 | 200 ms |
| Error rate | 0 % (nessun timeout) |
| `/api/quantity-groups` | 1,1K invocazioni · 23 s CPU |
| `/` (catalogo) | 494 · 57 s |
| `/index` | 954 · 23 s |
| `/cart` | 522 · 9 s |
| `/gadgets` | 496 · 5 s |
| `/compte/connexion` | 472 · 4 s |
| `/orders` | 387 · 3,05 s |
| `/api/auth/session` | 491 · 10 s |
| `/conditions-generales-vente` | 171 · 1,9 s (finestra precedente) |
| `/supprimer-compte` | 170 · 2,1 s (finestra precedente) |

Indicatore «invocazioni per caricamento completo» ≈ invocazioni totali ÷ `/api/auth/session` (una per caricamento completo) = 7.600 ÷ 491 ≈ **15**. Rapporto `/api/quantity-groups` ÷ `/api/auth/session` ≈ **2,2**.

### 1.3 Traffico — finestra 24 h (Firewall)

| Metrica | Valore |
|---|---:|
| Richieste consentite | 43,3k |
| `HeadlessChrome` Linux (AS Microsoft = runner GitHub) | 23,1k |
| `HeadlessChrome` Windows (macchina di sviluppo) | 11,7k |
| `HeadlessChrome` Linux v141 | 1,1k |
| **Totale HeadlessChrome** | **≈35,9k (≈83 % delle richieste)** |

Le richieste Firewall includono asset e immagini serviti dal CDN: l'83 % delle **richieste** non equivale all'83 % delle **invocazioni** né della **CPU**. Su Hobby non c'è una query che incroci user-agent e invocazioni; da questo ciclo il traffico di test è etichettato (§2.1) e diventa misurabile.

### 1.4 Metriche non accessibili

| Metrica | Stato |
|---|---|
| Invocazioni per route prima delle ultime 12 h | NON DISPONIBILE (retention Hobby) |
| CPU per user-agent | NON DISPONIBILE (nessuna query custom su Hobby) |
| Cache hit/miss di `/api/quantity-groups` | NON DISPONIBILE prima del deploy (risposta `no-store`) |

---

## 2. Interventi

### 2.1 P0 — Test browser sulla produzione

**Prima**: a ogni push idoneo su `main`, la suite completa (32 test, 33 `page.goto`, scroll infinito, 6 larghezze) partiva contro `https://shop.chloefood.com`; anche le verifiche locali dopo il push usavano la produzione (default della config).

**Dopo** — tre livelli:

| Livello | Cosa | Dove | Quando |
|---|---|---|---|
| A | suite completa (`*.spec.ts`, ora 3 file + budget richieste) | `next start` su 127.0.0.1:3100 (locale o runner GitHub) | job `local-full` a ogni push idoneo; in locale `pnpm build && pnpm test:confirmation` |
| B | `prodSmoke.spec.ts`: catalogo, ricerca, scheda prodotto, carrello → checkout (senza ordine né pagamento) | produzione | job `production-smoke` dopo il deploy `Vercel – chloefood` corrispondente |
| C | suite completa o smoke, a scelta | produzione o locale | solo `workflow_dispatch` |

- **Default sicuro**: senza `PLAYWRIGHT_BASE_URL` la suite avvia il proprio server locale; la suite completa rifiuta un URL remoto senza `CONFIRMATION_ALLOW_REMOTE_FULL=1` (`tests/confirmation/confirmationTarget.ts`, testato).
- **Isolamento del server locale**: chiavi Stripe (live e test), webhook, Packlink, Brevo/n8n e-mail, GREEN-API, Meta/WhatsApp, Gemini, Google Places, Gotenberg, rembg, wallet, `E2E_TEST_SECRET`, `ADMIN_EMAILS` impostate a stringa vuota. Verificato in `@next/env` 14.2.35: una variabile già definita nel processo (anche vuota) prevale su `.env.local`. Supabase resta in lettura (catalogo reale del tenant); nessun percorso guest esaminato scrive su GET (le uniche scritture lato server su GET riguardano sessioni di clienti autenticati); ogni chiamata `/api` non GET è risposta nel browser con 204 dalle spec.
- **Limite dichiarato**: il Livello A legge il database di produzione (sola lettura) e non usa dati deterministici; un progetto Supabase di test con seed dedicato è il passo successivo. Il job `local-full` richiede il secret `NEXT_PUBLIC_SUPABASE_ANON_KEY` (valore pubblico, già nel bundle della boutique) che oggi **non esiste** nel repository: il job termina con un avviso finché non viene aggiunto.
- **Trigger**: `concurrency` con `cancel-in-progress` (un push ravvicinato annulla il run precedente, anche in attesa del deploy); la smoke attende lo status Vercel del commit esatto e si ferma se `main` è già avanzato.
- **Traffico sintetico identificabile**: user-agent `… LepefySynthetic/1 (+storefront-confirmation)` e header `x-lepefy-synthetic: 1` sulle sole richieste same-origin (`tests/confirmation/fixtures.ts`; niente header verso Supabase/Stripe per non provocare preflight CORS). L'header è solo osservativo: nessun codice lo legge. Immagini e analytics non sono bloccati (le spec verificano layout e rendering).
- **Regola WAF suggerita (non applicata)**: Vercel → Firewall → Custom Rule, condizione *User Agent contains* `LepefySynthetic`, azione **Log**. Permette di contare il traffico di test senza bloccarlo.

### 2.2 P1 — Prefetch selettivo

Next 14.2.35 (`next/dist/client/link.js`): con `prefetch={false}` nell'App Router non c'è prefetch né in viewport né su hover/touch; con il default, un link verso una route dinamica genera una richiesta RSC renderizzata da una funzione (fino a `app/(shop)/loading.tsx`).

- Regola unica `src/lib/storefront/linkPrefetch.ts` (`shopLinkPrefetch`): default per `/accueil`, `/avis`, `/card`, `/evenementiel`, pagine legali, `/products/*`; `false` per tutto il resto e per ogni href con query.
- Applicata in: `BottomNav.tsx`, `Header.tsx` (logo, Catalogue, account, carrello, ritorno al carrello del checkout), `BrandNavigationDrawer.tsx`, `Footer.tsx` (`/supprimer-compte`; CGV e confidentialità restano precaricate perché in cache), `CatalogShelf.tsx` («Tout voir» → `/?promo=1`, `/?new=1`), `home/CategoryBlock.tsx` (tile `/?category=` su `/accueil`), `home/HeroCarousel.tsx` (CTA delle slide, href configurati dall'admin), «Voir tout →» di `/accueil`, `cart/CartShortcutButton.tsx` (pulsante carrello accanto alla ricerca mobile, apre il drawer), «Retour à mes commandes» di `/avis`, `ProductDetail.tsx` (fil d'Ariane, «Voir mon panier», «Voir les produits à mélanger»). I tre residui (`/cart` dal pulsante mobile, `/orders` da `/avis`, `/` da `/accueil`) sono stati trovati dal nuovo test di budget delle richieste, non dalla lettura del codice.
- Lasciati invariati (intenzione esplicita o pagina già dinamica): «Continuer mes achats» del carrello (ritorno al catalogo con ripristino dello scroll), «Voir mon panier» della conferma d'aggiunta, link delle card prodotto (ISR).
- UX: la navigazione resta client-side; al clic su una destinazione dinamica compare subito lo shell `loading.tsx`. Nessuna modifica a scroll restoration (`shoppingReturn.ts`), ricerca persistente o BottomNav.

### 2.3 P1 — Quantity groups condivisi e in cache

- `src/lib/cart/quantityGroupsStore.ts` (puro, testato): un'entrata per tenant, una sola richiesta in volo, riuso 60 s, retry automatico non prima di 10 s dopo un errore, `invalidate` per «Réessayer», un errore non diventa mai un insieme vuoto, un refresh fallito conserva l'ultimo insieme noto, numero di entrate limitato (4).
- `src/lib/cart/useQuantityGroups.ts`: `useSyncExternalStore` sullo store (snapshot server = `idle`, nessun disallineamento d'idratazione); opzione `enabled`.
- Caricamento differito: `CartDrawer` (montato ovunque) solo a drawer aperto **e** carrello non vuoto; `ChatWidget` solo a conversazione aperta. Sempre attivi: PDP (mostra il gruppo prima dell'aggiunta), carrello/checkout (gate fail-closed), `CheckoutSessionEditor`.
- `GET /api/quantity-groups`: `Cache-Control: public, s-maxage=60, stale-while-revalidate=60` sulla risposta di successo, `no-store` sull'errore (`src/lib/cart/quantityGroupsHttp.ts`). Verifiche fatte prima di applicarlo: payload = nome, minimo, step, id prodotti membri dei gruppi **attivi** del tenant; nessuna lettura di cookie, sessione o parametri; un progetto Vercel per tenant e chiave CDN host + path, quindi nessuna condivisione fra tenant; propagazione di una modifica admin ≤ ~2 min. Scelto `stale-while-revalidate=60` (invece di 300) per limitare l'età massima servita.
- Il checkout resta autorevole: `validateCheckoutItems` rilegge i gruppi dal DB (`src/lib/checkout/validateCheckoutItems.ts`) in ogni percorso di pagamento; nessuna modifica a `/api/checkout`.
- `useCartFulfillment` verificato: un'unica istanza per pagina (via `useCartPurchaseGate`, solo carrello e checkout), già con abort; nessun intervento.

### 2.4 P1 — Pagine legali

- `/conditions-generales-vente`: da `force-dynamic` + `fetchCache = 'force-no-store'` a **ISR 300 s**, come `/politique-confidentialite` (già ISR). Build locale: la route risulta `○` (statica/ISR).
- Rischio individuato e coperto: la pagina ISR scrive la lettura di `tenant_legal_documents` nella Data Cache di Next, e la stessa lettura serve al consenso (iscrizione, checkout, re-consenso). `getLatestLegalDocument` ora chiama `unstable_noStore()` salvo `{ cached: true }`, usato **solo** dalla pagina CGV: il consenso legge sempre la versione corrente. Nessun testo legale modificato.
- Isolamento: query filtrata per `tenant_id`; un deployment = un tenant.
- `/supprimer-compte` resta dinamica (legge la sessione); `/livraison` resta dinamica (fuori perimetro, da valutare).

---

## 3. File modificati

| File | Modifica |
|---|---|
| `.github/workflows/storefront-confirmation.yml` | job `production-smoke` (Livello B) e `local-full` (Livello A), `workflow_dispatch` suite/target (Livello C) |
| `apps/storefront/tests/confirmation/confirmationTarget.ts` | nuovo: destinazione, guardia anti-produzione, env neutralizzato, UA sintetico |
| `apps/storefront/tests/confirmation/playwright.config.ts` | default locale con `webServer`, selezione suite, UA sintetico |
| `apps/storefront/tests/confirmation/fixtures.ts` | nuovo: header `x-lepefy-synthetic` same-origin |
| `apps/storefront/tests/confirmation/prodSmoke.spec.ts` | nuovo: 4 test di produzione in sola lettura |
| `apps/storefront/tests/confirmation/requestBudget.spec.ts` | nuovo: nessun prefetch dinamico, conteggio richieste quantity groups |
| `apps/storefront/tests/confirmation/addToCart.spec.ts`, `cartMobile.spec.ts` | importano `test` dalla fixture |
| `apps/storefront/package.json` | script `test:confirmation` |
| `apps/storefront/src/lib/storefront/linkPrefetch.ts` | nuovo: regola di prefetch |
| `apps/storefront/src/components/layout/{BottomNav,Header,BrandNavigationDrawer,Footer}.tsx`, `catalog/CatalogShelf.tsx`, `home/{CategoryBlock,HeroCarousel}.tsx`, `cart/CartShortcutButton.tsx`, `product/ProductDetail.tsx`, `app/(shop)/accueil/page.tsx`, `app/(shop)/avis/page.tsx` | `prefetch` secondo la regola |
| `apps/storefront/src/lib/cart/quantityGroupsStore.ts`, `quantityGroupsHttp.ts` | nuovi: store condiviso, header HTTP |
| `apps/storefront/src/lib/cart/useQuantityGroups.ts` | hook sullo store, opzione `enabled` |
| `apps/storefront/src/components/cart/CartDrawer.tsx`, `chat/ChatWidget.tsx` | caricamento differito |
| `apps/storefront/src/app/api/quantity-groups/route.ts` | cache CDN su successo, `no-store` su errore |
| `apps/storefront/src/app/(shop)/conditions-generales-vente/page.tsx` | ISR 300 s |
| `apps/storefront/src/lib/legal/getLatestLegalDocument.ts` | `noStore()` salvo `{ cached: true }` |
| `apps/storefront/tests/unit/{linkPrefetch,quantityGroupsStore,confirmationTarget}.spec.ts` | nuovi test unitari |
| `CLAUDE.md`, `LEPEFY_PROJECT_CONTEXT.md` | regole correnti (prefetch, quantity groups, suite di conferma) |

---

## 4. Test e verifiche

Vedi §7.

---

## 5. Impatto atteso (misurato in §6 e §11)

| Invocazione | Prima (per caricamento) | Dopo (atteso) | Perché |
|---|---|---|---|
| prefetch `/`, `/cart`, `/gadgets`, `/compte/connexion` (BottomNav) | 1 ciascuna per pagina vista, ripetuta dopo 30 s | 0 | `prefetch={false}` |
| prefetch `/orders`, `/compte` (menu), `/supprimer-compte` (footer) | 1 ciascuna quando visibili | 0 | idem |
| prefetch `/conditions-generales-vente` (footer) | 1 funzione | 0 funzioni (CDN/ISR) | pagina ISR |
| prefetch `/?category=…` dalle tile di `/accueil`, `/?promo=1`, `/?new=1` | 1 per tile visibile | 0 | `prefetch={false}` |
| `/api/quantity-groups` | 2–3 per caricamento (drawer + Nala + PDP/carrello) | 0 a carrello vuoto fuori PDP; ≤ 1 per visita entro 60 s; la maggior parte servita dal CDN | store condiviso + `enabled` + `s-maxage` |
| traffico suite completa in produzione | ~33 caricamenti × run, fino a 9 run/giorno | 4 test × run di smoke | Livelli A/B/C |

Le pagine ISR (`/accueil`, schede prodotto, `/avis`) tornano a non generare invocazioni proprie quando il visitatore non ha un carrello: restano solo `/api/auth/session` (una per caricamento completo) e le rigenerazioni ISR.

---

## 6. Procedura di confronto prima/dopo

Eseguire a **24 h** e **72 h** dal deploy, sempre alla stessa ora del giorno:

1. Usage → Fluid Active CPU e Invocations, vista *Projects*: valore giornaliero `chloefood` per i giorni interi successivi al deploy.
2. Observability → Functions (12 h): totale invocazioni, P75 Active CPU, righe `/api/quantity-groups`, `/`, `/index`, `/cart`, `/gadgets`, `/compte/connexion`, `/orders`, `/conditions-generales-vente`, `/supprimer-compte`, `/api/auth/session`; error rate.
3. Firewall → Traffic (24 h): totale, user-agent `HeadlessChrome` e `LepefySynthetic`.
4. `gh run list --workflow storefront-confirmation.yml` e numero di commit su `main` del giorno.
5. Verifica cache: `curl -sI https://shop.chloefood.com/api/quantity-groups` due volte → `cache-control` pubblico lato CDN e `x-vercel-cache: HIT` alla seconda.

Normalizzazione (per confrontare giorni con traffico diverso):
- **invocazioni per caricamento** = invocazioni ÷ `/api/auth/session` (baseline ≈ 15);
- **quantity-groups per caricamento** = `/api/quantity-groups` ÷ `/api/auth/session` (baseline ≈ 2,2; obiettivo ≤ 1, idealmente ≪ 1 con il CDN);
- **CPU per run di smoke**: CPU del giorno ÷ (run + traffico reale stimato) solo come indicazione;
- confrontare almeno un giorno senza push con un giorno con push.

| Metrica | Baseline | 1 h dopo il deploy (16/10, 09:28–10:28 UTC) | 24 h (17/10) | 72 h (17–19/10, media giornaliera) | 4 giorni (12 h fino al 20/10, 20:20 UTC) |
|---|---:|---:|---:|---:|---:|
| CPU chloefood / giorno | media 22,8 min (10–15/10; 16,9–26,2) | NON DISPONIBILE | 21m54s | **18,5 min** (21m54s · 14m30s · 18m57s) → −19 % | 20/10 parziale: 27m35s (11 commit, vedi §11) |
| Invocazioni chloefood / giorno | media 13,8k (10–15/10; 6,5–17,2k) | 411 / 1 h | 9.187 | **8.348** (9.187 · 5.976 · 9.880) → −40 % | 20/10 parziale: 10.039; 12 h: 6,1K |
| CPU per invocazione (calcolata) | 78–156 ms (media ≈ 99 ms) | — | 143 ms | 133 ms | 165 ms (20/10) |
| Active CPU P75 | 200 ms | 153–165 ms | NON DISPONIBILE (retention 12 h) | NON DISPONIBILE | 327 ms |
| `/cart` · `/gadgets` · `/compte/connexion` · `/orders` · `/supprimer-compte` (12 h) | 522 · 496 · 472 · 387 · 170 | 0 · 0 · 0 · 0 · 0 | NON DISPONIBILE | NON DISPONIBILE | 34 · 3 · 11 · 8 · 0 |
| `/api/quantity-groups` (12 h) | 1,1K | 2 (1 h) | NON DISPONIBILE | NON DISPONIBILE | 43 |
| `/api/auth/session` (12 h) = caricamenti completi | 491 | 4 (1 h) | NON DISPONIBILE | NON DISPONIBILE | 87 |
| quantity-groups ÷ session | ≈ 2,2 | 0,5 | — | — | **0,49** |
| Invocazioni ÷ session | ≈ 15 | non significativo | — | — | ≈ 70 (non più un indicatore utile: vedi §11) |
| Richieste Firewall / 24 h | 43,3k | 693 / 1 h | NON DISPONIBILE | NON DISPONIBILE | **12,4k** (−71 %) |
| di cui HeadlessChrome | ≈ 35,9k | 0 | NON DISPONIBILE | NON DISPONIBILE | **1,0k** (−97 %); `LepefySynthetic` 0 |
| Run `storefront-confirmation` in produzione | fino a 9 / giorno, suite completa | 1 smoke | 0 | 0 | 0 (nessun push sui percorsi storefront dopo il 16/10) |
| Errori / timeout (12 h) | 0 % / 0 % | 0 % / 0 % | NON DISPONIBILE | NON DISPONIBILE | 0 % / **1,4 %** (vedi §11) |

Nota sull'ora post-deploy: con solo 4 caricamenti completi, il rapporto invocazioni ÷ session è dominato da invocazioni indipendenti dai caricamenti (admin aperto: `/api/admin/orders/poll` 39, `/admin` 31, ~30 pagine admin; tick n8n ~31; `/api/geocode/search` 26 di un checkout reale; ~150 schede prodotto con 1–3 invocazioni ciascuna). Diventa confrontabile solo sulle 24 h.

---

## 7. Risultati della validazione

Eseguiti in locale (Windows, Node 22, Next 14.2.35, Playwright 1.62.1) prima del commit.

| Controllo | Esito |
|---|---|
| `tsc --noEmit` (storefront) | **passato** |
| Test unitari completi (`test:unit`) | **1523/1523 passati** (di cui 23 nuovi: regola di prefetch, store quantity groups, destinazione della suite) |
| `next build` di produzione | **passato**; `/conditions-generales-vente` ora `○` (ISR), `/api/quantity-groups` resta `ƒ` |
| Suite di conferma completa su `next start` locale (chiavi provider svuotate) | **49/49 passati**: 39 test esistenti (layout e focus a 6 larghezze, carrello mobile, BottomNav, menu, quantità minime e +/−), 4 smoke, 6 di budget richieste |
| Selezione `CONFIRMATION_SUITE=smoke` | 4 test, solo `prodSmoke.spec.ts` |
| Guardia anti-produzione | la suite completa con `PLAYWRIGHT_BASE_URL=https://shop.chloefood.com` si rifiuta di partire |
| Header HTTP su server locale | `/api/quantity-groups` → `public, s-maxage=60, stale-while-revalidate=60`; CGV → risposta ISR (`x-nextjs-cache`); `/supprimer-compte` → `private, no-store` |
| Sintassi workflow (js-yaml) | valida: job `production-smoke` e `local-full`, input `suite`/`target` |
| `git diff --check` | nessun errore di spaziatura |
| `pnpm lint` | **non eseguito** per regola del repository (`next build` esegue comunque il proprio controllo) |
| Suite e2e `tests/e2e` | **non eseguita** (crea ordini reali senza `E2E_TEST_SECRET`) |
| Seconda istanza tenant (`lepefy-test`) in locale | **non eseguita**; l'isolamento è coperto da test unitario (entrate per tenant) e dall'architettura (un progetto per tenant, chiave CDN per host) |
| Smoke contro la produzione | **dopo il deploy**, dal job `production-smoke` (vedi §10) |

Il test di budget delle richieste ha trovato, al primo giro, tre prefetch dinamici sfuggiti alla lettura del codice (`/cart` dal pulsante carrello mobile, `/orders` da `/avis`, `/` da `/accueil`), poi corretti: la regola è verificata sul comportamento reale della build, non solo sul sorgente.

Verifiche funzionali delle quantità (unitarie + suite locale):
1. minimo 4 → primo clic 4; 2. minimo 2 → 2; 3. minimo 6, step 3 → 6, poi 9, «−» al minimo rimuove la riga; 4. gruppo combinabile valutato sul totale dei membri; 5–6. gruppo modificato/eliminato visibile dopo `invalidate` o allo scadere del TTL; 7. due tenant con entrate separate; 8. il checkout rilegge i gruppi dal DB (`validateCheckoutItems`), qualunque sia la copia client.

---

## 8. Rischi residui

- **Livello A non operativo in CI** finché manca il secret `NEXT_PUBLIC_SUPABASE_ANON_KEY`: fino ad allora la suite completa gira solo in locale o da `workflow_dispatch` (produzione). Copertura UX mobile in CI ridotta a 4 test di smoke nel frattempo.
- **Dati non deterministici**: il Livello A legge il catalogo reale; un test può fallire se il catalogo cambia (es. nessun prodotto in promo). Rimedio: progetto Supabase di test con seed.
- **Ritardo di propagazione** dei gruppi: fino a ~2 min dopo una modifica admin il carrello può mostrare la regola precedente; il checkout rifiuta comunque un carrello non valido con il messaggio canonico. L'ordine assistito admin (`AssistedOrderForm`, fetch `no-store` lato browser) riceve anch'esso la copia CDN; la validazione server dell'ordine assistito resta autorevole.
- **Primo clic più lento** verso destinazioni dinamiche (nessun prefetch): mitigato dallo shell `loading.tsx`; da osservare su mobile reale.
- **Header sintetico**: si applica solo alle richieste same-origin del browser; i fetch server-to-server non lo portano (non servono).
- `/livraison` e `/` restano dinamiche (fuori perimetro).
- **Rigenerazioni ISR dei prodotti** (osservato nella prima ora): ~150 schede prodotto con 1–3 invocazioni ciascuna (~0,1–0,9 s CPU). Ipotesi: le card del catalogo precaricano `/products/[slug]` (corretto, è ISR) e un prefetch su una pagina scaduta da più di 300 s ne avvia la rigenerazione in background; con lo scroll infinito, ogni sessione di navigazione rigenera i prodotti visibili. DA VERIFICARE sulle 24 h, è il tema del prossimo ciclo (ISR prodotti).
- **Prefetch delle pagine admin**: con una sessione admin aperta, ~15 pagine admin hanno 2 invocazioni ciascuna in un'ora senza visita (link della barra laterale verso pagine dinamiche). Fuori perimetro storefront; da trattare con la stessa regola.

---

## 9. Prossimo ciclo (raccomandazioni)

1. **Catalogo `/` cacheabile**: servire la variante senza parametri da ISR breve (60 s) con l'invalidazione catalogo esistente, oppure spostare filtri/paginazione sul client sopra `/api/products`. È la route più costosa (≈ 57 s CPU / 12 h). Prerequisiti: scroll restoration, `?page=N` diretti, SEO.
2. **ISR prodotti**: `revalidate` 900–3600 s, invalidazione mirata dopo decremento di stock al checkout; misurare le rivalidazioni (885 / 12 h) e verificare se il prefetch delle card su pagine scadute le provoca (§8).
2b. **Navigazione admin**: applicare una regola di prefetch analoga ai link della barra laterale/command palette admin (`lib/admin/navigation.ts`).
3. **Supabase di test con seed** per rendere deterministico il Livello A e attivarlo in CI.
4. **Tick n8n** con pre-controllo su Supabase (chiamare Vercel solo se c'è lavoro).
5. **Modello multi-tenant**: decidere tra progetto unico multi-dominio e deploy selettivi prima di 10 tenant (limite di 100 deploy/giorno su Hobby, build ripetute).
6. **Piano**: la decisione Pro resta valida indipendentemente da questo ciclo (uso commerciale, 6h58m su 4h).

---

## 10. Git, CI e Vercel

| Voce | Esito |
|---|---|
| Commit | `f502e55c` su `main`, unico commit sopra la base `57b48295` |
| CI (typecheck, lint, unit, SQL) | **success** |
| `Vercel – chloefood` | **success** (deployment di produzione del commit) |
| `Vercel – lepefy-food-test` | **success** (build automatica ancora attiva su questo progetto) |
| `Storefront confirmation` → `production-smoke` | **success**: 4/4 in 11,2 s contro `shop.chloefood.com` |
| `Storefront confirmation` → `local-full` | terminato con avviso: secret `NEXT_PUBLIC_SUPABASE_ANON_KEY` assente |

Metriche disponibili subito dopo il deploy (16/10, ~09:20 UTC):

- `GET /api/quantity-groups` in produzione: 1ª richiesta `X-Vercel-Cache: MISS`, 2ª e 3ª `HIT` (`Age` 2 s, 4 s); al browser arriva `Cache-Control: public` (Vercel rimuove `s-maxage`).
- `/conditions-generales-vente`: `X-Vercel-Cache: HIT` (servita dal CDN, nessuna funzione).
- Active CPU, invocazioni per route e quota HeadlessChrome a 24 h, 72 h e 4 giorni: §6 e §11 (misurati il 20/10).
- Prima ora interamente post-deploy (Observability *Last hour* e Firewall *Past Hour*, 10:28 UTC): 411 invocazioni, P75 153–165 ms, 0 errori; nessuna invocazione di `/cart`, `/gadgets`, `/compte/connexion`, `/orders`, `/supprimer-compte`; `/api/quantity-groups` 2; un ordine reale completato nel frattempo (checkout, webhook Stripe, `order-confirmation`) senza errori.

---

## 11. Esito a 4 giorni (20/10/2026)

**Cosa ha funzionato (DIMOSTRATO).**
- Traffico sintetico: HeadlessChrome da ≈35,9k a 1,0k richieste/24 h (−97 %); richieste Firewall totali da 43,3k a 12,4k (−71 %); nessuna esecuzione della suite completa in produzione dal deploy.
- Prefetch dinamici: le cinque destinazioni passano da 170–522 a 0–34 invocazioni/12 h (resta solo la navigazione reale).
- Quantity groups: da 1,1K a 43 invocazioni/12 h; 0,49 per caricamento completo (prima 2,2).
- Invocazioni giornaliere di chloefood: −40 % sulla media dei tre giorni interi successivi (8.348 contro 13.800).

**Cosa non è cambiato abbastanza.** L'Active CPU giornaliera scende solo del 19 % (18,5 min contro 22,8) e il 20/10, con 11 commit in un giorno, risale a 27m35s prima di fine giornata. Le invocazioni eliminate erano **leggere** (prefetch fino a `loading.tsx`, letture brevi): la CPU per invocazione sale da ~99 a 133–165 ms perché resta il lavoro pesante. Il limite Hobby resta superato (chloefood 6h 38m su 30 giorni).

**Dove va la CPU oggi** (12 h fino al 20/10 20:20 UTC, 341 route, ≈1.022 s ≈ 17 min):

| Categoria | Route | Invocazioni | CPU | Quota |
|---|---:|---:|---:|---:|
| Schede prodotto `/products/*` (ISR) | 148 | 2.544 | 574 s | **56 %** |
| Altre pagine ISR (`/accueil`, `/card`, `/avis`, pagine legali) | 6 | 290 | 149 s | **15 %** |
| Admin (`/admin/**`, `/api/admin/**`) | 60 | 1.876 | 96 s | 9 % |
| Tick interni n8n (`/api/internal/*`) | 7 | 415 | 82 s | 8 % |
| Catalogo `/` e `/index` | 2 | 375 | 68 s | 7 % |
| API pubbliche | 25 | 492 | 35 s | 3 % |
| Altre pagine (manifest, account…) | 19 | 355 | 18 s | 2 % |

**Causa principale ora: rigenerazioni ISR (≈71 % della CPU).** ISR Observability (12 h): 2,1K rivalidazioni time-based (885 prima), 0 per tag. `/accueil`, `/avis`, `/card`, `/politique-confidentialite` e i prodotti più visti hanno ciascuno ~30 scritture in 12 h, cioè una ogni ~24 minuti; ogni rigenerazione costa 0,2–0,9 s di CPU (`/accueil` ≈ 0,9 s). Nessun crawler rilevante nel Firewall (user-agent con «bot» < 80 richieste/24 h). Con `revalidate = 300`, **qualunque** richiesta a una pagina scaduta da più di 5 minuti — una visita o il prefetch automatico delle card prodotto e dei link verso pagine ISR, che questo ciclo ha volutamente lasciato attivo — ne avvia la rigenerazione. Ne deriva che il costo cresce con il prodotto *numero di sessioni di navigazione × dimensione del catalogo*, non con le pagine viste: è strutturale e peggiorerà con più prodotti e più tenant. La correlazione con il prefetch delle card è PROBABILE (stessa cadenza su tutte le pagine linkate, assenza di bot), non isolata da una misura diretta.

**Nuovi segnali di affidabilità (fuori perimetro, da segnalare).** Nelle stesse 12 h: `/api/internal/shipping-sync` 29,4 % di errori, `/api/internal/notifications/dispatch` 6,3 % (49 s di CPU, ×5 rispetto al 16/10), `/api/internal/catalog-schedule` 1,9 %; timeout complessivi 1,4 %. Sono comparsi dopo i rilasci del 17–20/10 (ordini V3, dispatcher notifiche staff, «resilient n8n ticks»): da verificare nel modulo interessato, non sono effetti di questo ciclo.

**Prossimi interventi, in ordine di impatto atteso sulla CPU.**
1. **ISR prodotti e pagine vetrina**: portare `revalidate` da 300 s a 3600 s (o più) su `/products/[slug]`, `/accueil`, `/card`, `/avis`, pagine legali, affidandosi all'invalidazione esplicita già esistente (`withStorefrontInvalidation`, `revalidateCatalogCache` del tick promo) e aggiungendo un `revalidatePath` mirato dei prodotti acquistati quando lo stock cambia (webhook/conversione ordine). Effetto teorico sulle rigenerazioni: fino a ×12 in meno a parità di traffico; il checkout resta autorevole su prezzo e stock.
2. In alternativa o in aggiunta: `prefetch={false}` sulle card prodotto nelle griglie lunghe (scroll infinito), mantenendo il prefetch su hover/intento se misurato utile.
3. **Catalogo `/`** cacheabile (7 %) e **navigazione admin** con la stessa regola di prefetch (9 %).
4. **Tick n8n** con pre-controllo su Supabase (8 %).

Il passaggio a Pro resta necessario: anche con −19 % il ritmo attuale (≈ 18–20 min/giorno per chloefood) vale ≈ 9–10 h/mese contro 4 h incluse.
