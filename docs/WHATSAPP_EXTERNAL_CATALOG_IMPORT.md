# Import di cataloghi WhatsApp esterni

Stato (8/10/2026, ramo `feat/whatsapp-external-catalog-import`, base `main@ae81c8a7`):
- **CLI sperimentale locale**: operativa, testata su un catalogo reale (§1, §7).
- **Console platform** `/admin/platform/catalogues-whatsapp`: implementata (§12). Migration 149 e 150 **applicate** l'8/10/2026; codice in produzione (`chloefood`, `lepefy-food-test`); flag `external_catalog_import` acceso su `lepefy-test` e `chloefood` (scelta del requester). Lettura oltre i primi 10 prodotti tramite collezioni (§1.1): implementata, non ancora deployata.

Obiettivo: leggere il catalogo WhatsApp Business di un'attività **terza** (senza accesso al suo Meta Business), normalizzare i prodotti, proporre quantità minime/step/formati e, dalla console platform, applicarli **prodotto per prodotto e campo per campo** al catalogo di un tenant dopo validazione.

> Questo modulo è distinto dal canale WhatsApp Business del tenant (`docs/WHATSAPP_BUSINESS_PLATFORM.md`, API Cloud Meta ufficiale). Qui non si inviano messaggi, non si usano token Meta, non si toccano `tenant_whatsapp_channels`.

---

## 1. Risultato del test reale (8/10/2026)

Istanza GREEN-API *Developer* (gratuita, 3 chat/mese) `7107…`, collegata a un numero WhatsApp di test di Lepefy. Venditore: link `https://wa.me/c/191701838729307`, numero `+39 329 695 8822`.

| Domanda | Esito |
|---|---|
| Accesso al catalogo reale | **Riuscito** (`getProducts` HTTP 200, ~4 s) con `--chat-id 393296958822@c.us` |
| Prodotti recuperati | **10** con il solo `getProducts` (prima lettura); **98** con le collezioni, §1.1 |
| Immagini | **12** dichiarate, **12** scaricate in staging (originali, 833–1536 × 1600–2048 px, JPEG da `*.fna.whatsapp.net`), 0 scadute/rifiutate |
| Quantità minima proposta | **4** prodotti (Arachide 3, Tapioca 2, Isenbeck 4, Malta Guinness 4) — tutte inferite, nessuna esplicita |
| Da revisionare | **5** (i 4 sopra + Bobolo: "1 carton … de 20 paquets" → 20 è contenuto, nessun minimo) |
| Articoli singoli senza revisione | 5 ("100g", "500g", "1 paquet 480g", "1 paquet de 250g") |
| Prezzi | 10/10 validi in EUR; 1 promozione (Bobolo 50 € → 45 €) |

### 1.1 Oltre i primi 10: lettura per collezioni (8/10/2026, sera)

Sonda in sola lettura (sequenziale, 1,5 s fra le chiamate, 22 chiamate su `getCollections`/`getCollection`, stesso venditore), poi rielaborazione con la CLI (`--from-raw`) delle sole risposte reali salvate.

| Voce | Valore reale |
|---|---|
| Prodotti da `getProducts` | **10** (unica pagina leggibile) |
| Collezioni trovate | **17**, in 2 pagine di `getCollections` (`afterCollectionId` funziona: 10 + 7, cursore poi vuoto) |
| Pagine `getCollection` percorse | **20** (`afterProduct` funziona: «Épices» 10 + 10 + 4, «Ndole / Légumes» 10 + 2, le altre in una pagina) |
| Prodotti letti dalle collezioni | **94** righe, nessun duplicato fra pagine della stessa collezione |
| Duplicati eliminati | **6** (5 prodotti di `getProducts` presenti anche in collezioni, 1 prodotto in due collezioni) |
| Totale prodotti unici | **98** (contro 10) |
| Prodotti con immagini | **98 / 98** (159 immagini originali in staging, 0 scadute o rifiutate) |
| Fuori da ogni collezione | **5 dei primi 10** prodotti di `getProducts` |
| Quantità minima proposta / da revisionare | 35 / 37 (prezzi validi 98/98) |
| Completezza verificabile | **parziale**: tutte le collezioni lette fino al cursore vuoto, ma il catalogo contiene prodotti fuori dalle collezioni e oltre i primi 10 di `getProducts` non sono raggiungibili |

I prodotti restituiti da `getCollection` hanno tutti i campi di `getProducts` (descrizione, `media.images`, `availability`, `sale_price`, `is_hidden`…): normalizzazione, parser, prezzi e immagini sono invariati.

Il prodotto di riferimento **"Haricot rouge petite graines"** è stato letto (collezione «Haricots / Koki»): descrizione "4 paquets de 500g", prezzo `12000` → **12,00 €**, 4 confezioni da 500 g (2000 g), **minimo 4 inferito** (`MIN_INFERRED_FROM_PACKAGE_COUNT`, `PRICE_MODEL_UNKNOWN`), `requires_review`, nessun prezzo unitario derivato: esattamente il risultato atteso dal brief iniziale.

Il primo tentativo di `getCollections` con `collectionLimit: 50` ha restituito HTTP 500 dal provider (*"write EPROTO … SSL routines … packet length too long"*); con `collectionLimit: 10` (valore della documentazione) la stessa richiesta è riuscita. Il connettore usa 10.

### 1.2 Prima lettura dalla console e restrizione WhatsApp (8/10/2026, notte)

- La prima «Actualiser» in produzione (sorgente su `chloefood`) si è fermata dopo `getProducts` con `PROVIDER_ERROR` sulle collezioni: lettura troncata, nessun prodotto marcato «retiré», messaggio del provider allora non visibile in console.
- Una chiamata diagnostica isolata a `getCollections` ha poi risposto HTTP 200 ma in **5,7 s**; una lettura reale a riprese (solo provider, nessuna scrittura) ha misurato **latenza media 3,1 s, massima 10,8 s** per chiamata: le ~23 chiamate di questo catalogo non stanno nei 45 s di una sola richiesta Vercel. Da qui la **lettura a riprese** (§2).
- La stessa lettura ha ricevuto da `getCollections` **HTTP 500 *"Commerce Features Disabled Error: Commerce features are not available."*** (due volte, a un secondo di distanza), mentre `getProducts` funzionava. È una **restrizione temporanea di WhatsApp sulle funzioni catalogo del numero** dopo molte letture ravvicinate nella giornata (sonde, prove, console), come avverte la documentazione GREEN-API. Il connettore la riconosce (`CATALOG_RESTRICTED`), non la ritenta e la mostra in console; letture sospese finché non rientra.

**Scostamenti fra documentazione GREEN-API e risposta reale** (corretti nel connettore, coperti da test):
1. **Scala del prezzo: millesimi (÷1000), non ÷100.** `"10000"` = 10,00 € per "3 paquets de 500g"; con ÷100 sarebbero 100 €. Coerente con `priceAmount1000` di WhatsApp.
2. **Disponibilità** nel campo `availability` (doc: `product_availability`), valore `IN_STOCK`.
3. **`sale_price`** è un oggetto `{ price, start_date, end_date }`, non una stringa → esposto come `sale_price` separato, mai al posto di `displayed_price`.
4. **`max_available`** vale 99 per tutti i prodotti: limite fisso, non uno stock.
5. Il link `wa.me/c/<id>` contiene **l'ID del catalogo, non il numero**: `getProducts` con `191701838729307@c.us` risponde 400 *"'chatId': invalid phone number"*. Il numero del venditore va fornito con `--chat-id`.

Lettura precedente (stesso giorno) senza credenziali: `AUTH_MISSING`, flusso interrotto senza dati simulati.

---

## 2. Provider: GREEN-API (verificato sulla documentazione ufficiale)

| Metodo | Uso | Note dalla doc |
|---|---|---|
| `GET {apiUrl}/waInstance{id}/getStateInstance/{token}` | Diagnosi sessione | `stateInstance`: `authorized`, `notAuthorized`, `blocked`, `sleepMode`, `starting`, `yellowCard`, `suspended` |
| `POST {apiUrl}/waInstance{id}/getProducts/{token}` `{ chatId, productLimit? }` | Prima pagina del catalogo | Non richiede account Business per chi legge; **istanza autorizzata obbligatoria**. Risposta `{ paging: { after }, products: [...] }`. `price`: la doc indica unità minima (÷100), il dato reale è in millesimi (÷1000), §1. **Al massimo 10 prodotti, nessuna pagina successiva.** |
| `POST {apiUrl}/waInstance{id}/getCollections/{token}` `{ chatId, collectionLimit?, productLimit?, afterCollectionId? }` | Elenco collezioni | Cursore `afterCollectionId` = `paging.after` precedente: **verificato**. `collectionLimit` 10 (50 → HTTP 500 del provider), `productLimit` 3 (anteprima, non usata). |
| `POST {apiUrl}/waInstance{id}/getCollection/{token}` `{ chatId, collectionId, productLimit?, afterProduct? }` | Prodotti di una collezione | Cursore `afterProduct` = `paging.after` precedente: **verificato**. `productLimit` 10. Prodotti con tutti i campi di `getProducts`. |

Campi prodotto usati: `id`, `name`, `description`, `price`, `sale_price` (oggetto `{ price, … }`), `currency`, `retailer_id`, `is_hidden`, `availability` (fallback `product_availability` della doc), `url`, `media.images[].{id, original_image_url, request_image_url}`.

Strategia di lettura (`fetchProducts`):
1. `getProducts` (prima pagina: l'unica che vede anche i prodotti fuori dalle collezioni);
2. se `paging.after` non è vuoto, tutte le pagine di `getCollections` (`afterCollectionId`) e, per ogni collezione, tutte le pagine di `getCollection` (`afterProduct`);
3. deduplica per ID prodotto (vince la prima occorrenza), appartenenza alle collezioni conservata (`RawExternalProduct.collections`), provenienza di ogni prodotto (`rawRef.page` → pagina con `method`, `collectionId`, `cursor`).

Cursori validati (`validCursor`: stringa base64/base64url, max 4096 caratteri): cursore vuoto = fine; non valido → `CURSOR_INVALID`, ripetuto → `CURSOR_REPEATED`, lettura interrotta. Richieste in sequenza con pausa (CLI 1000 ms, console 800 ms). Un solo nuovo tentativo (console) su 429/499/500/502/503/504, che coprono i 5xx transitori come *"write EPROTO"*; **mai** sulla restrizione *"Commerce Features Disabled"* (`CATALOG_RESTRICTED`). Un errore sulle collezioni non perde i prodotti di `getProducts` (`COLLECTIONS_FAILED` / `CATALOG_RESTRICTED`, con l'estratto redatto della risposta del provider).

**Lettura a riprese (console).** Ogni «Actualiser» è una sequenza di blocchi: ogni blocco dura al massimo 40 s o 40 richieste (route Vercel da 60 s), registra subito i prodotti letti (`external_catalog_record_fetch`, sempre `truncated` finché non è l'ultimo) e, se resta da leggere, restituisce un punto di ripresa (`CatalogReadResume`: cursore dell'elenco, ID delle collezioni, indice e cursore della collezione in corso). Il browser lo rimanda con `startedAt` al blocco successivo e mostra l'avanzamento. Il server rivalida tutto (`parseReadResume`: cursori, ID numerici, indici coerenti, max 30 blocchi, `startedAt` di meno di 30 min). Il primo blocco controlla l'istanza e legge `getProducts`; i successivi riprendono direttamente dalle collezioni. Tutti i blocchi registrano con la stessa data d'inizio: il riepilogo finale (prodotti unici, fuori collezione) è calcolato dal database su `last_seen_at ≥ startedAt`, quindi senza doppi conteggi fra blocchi. Limite noto: se un prodotto compare in collezioni lette in blocchi diversi, il suo `raw.collections` conserva l'ultima.

**Completezza** (`ReadCompleteness`):

| Valore | Quando | Effetto |
|---|---|---|
| `complete` | `getProducts` senza pagine successive | i prodotti assenti possono essere marcati «retiré» |
| `partial` | tutte le collezioni lette fino al cursore vuoto, ma `getProducts` aveva altre pagine | mai «retiré»: possono esistere prodotti fuori dalle collezioni (`READ_PARTIAL`, con il numero di prodotti fuori collezione fra i primi 10) |
| `truncated` | interruzione: budget, tempo, limite di 500 prodotti, errore, cursore anomalo, collezioni disattivate (`--no-collections`) | mai «retiré» (`READ_TRUNCATED`, `PAGINATION_UNSUPPORTED`) |

Limiti che condizionano il connettore:
- **`getProducts` non pagina** (verificato l'8/10/2026): al massimo **10 prodotti** anche con `productLimit: 100`/`500`; il cursore `after` è rifiutato con HTTP 400 *"Validation failed. Details: 'after' is not allowed"*. Nessuno degli SDK ufficiali GREEN-API (Python, JS, Go, PHP, MCP gateway) implementa `getProducts`. I prodotti fuori dalle collezioni oltre i primi 10 restano irraggiungibili (richiesta al supporto: §2.1).
- **Rate limiting**: WhatsApp può limitare temporaneamente l'API cataloghi su chiamate frequenti. Nessun parallelismo; backoff su 429/499/502/503 con `Retry-After` (max 30 s, 3 tentativi).
- **Errori comuni**: 401/403 → `AUTH_INVALID`; 466 → `QUOTA_EXCEEDED` (limite del piano); 400 "not authorized" → `INSTANCE_NOT_AUTHORIZED`; altri 400 → `CATALOG_UNAVAILABLE`.
- **`getContactInfo`** espone anch'esso `products` (con `imageUrls.original/requested`) ma senza valuta: non usato.

Il connettore conosce **solo** `getStateInstance`, `getProducts`, `getCollections` e `getCollection`, tutti in sola lettura (allow-list `ALLOWED_METHODS`): nessun metodo d'invio (`sendMessage`, `sendProduct`, `sendOrder`…) è raggiungibile.

### 2.1 Richiesta tecnica al supporto GREEN-API (da inviare)

> **Subject:** `getProducts` pagination: `paging.after` cursor cannot be sent back ("'after' is not allowed")
>
> Instance: Developer plan, instance ID available on request (not included here). Method: `POST {apiUrl}/waInstance{idInstance}/getProducts/{apiTokenInstance}`, seller `chatId` `<seller>@c.us` (WhatsApp Business account with a public catalog of ~100 products).
>
> 1. `{"chatId": "<seller>@c.us", "productLimit": 100}` → HTTP 200, **10 products**, `paging.after` non-empty. `productLimit` above 10 seems to be ignored.
> 2. `{"chatId": "<seller>@c.us", "productLimit": 100, "after": "<paging.after from 1>"}` → HTTP 400.
> 3. `{"chatId": "<seller>@c.us", "after": "test"}` → HTTP 400 `{"statusCode":400,"message":"Validation failed. Details: 'after' is not allowed"}`.
>
> Your documentation of GetProducts says to "pass this value in the next request" but lists only `chatId` and `productLimit`. `getCollections` (`afterCollectionId`) and `getCollection` (`afterProduct`) paginate correctly, but products that are not in any collection are only reachable through `getProducts`.
>
> Questions: (a) what is the request parameter name for the `getProducts` cursor? (b) what is the maximum `productLimit`? (c) is there any other documented method to list products that are not in a collection?
>
> Also observed: `getCollections` with `collectionLimit: 50` → HTTP 500 `write EPROTO … packet length too long`, while `collectionLimit: 10` works; and `price` is returned in thousandths (`"10000"` = 10.00 EUR), not hundredths as documented.

---

## 3. Mappa dei file

| File | Ruolo |
|---|---|
| `apps/storefront/src/lib/externalCatalog/types.ts` | Tipi provider-indipendenti, `ExternalCatalogProvider`, `QuantityExtractor` (estensione AI futura), errori tipizzati |
| `…/externalCatalog/sourceUrl.ts` | Parsing `wa.me/c/<numero>` → `chatId`; override `--chat-id` validato |
| `…/externalCatalog/providers/greenApi.ts` | Connettore GREEN-API: config da env, allow-list metodi, timeout, retry, mapping, redazione segreti |
| `…/externalCatalog/providers/index.ts` | Selezione da `WHATSAPP_CATALOG_PROVIDER` |
| `…/externalCatalog/quantityParser.ts` | Motore deterministico FR/IT/EN (§5) |
| `…/externalCatalog/normalizeProduct.ts` | Normalizzazione, prezzo, ponte `toLepefyQuantityRule` verso le regole esistenti |
| `…/externalCatalog/imageStaging.ts` | Download immagini in staging con protezione SSRF, MIME/dimensioni, deduplica sha256 |
| `…/externalCatalog/reviewDecisions.ts` | Schema zod delle decisioni di revisione (dato confermato) |
| `…/externalCatalog/report.ts` | Report JSON + HTML di revisione (escape sistematico, CSP) |
| `…/externalCatalog/artifacts.ts`, `localStore.ts` | Isolamento percorsi e I/O degli artefatti |
| `apps/storefront/scripts/catalog-whatsapp-test.ts` | CLI di recupero |
| `apps/storefront/scripts/catalog-whatsapp-review.ts` | Server di revisione locale (127.0.0.1) |
| `apps/storefront/scripts/ts-resolve-hooks.mjs` | Hook Node per eseguire i moduli TS col type stripping nativo (nessuna nuova dipendenza) |
| `apps/storefront/tests/unit/externalCatalog*.spec.ts` | 119 test unitari (di cui `externalCatalogCollections.spec.ts`: cursori, deduplica, provenienza, completezza, budget) |

I moduli di `lib/externalCatalog/` (tranne `server/`) non usano alias `@/` né Supabase/Next: girano identici nella CLI, nei test e nella console platform. La CLI non scrive mai in Supabase; tabelle, route e UI della console sono descritte al §12.

---

## 4. Modello dati: sorgente, inferenza, conferma

Tre livelli che non si sovrascrivono mai:

1. **Sorgente** — `raw/catalog.json` conserva le risposte integrali del provider; ogni prodotto normalizzato punta lì con `raw_data_reference { file, page, index }`.
2. **Inferenza** — `normalized/products.json` (`NormalizedExternalProduct`): `source_provider`, `source_catalog_id`, `source_product_id`, `source_url`, `original_name`, `normalized_name`, `original_description`, `displayed_price`, `sale_price`, `currency`, `images`, `product_availability`, `suggested_min_quantity`, `suggested_quantity_step`, `unit_format`, `package_count`, `package_total_weight`, `selling_model`, `extraction_confidence`, `review_reasons`, `requires_review`, `inference`, `raw_data_reference`. Un campo assente resta `null` con un motivo (`PRICE_MISSING`, `NO_DESCRIPTION`, `NO_IMAGE`, `CURRENCY_MISSING`…).
3. **Conferma** — `review/decisions.json`: per prodotto `min_quantity` + `min_quantity_confirmed`, `quantity_step` + `quantity_step_confirmed`, `price_model` (`per_lot | per_unit | unknown`) + `price_model_confirmed`, `status`, `note`. **Quantità minima e modello di prezzo si confermano separatamente.** Un nuovo parsing non sovrascrive mai una decisione salvata.

`displayed_price` è sempre e solo il prezzo mostrato. **Nessun prezzo unitario viene derivato.**

Integrazione con le regole Lepefy (`docs/PURCHASE_QUANTITY_RULES.md`): `toLepefyQuantityRule(decision)` produce `{ min_order_quantity, order_quantity_step }` **solo da valori confermati** (altrimenti 1/1) passando per `computeQuantityRuleState` di `lib/purchaseQuantityRules.ts`; il report mostra le prime quantità valide con lo stesso motore. Nessuna seconda logica commerciale. I gruppi combinabili non vengono proposti: l'appartenenza a un gruppo resta una scelta esplicita dell'admin.

---

## 5. Motore di interpretazione delle quantità

Deterministico (regex a fasi con mascheramento), nessun servizio esterno. Fasi: minimo esplicito → frasi di raggruppamento → conteggi strutturati → misure isolate. La descrizione è la fonte primaria; il nome solo se la descrizione non contiene segnali.

| Descrizione | `package_count` | `suggested_min_quantity` | `suggested_quantity_step` | `unit_format` | Motivi principali |
|---|---:|---:|---:|---|---|
| 4 paquets de 500g | 4 | 4 *(inferito)* | — | 500 g (tot. 2000 g) | `MIN_INFERRED_FROM_PACKAGE_COUNT`, `PRICE_MODEL_UNKNOWN` |
| Lot de 6 bouteilles 1L | 6 | 6 *(inferito)* | — | 1 L | idem |
| Minimum 2 pièces | — | 2 *(esplicito)* | — | — | `MIN_EXPLICIT` |
| Carton de 12 unités | 12 | 12 *(inferito)* | — | unità | `MIN_INFERRED_FROM_PACKAGE_COUNT` |
| Venduto in confezioni da 3 | 3 | **da verificare** | — | unità | `SALE_PACK_SIZE_AMBIGUOUS` |
| 1 kg | — | **non inferibile** | — | 1 kg | `NO_QUANTITY_SIGNAL` |
| 500g x 4 | 4 | 4 *(inferito)* | — | 500 g | `MIN_INFERRED_FROM_PACKAGE_COUNT` |
| Minimum 6, par lots de 3 | — | 6 | 3 | — | `MIN_EXPLICIT`, `STEP_EXPLICIT` |

Regole:
- un peso/volume da solo non produce mai un minimo (anche "minimum 500 g" → `MIN_IS_MEASURE`); un prezzo ("à partir de 12 €") non è un minimo;
- `package_count` (contenuto) e `suggested_min_quantity` (vincolo proposto) sono campi distinti: un minimo esplicito diverso dal conteggio vince ("Carton de 12 unités — minimum 2 cartons" → count 12, min 2);
- un solo imballo esterno dichiarato ("1 carton de Bobolo de 20 paquets") → 20 è il contenuto (`SINGLE_OUTER_PACKAGE`), nessun minimo; "a pack of 6" resta un lotto;
- uno step è proposto solo se accompagna un minimo esplicito; "par lots de 3"/"sold in packs of 4" da soli restano ambigui;
- quantità o formati in conflitto → nessun valore, affidabilità `low`;
- `extraction_confidence`: `high` (dicitura esplicita), `medium` (conteggio strutturato), `low` (ambiguo/conteggio nudo), `none` (nessun segnale).

Il caso "Haricot rouge petite graines" (`4 paquets de 500g`, 12,00 €) produce `suggested_min_quantity = 4` non confermato, `selling_model = requires_review`, `displayed_price = 12` e nessun prezzo per paquet.

Estensione futura: un estrattore AI implementa `QuantityExtractor` e restituisce la stessa `QuantityExtraction`; può solo proporre, mai confermare. Non implementato. Limiti noti: numeri in lettere ("deux paquets") non riconosciuti.

---

## 6. Immagini

- URL originale preferito; anteprima (`request_image_url`) solo come ripiego, marcata `variant: 'preview'`.
- Protezione SSRF: solo `https`, porta 443, niente credenziali né IP letterali, host in allow-list (`fbcdn.net`, `whatsapp.net`, `cdninstagram.com`, `facebook.com`; override `WHATSAPP_CATALOG_IMAGE_HOSTS`), tutti gli indirizzi DNS devono essere pubblici, redirect manuali (max 3) rivalidati. Rischio residuo: DNS rebinding tra verifica e connessione, mitigato dall'allow-list di domini Meta.
- Tipo dai magic bytes (JPEG/PNG/WebP), max 15 MB, dimensioni 100–12 000 px via `sharp` (avviso sotto 600 px).
- 403/404/410 → `expired` (gli URL CDN Meta sono firmati e scadono: rilanciare la lettura).
- Deduplica sha256 tra prodotti e tra esecuzioni: `images/<sha256>.<ext>` + `images/manifest.json` con URL e metadati originali.
- Mai screenshot del catalogo come sostituto. Mai copia nello storage del tenant in questo ciclo.

---

## 7. Uso

```bash
pnpm catalog:whatsapp:test --url https://wa.me/c/191701838729307 --chat-id 393296958822@c.us   # default: --limit 500, collezioni lette
pnpm catalog:whatsapp:test --url … --no-collections   # solo getProducts (10 prodotti), 1 richiesta
pnpm catalog:whatsapp:test --url … --page-delay-ms 1500   # pausa fra le richieste di catalogo (min 500)
pnpm catalog:whatsapp:test --url … --dry-run          # nessuna scrittura su disco
pnpm catalog:whatsapp:test --url … --no-images        # nessun download immagini
pnpm catalog:whatsapp:test --url … --chat-id 393296958822@c.us   # numero del venditore (obbligatorio se il link contiene l'ID catalogo)
pnpm catalog:whatsapp:test --url … --chat-id … --from-raw         # rielabora l'ultima lettura reale, nessuna chiamata al provider
pnpm catalog:whatsapp:review                          # http://127.0.0.1:4317
```

Variabili (in `apps/storefront/.env.local`, caricato con `--env-file-if-exists`):

```env
WHATSAPP_CATALOG_PROVIDER=green_api
GREEN_API_URL=https://<host>.api.greenapi.com   # apiUrl dell'istanza, solo domini green-api.com / greenapi.com
GREEN_API_INSTANCE_ID=
GREEN_API_TOKEN=
WHATSAPP_CATALOG_IMAGE_HOSTS=                   # opzionale, suffissi separati da virgola
```

Output (sotto `artifacts/whatsapp-catalog/`, ignorato da git):

```text
raw/catalog.json            risposte integrali del provider
normalized/products.json    prodotti normalizzati
images/<sha256>.<ext>       staging immagini + images/manifest.json
review/decisions.json       correzioni della revisione (solo locale)
report.json                 riepilogo + diagnostica
report.html                 revisione (apribile anche come file: il salvataggio scarica decisions.json)
```

`--from-raw` rilegge `raw/catalog.json` (solo se è una lettura reale GREEN-API dello stesso chatId) e rigenera normalizzazione, staging e report: utile dopo una modifica del parser senza consumare la quota né rischiare il rate limit.

Codici di uscita: `0` successo, `2` accesso al catalogo fallito (report di diagnosi scritto), `3` catalogo vuoto, `1` uso/errore interno. Ogni esecuzione è ripetibile: riscrive raw/normalized/report, conserva immagini (dedupe) e decisioni. `--out` deve restare sotto `artifacts/whatsapp-catalog/`.

Requisiti: Node ≥ 22.18 / 23.6 (type stripping; verificato con Node 24.20).

---

## 8. Sicurezza

- Token e id istanza mai stampati né scritti: `redactSecrets` su log, errori e ogni artefatto; nella config vengono nominate solo le **variabili** mancanti.
- `GREEN_API_URL` limitato ai domini GREEN-API in https: una config errata non può inviare il token altrove.
- Report HTML: ogni contenuto esterno escapato, JSON inline con `<`/`>`/`&` escapati, CSP `default-src 'none'`, immagini solo locali.
- Server di revisione: bind `127.0.0.1`, verifica `Host` (anti DNS-rebinding), POST solo `application/json` same-origin (nessun header CORS), corpo ≤ 1 MB, decisioni validate con zod e limitate ai prodotti presenti, immagini servite solo per nome sha256.
- Nessun accesso a Supabase, allo storage o ai prodotti esistenti.

---

## 9. Limitazioni per l'uso in produzione

1. **Client non ufficiale**: GREEN-API opera tramite una sessione WhatsApp (Web) di un account Lepefy. Le condizioni d'uso WhatsApp vietano accessi automatizzati non autorizzati: rischio di blocco del numero, nessuna garanzia contrattuale né SLA Meta. La via ufficiale (Commerce/Catalog API Meta) richiede che sia il venditore a concedere l'accesso al proprio catalogo.
2. **Diritti sui contenuti**: testi e foto appartengono al venditore; serve un consenso scritto prima di pubblicarli o copiarli nello storage di un tenant.
3. **Completezza non garantita**: i prodotti in collezione sono tutti leggibili (`getCollection`), ma quelli fuori da ogni collezione solo se compaiono fra i primi 10 di `getProducts`, che non pagina (§2). Una lettura di un catalogo con più di 10 prodotti è al massimo `partial`. Una lettura completa costa 1 + pagine di collezioni + pagine di prodotti richieste (23 per il catalogo di test).
4. **Formato del provider non conforme alla sua documentazione** (scala del prezzo, nomi di campo, §1): va ricontrollato a ogni aggiornamento GREEN-API.
5. **Rate limit** WhatsApp e quote del piano GREEN-API (466; *Developer* = 3 chat/mese, ogni venditore è una chat): niente sincronizzazioni frequenti.
6. **URL immagine firmati** che scadono.
7. **Numero del venditore** necessario: il link `wa.me/c/` da solo non basta.
8. Nessuna persistenza di provenienza, deduplica, audit o approvazione: tutto resta locale.

Dati non recuperabili dal catalogo: modello di prezzo, stock reale (solo `availability`; `max_available` = 99 fisso), peso di spedizione, ingredienti/allergeni/origine, categorie Lepefy (le collezioni del venditore sono lette e conservate su ogni prodotto, non mappate alle categorie del tenant), prodotti fuori collezione oltre i primi 10.

---

## 10. Cicli futuri (non implementati)

Sincronizzazione programmata (oggi solo «Actualiser» manuale), prodotti fuori collezione oltre i primi 10 (dipende dalla risposta del supporto GREEN-API, §2.1), proposta di categoria Lepefy a partire dalle collezioni del venditore, lettura «a riprese» per cataloghi che superano il budget di 45 s di una richiesta, notifica al tenant dei prezzi cambiati, provider ufficiale Meta (Commerce/Catalog API con accesso concesso dal venditore). Sorgenti per tenant, provenienza, deduplica, rilevamento modifiche, approvazione, audit e consenso sono nella console platform (§12).

## 11. Test

```bash
cd apps/storefront && pnpm test:unit -- tests/unit/externalCatalog
```

Coprono: catalogo accessibile (risposta simulata con la forma documentata), credenziali mancanti/rifiutate, istanza non autorizzata/bloccata, catalogo inesistente (400), risposta vuota o non conforme, paginazione (cursore non documentato, limite), duplicati e prodotti senza id, prodotti senza descrizione/immagine, prezzi assenti o non validi, parser FR/IT/EN, minimo vs contenuto, step ≠ minimo, ambiguità, deduplica immagini, SSRF/redirect/MIME/dimensioni/URL scaduti, isolamento artefatti, escape HTML, protezione del token. **Questi test usano dati d'esempio e non costituiscono una lettura reale del catalogo** (i casi "reali" riprendono solo i testi letti il 8/10/2026).

Console platform: `tests/unit/externalCatalogPlatform.spec.ts` (prezzo unitario, sconto, arrotondamenti, promo, valori proposti, hash del contenuto, numero del venditore, validazione zod, errori RPC, navigazione e flag) e `supabase/tests/149_external_catalog_import.test.sql` (privilegi/RLS, stati dopo lettura completa/troncata, consenso obbligatorio, creazione inattiva idempotente, validazioni, isolamento tenant su categoria e prodotto, doppio collegamento, foto, scarto/ripristino, cancellazione del prodotto).

---

## 12. Console platform: `/admin/platform/catalogues-whatsapp` (migration 149)

### 12.1 Regole di business

- **Solo platform owner**: `platform/layout.tsx` + `requirePlatformOwner` su ogni route `/api/admin/platform/external-catalogs/**`; le scritture con `Origin` diversa sono rifiutate.
- **Tenant di destinazione esplicito**: ogni sorgente è legata a un tenant; lettura e applicazione richiedono il flag di rilascio `external_catalog_import` **su quel tenant** (403 altrimenti). Le API catalogo del tenant, legate a `NEXT_PUBLIC_TENANT_SLUG`, non sono usate.
- **Consenso del venditore**: `consent_status = granted` con una prova scritta (`consent_note`, almeno 5 caratteri) è obbligatorio per applicare. La lettura resta possibile senza consenso.
- **Numero del venditore obbligatorio**: il link `wa.me/c/…` contiene l'ID del catalogo; il chatId GREEN-API è ricavato dal numero (`sellerChatIdFromPhone`, libphonenumber).
- **Prezzo**: il prezzo WhatsApp è il totale per la quantità minima, il prezzo Lepefy è unitario.

  ```text
  prezzo unitario = (prezzo lotto ÷ quantità minima) × (1 − sconto %), arrotondato al centesimo
  ```

  `lib/externalCatalog/pricing.ts` (`computeUnitPrice`, interi centesimi × punti base, nessun float). Sconto di default per sorgente (0–90 %), modificabile per prodotto; arrotondamento al centesimo più vicino, superiore o inferiore; lo scarto (10 € ÷ 3 → 3,33 € → lotto 9,99 €) è sempre mostrato. Si parte dal prezzo pieno; la promozione WhatsApp (`sale_price`) solo se scelta esplicitamente. Il prezzo resta modificabile a mano.
- **Applicazione campo per campo**: nome, descrizione, prezzo unitario, quantità minima, incremento, peso unitario (solo da un peso, mai da un volume), quantità netta, categoria, foto. In aggiornamento sono pre-spuntati solo i campi diversi dal prodotto attuale. Un prodotto **creato** nasce **inattivo, stock 0**, con slug univoco, barcode ed embedding come dal catalogo admin; si attiva dall'admin del tenant.
- **Collegamento**: un item WhatsApp è collegato al più a un prodotto Lepefy e viceversa (`product_already_linked`); un item già collegato non può creare un secondo prodotto (`item_already_linked`).
- **Foto**: scaricate dal CDN WhatsApp con le protezioni anti-SSRF di `imageStaging.ts`, ridimensionate a 1600 px come l'upload admin, caricate in `assets/tenants/<tenant>/products/<product>/wa-<sha256>.<ext>`, accodate alla galleria (8 al massimo, senza duplicati).
- **Cache**: l'applicazione invalida la cache catalogo del deployment corrente; lo storefront del tenant (altro progetto Vercel) mostra la modifica entro il TTL (60–300 s). Prezzo e stock dei prodotti sono comunque letti sempre freschi.

### 12.2 Stati di un prodotto WhatsApp

| Stato | Significato |
|---|---|
| `new` | letto, mai applicato |
| `linked` | applicato; il contenuto WhatsApp non è cambiato dall'ultima applicazione |
| `changed` | collegato, ma il contenuto (nome, descrizione, prezzi, disponibilità, foto) è cambiato; `previous_price` conserva il prezzo precedente |
| `unavailable` | assente da una lettura **completa** (una lettura troncata non marca nulla) |
| `dismissed` | scartato manualmente; resta scartato alle letture successive finché non viene ripristinato |

### 12.3 Schema (migration 149)

| Oggetto | Ruolo |
|---|---|
| `external_catalog_sources` | venditore → tenant: link, chatId, sconto, consenso, ultima lettura. Unique `(tenant_id, provider, seller_chat_id)` |
| `external_catalog_items` | un prodotto per sorgente: `raw`, `normalized`, `content_hash`, prezzi, stato, `linked_product_id` (FK composita verso `products`, `on delete set null (linked_product_id)`) |
| `external_catalog_events` | audit append-only: `fetched`, `created`, `updated` (valori prima/dopo per campo), `images_applied`, `dismissed`, `restored`; `request_key` univoca per tenant |
| `external_catalog_record_fetch` | registra una lettura e ricalcola gli stati (transazione, lock sulla sorgente) |
| `external_catalog_apply_item` | crea o aggiorna il prodotto, collega, audita; idempotente per `request_key`; campi ammessi in lista chiusa |
| `external_catalog_attach_images` | accoda le foto già caricate (solo percorsi del tenant e del prodotto) |
| `external_catalog_set_item_status` | scarto e ripristino |

RLS attiva e forzata **senza policy**; nessun privilegio per `anon`/`authenticated`; `service_role` senza DELETE, audit senza UPDATE. La **150** concede a `service_role` l'EXECUTE sulle funzioni di supporto (`external_catalog_text`, `external_catalog_int`, `external_catalog_unique_slug`): senza, ogni RPC fallisce con «permission denied for function external_catalog_text» (difetto della 149 visto alla prima prova reale). I test SQL ora girano **come `service_role`**. Errori `raise exception '<code>'` → messaggi francesi in `lib/externalCatalog/server/errors.ts`. I test SQL girano in CI (Postgres 16); **non sono stati eseguiti in locale** (nessun Postgres sulla macchina di sviluppo).

### 12.4 File

| File | Ruolo |
|---|---|
| `app/admin/(protected)/platform/catalogues-whatsapp/` | `SourcesClient` (sorgenti e creazione), `[sourceId]/SourceClient` (lettura, consenso, sconto, filtri per stato), `[sourceId]/[itemId]/ItemClient` (confronto, calcolo prezzo, applicazione, storico) |
| `app/api/admin/platform/external-catalogs/**` | `GET/POST /`, `GET/PATCH /[sourceId]`, `POST /[sourceId]/refresh`, `GET /[sourceId]/products?q=`, `GET /items/[itemId]`, `POST /items/[itemId]/apply`, `POST /items/[itemId]/status` |
| `lib/externalCatalog/server/repository.ts` | accesso dati, lettura GREEN-API, copia foto, barcode ed embedding, invalidazione cache |
| `lib/externalCatalog/server/{validation,errors,routeGuard}.ts` | zod, messaggi, guardia platform owner |
| `lib/externalCatalog/{pricing,proposalFormat,contentHash,sellerPhone}.ts` | funzioni pure, testate |
| `app/admin/_components/platformNavConfig.ts` | voce «Catalogues WhatsApp» (anche card nella console) |
| `lib/featureFlags/featureFlagRegistry.ts` | flag `external_catalog_import` |

### 12.5 Messa in servizio (da fare, previa approvazione)

1. Applicare `149_external_catalog_import.sql` (fatto l'8/10/2026, verificato: tabelle presenti, `anon` rifiutato) e `150_external_catalog_import_grants.sql` (solo GRANT, applicata l'8/10/2026 e verificata: prima lettura registrata e prodotto di prova creato su `lepefy-test`).
2. Impostare sul progetto Vercel da cui si usa la console platform `GREEN_API_URL`, `GREEN_API_INSTANCE_ID`, `GREEN_API_TOKEN` (e, se serve, `WHATSAPP_CATALOG_IMAGE_HOSTS`). Nessun segreto in DB.
3. Accendere `external_catalog_import` **solo su `lepefy-test`** (`/admin/parametres/fonctionnalites` di quel tenant).
4. Creare la sorgente (numero `+39 329 695 8822`), registrare il consenso, «Actualiser», applicare uno o due prodotti, controllare il prodotto inattivo e le foto nell'admin di `lepefy-test`.
5. Solo dopo valutare altri tenant (mai Chloe Food senza approvazione esplicita).

### 12.6 Troubleshooting

| Sintomo | Causa e azione |
|---|---|
| «Module indisponible : la migration 149…» (503) | migration non applicata |
| «Erreur inattendue» su lettura/applicazione, log `permission denied for function external_catalog_text` | migration 150 non applicata |
| «Import désactivé pour ce tenant» (403) | flag `external_catalog_import` spento sul tenant |
| «Catalogue introuvable pour ce numéro» | chatId errato: usare il numero del venditore, non l'ID del link |
| «L'instance GREEN-API n'est plus connectée» | rescansionare il QR nella console GREEN-API |
| «Quota du forfait GREEN-API épuisé» | piano Developer: 3 chat al mese |
| «WhatsApp limite temporairement les fonctions catalogue de ce numéro» (`CATALOG_RESTRICTED`, HTTP 500 *Commerce Features Disabled*) | troppe letture ravvicinate: attendere qualche ora, una sola «Actualiser» per volta |
| «Lecture interrompue : … HTTP 500 (write EPROTO …)» | errore transitorio del provider già ritentato una volta: rilanciare più tardi |
| «Reprise de lecture invalide ou expirée» | blocco successivo arrivato dopo più di 30 min o stato manomesso: rilanciare «Actualiser» |
| Foto «non récupérées» | URL CDN scaduti: «Actualiser» la sorgente e riapplicare le sole foto |
| Modifica non visibile sullo storefront | TTL della cache del deployment del tenant (al massimo 300 s) |
