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

**CI e deployment.** CI `38244471746` riuscita sullo SHA. Vercel `chloefood` `success` sullo stesso SHA. Vercel `lepefy-food-test` `failure` su entrambi i commit della delivery (`0ca70238`, `9637ddee`), dopo 20+ commit consecutivi riusciti. `next build` locale riesce sia come `chloefood` sia come `lepefy-test`: la causa dipende dall'ambiente del progetto di test e richiede i log Vercel. `test.lepefy.com` continua a servire il deploy precedente (HTTP 200). Lo smoke `Storefront confirmation` non parte su `9637ddee` per il filtro sui path. La suite `tests/confirmation` (10 test, 320–1440 px) eseguita localmente contro `shop.chloefood.com` è passata.

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

**Metriche Vercel ufficiali.** Non lette: CLI Vercel non autenticato e dashboard non accessibile in questa sessione. Percorso verificabile: Vercel → team → *Usage* → *Image Optimization* (Transformations, Cache Reads/Writes) filtrato per progetto e periodo; per progetto anche *Observability* → *Image Optimization*.

**Stima residua, da calcolare dopo il pilota:** trasformazioni Vercel = richieste uniche di larghezza/qualità delle immagini Supabase legacy e delle altre categorie ancora su `next/image`; per i set prodotto v2 su tenant abilitato il percorso di rendering non genera `/_next/image`. Storage aggiuntivo per immagine = somma dei cinque file del set, mantenendo l'originale legacy; banda Supabase = numero di visualizzazioni × byte della variante effettivamente scelta dal browser. Le tariffe e i volumi reali vanno letti dalle dashboard dei provider prima di tradurre questi numeri in euro.
