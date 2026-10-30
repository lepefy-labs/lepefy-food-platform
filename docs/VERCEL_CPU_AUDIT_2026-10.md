# Audit Vercel Fluid Active CPU — ottobre 2026

**Repository**: `lepefy-labs/lepefy-food-platform` — base analizzata `main` @ `57b48295` (16/10/2026)
**Progetto principale**: `chloefood` (`shop.chloefood.com`) — confronto: `lepefy-food-test`
**Piano Vercel**: Hobby (team `robertinsmartinvestor-3745s-projects`)
**Metodo**: lettura in sola consultazione della dashboard Vercel (Usage 30 giorni, Observability 12 h, Firewall 24 h), cronologia GitHub Actions (`gh run list`), `git log`, analisi statica del codice. Nessun codice applicativo, configurazione Vercel, workflow n8n o database modificato; nessuna chiamata artificiale agli endpoint di produzione.

> Convenzione: **DIMOSTRATO** = misurato in dashboard o verificato nel codice; **PROBABILE** = coerente con più evidenze indipendenti ma non isolato da una misura diretta; **DA VERIFICARE** = ipotesi senza evidenza sufficiente.

---

## 1. Executive summary

1. **L'aumento è di `chloefood` ed è un aumento di volume, non di costo per richiesta** (DIMOSTRATO). Active CPU di chloefood: ~4–8 min/giorno fino all'8/10, 14m38s il 9/10, poi 17–26 min/giorno dal 10/10. Le invocazioni passano da ~2–6k/giorno a 11–17k/giorno. La CPU media per invocazione resta nello stesso intervallo (~80–155 ms). Gli altri progetti sono stabili (sobre-app ~1m25s/giorno, buonapharma ~50 s, lepefy-corporate ~40 s).

2. **Il traffico che genera il consumo è in larga parte sintetico: test browser automatizzati contro la produzione** (DIMOSTRATO sulle ultime 24 h, PROBABILE sull'intero periodo). Nel Firewall di chloefood, su 43,5k richieste in 24 h, **≈36k (≈83 %) hanno user-agent `HeadlessChrome`**: 23,1k da AS *Microsoft Corporation* (runner GitHub Actions, user-agent Linux) e 11,7k con user-agent Windows (rete Fastweb, verosimilmente la macchina di sviluppo locale). Il grafico orario mostra raffiche di 2–7k richieste su una base vicina allo zero, allineate agli orari dei run del workflow `Storefront confirmation smoke` (es. 15/10: run alle 15:45, 16:09, 20:05, 20:57, 21:50, 22:16, 22:37 UTC). Il traffico browser reale (Chrome Android/desktop non headless) è dell'ordine di 3–4k richieste/giorno.

3. **Ogni pagina vista costa molte invocazioni, anche quando la pagina stessa è in cache** (DIMOSTRATO nel codice e coerente con l'Observability). Una navigazione storefront scatena: il prefetch automatico di `<Link>` verso route `force-dynamic` (Catalogo `/`, `/cart`, `/gadgets`, `/compte/connexion`, `/orders`, `/conditions-generales-vente`, `/supprimer-compte`), 2–3 chiamate `no-store` a `/api/quantity-groups` (un fetch indipendente per ogni componente montato), `/api/auth/session`, e sul carrello `/api/products`, `/api/cart/suggestions`, `/api/products/fulfillment`. Il 9/10 (`3686c598`) la pagina prodotto — servita da ISR, quindi gratuita — ha iniziato a chiamare `/api/quantity-groups` a ogni visualizzazione. Questo **moltiplica** il costo di qualunque traffico, reale o sintetico.

4. **Le automazioni (n8n, GitHub cron) non sono la causa dell'aumento** (DIMOSTRATO). Nelle 12 h osservate valgono ~23 s di CPU (notifications/dispatch 9 s, catalog-schedule 7 s, shipping-sync 6 s, shipping-campaign-worker 1,2 s) su un totale stimato di ~11 min: ≈3–4 %. L'unico tick aggiunto nel periodo è `catalog-schedule` (dal 14/10, ogni 5 min).

5. **Il team è già oltre il limite Hobby e il piano Hobby non è adatto a un negozio commerciale** (DIMOSTRATO). La dashboard riporta **6h 58m di Active CPU su 4h incluse** (174 %) nel periodo 16/09–16/10. Anche prima dell'aumento il ritmo del team (~10 min/giorno ≈ 5 h/30 giorni) superava già le 4 h. La documentazione Vercel indica che, superati i limiti Hobby, «nella maggior parte dei casi» occorre attendere 30 giorni prima di riutilizzare la funzionalità, e che Hobby è riservato a uso **personale e non commerciale**. Chloe Food è un e-commerce in produzione.

**Raccomandazione**: (a) passare `chloefood` (e i futuri tenant commerciali) a **Pro** subito, per conformità e per eliminare il rischio di sospensione — il costo atteso del consumo attuale resta dentro il credito incluso di 20 $/mese; (b) in parallelo, ridurre il consumo strutturale: togliere i test pesanti dalla produzione, eliminare i prefetch verso route dinamiche e le chiamate API ridondanti per pagina. Le ottimizzazioni da sole non riportano il team sotto 4 h/mese in modo affidabile e non risolvono il vincolo d'uso commerciale.

---

## 2. Stato attuale e dati disponibili

### 2.1 Totali team, 16/09 → 16/10/2026 (Usage, tutti i progetti)

| Metrica | Valore | Incluso Hobby | Note |
|---|---:|---:|---|
| Fluid Active CPU | **6h 58m** | 4 h | **174 % del limite** |
| Function Invocations | 220K | 1M | 22 % |
| Fluid Provisioned Memory | 68,3 GB-h | 360 GB-h | chloefood 61,7 GB-h (90 %) |
| CDN Requests | 395K | 1M | |
| Fast Origin Transfer | 3,02 GB | 10 GB | |
| ISR Reads / Writes | 127K / 69K | — | |
| Image Transformations | 4,8K | 5K | **96 %**, vicino al limite |
| Throttles | 0 | — | nessun problema di concorrenza |
| Edge Middleware Invocations | 0 | — | middleware non rilevante |
| Web Analytics Events | 79 | 50K | analytics praticamente non usato |

Ripartizione CPU per progetto: chloefood 5h 17m (75,8 %), sobre-app 40m 43s (9,7 %), buonapharma 26m 9s (6,2 %), lepefy-corporate 19m 6s (4,6 %), lepefy-food-test 8m 31s (2,0 %), veredoc 6m 40s (1,6 %).

Regione di esecuzione: **iad1 (Washington) 85,4 %**, fra1 6,4 %, sfo1 4,6 %, altre < 2 %.

### 2.2 Serie giornaliera chloefood (dashboard Usage, giorni UTC)

| Giorno | Active CPU | Invocazioni | CPU/invocazione | Run `storefront-confirmation` | Commit su main |
|---|---:|---:|---:|---:|---:|
| 16/09 | 4m17s | 3.186 | 81 ms | — | — |
| 21/09 | 7m16s | 5.290 | 82 ms | — | — |
| 25/09 | 11m40s | 4.809 | 146 ms | — | — |
| 26/09 | 11m46s | 4.944 | 143 ms | — | — |
| 01/10 | 6m49s | 2.948 | 139 ms | 0 | 10 |
| 04/10 | 7m04s | 4.538 | 93 ms | 2 | 10 |
| 06/10 | 5m49s | 2.014 | 173 ms | 0 | 3 |
| 07/10 | 7m58s | 3.743 | 128 ms | 0 | 2 |
| 08/10 | 8m33s | 6.102 | 84 ms | 0 | 6 |
| **09/10** | **14m38s** | **9.098** | 97 ms | 1 | 6 |
| **10/10** | **25m01s** | **17.224** | 87 ms | 0 | **27** |
| 11/10 | 21m56s | 11.218 | 117 ms | 5 | 6 |
| 12/10 | 26m11s | 14.705 | 107 ms | 4 | 14 |
| 13/10 | 16m55s | 6.516 | 156 ms | 2 | 14 |
| 14/10 | 22m24s | 17.209 | 78 ms | 7 | 8 |
| 15/10 | 24m04s | 15.818 | 91 ms | 9 | 11 |

(Valori CPU letti al passaggio del mouse sul grafico per progetto; invocazioni dal grafico «Invocations / Projects». La CPU/invocazione è un rapporto calcolato, include il costo fisso del runtime.)

Media chloefood: **~7 min/giorno** dal 16/09 all'08/10 → **~21,6 min/giorno** dal 09/10 al 15/10 (×3). Il team, nello stesso intervallo, passa da ~10 a ~26 min/giorno.

### 2.3 Istantanea per route, ultime 12 h (Observability chloefood, 16/10 mattina)

Totale **8,3K invocazioni**, Active CPU P75 195 ms, memoria media 239 MB / 2,05 GB, cold start 3,9 %, errori 0 %.

| Route | Invocazioni | Active CPU | Natura |
|---|---:|---:|---|
| `/` (catalogo, `force-dynamic`) | 490 | 56 s | pagina dinamica |
| `/accueil` (ISR 300 s) | 44 | 27 s | rigenerazione ISR (~0,6 s CPU ciascuna) |
| `/api/quantity-groups` | **1.100** | 23 s | API client `no-store` |
| `/index` | 939 | 22 s | DA VERIFICARE: verosimilmente richieste RSC/prefetch della radice |
| `/evenementiel` | 41 | 16 s | ISR 120 s |
| `/card` | 43 | 15 s | |
| `/products/*` (~120 slug) | ~10–42 ciascuno | ~1–12 s ciascuno | rigenerazioni ISR + RSC |
| `/api/auth/session` | 490 | 10 s | una per caricamento completo |
| `/cart` (`force-dynamic`) | 522 | 9 s | prefetch + visite |
| `/api/internal/notifications/dispatch` | 151 | 9 s | n8n ogni 5 min |
| `/api/products` | 364 | 8 s | scroll infinito catalogo/carrello |
| `/api/internal/catalog-schedule` | 153 | 7 s | n8n ogni 5 min |
| `/api/internal/shipping-sync` | 51 | 6 s | n8n ogni 15 min |
| `/gadgets` (`force-dynamic`) | 494 | 5 s | prefetch BottomNav/Header |
| `/api/cart/suggestions` | 163 | 4,8 s | carrello (Cart 2.0) |
| `/compte/connexion` (`force-dynamic`) | 471 | 4,0 s | prefetch BottomNav |
| `/api/products/fulfillment` | 215 | 3,4 s | carrello/checkout |
| `/orders` (`force-dynamic`) | 387 | 2,9 s | prefetch menu |
| `/conditions-generales-vente` (`force-dynamic`) | 171 | 1,9 s | prefetch footer |
| `/supprimer-compte` (`force-dynamic`) | 170 | 2,1 s | prefetch footer |
| `/api/admin/orders/poll` | 21 | 1,3 s | polling admin 18 s |
| `/api/internal/shipping-campaign-worker` | 13 | 1,2 s | n8n |

ISR nelle stesse 12 h: 5,8K read units, 3,3K write units, **885 rivalidazioni time-based**, 0 rivalidazioni per tag (le invalidazioni amministrative non sono la causa).

### 2.4 Traffico ultime 24 h (Firewall chloefood)

- 43,5k richieste consentite, 3 challenge, nessun blocco; Bot Protection **inattiva**, 0 regole custom.
- User-agent principali: `HeadlessChrome/151` Linux **23,1k**, `HeadlessChrome/151` Windows **11,7k**, Chrome Android 2,2k, `HeadlessChrome/141` Linux 1,2k, Chrome Windows 0,9k.
- AS: Microsoft Corporation 23,1k (coincide con l'UA HeadlessChrome Linux → runner GitHub Actions), Fastweb 15,3k (rete italiana: test locali + navigazione reale), Amazon 1,2k, Sky Italia 1,0k, Hetzner 737 (n8n).
- Una sola IP Fastweb conta 10,6k richieste (IP non riportata qui: il repository è pubblico).
- Host: shop.chloefood.com 42,4k; alcune URL di deployment `chloefood-*.vercel.app` 112 richieste ciascuna (controlli post-deploy).
- Path principali: `/` 2,3k, `/api/quantity-groups` 1,5k, `/_next/image` 1,4k, `/cart` 759, `/gadgets` 706.

---

## 3. Limiti delle evidenze

| Limite | Effetto | Come superarlo senza Pro |
|---|---|---|
| Observability Hobby: **12 h** di retention, nessuna query custom | Il dettaglio per route del 9–15/10 non è più consultabile; l'istantanea del 16/10 è rappresentativa di un giorno «con test» | Annotare ogni giorno l'istantanea (§13), oppure attivare la prova Pro per una settimana di misura |
| Firewall Hobby: 24 h | La quota HeadlessChrome è misurata solo per il 15–16/10 | Confronto con un giorno senza push/test (§13) |
| Runtime logs Hobby: 1 h | Impossibile ricostruire user-agent per invocazione | Log strutturato minimale (§12) |
| Usage per progetto senza dettaglio route | Il salto del 10/10 (27 commit, 0 run GitHub di conferma) non è attribuibile con certezza | Vedi ipotesi H1 |
| Nessun accesso alle metriche Postgres/Supabase | Il carico DB non è separabile dalla CPU Vercel | Dashboard Supabase (Reports → API/Database), gratuita |
| Regione Supabase non documentata nel repository | Impatto di iad1 sulla latenza/memoria non quantificabile | Verificare in Supabase → Settings → General |

---

## 4. Cause dimostrate

### C1 — Suite di test browser contro la produzione (fonte principale del volume, ultime 24 h)

- Workflow `.github/workflows/storefront-confirmation.yml`: parte a **ogni push su `main`** che tocca catalogo, carrello, layout, ricerca, `app/(shop)/**`, `api/products/**` o i test (righe 6–21), attende il deploy `Vercel – chloefood` e lancia Playwright contro `https://shop.chloefood.com` (`apps/storefront/tests/confirmation/playwright.config.ts:12`).
- La suite conta 32 test (`addToCart.spec.ts` 6, `cartMobile.spec.ts` 26) con 33 `page.goto`, scroll fino al footer, scroll infinito del catalogo (`cartMobile.spec.ts:252`, fino a 4 rotelle da 3000 px) e verifiche responsive. Ogni test parte da un contesto vergine (nessuna cache client), quindi ogni caricamento rifà sessione, quantity-groups, prefetch.
- Run per giorno: 0–2 fino al 10/10, poi 5, 4, 2, 7, 9 (11–15/10). La suite `cartMobile.spec.ts` è cresciuta dal 13 al 16/10 con Cart 2.0.
- Evidenza diretta: 23,1k richieste/24 h da HeadlessChrome Linux su AS Microsoft; picchi orari allineati ai run (§2.4).
- Ulteriori 11,7k richieste HeadlessChrome Windows: test o verifiche browser lanciati dalla macchina di sviluppo dopo ogni push (la pratica «live confirmation suite» dopo il deploy). PROBABILE.

Nota importante: spostare questi test su un altro progetto Vercel dello **stesso team** (es. `lepefy-food-test`) **non riduce** il consumo del team: Active CPU e limiti Hobby sono per team.

### C2 — Prefetch automatico verso route dinamiche

Next 14 prefetcha in produzione ogni `<Link>` visibile. Per una route `force-dynamic` il prefetch è una **richiesta RSC eseguita da una funzione** (fino al primo `loading.tsx`; esiste `app/(shop)/loading.tsx`), ripetuta a ogni nuova pagina dopo la scadenza della router cache (30 s per segmenti dinamici). Nessun `prefetch={false}` nel codice storefront.

| Link | File | Destinazione dinamica |
|---|---|---|
| BottomNav: Catalogo, Panier, Goodies, Compte | `components/layout/BottomNav.tsx:64-75` | `/`, `/cart`, `/gadgets`, `/compte/connexion` |
| Header / menu | `components/layout/Header.tsx:70-102`, `:123-205` | `/`, `/gadgets`, `/orders`, `/compte…`, `/cart` |
| Footer | `components/layout/Footer.tsx:41-42`, `:59-65`, `:136-142` | `/conditions-generales-vente`, `/supprimer-compte` |

Evidenza: conteggi quasi identici nelle 12 h (`/` 490, `/gadgets` 494, `/compte/connexion` 471, `/cart` 522, `/api/auth/session` 490) = una invocazione per destinazione per caricamento di pagina, indipendentemente da dove l'utente va davvero.

Pagine `force-dynamic` che non hanno contenuto per-utente nel render server:
- `app/(shop)/conditions-generales-vente/page.tsx:29-30` (`force-dynamic` + `fetchCache = 'force-no-store'`): il contenuto cambia solo quando si pubblica una nuova versione legale.
- `app/(shop)/page.tsx:19`: dinamico per `?q`, `?category`, `?page`, `?sort`… — legittimo con parametri, ma la variante **senza parametri** (la più visitata e quella prefetchata) è uguale per tutti.
- `app/(shop)/gadgets/page.tsx:14`: stessa situazione (`?category`, `?page`).
- `/supprimer-compte`, `/compte/connexion`, `/orders`, `/cart`: dinamici per sessione/dati freschi — corretti, ma non andrebbero prefetchati.

### C3 — `/api/quantity-groups`: più fetch `no-store` per caricamento, anche su pagine ISR

- `lib/cart/useQuantityGroups.ts:28`: ogni istanza del hook fa il proprio `fetch`, senza deduplicazione né cache in memoria (a differenza di `hooks/useSessionCustomer.ts`, che condivide una sola richiesta).
- Istanze montate: `components/cart/CartDrawer.tsx:61` (sempre montato nel layout shop, anche a cassetto chiuso), `components/chat/ChatWidget.tsx:68` (sempre montato se Nala è attivo), `components/product/ProductDetail.tsx:47` (dal 09/10, commit `3686c598`), `lib/cart/useCartPurchaseGate.ts:39` (carrello e checkout).
- `app/api/quantity-groups/route.ts:5,46`: `force-dynamic` + `Cache-Control: no-store`, quindi nessuna cache CDN.
- Effetto: la pagina prodotto e `/accueil`, servite dal CDN via ISR, generano comunque 2–3 invocazioni a ogni visualizzazione. È la route più invocata (1,1K/12 h).

### C4 — Volume ISR elevato sui prodotti e rigenerazioni costose

- `app/(shop)/products/[slug]/page.tsx:16`: `revalidate = 300` su ~120 prodotti; ogni prodotto visitato dopo 5 minuti viene rigenerato (885 rivalidazioni in 12 h). Una rigenerazione costa CPU server (render + `getRelatedProducts` + `getAiCapabilities`).
- `/accueil` costa ~0,6 s di CPU per rigenerazione (27 s / 44 invocazioni).
- Ogni deploy di produzione azzera la cache ISR del deployment e `generateStaticParams` (`products/[slug]/page.tsx:20`) rigenera tutti i prodotti in build (costo di build, non di Active CPU). Con 6–27 commit/giorno su `main`, le rigenerazioni post-deploy e le visite di verifica si sommano.

### C5 — Automazioni: costo basso e prevedibile

| Trigger | Frequenza | Endpoint Vercel | CPU osservata | Nota |
|---|---|---|---|---|
| n8n `notification-retry-scheduler` | 5 min (288/giorno) | `/api/internal/notifications/dispatch` | ~60 ms/run | chiamato anche quando la coda è vuota |
| n8n `catalog-schedule` (dal 14/10) | 5 min | `/api/internal/catalog-schedule` | ~46 ms/run | invalida cache solo se un tenant è cambiato (`route.ts:31-36`) |
| n8n `shipping-sync` | 15 min | `/api/internal/shipping-sync` | ~120 ms/run | |
| n8n `shipping-campaign-worker` | 5 min | `/api/internal/shipping-campaign-worker` | 13 run/12 h osservati | DA VERIFICARE perché meno di 144 |
| n8n digest, subscription-reminders | 1 h | rispettivi `/api/internal/*` | non nella top | |
| n8n `nala-analytics-purge` | giornaliero | | trascurabile | |
| n8n `whatsapp-maintenance` | 1 min (template) | `/api/internal/whatsapp/maintenance` | assente dall'Observability | template con `REPLACE_WITH_LEPEFY_APP_URL`: non attivo su chloefood |
| GitHub cron `nala-semantic-enrichment`, `ai-core-maintenance`, `event-booking-close-reports`, `review-invites` | dichiarati 10–60 min, **eseguiti 4–7 volte/giorno** (throttling GitHub) | | trascurabile | gli ultimi due interrogano Supabase prima e chiamano Vercel solo se c'è lavoro |
| GitHub `shipping-sync`, `shipping-campaign-worker` | | | 0 | `skipped` (cutover n8n) |

Totale automazioni: ≈45 s di CPU/giorno ≈ 22 min/mese ≈ **9 % del limite Hobby** da sole. Non spiegano l'aumento, ma sono un costo fisso da tenere basso (§10).

### C6 — Polling frontend: corretto e limitato

- `app/admin/(protected)/AdminOrdersPoller.tsx:6,29`: 18 s, sospeso se la scheda è nascosta, `router.refresh()` solo se ci sono cambiamenti. ~200 chiamate/ora per scheda admin visibile; 21 nelle 12 h osservate.
- `canaux/whatsapp/conversations/InboxClient.tsx:93`: sospeso se non visibile.
- `order-confirmation/OrderConfirmationClient.tsx:69,174`: 2 s per al massimo 30 s, poi stop.
- `EventConfirmationClient`, `RentalConfirmationClient`, `PayPreorderClient`: 2–2,5 s, limitati alla pagina di attesa.
- Nessun polling incontrollato trovato. Unico rischio: più schede admin aperte e visibili su più schermi.

### C7 — Middleware non rilevante

`apps/storefront/src/middleware.ts`: matcher limitato a `/admin/:path*`, `/scan`, `/api/admin/:path*`, solo header, nessun I/O. Usage «Edge Middleware Invocations: 0». Nessun intervento.

---

## 5. Ipotesi ancora da verificare

| ID | Ipotesi | Evidenza attuale | Come verificarla |
|---|---|---|---|
| H1 | Il picco del 10/10 (17,2k invocazioni, 27 commit, 0 run GitHub di conferma) viene da verifiche manuali/automatiche in produzione durante il lavoro sull'admin design system (pagine admin tutte `force-dynamic`) e da run locali | Correlazione temporale; nessuna misura per route di quel giorno | Prossimo giorno con molti push: istantanea Observability + Firewall (§13) |
| H2 | `/index` (939/12 h) = richieste RSC/prefetch di `/` | Nome route, ordine di grandezza ≈ 2× `/` | Observability → filtro sulla route, oppure runtime log di 1 h durante una navigazione |
| H3 | Il traffico reale è ~10–20 % delle invocazioni | Quota non-headless nel Firewall ≈ 17 % delle richieste CDN | Giorno senza push (§13) |
| H4 | La regione iad1 aumenta durata e memoria (non la CPU) se Supabase è in Europa | 85 % della CPU in iad1; regione Supabase non documentata | Supabase → Settings; confronto P75 Duration dopo cambio regione |
| H5 | Crawler/bot non sono significativi | Firewall: nessun crawler nei top UA; nessun `robots.ts`/`sitemap.ts` | «View All» degli user-agent per qualche giorno |
| H6 | `shipping-campaign-worker` esegue meno di quanto pianificato | 13 run in 12 h invece di 144 | n8n → Executions |
| H7 | Picco 25–27/09 (11–12 min/giorno con ~4,9k invocazioni, 145 ms/inv.) dovuto a rigenerazioni o elaborazioni più pesanti | CPU/invocazione più alta del solito | Non più ricostruibile; monitorare ricorrenze |

---

## 6. Analisi per endpoint e sottosistema

| Sottosistema | Endpoint/route | Trigger | Frequenza | Lavoro server | Cache possibile | Rischio |
|---|---|---|---|---|---|---|
| Catalogo | `/` | visita + prefetch da ogni pagina | ~1/caricamento | tenant (cache), AI caps, categorie (cache), promo, novità, pagina catalogo | variante senza parametri: ISR breve o shell statica + dati client | **Alto** |
| Catalogo | `/api/products` | scroll infinito, ricerca, carrello | 12 prodotti/pagina | query + ranking | `s-maxage` breve per le query pubbliche senza sessione | Medio |
| Catalogo | `/products/[slug]` | visita (ISR 300 s) | ~120 pagine | prodotto, correlati, AI caps | già ISR; valutare 900–3600 s + invalidazione mirata | Medio |
| Carrello | `/api/quantity-groups` | 2–4 hook per caricamento | **più alta** | 1 query | dedupe client + `s-maxage=60` + `stale-while-revalidate` | **Alto** |
| Carrello | `/api/cart/suggestions`, `/api/products/fulfillment` | `/cart`, checkout | 1/visita carrello | query + service client | breve cache CDN per ids (dati pubblici); il checkout rivalida | Basso |
| Sessione | `/api/auth/session` | 1/caricamento completo | alta | cookie + query | no (per utente); già deduplicato | Basso |
| Legali | `/conditions-generales-vente`, `/politique-confidentialite` | prefetch footer | alta | markdown | ISR + `revalidatePath` alla pubblicazione | Basso (facile) |
| Account | `/compte/connexion`, `/orders`, `/supprimer-compte` | prefetch | alta | sessione | no, ma **non prefetchare** | Medio |
| Admin | tutte le pagine `/admin/**` | uso staff | bassa | molte query | no | Basso |
| Automazioni | `/api/internal/*` | n8n | 5–15 min | RPC/batch | early-return a coda vuota | Basso |

---

## 7. Timeline dei commit (1–16/10/2026)

| Data | Commit | Modifica | Effetto potenziale sul consumo | Evidenza | Confidenza |
|---|---|---|---|---|---|
| 04/10 | `f1f5f11b` | La smoke di conferma attende lo status `Vercel – chloefood` | Test in produzione dopo ogni deploy idoneo | run 04/10 | Alta (meccanismo) |
| 05/10 | `a66089b9` | Purge Nala Analytics (n8n giornaliero) | trascurabile | Observability | Alta |
| 06/10 | `878d4977` | Canale WhatsApp + template n8n (1 min) | nessuno su chloefood finché non attivato | assente in Observability | Alta |
| 09/10 | `3686c598` | `ProductDetail` chiama `useQuantityGroups` | +1 invocazione a ogni vista prodotto (pagina ISR prima gratuita) | codice; quantity-groups route n.1 | Alta (meccanismo), media (peso) |
| 09/10 | `aeb937b0` | Navigazione «continua acquisti» | più navigazioni client → più prefetch | codice | Bassa |
| 10/10 | `de70404a`…`d68a5f12` (27 commit) | Admin design system U0–U12, journal | molti deploy + verifiche su pagine admin dinamiche | 17,2k invocazioni senza run GitHub | Media (H1) |
| 11/10 | `4d439146` | Pre-gate checkout (`useCartPurchaseGate` → `useQuantityGroups`) | +1 fetch su carrello/checkout | codice | Alta (meccanismo) |
| 13/10 | `b6611734` | Smoke: trigger manuale e percorsi «shop chrome» (layout, BottomNav, search) | più push fanno partire la suite | 7 e 9 run il 14 e 15/10 | Alta |
| 13/10 | `273fc824` | Ricerca globale, conferma aggiunta persistente | ricerca prodotto via API | codice | Bassa |
| 14/10 | `fdae08f4` | Promo programmate + tick n8n 5 min | +288 invocazioni/giorno (~3,5 min CPU/mese) | 153/12 h | Alta |
| 14/10 | `a4a0324b` | Scaffali Promo/Novità sul catalogo | due query in più per render di `/` | codice | Media |
| 15/10 | `c3bf5b42`…`9bc7c3ce` | Cart 2.0: ricerca, suggerimenti, catalogo infinito sotto il carrello | `/api/products`, `/api/cart/suggestions`, `/api/products/fulfillment` su `/cart`; suite di test più lunga | Observability 16/10 | Alta (meccanismo) |
| 15–16/10 | `306522eb`, `a3e17930` | Colori BottomNav e menu | nessun nuovo endpoint; tocca `components/layout/**` → fa partire la suite | workflow paths | Alta |

Correlazione ≠ causalità: la crescita è coerente con (1) più run di test in produzione, (2) più invocazioni per pagina introdotte da 3686c598, 4d439146 e Cart 2.0, (3) giornate con molti deploy. Il peso relativo di (1) è misurato solo per il 15–16/10.

---

## 8. Analisi frontend e backend

### Frontend
- **Buono**: `useSessionCustomer` deduplicato; layout shop senza cookie (ISR preservato); polling sempre con guardia di visibilità o durata; `ActiveCheckoutRecovery` lato client; `useInfiniteProducts` con abort/dedup.
- **Da correggere**:
  - prefetch implicito di route dinamiche (C2);
  - `useQuantityGroups` non condiviso (C3); stesso schema da verificare per `useCartFulfillment` (`lib/cart/useCartFulfillment.ts:37`), oggi limitato a carrello/checkout;
  - componenti globali (`CartDrawer`, `ChatWidget`) che caricano dati all'avvio anche se chiusi: dovrebbero caricarli all'apertura o quando il carrello contiene prodotti.

### Backend
- `app/(shop)/page.tsx`: 3–5 letture Supabase per render, in parte già in Data Cache (categorie, preview, ranking). `getAiCapabilities` (service client) a ogni render: DA VERIFICARE se in cache.
- `getTenant` (cache 60 s) e `getTenantServiceState` (`unstable_cache`, 60 s) corretti.
- `lib/cache/storefrontCache.ts:27-30,54-57`: `revalidateTenantCache`/`revalidateShopShellCache` usano `revalidatePath('/', 'layout')`, che invalida **tutto** l'ISR del sito a ogni salvataggio di impostazioni tenant o link social. Raro oggi (0 rivalidazioni per tag osservate), ma da restringere.
- Nessun N+1 evidente nei percorsi caldi esaminati; la CPU per invocazione (~80–150 ms, P75 195 ms) è nella norma per un render React server con Supabase.

---

## 9. Analisi delle automazioni

- n8n (Hetzner) è il pianificatore principale; GitHub cron è secondario e per lo più `skipped` o con pre-controllo su Supabase.
- Endpoint internali chiamati a intervallo fisso **anche senza lavoro**: `notifications/dispatch` e `catalog-schedule` (288 chiamate/giorno ciascuno). Il pattern migliore è già presente in `scripts/process-review-invites.mjs` e `process-event-booking-close-reports.mjs`: interrogare Supabase (PostgREST, nessuna funzione Vercel) e chiamare Vercel solo se c'è lavoro.
- Idempotenza e timeout: già documentati nei rispettivi moduli (claim atomici, request key); nessun retry aggressivo osservato (errori 0 %).
- Con molti tenant: i tick sono **multi-tenant su un unico endpoint** (chiamati su `shop.chloefood.com`), quindi il costo non cresce con il numero di progetti ma con il lavoro effettivo. Da mantenere così.

---

## 10. Valutazione multi-tenant

### Modello attuale
Un **progetto Vercel per tenant** (`NEXT_PUBLIC_TENANT_SLUG` per deployment), un unico repository: ogni push su `main` ricostruisce e ridistribuisce tutti i progetti collegati.

### Componenti di costo

| Tipo | Voce | Scala con |
|---|---|---|
| Fisso condiviso | tick n8n multi-tenant, Supabase, n8n Hetzner | lavoro effettivo, non n. tenant |
| Fisso per tenant | build a ogni push (`generateStaticParams` su tutti i prodotti), cache ISR fredda a ogni deploy, rigenerazioni ISR periodiche, prefetch dinamici | n. tenant × n. deploy |
| Variabile | pagine viste × invocazioni per pagina | traffico reale |
| Sintetico | suite di conferma in produzione | n. push (oggi solo chloefood) |

### Scenari (ipotesi esplicite)

Ipotesi: traffico reale per tenant come chloefood oggi senza test ≈ 2–3k invocazioni/giorno (H3, da confermare); CPU media 100 ms/invocazione; 10 push/giorno su `main`; nessuna ottimizzazione.

| Scenario | Invocazioni/mese (reale) | Active CPU/mese stimata | Deploy/giorno | Considerazioni |
|---|---:|---:|---:|---|
| 1 tenant | ~75k | ~2–3 h (+ test: oggi ~9–11 h) | 10 | il solo chloefood supera 4 h con i test attuali |
| 10 tenant | ~0,75M | ~20–25 h | 100 | **limite Hobby di 100 deploy/giorno raggiunto**; Pro: ~3–4 $ di CPU, nel credito |
| 50 tenant | ~3,8M | ~100–125 h | 500 | build per ogni push diventa il collo di bottiglia; ~15–20 $ CPU + invocazioni ~2 $ |
| 100 tenant | ~7,5M | ~200–250 h | 1.000 | ~30–40 $/mese di CPU a iad1; build e cache fredde dominano l'operatività |

(Prezzi Pro iad1: 0,128 $/h CPU, 0,0106 $/GB-h memoria, 0,60 $/M invocazioni; fra1: 0,184 $/h. Stime d'ordine di grandezza, non previsioni.)

Conclusioni strutturali:
1. Il **costo per pagina vista** è il moltiplicatore principale: ridurre da ~8–12 a ~2–3 invocazioni per caricamento vale più di qualunque ottimizzazione di query.
2. Un progetto per tenant con deploy di tutto a ogni push non scala in numero di build/deploy prima ancora che in CPU. Revisione da approvare separatamente: un **unico progetto multi-dominio** con risoluzione del tenant per host (cache e prefetch condivisi, un build per push), oppure deploy dei tenant secondari solo su tag di release.
3. I test in produzione devono restare a costo costante, non proporzionale ai push.

---

## 11. Matrice delle priorità

| ID | Problema | Evidenza | Impatto CPU | Complessità | Rischio | Priorità |
|---|---|---|---|---|---|---|
| P0-1 | Team oltre il limite Hobby (174 %) e uso commerciale su Hobby | Usage; documentazione Vercel | — (rischio sospensione) | Bassa | Basso | **P0** |
| P0-2 | Suite di conferma browser in produzione a ogni push | Firewall: ~83 % HeadlessChrome; run/giorno | **Alto** | Bassa | Basso | **P0** |
| P1-1 | Prefetch di route dinamiche da BottomNav/Header/Footer | conteggi uguali per destinazione | **Alto** | Bassa | Basso (UX: navigazione un po' meno istantanea su quei link) | **P1** |
| P1-2 | `useQuantityGroups` senza dedupe, `no-store`, montato globalmente | route n.1 per invocazioni | **Alto** | Bassa | Basso (il checkout rivalida lato server) | **P1** |
| P1-3 | `/conditions-generales-vente` dinamica | 171/12 h | Basso | Bassa | Basso | **P1** |
| P1-4 | Catalogo `/` senza parametri sempre dinamico | 490/12 h, 56 s: route più costosa | Medio-alto | Media | Medio (freschezza promo/stock) | **P1** |
| P2-1 | ISR prodotti a 300 s + rigenerazioni a ogni deploy | 885 rivalidazioni/12 h | Medio | Bassa | Medio (prezzo/stock visualizzato) | **P2** |
| P2-2 | Tick interni senza early-return a coda vuota | 288+288 chiamate/giorno | Basso | Bassa | Basso | **P2** |
| P2-3 | `revalidatePath('/', 'layout')` invalida tutto | `storefrontCache.ts:30,57` | Basso oggi | Bassa | Basso | **P2** |
| P2-4 | Regione funzioni iad1 vs utenti europei | 85 % iad1 | Nessuno su CPU; durata/memoria | Bassa | Medio | **P2 — DA VERIFICARE** |
| P2-5 | Image transformations al 96 % | Usage | — (immagini) | Bassa | Basso | **P2** |
| P3-1 | Un progetto per tenant + deploy di tutti a ogni push | modello attuale | Strutturale | Alta | Alto | **P3** (decisione architetturale) |
| P3-2 | Osservabilità permanente leggera | §12 | — | Media | Basso | **P3** |

### Schede di dettaglio

**P0-1 — Piano**
- Stato: Hobby, 6h58m/4h; uso commerciale.
- Soluzione: passare a Pro il team che ospita chloefood (o spostare chloefood in un team Pro dedicato, lasciando i progetti personali su Hobby). Configurare Spend Management con una soglia (es. 30 $) e notifiche.
- Beneficio: niente rischio di sospensione di 30 giorni; Observability 1 giorno di log, Drains disponibili.
- Rischio: costo fisso 20 $/mese. Metrica: fattura mensile vs credito.

**P0-2 — Test in produzione**
- Stato: `storefront-confirmation.yml` a ogni push idoneo; test locali dopo il deploy.
- Soluzione: (a) trigger solo `workflow_dispatch` o una volta per gruppo di push (es. pianificazione serale se `main` è cambiato); (b) dividere la suite: in produzione solo 3–5 test di fumo, il resto contro `next start` locale/CI con dati di test, o in un ambiente non-Vercel; (c) aggiungere a Playwright un header/UA riconoscibile (es. `extraHTTPHeaders: { 'x-lepefy-synthetic': '1' }`) per poter filtrare nel Firewall; (d) `serviceWorkers: 'block'` c'è già: aggiungere il blocco di immagini/analytics nei test di layout.
- File: `.github/workflows/storefront-confirmation.yml`, `apps/storefront/tests/confirmation/**`, pratica di verifica post-push.
- Beneficio atteso: proporzionale al numero di run evitati; sul 15/10, ~23k richieste CDN da GitHub. Non quantificare in % prima della misura (§13).
- Rischio: meno copertura in produzione → compensare con test locali. Test: confronto giornaliero invocazioni prima/dopo.

**P1-1 — Prefetch**
- Soluzione: `prefetch={false}` sui `<Link>` verso route dinamiche o personali (`/cart`, `/compte/**`, `/orders`, `/supprimer-compte`, `/gadgets`, `/` finché dinamico, CGV finché dinamica). Mantenere il prefetch verso pagine ISR (`/accueil`, `/avis`, prodotti).
- File: `components/layout/BottomNav.tsx:85`, `Header.tsx`, `Footer.tsx`, `BrandNavigationDrawer.tsx:256`.
- Trade-off UX: primo clic su quei link ~100–300 ms più lento (c'è già `loading.tsx`). Test: Playwright locale verifica la navigazione; metrica: invocazioni di `/gadgets`, `/compte/connexion`, `/orders` per caricamento.

**P1-2 — Quantity groups**
- Soluzione: cache modulo condivisa con promessa in volo (come `useSessionCustomer`), TTL in memoria; caricare solo quando serve (carrello non vuoto, drawer aperto, prodotto membro di un gruppo); risposta con `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` (dati pubblici del tenant; la validazione autorevole resta in `/api/checkout`). In alternativa includere i gruppi nel payload ISR della pagina prodotto.
- File: `lib/cart/useQuantityGroups.ts`, `app/api/quantity-groups/route.ts`, `CartDrawer.tsx`, `ChatWidget.tsx`.
- Rischio: un gruppo modificato in admin appare con ≤60 s di ritardo nel carrello (il checkout resta corretto). Test: unit test sulla dedupe; metrica: invocazioni `/api/quantity-groups` ÷ invocazioni `/api/auth/session` (oggi ≈2,2, obiettivo ≤1 o ≈0 con CDN).

**P1-3 — CGV**
- Soluzione: ISR (`revalidate` lungo) + `revalidatePath('/conditions-generales-vente')` alla pubblicazione di un documento legale (stesso schema di `/politique-confidentialite`, già ISR 300 s).

**P1-4 — Catalogo**
- Soluzione da progettare: servire la variante senza parametri da cache (ISR breve, es. 60 s, con invalidazione catalogo esistente) e lasciare dinamiche solo le varianti con `?q`/`?category`/`?page`; oppure spostare filtri e paginazione sul client sopra `/api/products` (già esistente). Il prezzo e lo stock visualizzati restano verificati al checkout, come già per le pagine prodotto ISR.
- Rischio: medio (SEO, ripristino della posizione, `shoppingReturn`). Test: suite di conferma locale; metrica: CPU della route `/`.

**P2-1 — ISR prodotti**: portare `revalidate` a 900–3600 s, perché l'invalidazione esplicita (`revalidateCatalogCache`) copre già le modifiche admin e i tick promo. Trade-off: uno stock esaurito senza passare dall'admin (decremento da checkout) appare dopo più tempo — il checkout lo blocca comunque. Valutare un `revalidatePath` mirato dopo il decremento di stock.

**P2-2 — Tick**: n8n legge prima un contatore su Supabase (PostgREST, costo Vercel zero) e chiama `/api/internal/notifications/dispatch` solo se ci sono consegne in attesa; idem per `catalog-schedule` (prossima transizione ≤ adesso).

**P2-3 — Invalidazione**: sostituire `revalidatePath('/', 'layout')` con tag specifici dove possibile.

**P2-4 — Regione**: se Supabase è in UE, impostare la regione funzioni (`fra1`/`cdg1`) nelle impostazioni progetto. Effetto atteso su durata/memoria; prezzo CPU più alto (0,184 vs 0,128 $/h). Da decidere con misura.

**P2-5 — Immagini**: 4,8K/5K trasformazioni; con più tenant o più prodotti si supera il limite Hobby. Già documentato in `docs/IMAGE_DELIVERY_ARCHITECTURE.md`.

---

## 12. Osservabilità permanente (progetto, non implementato)

Obiettivo: sapere ogni giorno CPU, invocazioni, errori e quota sintetica, per progetto e per route principale, senza un sistema più costoso del problema.

1. **Strumenti Vercel inclusi**: Usage (30 giorni, per progetto/giorno), Observability (12 h Hobby / 1 giorno+ Pro), Firewall (24 h). Su Pro: Spend Management con soglia e webhook, Drains se necessario.
2. **Traffico sintetico etichettato**: header `x-lepefy-synthetic` nei test Playwright e nei controlli n8n; su Vercel WAF una regola *Log* (non blocco) su quell'header per misurare la quota di traffico di test (Hobby: fino a 3 regole custom).
3. **Log strutturato minimale** solo sugli endpoint `/api/internal/*`: una riga JSON per run (`route`, `tenantCount`, `processed`, `durationMs`), niente per le pagine pubbliche.
4. **Aggregazione su Hetzner**: un workflow n8n giornaliero (fuori picco) che salva in Postgres Hetzner (non Supabase di produzione) un'istantanea: totali Usage del giorno precedente per progetto (API REST Vercel con token di sola lettura in credenziale n8n — endpoint e permessi DA VERIFICARE), run GitHub del giorno (`gh api`), conteggio esecuzioni n8n. Una sola chiamata al giorno: costo Vercel zero (l'API non invoca funzioni del progetto).
5. **Allarmi**: e-mail n8n (Error Workflow già esistente) se la CPU giornaliera del team supera la soglia (es. 8 min/giorno su Hobby, o una soglia di spesa su Pro).
6. **Costo per tenant**: con un progetto per tenant è diretto (Usage per progetto). Con un eventuale progetto unico multi-dominio servirebbero Observability Plus o Drains filtrati per host.

---

## 13. Strategia di misurazione prima/dopo

Baseline da registrare prima di ogni intervento (dashboard, nessuna chiamata artificiale):
- Usage → Fluid Active CPU e Invocations, vista Projects, valore giornaliero chloefood (ultimi 7 giorni).
- Observability → Functions, 12 h: totale invocazioni, P75 Active CPU, top 25 route (export manuale/screenshot).
- Firewall → Traffic, 24 h: totale e quota user-agent `HeadlessChrome`.
- Numero di run `storefront-confirmation` e di commit su `main` del giorno.

Regole:
1. Un intervento per volta, misurato su ≥3 giorni con numero di push simile.
2. Registrare almeno **un giorno senza push e senza test** per stimare il traffico reale (H3).
3. Metriche di risultato: CPU/giorno chloefood; invocazioni per caricamento ≈ invocazioni totali ÷ invocazioni `/api/auth/session`; rapporto `/api/quantity-groups` ÷ `/api/auth/session`; quota HeadlessChrome.
4. Non esprimere i risparmi in percentuale prima della misura.

---

## 14. Valutazione Hobby vs Pro

| Aspetto | Hobby | Pro |
|---|---|---|
| Uso consentito | personale, **non commerciale** (fair use) | commerciale |
| Active CPU | 4 h/mese incluse; superate → attesa fino a 30 giorni («nella maggior parte dei casi») | on-demand: 0,128 $/h (iad1), 0,184 $/h (fra1) |
| Credito | — | 20 $/mese incluso nella quota piattaforma di 20 $/mese |
| Invocazioni | 1M | 0,60 $/M |
| Deploy/giorno | 100 | 6.000 |
| Runtime logs / Observability | 1 h / 12 h | 1 giorno / Observability Plus opzionale |
| Spend management | no | sì (notifiche predefinite a 200 $) |

Stima del costo Pro con il consumo attuale (≈7 h CPU/30 giorni per il team, 68 GB-h di memoria, 220K invocazioni a iad1): CPU ≈ 0,9 $, memoria ≈ 0,7 $, invocazioni ≈ 0,1 $ → **≈ 2 $/mese, coperti dal credito di 20 $**. Anche al ritmo di ottobre (≈13 h/mese) si resta sotto i 3 $. Il costo effettivo del passaggio è quindi il canone di 20 $/mese.

**Periodo**: la finestra Hobby è mobile su 30 giorni. Anche annullando oggi i test, i giorni 9–15/10 (≈3 h del team) restano nel conteggio fino all'8–15/11; il team non torna sotto 4 h prima di metà novembre.

---

## 15. Raccomandazione architetturale finale

1. **Subito (decisione, non codice)**: Pro per chloefood; spend management; fermare i test browser pesanti in produzione a ogni push.
2. **Ciclo di sviluppo successivo (basso rischio)**: P1-1 prefetch, P1-2 quantity groups, P1-3 CGV, P2-2 tick con early-return. Obiettivo misurabile: ≤3 invocazioni per caricamento di pagina storefront e nessuna invocazione per una visita a una pagina ISR senza carrello.
3. **Poi**: P1-4 catalogo cacheabile, P2-1 ISR prodotti più lungo con invalidazione mirata, P2-4 regione.
4. **Prima dei 10 tenant**: decidere il modello di deploy (un progetto per tenant con deploy selettivi, oppure un progetto multi-dominio con risoluzione per host). È il vincolo che si romperà per primo (100 deploy/giorno su Hobby, build ripetute, cache fredde), prima della CPU.
5. **Principio guida**: ogni nuovo componente globale (layout, nav, widget) deve dichiarare quante invocazioni aggiunge per caricamento di pagina; nessun fetch client `no-store` montato globalmente senza deduplicazione e caricamento su richiesta.

---

## Appendice A — Output richiesti

### A. Diagnosi sintetica
Il consumo verificato è di `chloefood` (76 % della CPU del team) ed è triplicato dal 9–10/10 per **aumento di invocazioni**, non di costo per richiesta. Le cause verificate sono: (1) test browser automatizzati contro la produzione (≈83 % delle richieste nelle ultime 24 h, picchi allineati ai run); (2) un'architettura client che trasforma ogni caricamento di pagina in molte invocazioni (stima 8–12, da misurare) (prefetch di route dinamiche, `/api/quantity-groups` ripetuto e non in cache, sessione), peggiorata dalle modifiche del 9, 11 e 15/10. Le automazioni n8n/GitHub valgono ≈3–4 % e non sono la causa.

### B. Top 10 problemi (per impatto)
1. Test di conferma browser in produzione a ogni push (C1, P0-2).
2. Prefetch automatico verso route `force-dynamic` da BottomNav/Header/Footer (C2, P1-1).
3. `/api/quantity-groups` chiamato 2–4 volte per caricamento, `no-store`, anche su pagine ISR (C3, P1-2).
4. Catalogo `/` sempre dinamico anche senza parametri — route più costosa (P1-4).
5. Team oltre il limite Hobby e uso commerciale su Hobby (P0-1).
6. ISR prodotti a 300 s con 885 rivalidazioni/12 h e cache azzerata a ogni deploy (C4, P2-1).
7. Molti deploy al giorno su `main` (fino a 27) con verifiche in produzione (H1).
8. Pagine legali dinamiche prefetchate dal footer (P1-3).
9. Tick interni a intervallo fisso senza early-return (P2-2).
10. `revalidatePath('/', 'layout')` per salvataggi tenant/shell (P2-3) e regione iad1 da verificare (P2-4).

### C. Quick wins
- Limitare `storefront-confirmation` a trigger manuale/serale e ridurre la parte eseguita in produzione.
- `prefetch={false}` sui link verso route dinamiche/personali.
- Dedupe + caricamento su richiesta + `s-maxage` per `/api/quantity-groups`.
- CGV in ISR.
- Etichettare il traffico sintetico (header) e una regola WAF *Log*.

### D. Modifiche architetturali
- Catalogo: variante di default cacheabile, filtri/paginazione dinamici solo quando usati.
- Politica «costo per caricamento di pagina» per componenti globali.
- Modello di deploy multi-tenant (progetto unico multi-dominio o deploy selettivi per tenant).
- Tick n8n guidati da Supabase (chiamare Vercel solo se c'è lavoro).
- Osservabilità giornaliera su Hetzner (n8n + Postgres).

### E. Piano esecutivo
| Fase | Contenuto | Dipendenze | Rischio |
|---|---|---|---|
| 0 (oggi) | Baseline §13; decisione Pro; stop test pesanti in produzione | nessuna | basso |
| 1 (1–2 giorni) | P1-1, P1-2, P1-3, header sintetico | Fase 0 per misura | basso |
| 2 (≈1 settimana) | P2-2, P2-3, P2-1; misura regione (H4) | Fase 1 misurata | medio-basso |
| 3 | P1-4 catalogo cacheabile | suite locale stabile | medio |
| 4 | Osservabilità §12; decisione modello multi-tenant | Fasi 1–3 | variabile |

### F. Decisione infrastrutturale
**Passare a Pro è necessario**, indipendentemente dalle ottimizzazioni: (1) Hobby è riservato a uso personale non commerciale e Chloe Food è un negozio in produzione; (2) il team è a 6h58m su 4h nella finestra di 30 giorni e il rischio documentato è l'interruzione fino a 30 giorni; (3) anche prima dell'aumento il team viaggiava a ~5 h/30 giorni; (4) con i consumi attuali il costo on-demand su Pro resta dentro il credito di 20 $ incluso. Le ottimizzazioni restano necessarie per la scalabilità, non per evitare Pro.

### G. Blocchi diagnostici
| Informazione mancante | Come raccoglierla (gratis) |
|---|---|
| Dettaglio per route 9–15/10 | Non recuperabile su Hobby; da ora istantanea giornaliera Observability (12 h) |
| Quota reale vs sintetica su più giorni | Firewall 24 h ogni giorno + un giorno senza push/test; header sintetico |
| Natura di `/index` | Runtime log (1 h) durante una navigazione controllata |
| Regione Supabase | Supabase → Settings → General |
| Carico Postgres | Supabase → Reports |
| Esecuzioni n8n reali (es. shipping-campaign-worker) | n8n → Executions |
| Test lanciati dalla macchina locale | Elenco delle pratiche post-push nelle sessioni di sviluppo; header sintetico anche in locale |
| Endpoint API Vercel per l'export Usage | Documentazione REST Vercel, token di sola lettura |
