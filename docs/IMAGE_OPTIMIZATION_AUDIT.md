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

## Limiti della verifica

Non erano disponibili in questa sessione credenziali Supabase del tenant né dati Observability Vercel. Perciò non esistono ancora campione ChloeFood, benchmark browser su produzione, volumi Storage reali o risparmio misurato. La procedura di misura e rollback è in `docs/IMAGE_DELIVERY_ARCHITECTURE.md`.

**Stima residua, da calcolare dopo il pilota:** trasformazioni Vercel = richieste uniche di larghezza/qualità delle immagini Supabase legacy e delle altre categorie ancora su `next/image`; per i set prodotto v2 su tenant abilitato il percorso di rendering non genera `/_next/image`. Storage aggiuntivo per immagine = somma dei cinque file del set, mantenendo l'originale legacy; banda Supabase = numero di visualizzazioni × byte della variante effettivamente scelta dal browser. Le tariffe e i volumi reali vanno letti dalle dashboard dei provider prima di tradurre questi numeri in euro.
