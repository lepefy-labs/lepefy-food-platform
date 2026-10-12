# Distribuzione immagini prodotto v2

## Contratto e percorso

Nessuna migration database. `products.image_url` resta la cover e `products.images` resta la gallery ordinata (massimo 8, con `alt`). L'URL della cover v2 ha forma:

`{SUPABASE_URL}/storage/v1/object/public/assets/tenants/{tenantUuid}/products/{productUuid}/{imageId}/master.{jpg|png|webp}`

I quattro sibling obbligatori sono `thumbnail.webp` (160 px), `catalog.webp` (480), `detail.webp` (960), `full.webp` (1600). `imageId` nuovo è UUID; nel backfill è SHA-256 dell'URL legacy troncato a 32 caratteri, per retry idempotenti. Ogni set è immutabile; `cacheControl=31536000`, `upsert=false`. Sharp applica EXIF rotate, conserva proporzioni e non ingrandisce. Il master resta nel formato fotografico originale riconosciuto dal contenuto; le varianti usano WebP qualità 82, che supporta anche alpha PNG. GIF/SVG/animazioni non entrano in questa pipeline. La versione è l'`imageId`; hash SHA-256 e byte vengono riportati nei log operativi, senza nuove colonne.

Il resolver accetta solo URL pubblici dello stesso origin Supabase, con tenant ID corrispondente e path v2 canonico. Non prova a indovinare URL per file legacy o esterni. Il componente `LepefyImage` mantiene `next/image` per gli URL Supabase legacy, distribuisce direttamente URL HTTP(S) esterni non presenti nei remotePatterns Next e usa `<img srcSet sizes>` diretto per i set v2. Se una variante fallisce nel browser, tenta il master; se manca anche il master, mostra un fallback accessibile. `PRODUCT_IMAGE_VARIANTS_TENANTS` è una lista server-side di slug o UUID separati da virgola. Valore assente/vuoto = percorso storico per tutti. Il flag è risolto nel layout e passato come booleano al provider client; nessun segreto viene serializzato.

## Upload, errori e cancellazione

`upload-product-image`, `generate-product-image` e l'import autorizzato WhatsApp chiamano la stessa pipeline. Ogni upload crea prima tutti e cinque gli oggetti, poi aggiorna il prodotto. Se uno step fallisce, gli oggetti nuovi del tentativo sono rimossi. Il prodotto non viene modificato prima del completamento. La cancellazione dalla gallery scollega l'URL dal prodotto senza cancellare immediatamente lo Storage: altri contesti possono riferirsi allo stesso oggetto. Gli asset orfani vanno elencati e verificati con una procedura separata e una finestra di retention, mai eliminati dal backfill.

Il backfill lascia intatti gli originali. Classifica ogni immagine come `migrated` (v2), `legacy` (bucket `assets` dello stesso progetto, nello spazio `tenants/{tenantId}/products/{productId}`), `legacy-unscoped` (stesso bucket ma path storico fuori da quello spazio, es. `assets/products/<file>`), `external` o `unrecognized`. Il parametro di cache-busting `?v=` degli upload storici è ignorato per il download. Le `legacy-unscoped` sono convertite solo con `--include-unscoped`, che copia il contenuto nel prefisso tenant/prodotto del prodotto che le referenzia. Salta URL esterni, genera set deterministici e sostituisce gli URL nel JSONB mantenendo ordine e `alt`. Se la gallery cambia durante l'elaborazione, segnala errore e chiede retry. Un set parziale da un tentativo precedente viene riusato solo dopo confronto byte per byte degli oggetti già presenti. L'operazione è riavviabile; gli URL v2 sono saltati.

## Operazioni

Eseguire dalla root con le credenziali service-role in ambiente locale approvato. Non salvare chiavi nei report.

```sh
pnpm --filter @lepefy/storefront images:backfill --tenant chloefood --limit 20 --validate --include-unscoped --report ./artifacts/image-backfill-sample.json
pnpm --filter @lepefy/storefront images:backfill --tenant chloefood --product <uuid> --apply --include-unscoped --backup ./artifacts/image-backfill-one.backup.json --report ./artifacts/image-backfill-one.json
pnpm --filter @lepefy/storefront images:backfill --tenant chloefood --apply --include-unscoped --concurrency 2 --rate-ms 250 --backup ./artifacts/image-backfill-full.backup.json --report ./artifacts/image-backfill-full.json
```

Senza `--apply` il comando è read-only. `--validate` scarica e controlla formato/dimensioni di un campione senza scrivere. `--apply` rifiuta di partire senza `--backup <path>`: il file (creato in modalità esclusiva, mai sovrascritto) contiene `id`, `name`, `image_url`, `images` e `updated_at` di tutte le righe selezionate ed è scritto prima di qualunque scrittura Storage o DB. Il report JSON contiene stato per prodotto e immagine, conteggi `migrated`/`legacy`/`unscoped`/`external`, conversioni, byte di input/output realmente processati e, con `--validate`, formato e dimensioni delle sorgenti. Report e backup restano in `artifacts/` (git-ignored). `--limit`, `--concurrency` (1–8) e `--rate-ms` regolano l'esecuzione. Non usare una Vercel Function per il catalogo intero. Per ChloeFood: (1) dry-run, (2) campione e QA pubblico, (3) approvazione esplicita prima del backfill massivo, (4) solo dopo, impostare `PRODUCT_IMAGE_VARIANTS_TENANTS=chloefood` nel deployment approvato.

### Verifiche e rollback

Prima/dopo su catalogo mobile/desktop, home, pagina prodotto, lightbox, carrello, checkout solo immagini e admin: registrare `/_next/image`, URL CDN, larghezza effettiva, byte immagini, LCP, CLS, errori HTTP e screenshot a 3G/4G simulato. Un prodotto v2 su tenant abilitato deve usare Storage diretto; un legacy può ancora usare Vercel. Controllare cover, ordine, alt, stock esaurito, miniature e asset mancanti. Il vecchio service worker non conserva HTML o immagini in CacheStorage; testare anche una PWA installata prima del rollout.

Rollback immediato: togliere il tenant da `PRODUCT_IMAGE_VARIANTS_TENANTS` e ridistribuire la configurazione. I master restano validi per `next/image`, **ma solo se la quota Image Optimization del progetto Vercel è disponibile**: con quota esaurita ogni trasformazione non in cache risponde `402 OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED` e i master v2, mai trasformati prima, comparirebbero come "Image indisponible". In quella condizione il rollback va fatto ripristinando `image_url`/`images` dal file `--backup` (URL legacy, in parte già in cache Vercel) e non soltanto togliendo il flag. Gli URL originali storici restano nello Storage. Nessuna cancellazione automatica degli originali.

### Monitoraggio e alert

Il CLI riporta prodotti/immagini elaborate, varianti, byte ed errori; distinguere questi dati dai volumi Storage/CDN reali della dashboard Supabase. Contare via query tenant-scoped gli URL v2 vs legacy per la copertura. La piattaforma non registra ogni download browser. Per la quota Vercel usare esclusivamente la dashboard/API ufficiale per progetto: confrontare il periodo prima/dopo e segnalare mancato calo, errori sopra soglia concordata o backfill senza progresso. Non attivare n8n senza un bisogno operativo confermato.

Se un'immagine manca: controllare flag tenant, forma URL, cinque oggetti Storage, Content-Type e Cache-Control, risposta CDN, URL master nel DB e log `[product-images]`. Se soltanto una variante fallisce il browser usa il master; correggere il set e cambiare versione, senza sovrascrivere silenziosamente un URL già pubblicato.
