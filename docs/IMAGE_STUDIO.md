# Studio images (admin)

> Stato: migration `183_image_studio.sql` e `184_image_studio_platform_settings.sql` applicate in produzione il 12/11/2026; flag di rilascio `image_studio` spento per tutti i tenant (attivazione solo da Lepefy, `platformOnly`). Base letta: `main` @ `2b78c243`.
> Proposta approvata (inventario, audit UX, mockup PRE/POST, architettura): artifact « Studio images » (`docs/proposals/studio-images-proposal.html`).

## 1. Cosa fa

Una libreria di immagini **per tenant**, indipendente dai prodotti e dai moduli. Si crea prima l'immagine, si sceglie dove usarla solo dopo averla approvata.

1. **À partir d'une photo**: galleria, fotocamera o foto ricevuta su WhatsApp (salvata nella galleria del telefono), con una richiesta facoltativa (« enlever le piment rouge »).
2. **Créer avec une idée**: un testo libero; l'immagine è sempre un'**immagine d'ambiance** (nessuna confezione, logo, testo o marca, anche se il testo li cita).

Il **style de la boutique** (pattern visivo versionato) viene applicato a ogni creazione senza nessun parametro tecnico per l'utente. La lavorazione è asincrona: si può chiudere la pagina e tornare dopo.

Revisione: confronto Original / Proposition (fianco a fianco su desktop, interruttore su telefono), versioni V1…Vn, « Demander une correction » in linguaggio naturale (nuova versione a partire da quella scelta), « Approuver cette version », « Écarter l'image ». Poi « Utiliser l'image »: destinazione → elemento → **Aperçu** del formato (riquadro spostabile con dito, mouse o frecce) → « Confirmer et publier ».

Il pulsante « Générer avec l'IA » dell'editor prodotto, quando il flag è attivo, diventa « Créer avec le Studio images » (`/admin/studio?pour=product:<id>`): la destinazione prodotto è proposta appena l'immagine è approvata. Senza flag il vecchio flusso (`/api/admin/generate-product-image`, pubblicazione diretta) resta invariato; va rimosso quando il flag sarà generalizzato.

## 2. Stati

```
asset:     processing → review → approved ⇄ (correction → processing)
                   ↘ failed (Réessayer → processing)
           review/failed/approved senza utilizzi → discarded ⇄ restore ; approved → archived
revision:  pending → succeeded | failed (Réessayer → pending) ; mai cancellata
usage:     publishing → active → removed (removed | replaced | target_changed) ; publishing → failed
job:       queued → running → succeeded | queued (retry, backoff 30 s·2^n) | failed (max 3)
```

La macchina a stati vive nelle RPC 183 (`studio_*`); `lib/studio/rules.ts` la rispecchia solo per l'interfaccia. Una correzione su un'immagine approvata la riporta « À valider »: gli utilizzi esistenti restano sulla versione che usavano. Una correzione fallita lascia la proposta precedente da validare. Badge e toni: `STUDIO_ASSET_STATUS_META`, `STUDIO_REVISION_STATUS_META` (`lib/admin/statusRegistry.ts`).

## 3. Dati (migration 183)

| Tabella | Contenuto |
|---|---|
| `studio_style_versions` | pattern del tenant, righe **immutabili** (trigger), `version` crescente, una sola `active` |
| `studio_tenant_settings` | quote: `monthly_revisions` (60), `monthly_budget_usd` (20), `draft_retention_days` (30); nessuna riga = default; scritta solo da `studio_set_tenant_settings` (184) |
| `studio_assets` | origine, titolo, stato, richiesta, originale privato, versione approvata, `ambiance_only`, autore, `request_key` |
| `studio_revisions` | n° versione, versione di base (correzione), richiesta, prompt finale, stile v, provider/modello, file privato, sha256, costo, latenza, codice errore |
| `studio_jobs` | coda durevole: tentativi, `next_attempt_at`, `locked_until`, `claim_token` |
| `studio_usages` | asset × destinazione × elemento, URL pubblico e file della **copia dedicata**, ritaglio, stato, motivo di rimozione |

RLS forzata senza policy; `anon`/`authenticated` nessun privilegio; `service_role` solo `select`. Ogni scrittura passa da una RPC `security definer` con il tenant passato dal server e verificato sulla riga; FK composite `(tenant_id, id)`. Idempotenza: `request_key` unico per tenant su asset, versioni e utilizzi (doppio clic, retry di rete). Quote: `studio_quota_check` sotto `pg_advisory_xact_lock` per tenant, mese civile a Parigi; le versioni fallite non contano, il costo conta sempre. Capability `studio.use` (tenant_admin, platform_owner). Journal d'activité: `studio.asset.created|approved|discarded`, `studio.usage.published|removed`, `studio.style.published` (modulo `studio`, visibile con `studio.use`).

## 4. File e visibilità

- Bucket **privato** `studio-private` (15 Mo, JPEG/PNG/WebP, nessuna policy storage):
  `tenants/<t>/uploads/<admin>/<uuid>` (upload grezzo via **URL firmata**, direttamente dal telefono, mai attraverso la funzione Vercel), `tenants/<t>/assets/<key>/source.jpg` (originale normalizzato: tipo dai byte, rotazione EXIF, ≤ 2048 px, sRGB), `…/rev-<n>-<token>.webp` (ogni proposta). Lettura dal browser solo con URL firmate di 5 minuti.
- **Promozione** (`lib/studio/server/publish.ts`): riserva l'utilizzo → ritaglio al formato della destinazione (`sanitizeCrop`: il server non si fida del rettangolo del browser) → **copia** nella cartella pubblica della destinazione → **verifica** della copia → aggiornamento del riferimento con **compare-and-set** sul valore letto prima → `studio_finish_usage`. Ogni errore prima dell'aggiornamento rimuove la copia: nessun file pubblico senza utilizzo completato. Una copia per destinazione: rimuovere un utilizzo non rompe gli altri.
- Prodotto: la copia passa dalla pipeline v3 esistente (`uploadProductImageSet`, set immutabile, 7 file); rimuovere un utilizzo prodotto **scollega soltanto** (stessa regola della galleria). Gli altri slot cancellano la loro copia dopo lo scollegamento. Le immagini già pubblicate non vengono mai rielaborate.
- Pulizia (tick giornaliero): file privati delle bozze mai usate (review/failed inattive oltre la retention, écartées dopo 7 giorni) e upload abbandonati > 24 h. Le righe restano (`purged_at`): storico, costi e quote esatti.

## 5. Registro delle destinazioni

`lib/studio/destinations.ts` (metadati client-safe) + `lib/studio/server/destinations.ts` (implementazione), parità verificata da `tests/unit/imageStudio.spec.ts`.

| Chiave | Slot storefront | Permesso | Formato | Modo |
|---|---|---|---|---|
| `product` | galleria prodotto (`products.images`, opz. copertina) | `catalog.manage` | 1:1 | aggiunge (max 8) |
| `hero_slide` | `tenant_hero_slides.image_url` | `catalog.manage` | 1:1 | sostituisce |
| `category` | `categories.image_url` | `catalog.manage` | 4:5 | sostituisce |
| `story` | `tenants.story_image_url` (« Notre origine ») | `tenant_settings.manage` | 4:3 | sostituisce |
| `card_hero` | hero `/card` (varianti AVIF+WebP, `storeHeroVariants`) | `tenant_settings.manage` | 4:3 | sostituisce |
| `event_banner` | `events.banner_image_url` | `events.manage` | 16:9 | sostituisce |
| `service_cover` | `service_offerings.cover_image_url` | `event_content.manage` | 4:3 | sostituisce |
| `rental_item` | `rental_items.image_url` | `event_content.manage` | 1:1 | sostituisce |
| `event_gallery` | nuova riga `event_gallery_photos` | `event_content.manage` | originale | aggiunge |

Esclusi di proposito: logo, icona app, fondo etichetta (identità/stampa). Gli slot Événementiel compaiono solo con `tenants.events_enabled`. Pubblicare richiede `studio.use` **e** il permesso della destinazione; l'elenco degli elementi è sempre letto con `tenant_id`. Le immagini « ambiance » richiedono una conferma esplicita sugli slot che mostrano un prodotto reale (`confirmAmbiance`: prodotto, articolo di noleggio). Aggiungere uno slot = una voce nei due file + una riga di questa tabella.

## 6. Provider e routing

Interfaccia `ImageStudioProvider` (`lib/studio/server/providers/types.ts`), adapter Gemini (`generateContent` con modalità IMAGE) e OpenAI Images (`/v1/images/edits|generations`). La scelta del modello è una **policy AI Core**: `studio/photo_edit` e `studio/prompt_generate` in `/admin/platform/ai-routing` (priorità = ordine di fallback). Cambiare provider = cambiare la policy, il flusso admin non cambia. I modelli d'immagine hanno `image_edit`/`image_generation` e mai `chat`: il router di Nala li ignora. Credenziali solo per nome env (`credential_ref`). Fallback: chiave mancante, modello indisponibile o errore → candidato successivo; timeout (90 s) o rifiuto di contenuto → stop (un altro modello costerebbe per lo stesso rifiuto). Costo: `ai_pricing` (prezzo per immagine se presente, altrimenti token; i token d'uscita dell'immagine non sono contati due volte), registrato su `studio_revisions.cost_usd` (somma dei tentativi) e con lo **stesso importo** su `ai_usage_log` (`endpoint = studio-image`, `consumer = studio`, `estimatedCostUsd` passato da chi chiama). La console « Coûts » (`/admin/platform/ai-usage`) li mostra come funzionalità « Studio images » (`lib/ai/productUsage.ts`). Prezzi configurati il 12/11/2026: 2.5 Flash Image 0,039 $/immagine (027), 3.1 Flash Image 0,067 $, 3 Pro Image 0,134 $ (183).

Prompt: `buildStudioPrompt` (`lib/studio/style.ts`), in inglese con il testo francese dell'utente citato tra virgolette (le sue virgolette vengono neutralizzate). Foto: soggetto, confezione, etichetta, logo e testo stampato identici; nessun dato di etichetta inventato. Idea: nessuna confezione, marca, logo o testo. Correzione: « applica SOLO questa modifica ». Lo stile di default segue `docs/STOREFRONT_PRODUCT_IMAGE_RUNBOOK.md` (1:1, fondo off-white caldo, luce diffusa, ombra a terra, margine 10–12 %, niente persone/props/filigrana); un nuovo stile per tenant è pubblicato dal platform owner da « Style de la boutique » (righe immutabili, controllo di versione).

## 7. Esecuzione durevole

1. `POST /api/admin/studio/assets` crea asset + versione + job (idempotente) e risponde subito.
2. La pagina chiama `POST /api/admin/studio/jobs/<id>/run` con `keepalive` (la funzione continua anche se la pagina si chiude, `maxDuration 120`).
3. Il job è preso con **compare-and-set** (`studio_claim_jobs`, `FOR UPDATE SKIP LOCKED`, `claim_token`): due chiamate o il tick non lo eseguono due volte; solo il detentore del token chiude il job (`studio_finish_revision`).
4. Tick n8n `POST /api/internal/studio-worker` ogni 5 minuti (template `ops/n8n/studio-worker.json`, bearer dedicato `STUDIO_WORKER_TOKEN`, mai la service-role): riprende i retry dovuti e i job con lock scaduto (funzione interrotta), max 3 tentativi poi « Échec ». Alle 03:40 `{ "cleanup": true }` esegue la pulizia (§4).
5. La pagina interroga l'immagine ogni 4 s solo mentre un job è in corso e la scheda è visibile; la libreria si aggiorna ogni 5 s solo se ci sono creazioni in corso.

Errori mostrati all'utente: messaggio francese da `STUDIO_JOB_ERROR_MESSAGES` (mai il dettaglio del provider) + « Réessayer » (nessuna quota consumata dalla versione fallita).

## 8. Confronto dei provider

Script `apps/storefront/scripts/studio-benchmark.ts` (`pnpm studio:benchmark`), workflow manuale « Studio images benchmark » (`.github/workflows/studio-benchmark.yml`). Campione reale: prodotti attivi del tenant con foto (un prodotto per categoria), 1 correzione per immagine, più idee fisse in francese con 1 correzione, **stesso prompt builder della produzione**. Misura per modello e per compito (modifica foto / idea): successi, latenza p50/p90, token, costo da `ai_pricing`, errori; produce un foglio di contatto con etichette **cieche** per la valutazione di fedeltà del soggetto, qualità e rispetto della correzione. Sola lettura sul database, nessuna scrittura nello storage del tenant.

Risultati: vedi §8.1 (aggiornato dopo ogni run; nessun vincitore dichiarato senza risultati misurati). Il routing iniziale della migration è prudente (2.5 Flash Image, poi 3.1 Flash Image) finché il confronto non è eseguito.

### 8.1 Risultati misurati

Da completare con il run del workflow (artifact `studio-benchmark`).

## 9. Operatività

- **Attivazione per un tenant** (solo Lepefy, con approvazione): console piattaforma **Intelligence artificielle › Studio images** (`/admin/platform/studio-images`: tutte le boutique, « Activer » / « Désactiver » con conferma, « Quotas », consumo del mese) oppure `/admin/parametres/fonctionnalites` del deployment del tenant. Stessa riga `tenant_feature_flags` (audit `admin.feature_flag.changed`); gli altri deployment vedono il cambiamento entro i 30 s della cache dei flag. Prerequisiti: migration 183, `GEMINI_API_KEY` sul progetto Vercel, `STUDIO_WORKER_TOKEN` (≥ 32 caratteri) su Vercel e credenziale Header Auth in n8n, workflow `ops/n8n/studio-worker.json` pubblicato e collegato all'Error Workflow.
- **Quote**: « Quotas » nella console piattaforma → RPC `studio_set_tenant_settings` (184: creazioni 0–5 000, budget 0–10 000 USD, conservazione 7–365 giorni), audit `studio.settings.updated`.
- **Cambiare modello**: `/admin/platform/ai-routing` → policy `studio/photo_edit` o `studio/prompt_generate`; aggiungere il prezzo in `ai_pricing` prima di attivarlo.
- **Rollback**: spegnere il flag (UI sparisce, API 404); i file pubblicati restano validi; rollback SQL in fondo alla migration.

## 10. Troubleshooting

| Sintomo | Causa probabile |
|---|---|
| « Le Studio images n'est pas encore installé » | migration 183 assente sul database del deployment |
| Job fermo « En cours » | `/run` interrotto e tick n8n non attivo: verificare il workflow e `STUDIO_WORKER_TOKEN` |
| « Le service d'images n'est pas configuré » | `credential_ref` della policy senza env sul deployment, o policy vuota/spenta |
| « L'emplacement vient d'être modifié » | modifica concorrente dello slot: compare-and-set rifiutato, nulla sostituito |
| Upload rifiutato dal bucket | formato HEIC: iOS converte in JPEG con `accept` limitato; altrimenti esportare in JPEG |
| Utilizzo « target_changed » | lo slot mostrava già un'altra immagine al momento del « Retirer d'ici » |

## 11. Mappa dei file

- `supabase/migrations/183_image_studio.sql`, `184_image_studio_platform_settings.sql`, `supabase/tests/183_image_studio.{fixture,test}.sql`, `184_image_studio_platform_settings.test.sql` (CI)
- Console piattaforma: `app/admin/(protected)/platform/studio-images/**`, `app/api/admin/platform/studio-images/route.ts`, `lib/studio/server/platform.ts` (`platformStudioApi` = `requirePlatformOwner` + attore audit)
- `apps/storefront/src/lib/studio/` — `domain.ts`, `rules.ts`, `style.ts`, `destinations.ts`; `server/` — `access.ts`, `assets.ts`, `storage.ts`, `style.ts`, `worker.ts`, `publish.ts`, `destinations.ts`, `cleanup.ts`, `providers/{types,registry,gemini,openai}.ts`
- `apps/storefront/src/app/api/admin/studio/**`, `apps/storefront/src/app/api/internal/studio-worker/route.ts`
- `apps/storefront/src/app/admin/(protected)/studio/**` (libreria, creazione, dettaglio, dialog « Utiliser l'image », stile)
- `lib/card/cardHeroStorage.ts` (`storeHeroVariants`, condiviso con `/api/admin/card/hero-image`), `catalogue/[id]/ProductMediaManager.tsx`
- `ops/n8n/studio-worker.json`, `.github/workflows/studio-benchmark.yml`, `apps/storefront/scripts/studio-benchmark.ts`
- Test: `tests/unit/imageStudio.spec.ts`; guida Help Center `studio-images` (bozza, da pubblicare con revisione editoriale)
