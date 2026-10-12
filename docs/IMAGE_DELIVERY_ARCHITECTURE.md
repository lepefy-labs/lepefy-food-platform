# Distribuzione immagini prodotto v2

## Contratto e percorso

Nessuna migration database. `products.image_url` resta la cover e `products.images` resta la gallery ordinata (massimo 8, con `alt`). L'URL della cover v2 ha forma:

`{SUPABASE_URL}/storage/v1/object/public/assets/tenants/{tenantUuid}/products/{productUuid}/{imageId}/master.{jpg|png|webp}`

I quattro sibling obbligatori sono `thumbnail.webp` (160 px), `catalog.webp` (480), `detail.webp` (960), `full.webp` (1600). `imageId` nuovo è UUID; nel backfill è SHA-256 dell'URL legacy troncato a 32 caratteri, per retry idempotenti. Ogni set è immutabile; `cacheControl=31536000`, `upsert=false`. Sharp applica EXIF rotate, conserva proporzioni e non ingrandisce. Il master resta nel formato fotografico originale riconosciuto dal contenuto; le varianti usano WebP qualità 82, che supporta anche alpha PNG. GIF/SVG/animazioni non entrano in questa pipeline. La versione è l'`imageId`; hash SHA-256 e byte vengono riportati nei log operativi, senza nuove colonne.

Il resolver accetta solo URL pubblici dello stesso origin Supabase, con tenant ID corrispondente e path v2 canonico. Non prova a indovinare URL per file legacy o esterni. Il componente `LepefyImage` mantiene `next/image` per gli URL Supabase legacy, distribuisce direttamente URL HTTP(S) esterni non presenti nei remotePatterns Next e usa `<img srcSet sizes>` diretto per i set v2. Se una variante fallisce nel browser, tenta il master; se manca anche il master, mostra un fallback accessibile. `PRODUCT_IMAGE_VARIANTS_TENANTS` è una lista server-side di slug o UUID separati da virgola. Valore assente/vuoto = percorso storico per tutti. Il flag è risolto nel layout e passato come booleano al provider client; nessun segreto viene serializzato.

## Upload, errori e cancellazione

`upload-product-image`, `generate-product-image` e l'import autorizzato WhatsApp chiamano la stessa pipeline. Ogni upload crea prima tutti e cinque gli oggetti, poi aggiorna il prodotto. Se uno step fallisce, gli oggetti nuovi del tentativo sono rimossi. Il prodotto non viene modificato prima del completamento. La cancellazione dalla gallery scollega l'URL dal prodotto senza cancellare immediatamente lo Storage: altri contesti possono riferirsi allo stesso oggetto. Gli asset orfani vanno elencati e verificati con una procedura separata e una finestra di retention, mai eliminati dal backfill.

Il backfill lascia intatti gli originali. Scarica soltanto URL pubblici nello spazio `tenants/{tenantId}/products/{productId}`, salta URL esterni, genera set deterministici e sostituisce gli URL nel JSONB mantenendo ordine e `alt`. Se la gallery cambia durante l'elaborazione, segnala errore e chiede retry. Un set parziale da un tentativo precedente viene riusato solo dopo confronto byte per byte degli oggetti già presenti. L'operazione è riavviabile; gli URL v2 sono saltati.

## Operazioni

Eseguire dalla root con le credenziali service-role in ambiente locale approvato. Non salvare chiavi nei report.

```sh
pnpm --filter @lepefy/storefront images:backfill --tenant chloefood --limit 20 --validate --report ./artifacts/image-backfill-sample.json
pnpm --filter @lepefy/storefront images:backfill --tenant chloefood --product <uuid> --apply --report ./artifacts/image-backfill-one.json
pnpm --filter @lepefy/storefront images:backfill --tenant chloefood --apply --concurrency 2 --rate-ms 250 --report ./artifacts/image-backfill-full.json
```

Senza `--apply` il comando è read-only. `--validate` scarica e controlla formato/dimensioni di un campione senza scrivere. Il report JSON contiene stato per prodotto, legacy, esterni, migrati, numero di conversioni e byte di input/output realmente processati. `--limit`, `--concurrency` (1–8) e `--rate-ms` regolano l'esecuzione. Non usare una Vercel Function per il catalogo intero. Per ChloeFood: (1) dry-run, (2) campione e QA pubblico, (3) approvazione esplicita prima del backfill massivo, (4) solo dopo, impostare `PRODUCT_IMAGE_VARIANTS_TENANTS=chloefood` nel deployment approvato.

### Verifiche e rollback

Prima/dopo su catalogo mobile/desktop, home, pagina prodotto, lightbox, carrello, checkout solo immagini e admin: registrare `/_next/image`, URL CDN, larghezza effettiva, byte immagini, LCP, CLS, errori HTTP e screenshot a 3G/4G simulato. Un prodotto v2 su tenant abilitato deve usare Storage diretto; un legacy può ancora usare Vercel. Controllare cover, ordine, alt, stock esaurito, miniature e asset mancanti. Il vecchio service worker non conserva HTML o immagini in CacheStorage; testare anche una PWA installata prima del rollout.

Rollback immediato: togliere il tenant da `PRODUCT_IMAGE_VARIANTS_TENANTS` e ridistribuire la configurazione. I master restano validi per `next/image`. Gli URL originali storici restano nello Storage; per ripristinare URL precedenti su singoli prodotti, usare un backup del JSONB creato prima del backfill. Nessuna cancellazione automatica degli originali.

### Monitoraggio e alert

Il CLI riporta prodotti/immagini elaborate, varianti, byte ed errori; distinguere questi dati dai volumi Storage/CDN reali della dashboard Supabase. Contare via query tenant-scoped gli URL v2 vs legacy per la copertura. La piattaforma non registra ogni download browser. Per la quota Vercel usare esclusivamente la dashboard/API ufficiale per progetto: confrontare il periodo prima/dopo e segnalare mancato calo, errori sopra soglia concordata o backfill senza progresso. Non attivare n8n senza un bisogno operativo confermato.

Se un'immagine manca: controllare flag tenant, forma URL, cinque oggetti Storage, Content-Type e Cache-Control, risposta CDN, URL master nel DB e log `[product-images]`. Se soltanto una variante fallisce il browser usa il master; correggere il set e cambiare versione, senza sovrascrivere silenziosamente un URL già pubblicato.
