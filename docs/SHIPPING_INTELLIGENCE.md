# Shipping Intelligence — documentazione tecnica e operativa

> **Modulo:** Admin → Livraison / Shipping Intelligence
> **Repository:** `lepefy-labs/lepefy-food-platform`
> **Base codice verificata:** `main@8fb8563a897b701d37bf3c609d7647a5919c1c13`
> **Ultima verifica:** 23 settembre 2026
> **Schema di base:** `supabase/migrations/119_shipping_intelligence_foundation.sql` + `120_shipping_postal_code_index.sql` (V1E senza migration)
>
> Questo documento descrive lo **stato corrente** del modulo. Il codice rimane la source of truth.
> Quando il modulo viene modificato, questo file deve essere aggiornato nello stesso delivery unit/commit secondo `AGENTS.md`.

---

## 1. Scopo

Shipping Intelligence aggiunge a Lepefy una base dati logistica riutilizzabile, separata dal prezzo di spedizione mostrato al cliente.

Gli obiettivi correnti sono:

1. costruire un dataset di quotazioni di spedizione;
2. confrontare profili di imballaggio;
3. eseguire campagne di simulazione Packlink su pesi, imballaggi e destinazioni;
4. supportare il tenant nella preparazione di una spedizione reale tramite stime storiche;
5. analizzare forfait/tariffe commerciali senza attivarli automaticamente nel checkout;
6. mantenere il modello provider-neutral a livello dati anche se Packlink è oggi il provider implementato.

Il modulo è **decision support**, non è un sostituto del preventivo live del provider.

---

## 2. Confini architetturali

Il sistema distingue tre responsabilità.

### 2.1 Provider logistico

Il provider logistico gestisce il costo operativo corrente e, dove previsto, la spedizione/tracking.

Provider attuale:

```text
packlink
```

La logica reale di checkout continua a usare il flusso shipping esistente e non è stata sostituita da Shipping Intelligence.

### 2.2 Pricing cliente

Le regole cliente correnti restano separate:

- `shipping_country_rules`;
- `tenants.shipping_provider`;
- `packaging_surcharges`;
- flusso `/api/shipping/quote`.

I record di `shipping_tariff_drafts` sono solo bozze di analisi.

**Invariante:** il checkout non legge `shipping_tariff_drafts`.

### 2.3 Shipping Intelligence

Comprende:

- profili di imballaggio;
- zone logistiche tenant;
- osservazioni di costo provider;
- campagne di simulazione;
- stima per similarità;
- storico aggregato;
- laboratorio tariffario.

---

## 3. Navigazione Admin

`Admin → Livraison` contiene attualmente sette superfici:

| Tab | Route | Responsabilità |
|---|---|---|
| Tarification | `/admin/livraison` | regole paese esistenti + zone logistiche |
| Emballages | `/admin/livraison/emballages` | catalogo profili di imballaggio |
| Laboratoire | `/admin/livraison/laboratoire` | test rapido Packlink + campagne |
| Assistant expédition | `/admin/livraison/assistant` | stima deterministica dallo storico |
| Historique des coûts | `/admin/livraison/historique` | aggregati delle osservazioni |
| Analyse tarifaire | `/admin/livraison/analyse-tarifaire` | bozze e retrotest forfait |
| Diagnostic Packlink | `/admin/livraison/diagnostic-packlink` | diagnostica provider esistente |

Source:
`apps/storefront/src/app/admin/(protected)/livraison/LivraisonTabs.tsx`.

---

## 4. Modello dati

La migration `119_shipping_intelligence_foundation.sql` introduce cinque aree logiche, distribuite su sei tabelle.

### 4.1 `shipping_packaging_profiles`

Catalogo dei colli realmente disponibili al tenant per laboratorio e assistente.

Campi principali:

- `tenant_id`;
- `name`;
- `box_length_cm`;
- `box_width_cm`;
- `box_height_cm`;
- `max_weight_g`;
- `is_default`;
- `active`;
- `position`.

Al momento **non sostituisce** `packaging_surcharges` nel checkout.

La migration crea un profilo iniziale `Standard` derivato dalla configurazione `packaging_surcharges` attiva.

### 4.2 `shipping_zones`

Zone commerciali/logistiche definite dal tenant tramite prefissi CAP.

Campi principali:

- `tenant_id`;
- `code`;
- `country`;
- `postal_prefixes[]`;
- `active`;
- `position`.

Esempio concettuale:

```text
IT_SICILY
country = IT
postal_prefixes = [...]
```

La piattaforma non dichiara questi mapping come geografia ufficiale: sono configurazione tenant.

### 4.3 `shipping_quote_observations`

Dataset provider-neutral di osservazioni.

Campi principali:

- provider;
- source;
- origine;
- destinazione;
- zona;
- numero colli;
- dimensioni/peso colli;
- peso totale;
- profilo imballaggio;
- carrier/service;
- costo base;
- tasse;
- costo provider totale;
- eligibility;
- exclusion reason;
- timestamp;
- `request_hash`.

Valori `source`:

```text
synthetic_simulation
real_quote
real_shipment
```

Stato corrente:

- `synthetic_simulation` è popolato dalle campagne;
- `real_quote` può essere usato da quotazioni reali dove integrato;
- `real_shipment` è previsto dallo schema ma non è ancora alimentato con un costo finale consuntivo autonomo.

**Non vengono persistiti API key o payload provider raw.**

### 4.4 `shipping_simulation_campaigns`

Testata campagna.

State machine:

```text
draft
  ↓
queued
  ↓
running
  ↓
completed
  └→ completed_with_errors

draft/queued/running
  └→ cancelled
```

Contiene:

- matrice scenario;
- limiti concorrenza;
- contatori;
- autore;
- timestamp start/end/cancel.

### 4.5 `shipping_simulation_campaign_items`

Un record per scenario effettivo:

```text
peso × profilo × destinazione/CAP
```

Status:

```text
pending
running
succeeded
failed
skipped_duplicate
```

Semantica corrente:

- `succeeded` = nuova chiamata Packlink con osservazione operativa (`observation_id`);
- `skipped_duplicate` = riuso valido di un preventivo strettamente identico e fresco (nessuna nuova chiamata, `observation_id` = osservazione riusata);
- `failed` = nessuna quotazione utilizzabile, con codice in `error` (§12.1).

Gli item creati prima della V1E possono contenere `skipped_duplicate` per zona/tolleranza: la copertura li riclassifica (§13.2).

La persistenza per item rende le campagne riprendibili.

### 4.6 `shipping_tariff_drafts`

Bozze di pricing cliente usate solo per analisi.

Contiene:

- bande peso;
- surcharge per zona;
- strategia multi-collo;
- note;
- stato draft/archive.

Non è sorgente del prezzo checkout.

---

## 5. Origine logistica usata nelle simulazioni

La campagna usa oggi:

```text
country = IT
zip_code = 42122
```

definita in:

`apps/storefront/src/lib/shipping/intelligence/quoteScenario.ts`

come `INTELLIGENCE_FROM_ADDRESS`.

Questa origine deve restare coerente con il flusso shipping reale finché non viene introdotta una sorgente configurabile condivisa.

---

## 6. Profili di imballaggio

L'admin gestisce i profili da:

`/admin/livraison/emballages`

API principali:

```text
GET/POST /api/admin/shipping-packaging-profiles
.../[id]
```

Uso attuale:

- generazione scenari;
- numero di colli;
- dimensioni inviate a Packlink;
- filtro di similarità;
- confronto costo per profilo.

### Limite funzionale

Lepefy conosce il peso degli ordini ma non dispone ancora, in modo generalizzato, di dimensioni 3D prodotto sufficienti per un vero bin packing.

Quindi:

```text
profilo suggerito = ottimizzazione costo spedizione
profilo suggerito ≠ garanzia che tutti i prodotti entrino fisicamente nella scatola
```

---

## 7. Destinazioni: città → CAP della commune (disambiguata)

Nel Laboratoire l'admin può scegliere una città. Il contesto geografico (paese + codici amministrativi) è conservato lungo tutto il percorso:

```text
ricerca → scelta commune → risoluzione CAP → creazione campagna
```

Flusso corrente:

```text
Paese + testo città
        ↓
indice interno GeoNames (migration 120)          → candidati con admin_code1/admin_code2 esatti (source 'index')
   └ se vuoto: Nominatim / OpenStreetMap          → candidati con codici ISO 3166-2 (source 'nominatim')
        ↓
risoluzione CAP della commune scelta
   index     : righe con stesso nome normalizzato, raggruppate per (admin_code1, admin_code2)
   nominatim : stessi gruppi, selezionati per codice ISO (livello 2 → poi livello 1)
   repli rete: Zippopotam.us (già circoscritto per codice di stato) → GeoNames API (stesso raggruppamento)
        ↓
resolved   → CAP di UNA sola commune + codici amministrativi
ambiguous  → elenco delle communes omonime da scegliere esplicitamente (o CAP manuale)
not_found  → CAP manuale
        ↓
un destination scenario per ogni CAP (city, adminCode1, adminCode2, adminName salvati nella matrice)
```

Implementazione:

- `postalCityLookup.ts` (`groupByAdministration`, `resolveAdministrativeGroup`, ricerca e repli rete);
- `GET /api/admin/shipping-simulation-campaigns/city-postal-codes` (`mode=search|resolve`, `exact=1` + `adminCode1/adminCode2` per un candidato dell'indice o un'opzione di disambiguazione, altrimenti `stateCodes`);
- `CampaignDestinationPicker.tsx` (scelta disambiguata quando la risposta è `ambiguous`).

### 7.1 Convenzioni di codici differenti

Nominatim e GeoNames non usano sempre gli stessi codici:

| Paese | Nominatim (ISO 3166-2) | GeoNames `admin_code1` | GeoNames `admin_code2` |
|---|---|---|---|
| IT | regione `IT-25`, provincia `IT-MI` | regione `09` | provincia `MI` |
| FR | regione `FR-ARA`, dipartimento `FR-69` | regione INSEE `84` | dipartimento `69` |
| DE / CH | Land/Cantone `DE-BY` / `CH-ZH` | `BY` / `ZH` | distretto |

Regole:

1. si confronta prima il **livello 2** (provincia/dipartimento), poi il livello 1 — evita collisioni di numerazione (es. FR: regione INSEE `11` ≠ dipartimento `11`);
2. se nessun codice concorda, la commune è accettata **solo** se è l'unica di quel nome nel paese (`matchedBy = unique_place`);
3. altrimenti la risposta è `ambiguous`: **i CAP di communes distinte non vengono mai uniti**.

### 7.2 Codici postali

- sempre stringhe: gli zeri iniziali (`00118`, `01000`) sono preservati dal DB fino alla richiesta Packlink;
- normalizzazione unica `normalizePostalCode()` (trim + maiuscole), mai conversione numerica;
- un CAP condiviso da più communes produce **un solo** scenario (il preventivo dipende dal CAP), con il contesto della prima selezione.

### 7.3 Completezza

L'interfaccia mostra «N code(s) postal(aux) connu(s) pour cette commune — exhaustivité non garantie». L'API restituisce `completeness: 'unverified'`: il dataset non permette di dimostrare che una commune possieda esattamente quei CAP ufficiali. L'import GeoNames non viene rieseguito né sovrascritto da questo flusso.

### 7.4 Limite operativo

In caso di mancata risoluzione l'utente continua con il CAP manuale. Non considerare il servizio geografico autorevole per pricing o checkout. Le città GeoNames suddivise per arrondissement (es. `Lyon 01`…`Lyon 09`, `Paris 01`…) sono communes distinte nell'indice e non vengono raggruppate automaticamente.

---

## 8. Risoluzione zone automatica

`Zone automatique` viene risolta server-side al momento della creazione campagna.

Algoritmo:

1. filtra `shipping_zones` per tenant, paese e `active=true`;
2. confronta il CAP con `postal_prefixes`;
3. se esistono più match, usa il prefisso più lungo/specifico;
4. se non esiste match, `zoneCode = null`.

Implementazione:

`apps/storefront/src/lib/shipping/intelligence/resolveZone.ts`.

L'admin può forzare una zona esplicita; il server verifica che la zona appartenga al tenant e al paese corretto.

---

## 9. Matrice di campagna e campionamento progressivo

La matrice è deterministica:

```text
Σ(profili) pesi(profilo) × destinations (CAP espansi) = total_scenarios
```

Per profilo, i pesi sono `scenario_matrix.weightsByProfileId[profileId]` quando presenti, altrimenti `weightsKg` (campagne storiche e modalità manuale).

### 9.1 Modalità (`scenario_matrix.samplingMode`)

| Modalità | UI | Pesi per profilo di capacità M kg |
|---|---|---|
| `initial` (default) | Couverture initiale | `1, 3, M/2, M−0,5, M+0,5, 2M` → M=15: `1 · 3 · 7,5 · 14,5 · 15,5 · 30` |
| `deep` | Analyse approfondie | per ogni soglia `1, 2, 3, 5, 10, 20` (fasce corriere) e `M, 2M, 3M` (passaggio a 2/3 colli): `t−δ, t, t+δ` (δ = 0,25 sotto 5 kg, altrimenti 0,5), fino a 3M+1 kg → 27 pesi per M=15 |
| `manual` | Poids manuels | pesi inseriti, applicati a ogni profilo |
| `resample` | Remesure | sottoinsieme esplicito di item (non prodotto cartesiano), vedi §13.4 |

Motivazione della Couverture initiale: colli leggeri (prime fasce corriere), metà capacità, l'ultimo peso che sta in un collo, il primo che ne richiede due (il salto di costo più frequente), due colli pieni.

I pesi dei preset sono **ricalcolati dal server** a partire da `max_weight_g` dei profili del tenant (`weightPresets.ts`); il client invia solo la modalità. L'anteprima client usa la stessa funzione pura.

L'Analyse approfondie richiede `confirmDeepAnalysis: true` (casella di conferma con il numero massimo di chiamate Packlink): non parte mai implicitamente. La matrice completa storica (37 pesi) non viene più applicata per default.

### 9.2 Limite

```text
2000 scenari per campagna (MAX_CAMPAIGN_SCENARIOS)
```

Quando la selezione supera il limite, la UI:

- mostra `CAP × scenari per CAP (profilo: n pesi + …) = totale`;
- propone «Passer en Couverture initiale (N scénarios)» se la modalità è più pesante;
- propone una **suddivisione deterministica** (`splitDestinationsForLimit`): CAP ordinati per paese e codice, parti contigue di dimensione bilanciata ≤ 2000, lanciate **una per una** («Lancer la partie k»), con nome `… (partie k/N)` e `scenario_matrix.part`;
- non rimuove mai silenziosamente CAP o profili. Se un solo CAP supera già il limite, chiede di ridurre pesi/profili.

Il server rivalida con lo stesso messaggio (`validateScenarioMatrix`).

Implementazione: `scenarioMatrix.ts`, `weightPresets.ts`, `CampaignManager.tsx`, `POST /api/admin/shipping-simulation-campaigns`.

### 9.3 Couverture par zone (CAP témoins)

**Constatazione sui dati (23/09/2026, 2.887 scenari, 77 CAP):** a parità di peso e imballaggio il preventivo Packlink è identico al centesimo su tutti i CAP della stessa zona (80/80 gruppi) e anche tra Lombardia ed Emilia. Il prezzo dipende da fasce di peso, dimensioni del collo e poche zone speciali (isole, Calabria, laguna, isole minori, extra-doganali). Coprire tutti i CAP non aggiunge informazione.

Nel form «Nouvelle campagne», la scheda **«Par zone (CAP témoins)»** (`ZoneSentinelPicker.tsx`) sostituisce la scelta per città/CAP:

- `GET /api/admin/shipping-simulation-campaigns/zone-sentinels?country=IT&perZone=1..3[&includeUnzoned=1]` (sola lettura, nessuna chiamata Packlink) legge tutto l'indice GeoNames del paese (paginato), le zone attive del tenant e i CAP già rifiutati da Packlink;
- `planZoneSentinels` (`zoneSentinels.ts`, puro e deterministico): assegna ogni CAP alla zona col prefisso più specifico; esclude i **CAP generici pre-riforma** (IT: finisce in «00» e la stessa radice a 3 cifre ha altri CAP, es. 40100 ↔ 40121; 21100 Varese resta valido) e i CAP rifiutati; per ogni CAP usa come nome la località con più CAP (la città, non la frazione);
- CAP campione: **1° = CAP mediano della città principale della zona**, i successivi distribuiti tra le altre località (periferia, dove possono comparire supplementi «località disagiate»);
- l'admin vede per zona: CAP campione, CAP noti, esclusi (generici/rifiutati), e sceglie le zone da includere; le destinazioni risultanti portano il proprio `zoneCode`; la matrice registra `destinationMode = zone_sentinels` e `sentinelsPerZone`.

Ordine di grandezza: 23 zone × 2 CAP × 36 scenari (Couverture initiale, 6 profili) ≈ 1.650 scenari; in Analyse approfondie si usa la suddivisione in parti (§9.2). Una zona senza CAP nell'indice (es. IT_EXTRA_CUSTOMS: Livigno 23041, Campione 22061) va misurata con il CAP manuale.

---

## 10. Worker di campagna

### 10.1 Scheduler n8n (primario) e fallback GitHub

Il worker applicativo resta l'endpoint esistente:

`POST /api/internal/shipping-campaign-worker`

Il workflow n8n importabile è:

`ops/n8n/shipping-campaign-worker.json`

Contiene un `Schedule Trigger` ogni cinque minuti, un trigger manuale di test, una `HTTP Request` POST e una verifica del risultato che fallisce se `ok !== true` oppure `failed > 0`. La chiamata ha timeout 55 secondi e massimo due tentativi HTTP con intervallo di 15 secondi. In caso di fallimento, n8n registra un'esecuzione fallita: collegare un Error Workflow/alert ai canali già usati dal tenant.

**Stato:** n8n su Hetzner è lo scheduler primario (ogni cinque minuti, credenziale dedicata `SHIPPING_CAMPAIGN_SCHEDULER_TOKEN`). La repository variable `SHIPPING_CAMPAIGN_N8N_ACTIVE=true` è configurata (verificata il 22 settembre 2026: i job schedulati GitHub risultano `skipped`); GitHub Actions resta disponibile come fallback manuale (`workflow_dispatch`).

**Contratto della risposta:** `{ ok, processed, succeeded, skipped, failed, rejected }`. `failed` conta **solo gli incidenti di esecuzione** (Packlink indisponibile/429/credential, persistenza, eccezioni) ed è l'unico contatore che fa fallire il nodo n8n `Check batch outcome` (`shipping_campaign_batch_failed`) e il fallback GitHub. Gli scenari chiusi per una ragione di dato (CAP rifiutato da Packlink, nessun servizio / nessun servizio eleggibile, profilo eliminato) sono in `rejected`: restano `failed` nella campagna ma non segnalano un guasto. Il template n8n non richiede modifiche.

L'endpoint accetta `SHIPPING_CAMPAIGN_SCHEDULER_TOKEN` con confronto a tempo costante. Durante la transizione mantiene anche l'autenticazione legacy via `SUPABASE_SERVICE_ROLE_KEY` per il fallback GitHub. Non inserire la service-role key in n8n.

`.github/workflows/shipping-campaign-worker.yml` mantiene il trigger schedule ma salta i job schedulati finché `SHIPPING_CAMPAIGN_N8N_ACTIVE = true`; `workflow_dispatch` resta eseguibile. La rimozione definitiva del trigger schedule GitHub è una modifica dedicata, da fare una volta stabilizzato n8n.

### 10.2 Batch e capacità

Il cron legacy chiama `scripts/process-shipping-campaign-worker.mjs`; n8n chiama direttamente l'endpoint HTTP applicativo. Nessuno dei due implementa il business logic delle campagne.

Il worker `runCampaignBatch.ts` elabora fino a **40 scenari per tick** (scheduler e `Traiter maintenant`), con **3 chiamate Packlink simultanee per invocazione** e un **budget di 30 secondi** (`TICK_TIME_BUDGET_MS`) oltre il quale non reclama più item: quelli non reclamati restano `pending` per il tick successivo. Con il timeout di 20 s di una chiamata Packlink (`packlinkQuote.ts`) un tick resta sotto ~50 s, entro il timeout HTTP n8n (55 s) e `maxDuration` Vercel (60 s). I riusi (nessuna chiamata) sono rapidi, quindi un tick ne elabora in genere molti di più delle nuove quotazioni. `Traiter maintenant` mantiene il cooldown da dieci secondi. `STALE_RUNNING_ITEM_MS` è pari a dieci minuti. Il claim compare-and-set `pending → running` evita l'elaborazione concorrente dello stesso item; scheduler e trigger manuale simultanei possono comunque sommare il parallelismo verso Packlink.

### 10.3 Tenant admin

L'admin mantiene `Lancer la campagne`, `Traiter maintenant` e `Annuler`. L'endpoint manuale `POST /api/admin/shipping-simulation-campaigns/:id/process` usa autenticazione admin e capability `shipping.manage`, senza esporre il token dello scheduler.

---

## 11. Identità delle richieste, equivalenza e riuso

### 11.1 Identità effettiva

Una richiesta provider è identificata da ciò che viene realmente inviato a Packlink (`requestIdentity.ts`, `buildScenarioRequest`):

- tenant (filtro di ogni lettura) e provider;
- origine (`INTELLIGENCE_FROM_ADDRESS`);
- paese e **CAP** di destinazione (normalizzato, zeri preservati);
- numero di colli;
- peso di ogni collo (`splitIntoParcels`) e dimensioni del profilo;
- finestra di freschezza (`scenario_matrix.freshnessWindowDays`, default 30 giorni).

`request_hash` (`requestHash.ts`) = SHA-256 troncato a 32 caratteri di provider, origine, destinazione, numero colli e colli ordinati. Non include il tenant: tenant_id è sempre filtrato separatamente.

La **zona commerciale non fa parte dell'identità**: due CAP della stessa zona sono due richieste diverse.

### 11.2 Riuso nel worker

Prima di chiamare Packlink, `findReusableObservation()` (`equivalence.ts`):

1. legge le osservazioni `tenant_id = tenant AND request_hash = hash AND eligible AND observed_at ≥ now − freshness` (filtro in DB prima del limite, max 200 righe);
2. rivaluta ogni riga con `compareObservationToRequest()` (tenant, provider, origine, paese, CAP, peso totale, numero colli, colli esatti): un hash coincidente con dati divergenti è scartato;
3. raggruppa le righe per esecuzione e restituisce l'osservazione operativa dell'esecuzione valida più recente (§12).

Se trovata: `item.status = skipped_duplicate`, `observation_id` = osservazione operativa riusata. **Non** è una nuova chiamata Packlink, ma è una quotazione valida per quel CAP.

Nessuna tolleranza di peso/volume e nessuna sostituzione con la zona nel riuso di campagna. Le tolleranze restano nell'Assistant expédition (§16.1), dove il risultato è esplicitamente una stima.

### 11.3 Dati storici

Prima della V1E il worker considerava equivalente un'osservazione della stessa zona (anziché dello stesso CAP) con peso ±5 % (min ±250 g) e volume ±10 %. Questi item `skipped_duplicate` storici **non vengono né cancellati né corretti**: la copertura li classifica (§13.2) ed esclude quelli incompatibili. La remesure (§13.4) permette di rimisurarli in modo esplicito.

---

## 12. Quotazione e costo operativo

`quoteScenarioAndPersist()` (`quoteScenario.ts`):

1. costruisce la richiesta con `buildScenarioRequest()` (stessa identità del riuso);
2. invia a Packlink peso e dimensioni per collo;
3. riceve tutti i servizi e applica le regole di eligibility del shipping core (`isEligibleService`/`getExclusionReason`);
4. salva **una riga per servizio ricevuto**, eleggibile o no, con motivo di esclusione — le alternative restano disponibili per l'analisi per corriere/servizio;
5. designa **una sola osservazione operativa** (`chooseOperationalOffer`, `operationalObservation.ts`):

```text
costo operativo = base_price + tax_price   (= total_provider_cost)
osservazione scelta = servizio ELEGGIBILE con costo operativo minimo
spareggio: base_price, poi id servizio
```

Un servizio non eleggibile non viene mai scelto, anche se più economico. Il costo operativo è un **preventivo**, non il costo finale di una spedizione acquistata.

**IVA:** Packlink restituisce `tax_price = 0` (verificato: 0 osservazioni su 43.141 con taxe > 0): `total_provider_cost` è quindi di fatto **HT**. Il checkout aggiunge la TVA del paese (`shipping_vat_rates`). Historique e Assistant mostrano i costi con l'indicazione «HT»; il rétrotest li converte in TTC (§18.4).

### 12.1 Esiti espliciti

| Esito | Offerte persistite | Item | Conta come |
|---|---|---|---|
| `ok` (osservazione scelta) | sì | `succeeded` + `observation_id` | nuova quotazione valida |
| riuso valido (§11.2) | no | `skipped_duplicate` + `observation_id` | quotazione valida, non nuova chiamata |
| `provider_error` (rete, timeout, 5xx, 429, 401/403, JSON invalido) | no | `failed`, `error = provider_error` | incidente (fa fallire il tick) |
| `provider_rejected` (HTTP 400/404/422) | no | `failed`, `error = provider_rejected` | dato: destinazione rifiutata |
| CAP già rifiutato (≥ 2 pesi distinti rifiutati nel tenant entro la finestra di freschezza) | no, **nessuna chiamata** | `failed`, `error = provider_rejected_known_destination` | dato |
| `no_service` (0 servizi) | no | `failed`, `error = no_service` | dato |
| `no_eligible_service` | sì (con motivi) | `failed`, `error = no_eligible_service`, `observation_id = null` | dato — mai un falso successo |
| `persistence_error` | no | `failed`, `error = persistence_error: …` | incidente |
| `chosen_observation_missing` | sì | `failed` | incidente |
| profilo eliminato | no | `failed`, `error = packaging_profile_not_found` | dato |

La chiamata del laboratorio passa da `packlinkQuote.ts` (`requestPacklinkServices`), che conserva lo stato HTTP; il flusso reale/checkout continua a usare `fetchAllPacklinkServices` invariato (da `calculateShipping.ts` è stata solo esportata la costante `PACKLINK_API_BASE`). Casi osservati il 23/09/2026: i CAP generici pre-riforma presenti in GeoNames (`29100`, `40100`, `41100`, `42100`, `43100`, …) ricevono 400 da Packlink, mentre i CAP in vigore (es. `41121`) restituiscono i servizi.

### 12.2 Esecuzioni e campioni

Tutte le offerte di una chiamata Packlink sono inserite con una sola istruzione e condividono quindi `observed_at`. Un'**esecuzione** = `(request_hash, observed_at)`; la sua osservazione operativa è ricalcolata dalle righe eleggibili (`groupQuoteExecutions`). Questo vale anche per le righe storiche (anche quelle scelte, prima della V1E, sul solo prezzo base) e per il Test rapide, senza nuove colonne.

Il Test rapide (simulatore admin) conserva la propria logica di scelta allineata al checkout reale per la risposta mostrata; le sue offerte persistite sono rivalutate con la regola operativa quando entrano in Historique/Assistant/rétrotest.

---

## 13. Copertura verificabile per CAP

Route: `/admin/livraison/laboratoire/:id` — API equivalente: `GET /api/admin/shipping-simulation-campaigns/:id`.

### 13.1 Caricamento

`campaignData.ts`:

- `fetchCampaignItems()` legge **tutti** gli item con `.range()` a pagine di 1000 su ordine stabile (`created_at`, `id`) e filtro `tenant_id` + `campaign_id` — mai un `SELECT` implicitamente troncato a 1000 righe;
- `fetchObservationsByIds()` rilegge le osservazioni collegate a lotti di 150 id, **sempre** con `tenant_id` (un'osservazione di un altro tenant risulta assente);
- una query profili tenant-scoped; nessuna query per CAP (niente N+1).

### 13.2 Classificazione degli item (`classifyCampaignItem`)

| Classe | Significato | Copre il CAP |
|---|---|---|
| `quoted` | `succeeded`, osservazione eleggibile di questa campagna/profilo, stesso paese, CAP e peso | sì |
| `reused_valid` | `skipped_duplicate`, osservazione strettamente identica alla richiesta dello scenario (§11.1) e fresca al momento del riuso | sì |
| `pending` / `running` | da elaborare / in elaborazione | no |
| `failed` | errore esplicito (§12.1), motivo in `reason` | no |
| `provider_rejected` | destinazione rifiutata da Packlink (`provider_rejected*`) | no |
| `reused_other_postal_code` | riuso storico di un preventivo di un **altro CAP** | no |
| `reused_incompatible` | riuso storico divergente (peso, colli, dimensioni, origine, non eleggibile) o scaduto | no |
| `observation_missing` | nessuna osservazione collegata o ritrovata nel tenant | no |
| `unverifiable` | coerenza non dimostrabile (profilo eliminato per un riuso, divergenza su un `succeeded`, altro tenant) | no |

Le ultime quattro classi sono «Données historiques incompatibles»: restano in produzione, ma non contribuiscono alla copertura.

### 13.3 Aggregazione (`computeCampaignCoverage`)

Per riga CAP × profilo: scenari previsti, nuove quotazioni, riusi validi, in attesa, in corso, falliti, incompatibili, pesi previsti/coperti/mancanti, range dei costi operativi coperti, data dell'ultima quotazione valida, stato:

```text
complete      tutti gli scenari hanno una quotazione valida (quoted | reused_valid)
incompatible  non completo e almeno un item storico incompatibile
rejected      nessuna quotazione valida e scenari rifiutati da Packlink
partial       almeno una quotazione valida
todo          nessuna quotazione valida
```

Un CAP è **completamente coperto** solo se tutte le sue righe profilo sono `complete`.

Vue d'ensemble: CAP previsti, CAP completi, nuove quotazioni (chiamate Packlink effettive), riusi validi, errori, scenari da elaborare, dettaglio degli incompatibili. Il numero di offerte restituite da Packlink non compare mai come numero di scenari misurati.

**Diagnostic des erreurs** (prima della remesure): `summary.errorBreakdown` raggruppa per motivo (`campaignErrorReasons.ts`) gli scenari senza quotazione valida — fallimenti e dati storici incompatibili — con etichetta, spiegazione, natura (Incident / Donnée / Historique), numero di scenari, CAP e pesi coinvolti, messaggio d'esempio per le eccezioni e l'indicazione «Inclus / Exclu de la remesure». Ogni riga CAP × profilo mostra anche i propri motivi (`reasons`). Le erreurs `packlink_error` anteriori alla distinzione incidente/rifiuto sono mostrate come «Erreur Packlink (antérieure au diagnostic détaillé)».

Tabella «Couverture par CAP»: filtri «À mesurer» (default quando esistono righe incomplete), «Incompatibles», «Complets», «Tous», ricerca CAP/città/zona/profilo; tabella su desktop, card su mobile. Stati: `Couverture complète`, `Couverture partielle`, `À compléter`, `Données historiques incompatibles`.

La colonna «Traités» della lista campagne resta `completed_scenarios/total_scenarios` (nuove quotazioni + riusi registrati dal worker): la copertura verificata è solo nel dettaglio.

### 13.4 Remesure

`POST /api/admin/shipping-simulation-campaigns/:id/resample` (`shipping.manage`), su conferma esplicita (`{ confirm: true }`) dal pulsante «Remesurer N scénario(s)»:

- disponibile solo a campagna terminata/annullata; rifiutata (409) se una remesure della stessa campagna è già `queued/running`;
- seleziona gli item il cui motivo è rimisurabile (`needsResample`): incidenti, errori storici ambigui, dati storici incompatibili, `no_service`; **esclude** i rifiuti deterministici (`provider_rejected*`, `no_eligible_service`, profilo eliminato); deduplica per CAP × profilo × peso;
- la conferma elenca motivi inclusi ed esclusi con i rispettivi conteggi;
- crea una campagna `Remesure — <nome>` con `samplingMode = resample`, `sourceCampaignId`, al massimo 2000 item in ordine deterministico (il resto è segnalato come `deferred`);
- non modifica né cancella i dati storici; il worker riusa un preventivo identico ancora fresco prima di chiamare Packlink.

Nessuna remesure viene avviata automaticamente.

---

## 14. Significato dei campioni statistici

Regole comuni a Historique, Assistant e rétrotest:

1. **una riga di offerta ≠ un campione**: le offerte alternative di una stessa esecuzione non sono estrazioni indipendenti;
2. per ogni esecuzione si considera l'osservazione operativa (§12);
3. per ogni scenario (`request_hash`) si considera **l'ultima esecuzione valida** (`latestValidPerScenario`): le esecuzioni più vecchie dello stesso scenario non aumentano il campione;
4. un item `skipped_duplicate` non crea osservazioni e quindi non è mai una misura indipendente;
5. le analisi per corriere (Assistant `byCarrier`) usano le alternative, ma contano al massimo un campione per scenario e per corriere (offerta più economica del corriere nell'esecuzione retenuta);
6. letture paginate (`pagedQuery.ts`): Historique fino a 20 000 offerte eleggibili, rétrotest fino a 30 000 offerte sintetiche + 10 000 ordini; l'eventuale troncamento è segnalato.

Popolazioni distinte e mai mescolate:

| Popolazione | Fonte | Natura |
|---|---|---|
| scenari sintetici | `shipping_quote_observations.source = synthetic_simulation` (campagne + Test rapide) | preventivi Packlink su una griglia uniforme |
| quotazioni reali | `orders.shipping_details.packlinkCost` | preventivo registrato al momento dell'ordine, non fattura |
| spedizioni con costo finale verificato | `source = real_shipment` | non alimentato: solo conteggiato |

---

## 15. Test rapido

Il blocco `Test rapide` nel Laboratoire riusa il simulatore Packlink esistente.

Differenza rispetto alla versione storica:

- il risultato non viene semplicemente mostrato e scartato;
- le osservazioni vengono persistite per alimentare lo storico.

Uso:

- controllo puntuale;
- verifica di un CAP specifico;
- confronto immediato;
- costruzione incrementale del dataset.

---

## 16. Assistant expédition

Route:

`/admin/livraison/assistant`

API:

```text
POST /api/admin/shipping-advisor
```

Input:

```json
{
  "weightKg": 13.4,
  "country": "IT",
  "postalCode": "20121"
}
```

Per ogni profilo attivo il sistema stima il costo usando solo osservazioni storiche.

**Non viene eseguita una nuova chiamata Packlink.**

### 16.1 Similarità

Implementazione:

`apps/storefront/src/lib/shipping/intelligence/similarity.ts`.

Vincoli principali:

- stesso tenant/provider/origine/paese;
- stesso numero colli;
- stesso profilo;
- peso entro ±15%;
- volume entro ±20%;
- **stessa zona, in modo stretto**: le zone attive del tenant sono passate alla stima e la zona di ogni osservazione è ricalcolata dal suo CAP (`selectZonePool`), anche per le osservazioni storiche senza `destination_zone_code`; una zona senza dati dà «dati insufficienti», mai i prezzi di un'altra zona (es. il continente per la Sicilia);
- massimo 1000 offerte candidate lette.

Queste tolleranze sono ammesse **solo** qui, perché il risultato è presentato come stima con dimensione del campione e confidence; il riuso di campagna (§11.2) non ne applica alcuna.

Il campione è costituito da **scenari misurati** (§14): per ogni `request_hash` l'osservazione operativa dell'ultima esecuzione valida. La scomposizione `byCarrier` conserva le alternative ma conta al massimo un campione per scenario e corriere. Nell'interfaccia la dimensione è indicata come «scén.».

### 16.2 Confidence

Livelli:

```text
insufficient_data
low
medium
high
```

Regole correnti:

- (sample = scenario misurato, non offerta)
- 0–1 sample → `insufficient_data`;
- ≥3 sample → almeno `medium`;
- ≥8 sample e osservazione più recente <60 giorni → `high`;
- casi intermedi → `low`.

Output:

- sample size;
- min;
- mediana;
- max;
- freshness;
- eventuale prossimo gradino osservato;
- profilo raccomandato sulla mediana più bassa tra quelli con dati sufficienti.

### 16.3 Prossimo gradino

Se esistono scenari più pesanti (osservazione operativa) con differenza costo ≥ €0,50 rispetto alla mediana corrente, il sistema può restituire:

```text
deltaKg
nextCost
```

Questo supporta il messaggio operativo “quanto peso posso ancora aggiungere prima di un cambio costo osservato”.

Non equivale a una garanzia tariffaria provider.

---

## 17. Historique des coûts

Route:

`/admin/livraison/historique`

L'interfaccia non mostra migliaia di righe raw.

`observationsSummary.ts` (`summarizeObservations` puro + `buildObservationsSummary`):

- legge fino a 20 000 offerte eleggibili (paginato);
- riduce a **scenari misurati** (§14);
- aggrega per zona (o paese) × profilo: scenari, CAP distinti, mediana, min, max, ultima osservazione;
- confidence aggregata sul numero di scenari: ≥8 high, ≥3 medium, altrimenti low.

Il meta della pagina mostra `N scénarios mesurés · M offres provider enregistrées`; il totale delle offerte è un `COUNT` separato sul dataset tenant.

---

## 18. Analyse tarifaire

Route:

`/admin/livraison/analyse-tarifaire`

Serve a valutare un forfait prima di qualsiasi integrazione checkout.

### 18.1 Bande

Una bozza contiene bande:

```text
minKg
maxKg | null
price
```

Esempio di partenza UI:

```text
0–10 kg  → €10,50
10–15 kg → €12,50
```

Sono valori di bozza, non configurazione cliente attiva.

### 18.2 Surcharge zone

Formato logico:

```text
zoneCode → importo
```

Esempio UI:

```text
IT_SICILY=2
```

### 18.3 Strategia multi-collo

Il modello supporta:

```text
weight_bands_whole_order
first_parcel_plus_discounted
flat_multi_parcel_rate
```

L'UI corrente non espone ancora tutte le varianti in modo completo.

### 18.4 Retrotest

Endpoint:

```text
POST /api/admin/shipping-tariff-drafts/:id/simulate
```

Restituisce popolazioni separate, mai mediate insieme:

```text
scenarioWeighted   + scenarioSample
orderWeighted      + orderSample
verifiedShipmentCosts (conteggio real_shipment)
```

**Base TTC e paese.** I brouillons sono prezzi cliente TTC: il costo confrontato è il devis Packlink **TTC** — `providerCostTtc`: TVA del paese di destinazione da `shipping_vat_rates` aggiunta quando Packlink non restituisce la taxe — e per gli ordini `packlinkCost + vatAmount` (`orderBacktestRows`). Scenari e ordini sono filtrati sul paese del rétrotest (body `{ country }`, default `IT`; la UI invia IT). I frais d'emballage par colis (`packaging_surcharges`) non sono inclusi nel confronto. Metriche: `maxLoss` = perdita più forte (≤ 0, 0 se nessuna), `minMargin` = margine più basso (mostrato in UI come «Marge minimale»). «Enregistrer et rétrotester» lancia ora davvero il rétrotest dopo il salvataggio.

`scenarioWeighted` usa **un'osservazione operativa per scenario misurato** (ultima quotazione valida, §14) tra le osservazioni `synthetic_simulation`. `buildScenarioBacktestSample()` restituisce anche:

- `scenarios` (dimensione reale del campione), `executions`, `offersRead`;
- `alternativeOffersExcluded`, `olderExecutionsExcluded`;
- `postalCodes`, `zones`, `countries`, `topPostalCodeShare`;
- zona di ogni scenario ricalcolata dal CAP con le zone attive del tenant (le maggiorazioni di zona si applicano anche alle osservazioni storiche senza zona salvata);
- `reliability` prudente (`assessScenarioReliability`): `insufficient` (< 30 scenari), `limited` (un CAP > 50 % del campione, oppure < 3 zone **e** < 10 CAP), altrimenti `indicative` — mai «élevée», perché la griglia è uniforme e non ponderata sulla domanda.

Metriche (per popolazione): sample size, preventivo medio, mediana, P90, P95, margine medio, % a perdita, perdita massima, margine cumulato.

Correttezza dell'interfaccia (`TariffLabClient.tsx`):

- scenari sintetici → «% de scénarios à perte», «Pire perte (1 scénario)»; ordini → «% de commandes à perte»;
- i costi sono etichettati «Devis Packlink», mai come fattura pagata;
- viene mostrato il blocco campione (scenari, CAP, zone, paesi, offerte alternative escluse, concentrazione);
- `orderWeighted` è considerato affidabile solo con almeno 30 ordini; lo storico ordini è utilizzabile solo quando `orders.shipping_details` contiene `packlinkCost` e `totalWeightG`.

Le tariffe restano bozze: nessuna attivazione nel checkout.

---

## 19. Sicurezza e tenant isolation

Regole obbligatorie:

- tutte le query intelligence devono essere `tenant_id` scoped, comprese le letture paginate (`.range()`) e per lotti di id (`.in('id', …)` sempre accompagnato da `tenant_id`);
- i costi provider interni non devono diventare pubblici;
- API admin passano dal sistema admin/capability esistente;
- letture operative usano `shipping.view`;
- mutazioni/campagne usano `shipping.manage`;
- il worker interno usa service-role bearer;
- non loggare secret, URL sensibili o payload provider raw;
- non indebolire RLS/grant esistenti.

Tabelle con costi/simulazioni non hanno policy pubbliche e sono pensate per accesso service-role/admin server-side.

---

## 20. Dipendenze esterne

### Packlink

Usato per:

- quotazioni live;
- servizi/carrier;
- dataset sintetico.

Packlink rimane la fonte autorevole per il prezzo operativo corrente.

### Indice GeoNames interno (`shipping_postal_code_index`)

Fonte primaria per ricerca commune e risoluzione CAP (import statico CC BY 4.0, §7). Questo modulo lo legge soltanto: nessun reimport o sovrascrittura massiva.

### Nominatim / OpenStreetMap

Repli per la ricerca città quando l'indice non contiene il paese/nome; fornisce codici ISO 3166-2 riconciliati con GeoNames secondo §7.1.

Non viene usato come fonte del prezzo.

### Zippopotam.us / GeoNames API

Repli rete per espandere una commune nei CAP conosciuti quando l'indice non la conosce; i risultati GeoNames sono raggruppati per commune come l'indice.

Fallback manuale obbligatorio quando il lookup non è disponibile, ambiguo o incompleto.

---

## 21. Invarianti da preservare

Qualsiasi modifica futura deve mantenere queste regole, salvo esplicita decisione architetturale approvata:

1. Shipping Intelligence non modifica il checkout implicitamente.
2. `shipping_tariff_drafts` non è letto dal checkout.
3. Una stima storica non viene presentata come prezzo provider garantito; un preventivo non viene presentato come fattura.
4. Una spedizione reale deve continuare a usare un dato provider corrente quando richiesto.
5. Nessun secret/provider raw payload viene persistito nel dataset intelligence.
6. Tenant isolation su ogni lettura/scrittura, incluse le letture paginate e per lotti di id.
7. Le campagne restano bounded e resumable.
8. Nessuna raffica API incontrollata dal browser; analisi approfondite, parti di una suddivisione e remesure partono solo su azione esplicita.
9. Cron e trigger admin possono convivere senza doppia elaborazione.
10. Il catalogo imballaggi intelligence non sostituisce automaticamente `packaging_surcharges`.
11. Il suggerimento scatola non costituisce validazione fisica 3D del contenuto.
12. La risoluzione città→CAP mantiene un fallback manuale e non unisce mai i CAP di communes omonime distinte.
13. `Zone automatique` deve essere risolta server-side, non fidandosi soltanto del client.
14. Il token n8n è dedicato, server-side e non viene pubblicato nel template o nel repository.
15. Un CAP è coperto soltanto da una quotazione valida della sua esatta destinazione e configurazione di colli (nuova o riusata da una richiesta strettamente identica e fresca); la zona non sostituisce mai il CAP.
16. Ogni scenario contribuisce una sola volta alle statistiche operative, indipendentemente dal numero di servizi restituiti da Packlink.
17. L'osservazione operativa è il servizio eleggibile con costo base + tasse minimo; nessun servizio eleggibile ⇒ nessuna quotazione utilizzabile.
18. I dati storici di produzione non vengono corretti o cancellati per migliorare la copertura: la copertura li classifica.
19. Nessuna lettura che deve essere esaustiva si affida a un `SELECT` limitato implicitamente da PostgREST (1000 righe).
20. Lo scheduler fallisce solo per incidenti di esecuzione; un rifiuto deterministico di Packlink è un dato, visibile nel diagnostic, e non viene richiamato né rimisurato automaticamente.
21. Una stima per zona non usa mai i prezzi di un'altra zona; la zona di un'osservazione si ricava dal suo CAP.

---

## 22. File map

### UI Admin

```text
apps/storefront/src/app/admin/(protected)/livraison/
  LivraisonTabs.tsx
  page.tsx
  ZonesSection.tsx
  emballages/
  laboratoire/
    page.tsx
    CampaignManager.tsx              modalità di campionamento, limite, suddivisione
    CampaignDestinationPicker.tsx    ricerca/disambiguazione commune
    ZoneSentinelPicker.tsx           Couverture par zone (CAP campione)
    PostalCodeIndexAdmin.tsx
    [id]/page.tsx                    Vue d'ensemble + couverture
    [id]/CampaignCoverageTable.tsx   Couverture par CAP (filtri, mobile)
    [id]/CampaignErrorDiagnostic.tsx Diagnostic des erreurs
    [id]/ResampleCampaignButton.tsx  remesure esplicita (motivi inclusi/esclusi)
  assistant/
  historique/
  analyse-tarifaire/
  diagnostic-packlink/
```

### API Admin

```text
apps/storefront/src/app/api/admin/
  shipping-simulator/
  shipping-packaging-profiles/
  shipping-zones/
  shipping-simulation-campaigns/
    route.ts                    GET lista / POST creazione (samplingMode, contesto città, destinationMode)
    zone-sentinels/route.ts     GET anteprima CAP campione per zona (sola lettura)
    city-postal-codes/route.ts  search / resolve (resolved | ambiguous)
    [id]/route.ts               GET copertura
    [id]/process/route.ts
    [id]/cancel/route.ts
    [id]/resample/route.ts      POST remesure
  shipping-postal-code-import/
  shipping-observations/summary/
  shipping-advisor/
  shipping-tariff-drafts/
```

### Intelligence core

```text
apps/storefront/src/lib/shipping/intelligence/
  requestIdentity.ts        identità richiesta, normalizePostalCode, confronto osservazione/richiesta
  requestHash.ts
  equivalence.ts            riuso stretto (pickReusableObservation / findReusableObservation)
  operationalObservation.ts costo operativo, esecuzioni, ultimo valido per scenario
  quoteScenario.ts          chiamata Packlink + persistenza + esiti espliciti
  runCampaignBatch.ts       worker
  campaignCoverage.ts       classificazione item + copertura CAP + diagnostic (puro)
  campaignErrorReasons.ts   catalogo motivi (etichetta, spiegazione, remesure sì/no)
  campaignOutcomes.ts       incidente vs dato, CAP già rifiutato
  zoneSentinels.ts          CAP campione per zona (generici esclusi, capoluogo + periferia)
  packlinkQuote.ts          chiamata Packlink del laboratorio con stato HTTP
  campaignData.ts           caricamento paginato/tenant-scoped della copertura
  pagedQuery.ts             paginazione .range() + chunk id
  scenarioMatrix.ts         matrice, limite, suddivisione deterministica
  weightPresets.ts          Couverture initiale / Analyse approfondie
  postalCityLookup.ts       disambiguazione geografica
  postalCodeImport.ts       import GeoNames (invariato)
  observationsSummary.ts
  similarity.ts
  tariffBacktest.ts         campione per scenario + affidabilità
  resolveZone.ts
  schedulerAuth.ts
  unzip.ts
```

### Test

```text
apps/storefront/tests/unit/shippingIntelligenceDataQuality.spec.ts
apps/storefront/tests/unit/helpers/fakeShippingSupabase.ts   (client in memoria con tetto 1000 righe + log tenant scope)
apps/storefront/tests/unit/shippingSchedulerAuth.spec.ts
```

### Worker

```text
.github/workflows/shipping-campaign-worker.yml
scripts/process-shipping-campaign-worker.mjs
ops/n8n/shipping-campaign-worker.json
apps/storefront/src/app/api/internal/shipping-campaign-worker/route.ts
```

### Schema / types

```text
supabase/migrations/119_shipping_intelligence_foundation.sql
supabase/migrations/120_shipping_postal_code_index.sql
packages/types/shippingIntelligence.ts   (ShippingScenarioMatrix: samplingMode, weightsByProfileId, part, sourceCampaignId; destinazione con city/adminCode1/adminCode2/adminName)
```

La V1E non introduce migration: i nuovi campi vivono nel JSON `scenario_matrix` e la semantica di esecuzione usa colonne esistenti (`request_hash`, `observed_at`).

### Shipping core correlato

```text
apps/storefront/src/lib/shipping/calculateShipping.ts
apps/storefront/src/lib/shipping/resolveCountryRule.ts
apps/storefront/src/app/api/shipping/quote/route.ts
apps/storefront/src/lib/auth/adminApiPermissions.ts
```

---

## 23. Configurazione operativa e rollback n8n

Questa procedura richiede accesso all'istanza **n8n self-hosted Hetzner**, al progetto storefront **Vercel** e alle variabili del repository **GitHub**. Non è eseguibile automaticamente dal solo repository.

**Preparazione senza interruzioni**

1. Generare un segreto casuale di almeno 32 byte con un gestore di password o generatore CSPRNG; non salvarlo nel repository, nella chat, nei log o nel JSON del workflow.
2. Impostare su Vercel, nell'ambiente Production dello storefront ChloeFood: `SHIPPING_CAMPAIGN_SCHEDULER_TOKEN` uguale al segreto. Applicare la configurazione a un deployment production aggiornato.
3. Importare `ops/n8n/shipping-campaign-worker.json` su n8n Hetzner. Nel nodo `Process shipping campaign batch`, selezionare una **nuova credenziale HTTP Request → Header Auth** con Nome `Authorization` e Valore `Bearer <segreto-generato>`. La credenziale non deve contenere `SUPABASE_SERVICE_ROLE_KEY`.
4. Verificare che l'URL dell'HTTP Request sia quello dello storefront corretto (il template pilota usa `https://shop.chloefood.com/api/internal/shipping-campaign-worker`). Ogni storefront/tenant richiede un workflow e una configurazione dedicati se il deployment è separato.
5. Lasciare il workflow n8n non pubblicato e GitHub scheduler attivo durante il test iniziale.

**Test e switch del primario**

6. Eseguire il nodo `Manual test` in n8n. Verificare HTTP 200, `ok: true` e il risultato del batch senza credenziali esposte. Un risultato `processed: 0` è valido se non esistono campagne in coda.
7. Pubblicare/attivare il workflow n8n con schedule ogni cinque minuti. Verificare almeno due esecuzioni automatiche consecutive senza errori e, se ci sono campagne attive, l'avanzamento reale degli item.
8. Nel repository GitHub, impostare la **repository variable** `SHIPPING_CAMPAIGN_N8N_ACTIVE=true`. Il job schedulato GitHub diventa skipped, mentre `workflow_dispatch` resta eseguibile manualmente.
9. Configurare n8n per inviare un alert quando il workflow fallisce; controllare la cronologia Executions e gli errori applicativi Vercel. Un workflow riuscito senza item elaborati non prova che siano state completate campagne specifiche.

**Rollback**

Se n8n si ferma o non esegue i job, impostare `SHIPPING_CAMPAIGN_N8N_ACTIVE=false` o cancellare la variabile GitHub; il job GitHub torna operativo sui successivi trigger. È sempre possibile avviare `workflow_dispatch` manualmente. Disattivare il workflow n8n prima di lasciare GitHub come unico scheduler. Grazie al claim CAS, un overlap transitorio non duplica lo stesso item, ma può aumentare la concorrenza provider.

**Sicurezza:** usare il token dedicato soltanto nella credenziale Header Auth n8n e nella env Vercel server-side. Non creare una env `NEXT_PUBLIC_*`, non passare il token come query parameter e non esportare le credenziali n8n insieme al workflow. La service-role key resta autorizzata dal vecchio endpoint soltanto per la compatibilità GitHub; valutare la sua rimozione dopo la stabilizzazione definitiva.

---

## 24. Troubleshooting

### Campagna resta queued

Controllare anzitutto che il workflow n8n sia pubblicato e riuscito (Executions) — è lo scheduler primario; la repository variable `SHIPPING_CAMPAIGN_N8N_ACTIVE=true` rende skipped i job schedulati GitHub. Controllare inoltre:

- tenant `shipping_provider = packlink`;
- API key Packlink disponibile;
- URL worker configurata;
- bearer dedicato valido;
- endpoint interno raggiungibile.

In emergenza: `workflow_dispatch` GitHub oppure `Traiter maintenant`.

### n8n: `shipping_campaign_batch_failed`

Il nodo `Check batch outcome` fallisce se `ok !== true` o se `failed > 0`. Dopo la distinzione incidente/dato, `failed` > 0 indica un incidente reale (Packlink 5xx/429/credential, persistenza, eccezione): controllare i log Vercel del worker e il «Diagnostic des erreurs» della campagna in corso. CAP rifiutati e scenari senza servizio eleggibile finiscono in `rejected` e non fanno fallire il workflow.

### CAP rifiutato da Packlink

Packlink risponde 400 per quel codice postale (spesso un CAP generico pre-riforma listato da GeoNames). Dopo due pesi rifiutati, gli altri scenari del CAP sono chiusi senza chiamate. Sostituirlo con i CAP in vigore in una nuova campagna; la remesure non lo include.

### `Traiter maintenant` restituisce 429

Comportamento atteso entro il cooldown manuale di 10 secondi. Lo scheduler continua comunque a funzionare.

### Molti `skipped_duplicate` / «Réemplois valides»

Esistono preventivi **strettamente identici** (stesso CAP, stessi colli) ancora freschi: nessuna chiamata Packlink è necessaria. Se l'obiettivo è una misura più recente, ridurre `freshnessWindowDays` invece di duplicare chiamate.

### Una campagna storica mostra «Données historiques incompatibles»

Sono riusi pre-V1E per zona/tolleranza di peso, osservazioni sparite o non verificabili. Non vengono corretti in DB. Per ottenere la copertura, usare «Remesurer N scénario(s)» a campagna terminata.

### Un CAP resta «Couverture partielle» a campagna terminata

Guardare i pesi «Manquants» e gli errori della riga: `no_eligible_service` (Packlink risponde solo con servizi dropoff/B2B per quel CAP/peso), `provider_error`, `no_service`. Rilanciare con la remesure; un `no_eligible_service` ricorrente è un'informazione logistica, non un bug.

### Il numero di scenari dell'Historique è molto inferiore al numero di offerte

Atteso: un preventivo Packlink restituisce più servizi, ma conta come un solo scenario misurato (§14).

### Rétrotest «Données insuffisantes» o «Couverture limitée»

Meno di 30 scenari distinti, meno di 10 CAP o un CAP che pesa oltre metà del campione. Ampliare la copertura geografica (Couverture initiale su più CAP) prima di trarre conclusioni nazionali.

### Assistant mostra dati insufficienti

La stima è per zona in modo stretto: se la zona del CAP richiesto non ha misure (es. Sicilia), lanciare una «Couverture par zone» che la includa.

Generare una campagna con stesso paese, CAP rappresentativi, pesi vicini, stesso profilo e numero colli coerente.

### Una città non restituisce CAP o propone più communes

`ambiguous`: scegliere la commune corretta (provincia/dipartimento). `not_found`: usare il CAP manuale. Non inventare CAP nel codice o nel client.

### Livigno / Campione d'Italia (IT_EXTRA_CUSTOMS)

Packlink non restituisce alcun servizio verso 23041 (Livigno) e 22061 (Campione d'Italia) da origine 42122 (campagna e preventivo live verificati il 23/09/2026). Nel checkout la consegna resta non disponibile (nessun `quoteToken`, `/api/checkout` rifiuta l'ordine con consegna); `/api/shipping/quote` mostra un messaggio esplicito «Livraison indisponible vers … (zone extra-douanière)», con il ritiro in negozio proposto solo se `click_collect_enabled` (`lib/shipping/extraCustomsTerritories.ts`). Un eventuale `flat_rate_override` sul paese IT salterebbe la chiamata Packlink e renderebbe questi CAP «disponibili»: da escludere prima di attivarlo.

### La selezione supera 2000 scenari

Passare alla Couverture initiale o lanciare le parti della suddivisione una per una.

### Costo storico diverso dal live Packlink

È normale: lo storico è decision support. Richiedere un preventivo provider live quando serve il prezzo corrente.

---

## 25. Limiti correnti e sviluppi futuri

Non ancora implementato:

- attivazione del pricing rule-based nel checkout;
- costi finali `real_shipment` acquisiti come consuntivo separato;
- true 3D bin-packing per prodotto;
- campionamento adattivo automatico dei soli punti di discontinuità (l'Analyse approfondie resta un preset esplicito);
- provider logistici multipli nel laboratorio;
- raggruppamento automatico delle città GeoNames suddivise per arrondissement;
- verifica di completezza ufficiale dei CAP di una commune;
- UI completa per tutte le strategie multi-collo;
- valutazione statistica avanzata per regione/corriere/SLA e distinzione di campioni temporali dello stesso scenario (oggi: ultima quotazione valida).

Limiti noti della V1E:

- il range di costo mostrato per un item storico `succeeded` usa l'osservazione collegata all'epoca (scelta sul prezzo base prima della V1E); Historique, Assistant e rétrotest ricalcolano invece l'osservazione operativa dall'esecuzione;
- gli item storici incompatibili restano nel DB finché non viene lanciata una remesure esplicita;
- la classificazione di un riuso storico confronta i colli con il profilo **corrente**: se il profilo è stato modificato dopo il riuso, l'item risulta `reused_incompatible`.

Qualsiasi passaggio del forfait dal laboratorio al checkout è un cambio money-impacting e richiede il normale approval gate critico previsto da `AGENTS.md`.

---

## 26. Contratto di manutenzione di questo documento

Questo file è documentazione **viva**.

Quando viene toccato qualunque elemento del perimetro Shipping Intelligence / Admin Livraison, l'agente deve:

1. leggere questo documento prima di pianificare la modifica;
2. verificare il comportamento sul codice reale;
3. aggiornare le sezioni interessate nello stesso delivery unit;
4. aggiornare `Base codice verificata` con lo SHA reale del branch letto durante DISCOVER; non tentare di inserire nel file lo SHA del commit che contiene il file stesso;
5. aggiornare `Ultima verifica`;
6. correggere contenuti diventati obsoleti, non accumulare cronologia di sessione;
7. aggiungere nuovi file/endpoints/tabelle al file map;
8. aggiornare invarianti, worker, API, schema, UX o troubleshooting quando cambiano;
9. mantenere allineato anche `LEPEFY_PROJECT_CONTEXT.md` quando il cambiamento soddisfa i criteri di manutenzione definiti in `AGENTS.md`.

Questo documento non sostituisce il codice né la migration history: serve a rendere l'architettura leggibile e mantenibile senza dover ricostruire ogni volta il modulo scavando fra quaranta file. Per una volta possiamo evitare di usare l'archeologia come metodologia di sviluppo.
