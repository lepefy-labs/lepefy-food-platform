# Audit distribuzione immagini

**Base verificata:** `main@5731d352eafb10d5c234d14631bb4c1c92f44ec8`, 12 ottobre 2026. Le affermazioni su traffico e costi sono separate dalle evidenze del codice.

## Baseline verificata nel repository

| Categoria | Origine e rendering al baseline | Esito |
|---|---|---|
| Prodotti, gallery, carrello, home, chat, admin catalogo | `products.image_url` e `products.images`; bucket pubblico Supabase `assets`, percorso tenant/prodotto; `next/image` con `fill` e `sizes` | URL Supabase remoti idonei a `/_next/image`; upload Sharp produceva un solo file, massimo 1600 px |
| Import catalogo WhatsApp | copia da host esterni permessi a `assets`, resize Sharp a 1600 px | nessuna variante prima di questa modifica |
| Categorie | immagine categoria o anteprime immagini prodotto | immagini categoria restano nel percorso attuale; anteprime prodotto migrano al resolver |
| Hero/editoriale/story | asset locali o URL Supabase; `next/image` e CSS background | non incluso nella prima pipeline: dimensioni e cicli editoriali diversi |
| Logo/branding | tenant URL, `next/image` | non convertire automaticamente SVG o loghi |
| Eventi/servizi/noleggi | upload Sharp dedicati, `<img>`, CSS o hero | già distribuiti direttamente in vari punti; richiedono audit dimensioni separato |
| Icone/PWA/OG | SVG/locali e API Sharp | non sono immagini prodotto; non rientrano nel rollout |
| Immagini esterne | URL di terze parti | lasciate intatte; nessun tentativo di costruire varianti |

La prima foto della gallery resta la cover, il limite è 8. Il client può convertire in WebP a 1600 px prima dell'upload sequenziale (4 MiB per immagine). L'upload originale accettava JPEG/PNG/WebP e la generazione AI creava un JPEG dichiarato. Il service worker è network-only e non intercetta immagini; la cache dei nuovi URL versionati è quindi quella HTTP del browser/CDN. L'OG del negozio usa `/api/og-image`, separato dalla gallery.

## Causa e livello di evidenza

- **Certa, dal codice:** le immagini prodotto remote passavano a `next/image` senza `unoptimized`; il loader standard genera `/_next/image` per più larghezze/qualità. Mancavano varianti salvate una volta sola.
- **Probabile, non misurata:** l'aumento di catalogo, superfici e risoluzioni richieste moltiplica le trasformazioni uniche. Il consumo indicato dal richiedente (~5.000 nel periodo) non è attribuibile a ChloeFood sulla sola base del repository.
- **Non verificata:** picchi del 1° e 10 ottobre 2026, cache miss/stale, crawler, quota per progetto o deployment. L'API Observability collegata ha restituito 404; la lista progetti ha confermato nel team almeno `chloefood`, `lepefy-food-test`, `lepefy-web` e `lepefy-corporate`. Nessuna metrica Vercel è stata simulata.

## Priorità

1. Varianti prodotto versionate in Storage e distribuzione diretta per i soli URL v2 e tenant abilitati.
2. Backfill tenant-aware prima dell'attivazione ChloeFood; dry-run e campione con conferma prima di scritture massive.
3. Misurare dal browser richieste, byte, LCP/CLS/errori prima e dopo; confrontare con il consumo Vercel per progetto quando l'API o la dashboard sono disponibili.
4. Valutare in un intervento successivo banner, categorie, story e branding secondo i loro requisiti specifici.

## Stato verificato su `main@9637ddee` (12 ottobre 2026)

Flag `PRODUCT_IMAGE_VARIANTS_TENANTS` non impostato, nessun `--apply` eseguito: tutte le immagini prodotto ChloeFood passano ancora da `/_next/image`.

**CI e deployment.** CI `38244471746` riuscita sullo SHA. Vercel `chloefood` `success` sullo stesso SHA. Vercel `lepefy-food-test` `failure` su entrambi i commit della delivery (`0ca70238`, `9637ddee`), dopo 20+ commit consecutivi riusciti, e di nuovo `success` su `ed5db2bf` (CI `38247966306`). `next build` locale riesce sia come `chloefood` sia come `lepefy-test`. La causa dei due fallimenti non è confermata: i log Vercel non sono stati letti. `test.lepefy.com` continua a servire il deploy precedente (HTTP 200). Lo smoke `Storefront confirmation` non parte su `9637ddee` per il filtro sui path. La suite `tests/confirmation` (10 test, 320–1440 px) eseguita localmente contro `shop.chloefood.com` è passata.

**Catalogo ChloeFood (CLI read-only, 180 prodotti).** 137 prodotti con immagini, 257 immagini: 234 `legacy` tenant/prodotto, 23 `legacy-unscoped` (`assets/products/<file>`), 0 v2, 0 esterne, 0 errori. Campione `--limit 20 --validate --include-unscoped`: 29 immagini, tutte decodificabili, nessuna scrittura. Formati: 20 WebP, 7 JPEG, 2 PNG. Lato lungo 767–1600 px (mediana 1254, nessuna sotto 480). Peso 28 KB–2,2 MB (mediana 137 KB, p90 359 KB), 8,0 MB in totale. La prima versione del CLI classificava le 23 `legacy-unscoped` come esterne, quindi non le avrebbe mai migrate: corretto.

**Browser, produzione, flag spento (Playwright Chromium, 390×844 mobile e 1440×900 desktop, senza service worker).**

| Pagina | Immagini DOM | Richieste `/_next/image` | Byte immagini | LCP | CLS |
|---|---|---|---|---|---|
| Catalogo mobile | 55 | 47 (w=256, q=75; AVIF) | ~220 KB | 992 ms (testo) | 0,009 |
| Dettaglio mobile | 8 | 9 (w=128/256/640) | ~60 KB | 540 ms (immagine) | 0,009 |
| Catalogo desktop | 77 | 67 (w=384) | ~620 KB | 396 ms (testo) | 0 |
| Dettaglio desktop | 9 | 8 (w=384/750) | ~111 KB | 484 ms (immagine) | 0,005 |

Nessun URL Supabase diretto, nessuna immagine senza `alt`, nessuna immagine rotta nel DOM. Le pagine pubbliche referenziano soltanto `assets/tenants/7706f591-…` (tenant ChloeFood). Header: `cache-control: public, max-age=604800, must-revalidate`, `x-vercel-cache` quasi sempre `HIT`/`STALE`.

**Quota Vercel Image Optimization esaurita (evidenza diretta).** Ogni trasformazione non in cache risponde `402`, `x-vercel-error: OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED`, `cache-control: max-age=0`. Al test, 3 card del catalogo mobile mostravano il fallback "Image indisponible" di `LepefyImage` (nessuna icona rotta). Con la scadenza della cache Vercel il numero di immagini mancanti può solo crescere finché la quota resta esaurita. Il dato prova che la quota del progetto o del team è esaurita, non quale progetto l'abbia consumata.

**Metriche Vercel ufficiali** (dashboard team → *Usage* → *Image Optimization*, piano Hobby, 12 set – 12 ott 2026, lette il 12/10). Image Transformations **5.024 / 5.000**: `chloefood` 4.967 (98,9 %), `lepefy-corporate` 55, `lepefy-food-test` 2. I picchi del 1° ottobre (~950) e del 10 ottobre (~740) appartengono a `chloefood`. Cache Reads 38.590 / 300.000, Cache Writes ~29K. Il consumo che ha esaurito la quota è quindi attribuibile a ChloeFood. La causa dei singoli picchi (crawler, nuovo catalogo, cache invalidata) non è determinabile da questi aggregati.

## Pilot ChloeFood (12 ottobre 2026)

Approvato dal richiedente. Ordine eseguito: prima il flag, poi i dati, perché con la quota esaurita un master v2 servito da `/_next/image` riceverebbe 402.

1. `PRODUCT_IMAGE_VARIANTS_TENANTS=chloefood` impostato dal richiedente sul progetto Vercel `chloefood` (Config, solo Production). Il redeploy di `ed5db2bf` è `Ready`. Verifica no-op: la home usa ancora solo `/_next/image`, nessun URL v2.
2. `--product <uuid> --apply --include-unscoped --backup …` su 3 prodotti: `mutzig` (PNG 1,6 MB, path `legacy-unscoped`), `la-raie-cover-pot` (galleria di 4 JPEG), `atieke-ivoirien` (2 WebP). Risultato: 7 immagini convertite, 0 errori. Ordine, `alt` e cover conservati. Per ogni set ci sono 5 oggetti con HTTP 200, `cache-control: public, max-age=31536000` e content-type corretti. Backup e report in `artifacts/product-images/pilot-*.json` (git-ignored).

**Browser dopo il pilot (Playwright, produzione).** Il prodotto principale delle tre pagine è servito direttamente da Supabase: mobile `catalog.webp` a 358 px (DPR 1), desktop `detail.webp` a 496–596 px. Miniature gallery `thumbnail.webp` a 84 px, lightbox `full.webp`. LCP del dettaglio desktop: 0,5–0,6 s sull'immagine v2. Nessuna richiesta `/_next/image` per un master v2, nessuna immagine rotta, CLS ≤ 0,01 sulle pagine prodotto. Conferma aggiunta e carrello usano le varianti v2 con `alt`. In un contesto pulito il carrello scarica solo `thumbnail.webp` (3,4 KB); una variante più grande compare solo se il browser l'ha già in cache dalla pagina prodotto. Le pagine prodotto hanno `revalidate = 300`: per alcuni minuti dopo il backfill l'HTML ISR può ancora riferire l'URL legacy, che resta valido ma è esposto al 402.

## Backfill completo ChloeFood (12 ottobre 2026)

Approvato dal richiedente. Comando: `--tenant chloefood --apply --include-unscoped --concurrency 2 --rate-ms 250 --backup …`. Durata 7 min 48 s, 0 errori. Convertite 250 immagini, saltate le 7 già migrate. Sorgenti 79,3 MB, nuovi oggetti 139,2 MB; con il pilot il nuovo Storage è circa 146 MB, e gli originali restano.

**Verifiche dopo il backfill.**
- Classificazione read-only: 257 `migrated`, 0 legacy, 0 unscoped, 0 external.
- 180/180 prodotti coerenti con i backup: numero immagini, `alt`, chiavi JSONB, cover.
- Listing Storage: 257 set completi (5 oggetti ciascuno), controllati in sequenza. Controlli paralleli più aggressivi avevano prodotto 429 e "Too many connections" lato Supabase: non vanno ripetuti in produzione.

**Browser dopo il backfill (Playwright, DPR 1).** Catalogo, dettaglio e `/gadgets` servono le immagini prodotto da Supabase, senza `/_next/image` e senza 402 sulle card. CLS ≤ 0,01. LCP del dettaglio mobile 0,2–0,3 s sull'immagine v2. Nel catalogo admin e nel media manager nessuna immagine rotta.

Restano due rendering via `/_next/image`:
- il logo del tenant (`assets/chloefood/…`, in cache Vercel);
- un rendering prodotto sfuggito alla migrazione, `GoodiesHero` (`/gadgets`), che passava il master v2 a `next/image` e riceveva 402. È corretto nello stesso commit di questo documento, passando a `LepefyImage` con `variant="detail"`.

Anche il catalogo admin (`CatalogueTable`) caricava i master interi (in media circa 330 KB, fino a 2,4 MB) per miniature da 44 px. Ora risolve `thumbnail.webp` solo per set v2 di tenant abilitati; gli altri tenant restano sull'`<img>` diretto, senza trasformazioni Vercel.

**Confronto byte (catalogo, stesso protocollo della baseline).**

| | Prima (`/_next/image`, AVIF q75) | Dopo (Supabase, WebP q82) |
|---|---|---|
| Mobile 390 px | 47 richieste, ~220 KB (w=256, ~4,7 KB/immagine) | 78 richieste, ~1,6 MB (`catalog.webp`, ~25 KB/immagine) |
| Desktop 1440 px | 69 richieste, ~620 KB (w=384, ~9 KB/immagine) | 83 richieste, ~2,1 MB (~25 KB/immagine) |

Le trasformazioni Vercel per le immagini prodotto passano a zero e i 402 spariscono. In cambio, ogni card pesa circa 3–5 volte di più a DPR 1: una card da circa 170–270 px CSS sceglie la variante da 480 px, perché la scala salta da 160 a 480, e WebP q82 pesa più di AVIF q75. Il traffico passa sulla banda Supabase; quota e piano Supabase non sono ancora stati verificati. Su telefoni a DPR 2–3 il confronto cambia, perché `next/image` avrebbe servito larghezze maggiori: va misurato su dispositivo reale. Interventi possibili, da approvare: una variante intermedia da 320 px e una qualità o un formato più compatti. Entrambi richiedono un nuovo backfill delle varianti.

**Residui osservati.** Il master PNG di `mutzig` è passato da 1,6 a 2,4 MB perché Sharp ricodifica il PNG con i parametri di default. Il browser non lo scarica (riceve le varianti WebP, 5–86 KB), ma occupa Storage. Una compressione PNG più forte va introdotta solo dopo il backfill completo: il riuso idempotente confronta i byte e un retry con encoder diverso fallirebbe. Chat e admin non verificati, perché richiedono autenticazione. Le miniature della gallery hanno `alt=""` già prima del pilota (sono decorative dentro un bottone etichettato). Il CLS di circa 0,11–0,12 della pagina carrello non dipende dalle immagini prodotto: va analizzato a parte.

**Stima residua, da calcolare dopo il pilota:** trasformazioni Vercel = richieste uniche di larghezza/qualità delle immagini Supabase legacy e delle altre categorie ancora su `next/image`; per i set prodotto v2 su tenant abilitato il percorso di rendering non genera `/_next/image`. Storage aggiuntivo per immagine = somma dei cinque file del set, mantenendo l'originale legacy; banda Supabase = numero di visualizzazioni × byte della variante effettivamente scelta dal browser. Le tariffe e i volumi reali vanno letti dalle dashboard dei provider prima di tradurre questi numeri in euro.
