# Audit Performance Frontend — Storefront Lepefy Food

**Ambito**: `apps/storefront/` (Next.js 14 App Router), tenant pilota `chloefood` (121 prodotti, 8 categorie).
**Metodo**: analisi statica del codice + build di produzione reale eseguita in sandbox (`pnpm install && pnpm build` con variabili d'ambiente placeholder, nessuna connessione Supabase live). Le dimensioni bundle riportate nella Sezione 9 sono **misurate** dall'output di `next build`. Le stime di LCP/CLS/INP sono **stime basate su analisi statica del codice**, non misurazioni Lighthouse — l'ambiente sandbox non ha accesso a un browser headless con rete instrumentata né a un database Supabase popolato con i 121 prodotti reali, quindi non è stato possibile eseguire un audit Lighthouse/PageSpeed contro dati reali. Nessun file di codice è stato modificato: `pnpm install`/`pnpm build` sono stati eseguiti in una copia locale, l'unico artefatto di build generato (`next-env.d.ts`, riformattazione automatica di `tsconfig.json`, `.next/`, `node_modules/`) è stato rimosso/ripristinato al termine.

---

## 1. Executive summary

I tre problemi con impatto maggiore sul tempo di caricamento reale percepito dall'utente:

1. **`select('*')` sul catalogo prodotti include la colonna `embedding vector(768)`** (usata solo dalla ricerca semantica) e il blob `descriptions jsonb` multilingua su **ogni** query prodotti di `/products` e `/products/[slug]`. Per 121 prodotti questo significa centinaia di KB di dati completamente inutili al render, trasferiti da Supabase al server Next.js e rigenerati nell'HTML/RSC payload ad ogni richiesta — un costo di rete e serializzazione puro, pagato da ogni singolo visitatore.
2. **Nessuna pagina è statica o ISR**: la build di produzione mostra **36/36 route `ƒ` (dynamic, server-rendered on demand)**, incluse home, catalogo e pagina prodotto — contenuti che cambiano raramente. La causa è strutturale: il client Supabase server-side condiviso (`src/lib/supabase/server.ts`) usa `cookies()` di Next.js, il che costringe Next a disabilitare ogni forma di cache statica/ISR su tutte le route che lo importano, anche quando non serve alcuna personalizzazione per-utente.
3. **Catalogo (121 prodotti) scaricato per intero, senza paginazione**, e **home page con un loop sequenziale di query Supabase** (una per categoria, in `await` dentro un `for`) invece di un fetch parallelo — entrambi problemi già noti da roadmap, confermati nel codice.

A questi si aggiungono: immagini del logo tenant con `<img>` invece di `next/image` (sistemico, non isolato a `Header.tsx`), assenza di `loading.tsx`/streaming su qualunque route, polling client-side diretto a Supabase su `/order-confirmation` che importa l'intero SDK `@supabase/supabase-js` lato client (route JS più pesante del sito), e nessuna strategia di cache/`minimumCacheTTL` per le immagini prodotto.

Nessuna violazione multi-tenant strutturale nel codice sorgente (niente asset ChloeFood-specifici hardcoded in `apps/storefront/public/` — la cartella non esiste nemmeno). Un riferimento rotto (`/icons/apple-touch-icon.png`, nessun file/route corrispondente) è segnalato come difetto minore.

---

## 2. Tabella prioritizzata

| Area | Problema | Impatto | Effort | Multi-tenant impact |
|---|---|---|---|---|
| Data fetching | `select('*')` su `products` trascina `embedding vector(768)` + `descriptions jsonb` su `/products` e `/products/[slug]` | **Alto** | **Basso** | No — riguarda tutti i tenant ugualmente |
| Rendering strategy | Tutte le 36 route sono `force-dynamic`/dynamic (client Supabase legato a `cookies()`) → zero ISR/static | **Alto** | **Medio** | No |
| Data fetching | Home page: loop `for...await` sequenziale, una query per categoria (8 round-trip Supabase in serie) | **Alto** | **Basso** | No |
| Catalogo | Nessuna paginazione: 121 prodotti scaricati e renderizzati in un colpo su `/products` | **Alto** | **Medio-Alto** | No |
| Immagini | `<img>` invece di `next/image` per `tenant.logo_url` (Header pubblico + header admin) | **Medio** | **Basso** | Sì — il logo è per-tenant, ma il problema tecnico non è hardcoding, è la mancata ottimizzazione |
| Bundle JS | `/order-confirmation` importa `@supabase/supabase-js` client-side per un polling fai-da-te (161 kB First Load JS, il più pesante del sito) | **Medio** | **Medio** | No |
| Caching/HTTP | Nessun `images.minimumCacheTTL` / `formats` in `next.config.mjs` → cache immagini corta (default 60s), niente AVIF | **Medio** | **Basso** | No |
| Immagini | Upload prodotto (`upload-product-image`, `generate-product-image`) salva il buffer originale senza resize/compressione lato server | **Medio** | **Medio** | No |
| Rendering strategy | Nessun `loading.tsx` in nessuna route → nessuno streaming/skeleton durante SSR, schermo bianco durante la navigazione | **Medio** | **Basso** | No |
| Terze parti | `loadStripe()` invocato a livello di modulo in `CheckoutForm.tsx`: script Stripe.js caricato anche se l'utente non arriva mai allo step di pagamento | **Basso-Medio** | **Basso** | No |
| Data fetching | `force-dynamic` "di abitudine" su pagine che non ne hanno bisogno (`/cart`, `/orders/[id]`) — ridondante dato il punto precedente ma segnala over-uso del pattern | **Basso** | **Basso** | No |
| Admin | Polling ordini ogni 18s (`AdminOrdersPoller.tsx` + `/api/admin/orders/poll`) | **Basso** | **Basso** (già leggero) | No |
| Difetto minore | `/icons/apple-touch-icon.png` referenziato in `layout.tsx` ma nessun file/route esiste (404 silenzioso) | **Basso** | **Basso** | No |
| Font/CSS | next/font già usato correttamente (Inter + Bricolage Grotesque, `display: swap`); Tailwind `content` scoping corretto | — (non è un problema) | — | — |

---

## 3. Dettaglio per problema

### 3.1 `select('*')` trascina colonne pesanti e inutilizzate nel payload catalogo

**File coinvolti**: `src/app/(shop)/products/page.tsx` (righe 29-34), `src/app/(shop)/products/[slug]/page.tsx` (riga 26), `src/app/api/admin/catalogue/route.ts`.

**Causa tecnica**: la tabella `products` ha accumulato colonne pesanti nel tempo (`supabase/migrations/028_semantic_search.sql` aggiunge `embedding vector(768)`; `026_ai_descriptions.sql` aggiunge `descriptions jsonb` multilingua). `select('*', 'category:categories(*)')` le include tutte, per ogni riga, anche se `CatalogClient`/`ProductGrid`/`ProductCard` leggono solo `id, name, slug, price, image_url, weight_grams, stock, storage_type, category.name`. Un vettore a 768 dimensioni serializzato in JSON pesa circa 6-8 KB per riga; su 121 prodotti sono ~1 MB di dati morti trasferiti da Supabase al server ad ogni caricamento di `/products`, più il costo di query/serializzazione lato Postgres e lato Next.js.

**Soluzione proposta** (illustrativa, non da applicare):

```ts
// src/app/(shop)/products/page.tsx
let dbQuery = supabase
  .from('products')
  .select(`
    id, name, slug, price, compare_at_price, image_url,
    weight_grams, stock, storage_type,
    category:categories(id, name, slug)
  `)
  .eq('tenant_id', tenant.id)
  .eq('active', true)
  .order('position');
```

Lo stesso vale per `products/[slug]/page.tsx` (elencare le colonne usate da `ProductDetail`/`ProductDescription`, incluse quelle multilingua effettivamente mostrate — non l'intero blob `descriptions`).

**Trade-off**: nessuno significativo — è un cambiamento puramente additivo di precisione della query. L'unico costo è dover mantenere l'elenco colonne sincronizzato quando si aggiungono nuovi campi consumati dalla UI (rischio di "dimenticare" una colonna, mitigabile con un tipo `Pick<...>` condiviso in `@lepefy/types`).

---

### 3.2 Nessuna route beneficia di static rendering/ISR — causa strutturale

**File coinvolti**: `src/lib/supabase/server.ts` (`createClient()`), tutte le route che lo importano tramite `getTenant()` o query dirette (`(shop)/page.tsx`, `products/page.tsx`, `products/[slug]/page.tsx`, ecc.).

**Causa tecnica**: `createClient()` chiama `cookies()` da `next/headers` per propagare la sessione utente. Next.js rileva l'uso di `cookies()` durante il render e disabilita automaticamente la cache statica per l'intera route, indipendentemente dal fatto che i dati letti (prodotti, categorie, tenant) non abbiano nulla di per-utente. Confermato dall'output reale di `next build` in questa sandbox: **ogni singola route applicativa risulta `ƒ (Dynamic)`**, incluse home e catalogo — zero pagine `○ (Static)` a parte `/api/health`.

```
Route (app)                    Size     First Load JS
┌ ƒ /                          2.56 kB         104 kB
├ ƒ /products                  4.57 kB         106 kB
└ ƒ /products/[slug]           2.46 kB        97.4 kB
...
ƒ  (Dynamic)  server-rendered on demand
```

Questo significa: nessuna cache CDN/Vercel per l'HTML di catalogo e prodotto, ogni richiesta ripete l'intera query Supabase, e nessun `generateStaticParams` è possibile finché la route dipende da un client legato ai cookie.

**Soluzione proposta**: introdurre un secondo client Supabase, "pubblico" (senza `cookies()`), da usare esclusivamente per letture pubbliche non personalizzate (tenant, categorie, prodotti attivi):

```ts
// src/lib/supabase/public.ts
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}
```

```ts
// src/app/(shop)/products/[slug]/page.tsx
export const revalidate = 300; // ISR: 5 minuti, invece di force-dynamic implicito

export async function generateStaticParams() {
  const supabase = createPublicClient();
  const { data } = await supabase.from('products').select('slug').eq('active', true);
  return (data ?? []).map((p) => ({ slug: p.slug }));
}
```

**Trade-off**: le pagine prodotto/catalogo diventano "eventually consistent" (fino a `revalidate` secondi di ritardo su modifiche prezzo/stock fatte da admin) — accettabile per un catalogo che cambia a ritmo umano, non a ogni secondo. Serve disciplina nel non riusare per errore il client "pubblico" per query che *devono* essere per-utente (es. dati cliente autenticato) — da isolare chiaramente per nome/percorso file e commento d'intento.

---

### 3.3 Home page: fetch a cascata invece di parallelo

**File coinvolti**: `src/app/(shop)/page.tsx`, righe 58-72.

**Causa tecnica**:

```ts
for (const cat of categories) {
  const { data: catRaw } = await supabase
    .from('products')
    .select(...)
    .eq('category_id', cat.id)
    ...
  // await dentro un for → una query alla volta, in serie
}
```

Con 8 categorie, questo produce 8 round-trip di rete sequenziali verso Supabase (oltre alle 2 query iniziali per tenant/categorie/featured, totale ~10 round-trip in serie). Se ogni query costa 50-150ms di latenza (tipico per Supabase in EU da un'edge function Vercel), il solo data fetching della home può costare 500ms-1.5s prima che il render lato server possa anche iniziare — questo si traduce direttamente in TTFB alto e LCP tardivo.

**Soluzione proposta**:

```ts
const categoryProducts = Object.fromEntries(
  await Promise.all(
    categories.map(async (cat) => {
      const { data } = await supabase
        .from('products')
        .select('id, name, price, image_url, slug, weight_grams, stock, storage_type, category:categories(name)')
        .eq('tenant_id', tenant.id)
        .eq('active', true)
        .eq('category_id', cat.id)
        .not('id', 'in', `(${excludeIds.join(',')})`)
        .order('position', { ascending: true })
        .limit(4);
      return [cat.id, data ?? []];
    }),
  ),
);
```

Ancora meglio: una singola query con `category_id in (...)` e un `limit` applicato lato client per categoria (una query invece di 8), se la dimensione del risultato resta contenuta.

**Trade-off**: `Promise.all` aumenta il picco di connessioni concorrenti verso Supabase (8 invece di 1 alla volta) — irrilevante ai volumi di questo tenant, da monitorare se il numero di categorie crescesse molto (es. >30). La versione "query unica" è più efficiente ma richiede raggruppare i risultati per categoria in JS e gestire il `limit(4) per categoria` a mano (Postgres non supporta `LIMIT` per gruppo nativamente via PostgREST senza una RPC dedicata).

---

### 3.4 Catalogo senza paginazione (121 prodotti in un colpo)

**File coinvolti**: `src/app/(shop)/products/page.tsx`, `src/components/catalog/CatalogClient.tsx`, `src/components/catalog/ProductGrid.tsx`.

**Causa tecnica**: `dbQuery` non ha mai un `.range()`/`.limit()`; tutti i prodotti attivi del tenant (121 oggi, crescerà) vengono letti dal DB, serializzati nell'HTML/RSC payload, e passati a un Client Component (`CatalogClient`) che li tiene tutti in memoria. Su una connessione 3G/4G lenta, questo significa scaricare l'intero catalogo (dati + tutte le image URL) prima che l'utente veda la prima riga di prodotti.

**Opzioni valutate**:

| Opzione | SEO (indicizzazione prodotti) | UX mobile | Complessità implementativa (workflow prompt→GitHub→Vercel) |
|---|---|---|---|
| **Paginazione server (query param `?page=`)** | Ottima — ogni pagina ha URL indicizzabile, contenuto stabile | Richiede tap "pagina successiva"/numeri pagina | Bassa — estende `ProductsPage` con `.range()`, nessun nuovo stato client complesso |
| **Infinite scroll (client, `IntersectionObserver` + fetch incrementale)** | Debole di default (contenuto oltre la prima schermata non è in HTML iniziale, va gestito con URL/paginazione "shadow" per i crawler) | Ottima — pattern familiare da e-commerce mobile | Media — richiede stato di paginazione client, gestione scroll restoration, fallback SEO |
| **Virtualizzazione lista (es. `react-window`) senza cambiare fetch** | Nessun beneficio (il problema è la query, non il DOM) | Nessun beneficio percepibile sotto ~200 prodotti | Bassa ma risolve il problema sbagliato |

**Raccomandazione**: paginazione server-side con query param, eventualmente con "carica altri" (bottone, non scroll automatico) che fa un secondo fetch server tramite Server Action o route handler — combina la semplicità/SEO della paginazione con una UX di continuità simile all'infinite scroll, senza la complessità di virtualizzazione o gestione scroll state.

```ts
// src/app/(shop)/products/page.tsx
const PAGE_SIZE = 24;
const page = Number(searchParams.page ?? '1');

const { data: productsRaw, count } = await dbQuery
  .select('*', { count: 'exact' })
  .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
```

**Trade-off**: la ricerca full-text (`ilike`) e i filtri categoria dovranti essere paginati allo stesso modo (già server-side oggi, quindi coerente). Il filtro categoria oggi è correttamente server-side (`dbQuery.eq('category_id', ...)`, non client-side su dataset scaricato) — nessun cambiamento necessario lì, va solo composto con `.range()`.

---

### 3.5 `<img>` per il logo tenant — sistemico, non isolato

**File coinvolti**: `src/components/layout/Header.tsx` (riga 14), `src/app/admin/(protected)/layout.tsx` (riga 67). (Gli usi in `src/lib/labels/templates/*.tsx` sono HTML renderizzato server-side da Gotenberg per generare PDF etichette — non affetto da questo problema, non è codice servito nel browser).

**Causa tecnica**: `<img src={tenant.logo_url}>` non passa per l'ottimizzatore immagini di Next.js: nessun resize automatico, nessuna conversione WebP/AVIF, nessun `loading="lazy"` di default corretto (il logo è above-the-fold quindi andrebbe *eager*, ma comunque non ridimensionato). Non è un caso isolato: il pattern si ripete identico nell'header admin.

**Soluzione proposta**:

```tsx
import Image from 'next/image';

{tenant.logo_url ? (
  <Image
    src={tenant.logo_url}
    alt={tenant.name}
    width={160}
    height={48}
    className="h-12 w-auto"
    priority
  />
) : tenant.name}
```

**Trade-off**: `next/image` richiede dimensioni intrinseche (`width`/`height`) o un container con `fill`; i loghi tenant hanno rapporti d'aspetto diversi tra tenant, quindi va scelto un bounding box fisso (es. altezza fissa, larghezza `auto` via CSS) — non un vincolo hardcoded per un tenant specifico, ma un vincolo di layout di piattaforma applicabile a tutti.

---

### 3.6 `/order-confirmation` importa l'intero SDK Supabase client-side per un polling fai-da-te

**File coinvolti**: `src/app/(shop)/order-confirmation/OrderConfirmationClient.tsx` (righe 74-88), `src/lib/supabase/client.ts`.

**Causa tecnica**: dopo un pagamento Stripe, il componente client fa `setInterval` ogni 2s per **12-15 volte** (30s di timeout), interrogando direttamente Supabase dal browser (`supabase.from('orders').select('*, order_items(*)')...`) per scoprire se il webhook Stripe ha già creato l'ordine. Questo:
- importa `@supabase/supabase-js` nel bundle di questa singola route, che infatti risulta la più pesante del sito lato storefront (**161 kB First Load JS**, misurato — contro 97-122 kB delle altre pagine cliente);
- esegue query dirette dal browser con la anon key, bypassando qualunque route API propria (nessun controllo/rate-limit applicativo oltre le RLS Supabase).

**Soluzione proposta**: sostituire il polling diretto a Supabase con un polling verso una route API leggera dello stesso backend (stesso pattern già usato per l'admin in `/api/admin/orders/poll`), che non richiede di spedire il client SDK al browser:

```ts
// src/app/api/orders/by-payment-intent/route.ts
export async function GET(req: NextRequest) {
  const paymentIntentId = req.nextUrl.searchParams.get('payment_intent');
  // ...query lato server con createServiceClient(), niente SDK nel browser
}
```

```ts
// OrderConfirmationClient.tsx
const res = await fetch(`/api/orders/by-payment-intent?payment_intent=${paymentIntentId}`);
```

**Trade-off**: un round-trip HTTP in più verso la propria infrastruttura Vercel invece che diretto a Supabase — trascurabile, e in cambio si eliminano ~35-50 kB di JS da una route ad alto traffico (ogni checkout completato la visita) e si centralizza l'accesso ai dati ordine lato server, più facile da proteggere/loggare.

---

### 3.7 Cache immagini: nessun `minimumCacheTTL`/`formats`, nessuna compressione all'upload

**File coinvolti**: `apps/storefront/next.config.mjs`, `src/app/api/admin/upload-product-image/route.ts`, `src/app/api/admin/generate-product-image/route.ts`.

**Causa tecnica**: `next.config.mjs` configura solo `remotePatterns` per Supabase Storage, senza `images.formats` (default: solo WebP, niente AVIF) né `images.minimumCacheTTL` (default: 60s — molto corto per foto prodotto che cambiano a ritmo di settimane/mesi). Inoltre `upload-product-image/route.ts` scrive il buffer ricevuto (foto scattata da telefono, potenzialmente 3-8 MB, risoluzione 3000px+) direttamente su Supabase Storage senza resize/compressione — il primo rendering di ogni size unica richiede quindi che l'ottimizzatore Next scarichi e comprima un originale molto più grande del necessario.

**Soluzione proposta**:

```js
// next.config.mjs
const nextConfig = {
  images: {
    remotePatterns: [/* ... esistente ... */],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 7, // 7 giorni
  },
};
```

Per l'upload, un resize server-side (es. `sharp`, già disponibile come dipendenza transitiva di Next.js) a una larghezza massima ragionevole (es. 1600px) prima dello storage:

```ts
import sharp from 'sharp';
const resized = await sharp(buffer).resize({ width: 1600, withoutEnlargement: true }).toBuffer();
```

**Trade-off**: `minimumCacheTTL` lungo significa che un cambio immagine prodotto può restare in cache CDN fino a 7 giorni — mitigabile cambiando il filename/path a ogni upload (già il caso: `products/${slug}.${ext}` con `upsert: true` mantiene lo stesso path, quindi serve un cache-busting via query string o hash nel path se si vuole invalidazione immediata). Il resize server-side aggiunge una dipendenza (`sharp`) e qualche centinaio di ms all'upload admin (operazione rara, non sul percorso critico cliente).

---

### 3.8 Nessun `loading.tsx` in nessuna route

**File coinvolti**: intero albero `src/app/` (nessun file `loading.tsx` trovato).

**Causa tecnica**: senza `loading.tsx`, Next.js non può mostrare uno stato di streaming/skeleton mentre il Server Component esegue le query Supabase — il browser resta sulla pagina precedente (o su un frame bianco alla prima visita) finché tutta la route non è pronta. Combinato con i fetch sequenziali sopra descritti, l'assenza di streaming rende ogni ritardo lato server pienamente visibile all'utente come "pagina che non risponde", invece di un progressive reveal.

**Soluzione proposta**:

```tsx
// src/app/(shop)/products/loading.tsx
export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-square bg-gray-100 rounded-lg animate-pulse" />)}
      </div>
    </div>
  );
}
```

Nota: `ProductGrid.tsx` ha già uno `ProductCardSkeleton` interno usato per le transizioni client (`isPending`) — lo stesso stile visivo può essere riusato per i vari `loading.tsx`, evitando di reinventare il pattern.

**Trade-off**: nessuno significativo; è puro upside (percezione di velocità) a basso effort. L'unico limite è che `loading.tsx` copre l'intera route — per skeleton più granulari (es. solo la lista prodotti mentre l'header categoria è già pronto) servirebbe `<Suspense>` con più fetch indipendenti, che presuppone prima la separazione dei fetch descritta nei punti 3.2/3.3.

---

### 3.9 Terze parti: Stripe.js caricato eagerly

**File coinvolti**: `src/app/(shop)/checkout/CheckoutForm.tsx`, riga 20.

**Causa tecnica**: `const stripePromise = loadStripe(...)` viene eseguito a livello di modulo, quindi nel momento stesso in cui `CheckoutForm` viene importato (cioè non appena si entra in `/checkout`, prima ancora che l'utente compili il form e arrivi allo step `payment`). `loadStripe` inietta uno `<script>` per `js.stripe.com/v3` — non è JS pesante bundlizzato (Stripe.js resta esterno), ma è comunque una richiesta di rete e un parse anticipati rispetto al momento in cui servono davvero.

**Soluzione proposta**:

```ts
function StripeStep(props: Props) {
  const [stripePromise] = useState(() => loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!));
  // invocato solo quando questo componente monta, cioè a step === 'payment'
}
```

Spostare la `loadStripe()` dentro il componente montato solo allo step 2 (`step === 'payment'`), invece che a livello di modulo del form intero.

**Trade-off**: minimo — un frame di ritardo aggiuntivo nel caricare Stripe.js quando l'utente *arriva* allo step di pagamento, compensabile pre-caricando (`<link rel="preconnect" href="https://js.stripe.com">` o richiamando `loadStripe` on-hover del bottone "Continuer vers le paiement") se si vuole azzerare anche quella percezione.

---

## 4. Roadmap di implementazione consigliata

Raggruppamento pensato per minimizzare cicli prompt → errore → fix separati, ordinando per rapporto impatto/rischio di regressione:

**Prompt 1 — Query e select mirati (basso rischio, alto impatto, nessun cambio di UX)**
- Fix `select('*')` → colonne mirate su `/products`, `/products/[slug]`, admin catalogue (3.1)
- Home page: fetch categorie in parallelo con `Promise.all` (3.3)
- Aggiungere `loading.tsx` alle route pubbliche principali riusando lo skeleton esistente di `ProductGrid` (3.8)

*Perché insieme*: sono modifiche isolate, non toccano la UX visibile (a parte lo skeleton, che è un puro miglioramento), e si verificano facilmente con `pnpm typecheck` + verifica visuale — basso rischio di introdurre bug che richiedono un secondo giro.

**Prompt 2 — Immagini e caching**
- `<img>` → `next/image` per il logo tenant (storefront + admin) (3.5)
- `next.config.mjs`: `formats` AVIF/WebP + `minimumCacheTTL` (3.7)
- Resize/compressione server-side all'upload prodotto (3.7)

*Perché insieme*: stesso dominio (pipeline immagini), toccano file diversi ma con lo stesso tema di verifica (controllo visivo di logo e immagini prodotto dopo il deploy).

**Prompt 3 — Paginazione catalogo**
- Paginazione server-side `/products` con query param `?page=` (3.4)
- Aggiornamento `CatalogClient`/`ProductGrid` per gestire il nuovo parametro e "carica altri"

*Perché isolato*: è il cambiamento con superficie UX più ampia (comportamento di scroll/navigazione catalogo) — merita un ciclo prompt dedicato con test manuale approfondito su mobile prima di combinarlo con altro.

**Prompt 4 — Rendering strategy (ISR) e client Supabase pubblico**
- Introdurre `createPublicClient()` senza `cookies()` (3.2)
- `revalidate`/`generateStaticParams` su `/products/[slug]` e home
- Riesame puntuale di ogni `export const dynamic = 'force-dynamic'` esistente: quali sono realmente necessari (checkout, cart — dipendono da stato sessione/carrello) vs residuo di abitudine

*Perché ultimo*: è il cambiamento più delicato — tocca la strategia di rendering di più route contemporaneamente e richiede attenzione a non rompere dati che *devono* restare freschi (stock, prezzi). Va fatto con la paginazione già in posto (Prompt 3) per evitare di dover ritoccare la stessa route due volte.

**Prompt 5 — Terze parti e polling**
- `/order-confirmation`: sostituire il polling diretto Supabase-client con una route API server-side (3.6)
- `loadStripe()` differito al montaggio dello step di pagamento (3.9)

*Perché insieme e ultimo*: entrambi toccano flussi post-pagamento/checkout, i più sensibili del sito dal punto di vista business — meglio isolarli in un prompt dedicato con test end-to-end del flusso di checkout completo (Stripe test mode) prima e dopo.

---

## Nota metodologica su `@next/bundle-analyzer`

Non è stato aggiunto `@next/bundle-analyzer` come devDependency: i numeri di bundle riportati nella Sezione 2/3 provengono direttamente dall'output standard di `next build` (colonna "First Load JS" per route), che si è rivelato sufficiente per individuare la route anomala (`/order-confirmation`, 161 kB) senza necessità di un breakdown a livello di singolo modulo. Se in un prompt successivo servisse un'analisi più fine (es. per isolare il peso esatto di `@stripe/react-stripe-js` vs `@supabase/supabase-js` client-side), va aggiunto come devDependency **temporanea** e rimosso a fine sessione — da segnalare esplicitamente in quel momento, come richiesto.
