# Shipping Intelligence — documentazione tecnica e operativa

> **Modulo:** Admin → Livraison / Shipping Intelligence
> **Repository:** `lepefy-labs/lepefy-food-platform`
> **Base codice verificata:** `main@5ba18710bcdde340775641e235bb9bb55806aa83`
> **Ultima verifica:** 22 settembre 2026
> **Schema di base:** `supabase/migrations/119_shipping_intelligence_foundation.sql`
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

## 7. Destinazioni: città → tutti i CAP

Nel Laboratoire l'admin può scegliere una città.

Flusso corrente:

```text
Paese + testo città
        ↓
Nominatim / OpenStreetMap
        ↓
città disambiguata + codici amministrativi
        ↓
indice postale GeoNames interno (migration 120), se importato
        ↓
insieme dei CAP conosciuti della città
        ↓
un destination scenario per ogni CAP
```

Implementazione:

- `postalCityLookup.ts`;
- `/api/admin/shipping-simulation-campaigns/city-postal-codes`;
- `CampaignDestinationPicker.tsx`.

Fallback:

- CAP manuale sempre disponibile.

### Perché tutti i CAP

L'obiettivo non è rappresentare una città con un solo CAP arbitrario.

Ogni CAP genera uno scenario distinto per individuare:

- differenze di costo intra-città;
- eventuali discontinuità provider;
- copertura statistica più robusta.

### Limite operativo

La ricerca città usa Nominatim e, quando importato, l'indice GeoNames interno per il mapping CAP. In caso di mancata risoluzione, l'utente deve poter continuare con inserimento CAP manuale.

Non considerare il servizio geografico autorevole per pricing o checkout.

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

## 9. Matrice di campagna

La matrice è deterministica:

```text
weightsKg
× packagingProfileIds
× destinations (CAP espansi)
= total_scenarios
```

Esempio:

```text
17 pesi
× 1 profilo
× 25 CAP
= 425 scenari
```

Limite corrente:

```text
2000 scenari per campagna
```

I 37 pesi predefiniti UI sono densificati attorno a 10 kg e ai multipli di 15 kg per osservare possibili gradini tariffari.

Implementazione:

`apps/storefront/src/lib/shipping/intelligence/scenarioMatrix.ts`.

---

## 10. Worker di campagna

### 10.1 Scheduler n8n: adozione con cutover controllato

Il worker applicativo resta l'endpoint esistente:

`POST /api/internal/shipping-campaign-worker`

Il workflow n8n importabile è:

`ops/n8n/shipping-campaign-worker.json`

Contiene un `Schedule Trigger` ogni cinque minuti, un trigger manuale di test, una `HTTP Request` POST e una verifica del risultato che fallisce se `ok !== true` oppure `failed > 0`. La chiamata ha timeout 55 secondi e massimo due tentativi HTTP con intervallo di 15 secondi. In caso di fallimento, n8n registra un'esecuzione fallita: collegare un Error Workflow/alert ai canali già usati dal tenant.

**Stato del cutover:** il template e l'endpoint con bearer dedicato sono predisposti nel repository, ma l'istanza n8n e le sue credenziali devono essere configurate e il workflow pubblicato prima di cambiare lo scheduler primario. Non considerare n8n attivo sulla sola base di questo commit.

L'endpoint accetta `SHIPPING_CAMPAIGN_SCHEDULER_TOKEN` con confronto a tempo costante. Durante la transizione mantiene anche l'autenticazione legacy via `SUPABASE_SERVICE_ROLE_KEY` per il fallback GitHub. Non inserire la service-role key in n8n.

L'attuale `.github/workflows/shipping-campaign-worker.yml` continua a eseguire il cron finché la variabile GitHub `SHIPPING_CAMPAIGN_N8N_ACTIVE` non è `true`. Dopo avere verificato un'esecuzione manuale e due esecuzioni automatiche n8n riuscite, impostare quella variabile a `true` per saltare i job schedulati GitHub senza un deploy; `workflow_dispatch` resta disponibile per il recupero manuale. In seguito, rimuovere il trigger schedule GitHub con una modifica dedicata, una volta stabilizzato n8n.

### 10.2 Batch e capacità

Il cron legacy chiama `scripts/process-shipping-campaign-worker.mjs`; n8n chiama direttamente l'endpoint HTTP applicativo. Nessuno dei due implementa il business logic delle campagne.

Il worker `runCampaignBatch.ts` elabora otto scenari per tick schedulato, con due chiamate Packlink simultanee **per invocazione**; il pulsante admin `Traiter maintenant` usa un batch da venti scenari e cooldown da dieci secondi. `STALE_RUNNING_ITEM_MS` è pari a dieci minuti. Il claim compare-and-set `pending → running` evita l'elaborazione concorrente dello stesso item. Scheduler diversi simultanei possono comunque moltiplicare il parallelismo complessivo: effettuare il cutover tempestivamente.

### 10.3 Tenant admin

L'admin mantiene `Lancer la campagne`, `Traiter maintenant` e `Annuler`. L'endpoint manuale `POST /api/admin/shipping-simulation-campaigns/:id/process` usa autenticazione admin e capability `shipping.manage`, senza esporre il token dello scheduler.

---

## 11. Deduplicazione ed equivalenza

Prima di chiamare Packlink, il worker cerca un'osservazione recente equivalente.

Implementazione:

`apps/storefront/src/lib/shipping/intelligence/equivalence.ts`.

Criteri principali:

- stesso tenant;
- stesso provider;
- stessa origine;
- stesso paese destinazione;
- stessa zona quando disponibile, altrimenti CAP;
- stesso numero colli;
- peso entro ±5%, con tolleranza minima ±250 g;
- volume entro ±10%;
- osservazione dentro la freshness window.

Se trovata:

```text
item.status = skipped_duplicate
```

e viene riusata l'osservazione esistente.

Per scenari strettamente identici viene inoltre generato un `request_hash` SHA-256 troncato a 32 caratteri.

---

## 12. Quotazione e persistenza

`quoteScenarioAndPersist()`:

1. divide il peso totale in colli secondo `profile.max_weight_g`;
2. invia a Packlink peso e dimensioni per collo;
3. riceve tutti i servizi;
4. applica le stesse regole di eligibility usate dal shipping core;
5. salva una riga `shipping_quote_observations` per ogni servizio ricevuto;
6. identifica come osservazione scelta il servizio eleggibile più economico.

Questo è intenzionale: il dataset conserva anche alternative e servizi esclusi, non solo il vincitore.

---

## 13. Test rapido

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

## 14. Assistant expédition

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

### 14.1 Similarità

Implementazione:

`apps/storefront/src/lib/shipping/intelligence/similarity.ts`.

Vincoli principali:

- stesso tenant/provider/origine/paese;
- stesso numero colli;
- stesso profilo;
- peso entro ±15%;
- volume entro ±20%;
- preferenza per stessa zona quando disponibile;
- massimo 200 osservazioni candidate.

### 14.2 Confidence

Livelli:

```text
insufficient_data
low
medium
high
```

Regole correnti:

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

### 14.3 Prossimo gradino

Se esistono osservazioni più pesanti con differenza costo ≥ €0,50 rispetto alla mediana corrente, il sistema può restituire:

```text
deltaKg
nextCost
```

Questo supporta il messaggio operativo “quanto peso posso ancora aggiungere prima di un cambio costo osservato”.

Non equivale a una garanzia tariffaria provider.

---

## 15. Historique des coûts

Route:

`/admin/livraison/historique`

L'interfaccia non mostra migliaia di righe raw.

`observationsSummary.ts`:

- considera fino a 2000 osservazioni eleggibili recenti;
- aggrega per destinazione/zona e profilo;
- calcola mediana, min, max, sample size, ultima osservazione;
- assegna confidence aggregata:
  - ≥8 high;
  - ≥3 medium;
  - altrimenti low.

Il contatore totale viene calcolato separatamente sul dataset completo tenant.

---

## 16. Analyse tarifaire

Route:

`/admin/livraison/analyse-tarifaire`

Serve a valutare un forfait prima di qualsiasi integrazione checkout.

### 16.1 Bande

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

### 16.2 Surcharge zone

Formato logico:

```text
zoneCode → importo
```

Esempio UI:

```text
IT_SICILY=2
```

### 16.3 Strategia multi-collo

Il modello supporta:

```text
weight_bands_whole_order
first_parcel_plus_discounted
flat_multi_parcel_rate
```

L'UI corrente non espone ancora tutte le varianti in modo completo.

### 16.4 Retrotest

Endpoint:

```text
POST /api/admin/shipping-tariff-drafts/:id/simulate
```

Restituisce due popolazioni separate:

```text
scenarioWeighted
orderWeighted
```

Non vengono mai mediate insieme.

Metriche:

- sample size;
- costo provider medio;
- mediana;
- P90;
- P95;
- margine medio;
- % margine negativo;
- perdita massima osservata;
- margine aggregato.

`orderWeighted` è considerato affidabile solo con almeno 30 campioni.

Lo storico ordini è utilizzabile solo quando `orders.shipping_details` contiene dati compatibili come `packlinkCost` e `totalWeightG`.

---

## 17. Sicurezza e tenant isolation

Regole obbligatorie:

- tutte le query intelligence devono essere `tenant_id` scoped;
- i costi provider interni non devono diventare pubblici;
- API admin passano dal sistema admin/capability esistente;
- letture operative usano `shipping.view`;
- mutazioni/campagne usano `shipping.manage`;
- il worker interno usa service-role bearer;
- non loggare secret, URL sensibili o payload provider raw;
- non indebolire RLS/grant esistenti.

Tabelle con costi/simulazioni non hanno policy pubbliche e sono pensate per accesso service-role/admin server-side.

---

## 18. Dipendenze esterne

### Packlink

Usato per:

- quotazioni live;
- servizi/carrier;
- dataset sintetico.

Packlink rimane la fonte autorevole per il prezzo operativo corrente.

### Nominatim / OpenStreetMap

Usato per disambiguare la città scelta dall'admin.

Non viene usato come fonte del prezzo.

### Zippopotam.us / GeoNames

Usato per espandere una città nell'insieme dei CAP conosciuti.

Fallback manuale obbligatorio quando il lookup non è disponibile o incompleto.

---

## 19. Invarianti da preservare

Qualsiasi modifica futura deve mantenere queste regole, salvo esplicita decisione architetturale approvata:

1. Shipping Intelligence non modifica il checkout implicitamente.
2. `shipping_tariff_drafts` non è letto dal checkout.
3. Una stima storica non viene presentata come prezzo provider garantito.
4. Una spedizione reale deve continuare a usare un dato provider corrente quando richiesto.
5. Nessun secret/provider raw payload viene persistito nel dataset intelligence.
6. Tenant isolation su ogni lettura/scrittura.
7. Le campagne restano bounded e resumable.
8. Nessuna raffica API incontrollata dal browser.
9. Cron e trigger admin possono convivere senza doppia elaborazione.
10. Il catalogo imballaggi intelligence non sostituisce automaticamente `packaging_surcharges`.
11. Il suggerimento scatola non costituisce validazione fisica 3D del contenuto.
12. La risoluzione città→CAP deve mantenere un fallback manuale.
13. `Zone automatique` deve essere risolta server-side, non fidandosi soltanto del client.
14. Il token n8n è dedicato, server-side e non viene pubblicato nel template o nel repository.

---

## 20. File map

### UI Admin

```text
apps/storefront/src/app/admin/(protected)/livraison/
  LivraisonTabs.tsx
  page.tsx
  ZonesSection.tsx
  emballages/
  laboratoire/
    page.tsx
    CampaignManager.tsx
    CampaignDestinationPicker.tsx
    [id]/page.tsx
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
    route.ts
    city-postal-codes/route.ts
    [id]/process/route.ts
    [id]/cancel/route.ts
  shipping-observations/summary/
  shipping-advisor/
  shipping-tariff-drafts/
```

### Intelligence core

```text
apps/storefront/src/lib/shipping/intelligence/
  equivalence.ts
  observationsSummary.ts
  postalCityLookup.ts
  quoteScenario.ts
  requestHash.ts
  resolveZone.ts
  runCampaignBatch.ts
  schedulerAuth.ts
  scenarioMatrix.ts
  similarity.ts
  tariffBacktest.ts
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
packages/types/shippingIntelligence.ts
```

### Shipping core correlato

```text
apps/storefront/src/lib/shipping/calculateShipping.ts
apps/storefront/src/lib/shipping/resolveCountryRule.ts
apps/storefront/src/app/api/shipping/quote/route.ts
apps/storefront/src/lib/auth/adminApiPermissions.ts
```

---

## 21. Configurazione operativa e rollback n8n

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

## 22. Troubleshooting

### Campagna resta queued

Durante il cutover, controllare anzitutto che n8n sia pubblicato e che la repository variable `SHIPPING_CAMPAIGN_N8N_ACTIVE` sia coerente con il suo stato. Controllare inoltre:

- tenant `shipping_provider = packlink`;
- API key Packlink disponibile;
- worker GitHub Actions attivo;
- URL worker configurata;
- bearer service-role valido;
- endpoint interno raggiungibile.

### `Traiter maintenant` restituisce 429

Comportamento atteso entro il cooldown manuale di 10 secondi.

Il cron continua comunque a funzionare.

### Molti `skipped_duplicate`

Significa che esistono osservazioni equivalenti ancora fresche.

Controllare la freshness window prima di aumentare inutilmente il volume di chiamate.

### Assistant mostra dati insufficienti

Generare una campagna con:

- stesso paese;
- zone/CAP rappresentativi;
- pesi vicini;
- stesso profilo;
- numero colli coerente.

### Una città non restituisce CAP

Usare il fallback manuale.

Non inventare CAP nel codice o nel client.

### Costo storico diverso dal live Packlink

È normale: lo storico è decision support. Richiedere un preventivo provider live quando serve il prezzo corrente.

---

## 23. Limiti correnti e sviluppi futuri

Non ancora implementato:

- attivazione del pricing rule-based nel checkout;
- costi finali `real_shipment` acquisiti come consuntivo separato;
- true 3D bin-packing per prodotto;
- adaptive sampling automatico dei soli punti di discontinuità;
- provider logistici multipli nel laboratorio;
- modello città/CAP proprietario persistito in Lepefy;
- UI completa per tutte le strategie multi-collo;
- valutazione statistica avanzata per regione/corriere/SLA.

Qualsiasi passaggio del forfait dal laboratorio al checkout è un cambio money-impacting e richiede il normale approval gate critico previsto da `AGENTS.md`.

---

## 24. Contratto di manutenzione di questo documento

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
