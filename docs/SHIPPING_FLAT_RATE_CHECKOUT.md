# Forfait di spedizione nel checkout — dossier di implementazione

> **Stato:** **V1G implementata: tariffazione commerciale** (base `main@200abcc`, 24/09/2026), sopra la V1F
> (foundation + shadow, §10–11). Il codice permette di addebitare una versione tariffaria attiva con
> preventivo e pagamento verificati server-side (§12–13), ma **nessun tenant è attivato**: il forfait è
> addebitato solo dopo l'attivazione esplicita in admin. Migration `124` e `125` da applicare
> manualmente. Pagina pubblica `/livraison` presente ma **nascosta** (default).
> **Tenant pilota:** ChloeFood (IT, partenza Reggio Emilia 42122).
> **Dati raccolti:** 22–23 settembre 2026 (Shipping Intelligence, campagne + preventivi diretti Packlink).
> **Documenti collegati:** `docs/SHIPPING_INTELLIGENCE.md` (laboratorio, rétrotest, bozze), `CLAUDE.md` § Shipping Calculation.
>
> Scopo: raccogliere in un solo posto le evidenze di mercato, la griglia commerciale proposta e il
> design raccomandato per portare un forfait a fasce di peso nel checkout, in modo **multi-tenant,
> multi-paese e versionato**. Il codice resta la source of truth: aggiornare questo file quando
> l'implementazione parte o quando i dati cambiano.

---

## 1. Sintesi decisionale

| Tema | Decisione proposta |
|---|---|
| Modello di prezzo | Forfait TTC a fasce di **peso totale dell'ordine**, imballaggio incluso |
| Griglia ChloeFood | 0–5 kg **8,40 €** · 5–10 kg **10,80 €** · 10–15 kg **12,60 €** · 15–20 kg **16,40 €** (2 colli) · 20–30 kg **19,80 €** (2 colli) |
| Isole | **+2 € per collo** su `IT_SICILY`, `IT_SARDINIA`, `IT_CALABRIA` |
| Oltre 30 kg | **Blocchi di 30 kg**: `19,80 € × floor(peso / 30)` + fascia del resto |
| Colli | **15 kg massimo** per collo (vincolo del tenant) |
| Cartoni | **S** 35×25×22 fino a 5 kg · **M** 40×30×30 da 5 a 15 kg · **L** 45×35×40 solo collo unico ingombrante 12,5–15 kg |
| Zone non servite | `IT_EXTRA_CUSTOMS` (Livigno 23041, Campione 22061): nessuna consegna, retrait proposto (già attivo) |
| IVA | **Tutti i prezzi forfait del tenant sono IVA inclusa (TTC)**; margini calcolati TTC contro TTC (preventivo Packlink HT × 1,22) |
| Condizione di validità | Costo reale imballaggio (cartone + nastro + riempitivo) **≤ 1,79 € IVA inclusa per collo, cioè ≤ 1,47 € + IVA** (i listini fornitori sono di solito HT); tra 1,80 e 2,30 € IVA inclusa (1,48–1,88 € HT) portare 0–5 kg a **8,90 €**; oltre, rivedere la griglia |

Bozza di riferimento in admin: **«Grille ChloeFood 23/09 — 8,40/10,80/12,60/16,40/19,80, îles +2 €/colis»**
(`shipping_tariff_drafts.id = cdae3da2-1c5b-47a4-b47d-b260cd12cea5`). La regola a blocchi oltre 30 kg,
il limite di 15 kg per collo e le zone non consegnabili non esistono nelle bozze: si aggiungono quando
la bozza viene copiata in una **versione tariffaria** (§10.2).

---

## 2. Evidenze di mercato (Packlink, preventivi IVA esclusa)

Tutti i valori sono **preventivi**, non fatture. Packlink restituisce `tax_price = 0`: l'IVA 22 % va
aggiunta (`shipping_vat_rates`). Servizio scelto = eleggibile più economico (consegna a domicilio, no B2B).

### 2.1 Il CAP non conta, contano 3 gruppi di zone

Su 80 gruppi (peso × cartone × zona) il prezzo è identico al centesimo per tutti i CAP di una zona.
Le 22 zone IT si riducono a:

| Gruppo | Zone |
|---|---|
| Continente | 17 zone regionali |
| Laguna / isole minori | `IT_VENICE_LAGOON`, `IT_MINOR_ISLANDS` — prezzo del continente **con cartone S**, più caro con cartoni grandi (BRT non serve) |
| Isole maggiori + Calabria | `IT_SICILY`, `IT_SARDINIA`, `IT_CALABRIA` — da +1,07 a +2,16 € |
| Non servite | `IT_EXTRA_CUSTOMS` |

→ **Conseguenza di design:** il prezzo si esprime per **zona**, mai per CAP. Il controllo nel tempo si fa
con 1–2 CAP testimoni per zona (campagna «Par zone»), non su tutti i CAP.

### 2.2 Campagna cartoni S / M / L (792 scenari, 44 CAP, 22 zone)

Campagna `a7c56807-cf48-47a5-b750-6ce4f799e718`, 0 errori.

| Gruppo | Cartone | 1 kg | 3 kg | 7,5 kg | 14,5 kg | 2 colli 15,5 kg | 2 colli 30 kg |
|---|---|---|---|---|---|---|---|
| Continente | S | 4,83 | 5,42 | 6,80 | 7,89 | 7,89 | 9,82 |
| | M | 5,90 | 6,69 | 6,80 | 7,89 | 7,89 | 9,82 |
| | L | 5,90 | 6,69 | 7,89 | 7,89 | 13,25 | 16,99 |
| Laguna / isole minori | S | 4,83 | 5,42 | 6,80 | 7,89 | 7,89 | 9,82 |
| | M | 6,80 | 6,80 | 6,80 | 7,89 | 7,89 | 9,82 |
| | L | 7,89 | 7,89 | 7,89 | 7,89 | 16,99 | 16,99 |
| Sicilia · Sardegna · Calabria | S | 5,90 | 6,60 | 8,57 | 9,66 | 9,66 | 11,59 |
| | M | 5,90 | 6,69 | 8,57 | 9,66 | 9,66 | 11,59 |
| | L | 5,90 | 6,69 | 9,19 | 9,66 | 13,25 | 20,69 |

Preventivi diretti complementari (stessa giornata):

- 15 kg totali: **1 L = M 10 + S 5 = M 12 + S 3 = M 7,5 + S 7,5** = 7,89 € (continente) / 9,66 € (isole).
- 20 kg (15 + 5): **M + S 7,89 €** · M + M 9,82 € · L + L 13,25 €.
- 30 kg (15 + 15) in L + M: 16,99 € → il cartone L in una spedizione multi-collo va evitato.

### 2.3 Regole di formato (Poste Italiane, tariffa più bassa)

- Fino a ~5 kg: lati entro **50 × 30 × 28 cm** (lungo ≤ 50, medio ≤ 30, corto ≤ 28). Un lato oltre → BRT, +1,07/1,55 €.
- Da ~5 kg Poste accetta anche il **40 × 30 × 30** (cartone M).
- Il volume in litri non conta, contano i lati.
- **Prezzo sul peso totale della spedizione**, non sul numero di colli.

### 2.4 Oltre 30 kg (una spedizione, colli da 15 kg)

| Peso totale | Continente | Sicilia |
|---|---|---|
| ≤ 30 kg | ≤ 9,82 € | ≤ 11,59 € |
| 30,5 – 50 kg | 16,99 € | 20,69 € |
| 60 – 70 kg | 20,66 € | 25,96 € |
| 75 – 80 kg | 37 – 41 € (TNT) | non servito |

Regola operativa: **una spedizione fino a 50 kg; oltre 50 kg (sempre oltre 70 kg) spedizioni multiple ≤ 30 kg.**
Lo scalino esatto tra 50 e 60 kg non è stato misurato.

### 2.5 Domanda reale

6 ordini reali (3 consegne, 3 ritiri), tutti ≤ 3 kg, mediana 1 kg, carrello 13–26 €. Peso mediano
prodotto a catalogo 500 g. **19 prodotti attivi su 133 non hanno `weight_grams`** (fallback 400 g in
`calculateShipping.ts`) — da correggere prima di un forfait a fasce di peso (§6.4).

---

## 3. Fattibilità della griglia

Margine = prezzo cliente **IVA inclusa** − preventivo Packlink IVA inclusa (HT × 1,22), **prima dell'imballaggio**, con la regola cartoni S/M.
"Max imballaggio/collo" = costo imballaggio **IVA inclusa** che porta a margine zero; per confrontarlo con un listino fornitore HT dividere per 1,22 (1,79 € → 1,47 € HT).
Per un tenant soggetto IVA che detrae l'IVA sugli acquisti, il ragionamento HT è equivalente: ricavo netto = prezzo / 1,22, costi netti = Packlink HT + cartone HT.

| Fascia | Continente e laguna | Isole (+2 €/collo) | Isole senza maggiorazione |
|---|---|---|---|
| 0–5 kg, 1 kg | 2,51 € | 3,20 € | 1,20 € |
| 0–5 kg, 3–5 kg | **1,79 €** | 2,35 € | 0,35 € |
| 5–10 kg | 2,50 € | 2,34 € | 0,34 € |
| 10–15 kg | 2,97 € | 2,81 € | 0,81 € |
| 15–20 kg (2 colli) | 3,39 € | 4,31 € | 2,31 € |
| 20–30 kg (2 colli) | 3,91 € | 4,83 € | 2,83 € |

Sensibilità sui 264 scenari "regola S/M" della campagna:

| Imballaggio / collo | Margine medio / ordine | Casi in perdita | Caso peggiore |
|---|---|---|---|
| 0 € | +4,17 € | 0 % | +1,79 € |
| 1,50 € | +2,17 € | 0 % | +0,29 € |
| 1,80 € | +1,77 € | 14,4 % | −0,01 € |
| 3,00 € | +0,17 € | 64,4 % | −1,21 € |

Oltre 30 kg con la regola a blocchi: tutti i pesi misurati restano positivi prima dell'imballaggio,
con almeno 2,49 € per collo (caso più stretto 31–35 kg).

Rétrotest globale della bozza (4 780 scenari, **tutti** i cartoni misurati, anche fuori formato):
+3,72 € senza imballaggio, −0,30 € con 3 €/collo. È volutamente pessimista: include L + L e cartoni
fuori formato che la regola di magazzino esclude.

---

## 4. Checkout attuale — punti di aggancio

```text
Cart → POST /api/shipping/quote → { shippingTotal, shippingDetails, quoteToken (HMAC, 1 h) }
     → POST /api/checkout          → verifyQuote(token) → orders.shipping_total / shipping_details
```

| Elemento | File / tabella | Nota per il forfait |
|---|---|---|
| Router provider | `app/api/shipping/quote/route.ts` (`tenants.shipping_provider`: `packlink` \| `flat_rate` \| `pickup_only`) | `flat_rate` è un importo unico, **senza fasce** |
| Calcolo Packlink | `lib/shipping/calculateShipping.ts` | split `ceil(peso / max_pack_kg)`, cartone unico da `packaging_surcharges` (oggi **40×30×20**, 15 kg, +3 €/collo) |
| Regole paese | `shipping_country_rules` + `lib/shipping/resolveCountryRule.ts` | `flat_rate_override`, sconto, `free_shipping_above` (IT: 99,99 €, regola **inattiva**) |
| IVA | `shipping_vat_rates` | IT 22 % |
| Token | `lib/shipping/quoteToken.ts` | firma `{t, c, z, e}` — non include peso né versione tariffa |
| Zone | `shipping_zones` + `lib/shipping/intelligence/resolveZone.ts` | prefisso più lungo; oggi usato solo dal laboratorio |
| Territori extra-doganali | `lib/shipping/extraCustomsTerritories.ts` | messaggio dedicato su `no_service` |
| Bozze | `shipping_tariff_drafts` + `lib/shipping/intelligence/tariffBacktest.ts` (`applyTariffDraft`) | **invariante: il checkout non legge mai le bozze** |
| Versioni (V1F) | `shipping_tariff_versions` + `lib/shipping/tariff/*` | lette dal checkout **solo** in shadow mode, mai addebitate (§10) |
| Modalità pricing (V1F) | `tenants.shipping_pricing_mode` | `provider_cost` (default) \| `shadow` \| `tariff` (riservato) |

---

## 5. Design raccomandato

### 5.1 Separare *prezzo cliente* e *provider logistico*

Oggi `shipping_provider` mescola due concetti. Raccomandazione:

- `tenants.shipping_provider` resta il **provider logistico** (Packlink: disponibilità, etichette, tracking);
- nuovo `tenants.shipping_pricing_mode`: `'provider_cost'` (default, comportamento attuale) | `'tariff'`.

Così un tenant può avere forfait + Packlink per le spedizioni, e un altro provider in futuro senza
toccare il pricing. Default `provider_cost` → **zero cambiamenti** per i tenant non migrati.

### 5.2 Tariffe pubblicate, versionate e immutabili

> **V1F:** implementato con uno schema più compatto (una tabella con fasce e maggiorazioni in JSON, stati
> `validated | shadow | retired | active`), vedi §10.1. Lo schema sotto resta il design di riferimento.

Non far leggere al checkout `shipping_tariff_drafts`. Aggiungere una **pubblicazione** che copia una
bozza in una versione immutabile:

```text
shipping_tariffs
  id, tenant_id, country (ISO-2), version (int), status: active | scheduled | retired,
  source_draft_id, currency ('EUR'), prices_include_vat (bool, default true),
  max_parcel_kg (numeric, 15), block_kg (numeric null, 30), block_price (numeric null, 19.80),
  valid_from (timestamptz), valid_to (timestamptz null),
  published_by, published_at, notes
  UNIQUE (tenant_id, country, version)
  -- al più una versione active per (tenant_id, country) : indice unico parziale

shipping_tariff_bands
  tariff_id, min_kg_exclusive, max_kg_inclusive, price, expected_parcels (info)

shipping_tariff_zone_surcharges
  tariff_id, zone_code, amount, mode: per_parcel | per_order

shipping_tariff_zone_rules          -- opzionale, vedi §5.5
  tariff_id, zone_code, deliverable (bool), message_key
```

Regole:

- una versione `active` non si modifica mai: una correzione = nuova versione;
- `scheduled` + `valid_from` permettono di annunciare un cambio prezzi con data;
- rollback = riattivare la versione precedente (una transazione, un'azione admin);
- RLS: lettura solo `service_role` (come le altre tabelle di configurazione shipping);
- l'ordine conserva `tariff_id` + `version` → ogni prezzo storico resta spiegabile.

### 5.3 Un solo motore di prezzo, condiviso

> **V1F:** motore implementato in `lib/shipping/tariff/priceFromTariff.ts` (grammi e centesimi interi).
> Il rétrotest del laboratorio (`applyTariffDraft`) **non** è ancora stato migrato su questo motore.

Stesso principio di `lib/purchaseQuantityRules.ts`: **una funzione pura** importata da checkout,
simulatore admin e rétrotest.

```ts
// lib/shipping/tariff/priceFromTariff.ts (proposta)
priceFromTariff(tariff, { weightKg, zoneCode }) → {
  available: boolean,
  price: number,             // TTC
  parcels: number[],         // kg per collo, riempimento 15 + resto
  blocks: number,            // blocchi da block_kg applicati
  band: { min, max, price }, // fascia del resto
  zoneSurcharge: number,
  breakdown: {...}           // per shipping_details e admin
}
```

Semantica da fissare nei test:

- fasce `min < peso ≤ max` (5,00 kg → 0–5; 5,01 kg → 5–10);
- **blocchi**: `blocks = floor(peso / block_kg)`, `resto = peso − blocks × block_kg`;
  `prezzo = blocks × block_price + (resto > 0 ? fascia(resto) : 0)`.
  Esempi ChloeFood: 30 kg = 19,80 · 45 kg = 32,40 · 60 kg = 39,60 · 90 kg = 59,40;
- colli: `parcels = splitFilled(peso, max_parcel_kg)` (20 kg → 15 + 5), coerente con il blocco
  (un blocco da 30 kg = 2 colli da 15);
- maggiorazione zona `per_parcel` × numero colli, oppure `per_order` una volta;
- arrotondamento finale a 2 decimali una sola volta.

`applyTariffDraft` in `tariffBacktest.ts` va **rifattorizzato** per chiamare questo motore (aggiungendo
blocchi e `max_parcel_kg` alle bozze), così rétrotest e checkout non divergono mai.

### 5.4 Pianificazione colli e cartoni

**Già implementato (migration 123):** `suggest_min_weight_g` / `suggest_max_weight_g` su
`shipping_packaging_profiles` e la card «Carton à utiliser» nel dettaglio ordine admin
(`lib/shipping/cartonSuggestion.ts`, vedi `SHIPPING_INTELLIGENCE.md` §4.1). Restano da fare i punti
sotto (costo unitario, tara, uso nel checkout e nella creazione della spedizione).

Generalizzare `packaging_surcharges` (un cartone unico) verso i profili già esistenti
`shipping_packaging_profiles`, aggiungendo:

```text
shipping_packaging_profiles
  ✓ suggest_min_weight_g, suggest_max_weight_g   -- fascia di utilizzo (migration 123)
  + use_in_checkout (bool)
  + unit_cost (numeric null)         -- costo reale cartone + materiali, per il margine
  + tare_g (int null)                -- peso del cartone
```

Motore `planParcels(totalKg, profiles, maxParcelKg)` → lista `{ profileId, weightKg, dims }` con la
regola: collo < 5 kg → S; 5–15 kg → M; L solo come collo unico se segnalato "ingombrante".
Usato per:

1. il controllo di disponibilità Packlink con le **dimensioni corrette**;
2. la picking list admin (cartone suggerito per ordine);
3. la creazione della spedizione Packlink (stesse dimensioni del preventivo);
4. il calcolo del margine atteso (§5.7).

### 5.5 Disponibilità senza pagare una chiamata Packlink a ogni quote

Con il forfait il prezzo non dipende da Packlink, ma la **consegnabilità** sì. Ordine raccomandato:

1. `shipping_tariff_zone_rules.deliverable = false` (es. `IT_EXTRA_CUSTOMS`) → indisponibile subito,
   messaggio `extraCustomsUnavailableMessage` + retrait se attivo;
2. CAP mai visto o zona senza dati freschi → chiamata Packlink **in guardia** (timeout breve), cache
   per `(paese, CAP, fascia di peso, piano colli)` con TTL (es. 7 giorni) nella tabella osservazioni
   (`source = 'real_quote'`);
3. Packlink in errore/timeout → **non bloccare** il checkout se la zona è consegnabile: il forfait è
   noto; loggare l'incidente.

### 5.6 Quote token e checkout

> **V1F (shadow):** il token **non** è stato modificato. Il forfait è ricalcolato sul server al checkout
> e non transita dal quote.
>
> **V1G:** token V2 implementato e ricalcolo in ogni percorso di pagamento (§12.4–12.5).

- Estendere il payload firmato: `{ t, c, z, e, w (peso g), v (tariff_id:version), m (pricing_mode) }`.
- In `/api/checkout` **ricalcolare** il prezzo con `priceFromTariff` sul carrello server-side e
  confrontarlo col token (come oggi per l'importo): rifiuto se il peso o la versione non combaciano.
- Se la tariffa è cambiata tra quote e pagamento (versione ritirata): ri-quotare, non addebitare il
  vecchio importo senza conferma.
- `orders.shipping_details` (jsonb, nessuna migration necessaria) deve contenere:
  `pricing_mode`, `tariff_id`, `tariff_version`, `zone_code`, `weight_g`, `parcels` (piano colli con
  profilo), `band`, `blocks`, `zone_surcharge`, `expected_provider_cost_ttc`,
  `expected_packaging_cost`, `expected_margin`.

### 5.7 Precedenze con le regole esistenti

Ordine unico, documentato e testato:

```text
1. priceFromTariff (o costo provider se pricing_mode = provider_cost)
2. shipping_country_rules.flat_rate_override  (se presente vince sul forfait)
3. sconto percentuale/fisso
4. free_shipping_above (sottototale calcolato server-side)
```

`packaging_surcharges.surcharge_amount` **non si somma** in modalità `tariff`: il forfait è già
"IVA e imballaggio compresi". Questo è il punto più facile da sbagliare.

### 5.8 IVA e prezzi TTC

- Prezzi forfait salvati **TTC** (`prices_include_vat = true`), come li pensa il tenant.
- Per altri paesi UE (OSS) l'aliquota può cambiare: il campo esiste già in `shipping_vat_rates`;
  non indovinare — prevedere per paese `prices_include_vat` e l'aliquota applicata in `shipping_details`.
- Il margine si confronta sempre **TTC con TTC** (o HT con HT): preventivo Packlink HT × (1 + IVA).

---

## 6. Scalabilità

### 6.1 Multi-tenant

- Tutte le tabelle nuove con `tenant_id`, filtro esplicito nel codice + RLS `service_role`.
- **Template di piattaforma**: griglie e set di zone di riferimento per paese
  (`platform_shipping_zone_sets`, `platform_tariff_templates`) che un tenant copia e adatta, invece
  di ricreare 22 zone a mano. Le zone IT di ChloeFood sono il primo template.
- Punto di partenza diverso per tenant (oggi `FROM_ADDRESS` è **hard-coded 42122** in
  `quote/route.ts` e in `INTELLIGENCE_FROM_ADDRESS`): spostarlo su `tenants` (o `tenant_warehouses`)
  prima di un secondo tenant spedente.

### 6.2 Multi-paese

- Una tariffa per `(tenant, paese)`; zone per paese (`shipping_zones.country` esiste già).
- Paesi senza tariffa attiva → fallback esplicito: `provider_cost` o "non consegnabile", configurabile.
- Replicare la metodologia prima di ogni paese: campagna «Par zone» con 1–2 CAP testimoni, cartoni
  S/M/L, pesi 1 / 3 / 7,5 / 14,5 / 15,5 / 30 (+ 45 / 60 se servono i blocchi).

### 6.3 Multi-provider

- Il motore di prezzo non conosce Packlink; il provider serve per disponibilità e spedizione
  (`lib/shipping/providers/registry.ts` esiste già).
- Le osservazioni restano provider-neutral (`provider` in `shipping_quote_observations`).

### 6.4 Qualità dei dati di peso

- 19/133 prodotti attivi senza peso → con un forfait a fasce il fallback 400 g può spostare un ordine
  di fascia. Rendere `weight_grams` obbligatorio per i prodotti spedibili (validazione admin +
  segnalazione in dashboard).
- Aggiungere la tara del cartone (`tare_g`) al peso inviato a Packlink e, se deciso, al peso di fascia.
  Decidere esplicitamente: **fascia su peso netto prodotti** (più semplice per il cliente,
  raccomandato) vs peso lordo.

### 6.5 Monitoraggio del margine

- **Campagna testimoni mensile** via n8n (44 CAP × 3 cartoni × 6 pesi = 792 scenari, gran parte in
  riuso): rileva un cambio listino Packlink in giorni, non in mesi.
- **Margine reale per ordine**: `expected_margin` in `shipping_details` + costo reale dalla fattura
  Packlink (`source = 'real_shipment'`) → report mensile e alert se i casi in perdita superano una
  soglia (es. 10 %) o se il margine medio scende sotto 1 €.
- Rétrotest automatico di ogni bozza sugli scenari aggiornati prima della pubblicazione (già
  disponibile: `POST /api/admin/shipping-tariff-drafts/:id/simulate`).

### 6.6 Rollout sicuro

1. **Shadow mode** (2–4 settimane): il checkout addebita ancora il costo Packlink, ma calcola e
   salva anche il forfait in `shipping_details.shadow_tariff` → confronto su ordini reali.
2. **Feature flag per tenant** (`shipping_pricing_mode = 'tariff'`) attivabile e reversibile in un clic.
3. Pagina pubblica "Livraison" con la griglia (generata dalla tariffa attiva, mai testo manuale).
4. Revisione dopo 50–100 spedizioni reali.

### 6.7 Test da prevedere

- Motore: bordi 5 / 5,01 / 15 / 15,01 / 20 / 30 / 30,01 / 45 / 60 / 90 kg; isole per collo e per
  ordine; zona non consegnabile; `flat_rate_override` e soglia di gratuità; arrotondamenti.
- Parità: stesso input → stesso prezzo in checkout, simulatore e rétrotest.
- Token: peso o versione manomessi → rifiuto; tariffa ritirata tra quote e checkout → ri-quotazione.
- Piano colli: 4,9 kg → 1 S; 5,1 kg → 1 M; 20 kg → M 15 + S 5; 30 kg → M 15 + M 15.
- Regressione: `pricing_mode = provider_cost` → risposta identica a oggi (stessi `shippingDetails`).

---

## 7. Regole di magazzino (da consegnare al tenant)

1. Collo fino a 5 kg → **cartone S** (anche il secondo collo di un ordine grande).
2. Collo da 5 a 15 kg → **cartone M**.
3. **L** solo per un collo unico ingombrante da 12,5–15 kg; mai due L nella stessa spedizione.
4. Mai superare 50 × 30 × 28 cm per colli leggeri.
5. Fino a 50 kg una spedizione; oltre, spedizioni da ≤ 30 kg (oggi manuale in Packlink PRO).
6. Livigno e Campione: solo retrait.

---

## 8. Decisioni aperte

| # | Decisione | Proprietario | Impatto |
|---|---|---|---|
| 1 | Costo reale cartoni S / M / L con materiali (fornitore) | Tenant | Conferma o modifica la fascia 0–5 kg |
| 2 | Approvazione maggiorazione isole +2 €/collo | Tenant | Senza, isole in perdita |
| 3 | Regola a blocchi oltre 30 kg | Tenant | Richiede §5.3 |
| 4 | Fascia 15–20 kg (16,40 €) più bassa per compensare le fasce leggere? | Tenant | Margine 3,39 €/collo, generoso |
| 5 | Soglia di spedizione gratuita (regola IT 99,99 € oggi inattiva) | Tenant | Da simulare sui margini prodotto |
| 6 | Peso di fascia netto o lordo (tara) | Prodotto | Semantica del motore |
| 7 | Pesi mancanti sui 19 prodotti | Tenant | Fasce errate |
| 8 | Verifica 5–10 fatture Packlink vs preventivi | Tenant / piattaforma | Affidabilità dei dati |

---

## 9. Limiti dei dati

- Preventivi Packlink, non fatture; listino osservato il 22–23/09/2026.
- 6 ordini reali: la distribuzione dei pesi è una tendenza, non una statistica.
- I 3 € per collo usati nei rétrotest sono il supplemento pagato oggi dal cliente, **non** un costo misurato.
- Nessuna misura tra 50 e 60 kg; oltre 70 kg solo TNT (continente).
- Solo Italia misurata.

---

## 10. Implementazione V1F — foundation e shadow mode

**Cosa esiste nel codice.** Motore tariffario puro, versioni immutabili, modalità di pricing per tenant,
calcolo shadow server-side al checkout, onglet admin «Forfait shadow» e rapporto sugli ordini reali.
**Perimetro V1F (storico).** La V1F non addebitava alcun forfait. La tariffazione commerciale, lo stato
`active` e la pagina pubblica sono arrivati con la V1G (§12).

### 10.1 Schema (migration `124_shipping_tariff_versions.sql`, additiva e reversibile)

- `tenants.shipping_pricing_mode` `provider_cost | shadow | tariff`, default `provider_cost` (nessun
  cambio per i tenant esistenti). Indipendente da `tenants.shipping_provider` (`flat_rate` resta il
  forfait unico esistente). In V1F `tariff` è trattato come `provider_cost` (log di avvertimento).
- `shipping_tariff_versions`: `tenant_id`, `country`, `currency`, `version` (unica per tenant+paese),
  `status` `validated | shadow | retired | active`, `name`, `bands`
  (`[{min_g_exclusive, max_g_inclusive|null, price_cents}]`), `zone_surcharges`
  (`[{zone_code, amount_cents, mode: per_parcel|per_order}]`), `non_deliverable_zones`,
  `max_parcel_weight_g`, `block_weight_g`/`block_price_cents` (entrambi o nessuno),
  `logistics_verified_max_weight_g`, `prices_include_vat`, `source_draft_id`, `notes`, `created_by`,
  `created_at`, `selected_at`, `retired_at`.
- **Immutabilità:** il trigger `shipping_tariff_versions_immutable` rifiuta ogni modifica dei parametri
  economici e dell'identità (cambiano solo stato, date e note); nessun `DELETE` concesso al service role.
- **Vincoli:** indice unico parziale «una sola `shadow` per tenant+paese» e «una sola `active`».
- **Selezione atomica:** la RPC `select_shipping_tariff_shadow_version(tenant, version)` ritira la shadow
  corrente e seleziona la nuova nella stessa transazione; rifiuta una versione `active`.
- RLS attiva senza policy pubbliche (service role).

### 10.2 Motore (`apps/storefront/src/lib/shipping/tariff/`)

| File | Ruolo |
|---|---|
| `priceFromTariff.ts` | `priceFromTariff(snapshot, {weightG, country, zoneCode, vatRate})` puro: fascia `min < peso ≤ max`, blocchi `floor(peso / blocco)` + fascia del resto, colli a riempimento progressivo (`splitParcelWeightsFilled` di `cartonSuggestion.ts`), maggiorazione per collo/ordine, IVA inclusa o aggiunta una volta, avvertimento `logistics_unverified_weight` oltre il limite logistico verificato. `applyCommercialRulesCents` riusa `applyCountryRule` (stessa precedenza del live). |
| `tariffVersion.ts` | validazione (fasce da 0, contigue, illimitata solo in fondo, blocco coperto, maggiorazioni uniche), `parseTariffVersion`, `buildVersionFromDraft` (bozza → grammi/centesimi; solo «prezzo sul peso totale», le strategie «1er colis + …» sono rifiutate). |
| `shadowTariff.ts` | `resolveCheckoutShippingDetails`: toglie sempre un `shadow_tariff` inviato dal browser; se `shipping_pricing_mode = shadow` e consegna, esegue `computeShadowTariff` con timeout di 2,5 s e `try/catch`, poi aggiunge `shipping_details.shadow_tariff`. |
| `shadowReport.ts` | aggregati sugli ordini reali (paginati, tenant-scoped). |
| `adminData.ts` | dati dell'onglet admin. |

Esempi ChloeFood verificati nei test: 5 000 g → 8,40 €; 5 001 g → 10,80 €; 15,001 kg → 16,40 €;
20 kg → 15 + 5 (Sicilia 16,40 + 2 × 2 € = 20,40 €); 30 kg → 19,80 €; 30,001 kg → 28,20 €; 45 kg → 32,40 €;
60 kg → 39,60 €; 90 kg → 59,40 €.

### 10.3 Checkout (importi invariati)

```text
Importo cliente : /api/shipping/quote → token {t,c,z,e} (invariato) → /api/checkout | external-link | PATCH session → Stripe / in negozio / link esterno
Shadow          : prodotti validati + products.weight_grams → resolveZoneCode → priceFromTariff(versione shadow)
                  → regole paese (subtotale server) → shipping_details.shadow_tariff
```

- Punti di aggancio: `/api/checkout` (Stripe e in negozio), `/api/checkout/external-link`,
  `PATCH /api/checkout-sessions/:id` (ricalcolo a ogni modifica; lo shadow del browser è scartato).
  Webhook Stripe e `createOrderFromCheckoutSession` copiano `shipping_details` senza modifiche.
- `shippingTotal`, totale, PaymentIntent, token e i campi Packlink di `shipping_details` usati per
  l'etichetta **non cambiano**. Con `provider_cost` i dettagli restano identici a prima.
- Ritiro in negozio: nessun calcolo (escluso esplicitamente).
- **Peso:** netto, da `products.weight_grams` × quantità validate server-side; il peso inviato dal
  browser (`totalWeightG`) è ignorato. Nessun fallback di 400 g: un prodotto senza peso → `incomplete`
  + `missingWeightProductIds`. Tara: `tareG = null` (non configurata, mai sommata).
- **Preventivo provider:** `packlinkCost + vatAmount` è registrato come verificato solo se, con
  l'imballaggio, ricostruisce al centesimo il totale firmato (`matches_signed_total`); altrimenti
  `unverified` e nessun margine.
- **Margini:** `shadowMinusChargedCents` confronta due prezzi cliente (non è un margine);
  `expectedMarginBeforePackagingCents` = forfait − preventivo Packlink TTC verificato;
  `expectedMarginCents` resta `null` finché il costo reale dell'imballaggio non è noto.
- Stati: `complete` | `incomplete` (`missing_product_weight`, `zone_unresolved`) | `unavailable`
  (`no_shadow_tariff`, `band_not_covered`, `zone_not_deliverable`, `vat_rate_missing`, `invalid_weight`,
  `country_mismatch`) | `error` (`invalid_tariff_config`, `timeout`, `unexpected_exception`).
  Solo `complete` entra nelle statistiche.

### 10.4 Admin → Livraison → Forfait shadow (`/admin/livraison/forfait-shadow`)

Lettura con `shipping.view`; creazione/selezione di versione e collecte con `shipping.manage`.
Stati espliciti Brouillon / Version shadow / Tarification active (bloccata). Creazione di una versione
da una bozza (paese, TTC/HT, collo max, blocco, zone non consegnabili, limite logistico) con anteprima e
simulazione d'esempio calcolata dallo stesso motore; riselezione di una versione precedente (rollback);
attivazione/disattivazione della sola collecte; qualità dei pesi prodotto (link all'editor);
rapporto sugli ordini reali filtrabile per periodo e versione (affidabilità: < 30 insufficiente, < 100 limitata).

API: `GET/POST /api/admin/shipping-tariff-versions`, `POST …/:id/select`,
`GET/PATCH /api/admin/shipping-pricing-mode` (solo `provider_cost`/`shadow`),
`GET /api/admin/shipping-shadow-report`.

---

## 11. Runbook operativo

### 11.1 Prerequisiti

1. Applicare manualmente `supabase/migrations/124_shipping_tariff_versions.sql` (Vercel non applica
   migration). Verifica: `select shipping_pricing_mode, count(*) from tenants group by 1;` → solo
   `provider_cost`.
2. Finché la migration non è applicata l'onglet mostra «migration non appliquée» e il checkout resta invariato.
3. Completare i pesi mancanti (sezione «Qualité des poids produits»).

### 11.2 Configurazione della tariffa ChloeFood

Onglet **Forfait shadow** → «Créer une version shadow depuis un brouillon»: bozza «Grille ChloeFood
23/09», paese `IT`, prezzi TTC, collo max 15 kg, blocco 30 kg = 19,80 €, zona non consegnabile
`IT_EXTRA_CUSTOMS`, logistica verificata fino a 50 kg, «Sélectionner comme version shadow».
Controllare la simulazione d'esempio (valori §10.2).

### 11.3 Attivazione shadow

Dopo autorizzazione esplicita: «Activer la collecte shadow» (richiede una versione shadow selezionata).
Nessun cambiamento di prezzo per il cliente.

### 11.4 Verifica dei dati raccolti

- Rapporto nell'onglet (periodo, versione).
- SQL: `select id, shipping_cost, shipping_details->'shadow_tariff'->>'status', shipping_details->'shadow_tariff'->>'shadowTtcCents' from orders where tenant_id = … order by created_at desc limit 20;`
- `shipping_cost` deve restare identico all'importo del quote (`chargedCents / 100`).

### 11.5 Rollback immediato

- **Stop raccolta:** «Désactiver la collecte» (oppure `update tenants set shipping_pricing_mode = 'provider_cost' where id = …`).
  Effetto dal checkout successivo; nessun altro cambiamento.
- **Versione errata:** selezionare una versione precedente o crearne una nuova (le vecchie restano immutabili).
- **Codice:** revert del commit V1F; gli `shadow_tariff` già scritti restano JSON inerte negli ordini.
- **Schema:** blocco di rollback in fondo alla migration 124.

### 11.6 Troubleshooting

| Sintomo | Causa / azione |
|---|---|
| Onglet «migration non appliquée» | Migration 124 assente nel Supabase del deployment |
| «Activer» disabilitato | Nessuna versione `shadow` selezionata |
| Molti `incomplete / missing_product_weight` | Pesi prodotto mancanti: correggerli nell'editor catalogo |
| `zone_unresolved` | CAP senza zona tenant: completare `shipping_zones` (onglet Tarification) |
| `unavailable / no_shadow_tariff` | Ordine verso un paese senza versione shadow |
| `error / timeout` | Latenza DB > 2,5 s: il checkout è proseguito; verificare i log Vercel `[shadow-tariff]` |
| `provider.verification = unverified` | Regola paese applicata o dettagli del quote incoerenti: margine non calcolato (voluto) |
| `logistics_unverified_weight` | Ordine oltre il limite logistico verificato: prezzo teorico, fattibilità Packlink da confermare |

### 11.7 Passaggio alla tariffazione commerciale

Implementato in V1G: vedi §12 (comportamento) e §13 (runbook di pubblicazione e rollback).
Nessuna attivazione automatica basata sulla dimensione del campione.

---

## 12. Implementazione V1G — tariffazione commerciale

**Stato distinto in tre fatti:** (1) codice commerciale implementato e distribuito; (2) schema di
produzione (`124` e `125`) da applicare e verificare manualmente; (3) **nessun tenant è attivato**:
il forfait viene addebitato solo dopo l'azione esplicita «Activer cette tarification pour les clients».

### 12.1 Modello

- `tenants.shipping_provider` resta il provider logistico (Packlink: disponibilità, spedizioni, tracking);
  `flat_rate` resta il forfait unico storico, invariato.
- `tenants.shipping_pricing_mode`: `provider_cost` (default) | `shadow` (V1F) | `tariff` (V1G). `tariff`
  si ottiene **solo** con l'attivazione di una versione (RPC atomica), mai con un PATCH diretto.
- `tenants.shipping_tariff_fallback` (migration 125): cosa succede in modalità `tariff` quando la
  tariffa non si applica (paese senza versione attiva, CAP fuori dalle zone, prodotto senza peso): `unavailable` (default,
  consegna non disponibile e ritiro proposto) oppure `provider_cost` (preventivo Packlink attuale).
  Mai implicito.
- `tenants.shipping_public_grid_enabled` (migration 125, default `false`): pagina pubblica `/livraison`.
  **Attualmente nascosta** su richiesta del tenant: il codice esiste, la pagina risponde 404 finché non
  viene attivata dall'admin (e comunque solo con una tariffa attiva).

### 12.2 Schema (migration `125_shipping_tariff_activation.sql`, additiva)

- `shipping_tariff_versions.activated_at / activated_by / retired_by` (tracciabilità; parametri
  economici sempre immutabili via trigger 124).
- `tenants.shipping_tariff_fallback`, `tenants.shipping_public_grid_enabled`.
- `shipping_packaging_profiles.tare_g` (tara del cartone, solo per la verifica logistica).
- RPC service-role: `activate_shipping_tariff_version(tenant, version, actor)` (ritira l'`active` dello
  stesso paese, attiva, porta il tenant a `tariff`); `retire_shipping_tariff_country(tenant, country,
  actor)` (se non resta alcuna attiva → `provider_cost`); `rollback_shipping_tariff_to_provider_cost`.
- Nessun backfill, nessun tenant attivato dalla migration. Rollback in fondo al file.

### 12.3 Preventivo autorevole (`/api/shipping/quote`, `lib/shipping/tariff/tariffQuote.ts`)

In modalità `tariff`, nell'ordine:

1. territori extra-doganali noti (Livigno 23041, Campione 22061) → sempre non consegnabili, anche con
   `flat_rate_override`;
2. versione `active` del paese (una `shadow` non è mai addebitata); assente → fallback configurato;
3. prodotti del tenant e **peso netto** da `products.weight_grams` × quantità (il peso e il prezzo del
   browser sono ignorati); prodotto senza peso → fallback configurato, mai 400 g;
4. zona tenant (`resolveZoneCodeFromRows`); CAP fuori da ogni zona → **non coperto dal forfait** e
   segue il fallback del tenant (`zone_not_covered`: preventivo provider, oppure non disponibile). Una
   zona ignota non riceve mai il prezzo «standard» (potrebbe essere un'isola). È così che si escludono
   dal forfait aree come Corsica, oltremare e Monaco: la zona del paese copre solo i prefissi serviti.
   Zona `non_deliverable` → non disponibile;
5. `priceFromTariff` + regole paese nella stessa precedenza del live (tariffa → `flat_rate_override`
   → sconto → gratuità sul subtotale server). `packaging_surcharges` non è mai sommato. IVA una volta;
6. **disponibilità logistica** (`checkTariffAvailability`), separata dal prezzo:
   - piano colli uguale a quello della preparazione (colli pieni al limite della versione + resto,
     cartone per collo con `cartonsForWeight`, altrimenti profilo di default o scatola
     `packaging_surcharges`), peso lordo = netto + `tare_g`;
   - preventivo **identico** (stesso CAP, stessi colli) ancora fresco (7 giorni) → disponibile senza chiamata;
   - altrimenti chiamata Packlink con timeout 6 s; servizi persistiti come osservazioni `real_quote`;
     rifiuto / nessun servizio / nessun servizio eleggibile → non disponibile;
   - errore o timeout Packlink → disponibile **solo** con un'osservazione eleggibile dello stesso CAP
     negli ultimi 30 giorni, e mai oltre `logistics_verified_max_weight_g`; altrimenti messaggio chiaro
     e ritiro proposto;
   - provider senza API di preventivo (es. `flat_rate`) → `not_checked`.
7. risposta `{ shippingTotal, shippingDetails, pricingMode: 'tariff', quoteToken (V2) }`.

`provider_cost` e `shadow`: flusso storico invariato (token legacy).

### 12.4 Token V2 (`lib/shipping/quoteToken.ts`)

`v2.<payload>.<HMAC-SHA256>` con dominio di firma distinto dal legacy (un token non vale mai per
l'altro formato). Payload con chiavi fisse e interi: tenant, importo in centesimi, paese, CAP
normalizzato, peso netto in grammi, impronta canonica del carrello (`cartFingerprint`: sha256 di
`id:qty` ordinati), modalità (`tariff` | `provider_cost` per il fallback), id e numero di versione,
preventivo provider firmato, origine della disponibilità, corriere/servizio, scadenza (1 h).
Confronto della firma a tempo costante. Nessun segreto nel client.

### 12.5 Verifica in ogni percorso di pagamento (`lib/shipping/tariff/checkoutShipping.ts`)

| Percorso | Verifica |
|---|---|
| `/api/checkout` (Stripe e pagamento in negozio) | `verifyCheckoutShipping` |
| `/api/checkout/external-link` | `verifyCheckoutShipping` |
| `PATCH /api/checkout-sessions/:id` con nuovo preventivo | `verifyCheckoutShipping` |
| `PATCH` senza nuovo preventivo, `create-intent` (recupero Stripe) | `revalidateSessionShipping` |
| Webhook Stripe, conferma pagamento esterno (`createOrderFromCheckoutSession`) | copiano lo snapshot verificato della sessione, idempotenti (`23505`) |
| Ritiro | nessun forfait, importo 0 |

In `tariff`: token V2 obbligatorio (un legacy → nuovo preventivo); tenant, paese/CAP e impronta del
carrello devono coincidere; il server ricalcola peso, zona, versione attiva e prezzo e li confronta
con il token (versione, peso, centesimi). Qualsiasi differenza (tariffa sostituita o ritirata, carrello
o indirizzo cambiati, token scaduto o alterato) → **409 `SHIPPING_REQUOTE_REQUIRED`**: il checkout e
l'editor di sessione rifanno il preventivo e il cliente riconferma il nuovo importo. Mai un aumento
silenzioso; il PaymentIntent è creato/aggiornato solo dopo la verifica. Un ritorno a `provider_cost`
rende non validi i token e gli snapshot al forfait ancora aperti (nuovo preventivo).

### 12.6 Snapshot sull'ordine

`shipping_details` di un ordine al forfait: `pricingMode: 'tariff'`, `totalWeightG`, `numParcels`,
`carrierName`, `serviceName` (letti da picking/carton e dettaglio ordine) e `tariff: { versionId,
version, name, country, currency, pricesIncludeVat, postalCode, zoneCode, weightG, blocks, band,
parcelsG, zoneSurcharge, vat, theoreticalCents, commercial, finalCents, availability.source,
providerQuoteTtcCents, warnings, verifiedAt }`. `packlinkCost` **non** è scritto (il cliente non ha
pagato il preventivo provider; il rétrotest delle bozze esclude quindi questi ordini). Fallback:
`pricingMode: 'provider_cost_fallback'` + dettagli Packlink + `tariffFallback.reason`. I dati shadow
V1F restano negli ordini storici.

### 12.7 Admin (`/admin/livraison/forfait-shadow`, onglet «Forfait»)

- Stati: Brouillon / Version shadow / Tarification active (paese, dal, autore) / Version retirée.
- «Activer cette tarification pour les clients» su una versione shadow, validata o ritirata →
  schermata di conferma: paese, fasce, blocchi, maggiorazioni, zone escluse, regola paese, conseguenze,
  checklist (`activationChecklist.ts`): migration 125 (bloccante), coerenza versione (bloccante),
  maggiorazioni `per_order` (conferma esplicita obbligatoria, anche lato API), zona extra-doganale
  esclusa, pesi mancanti, cartoni, limite logistico, costo reale degli imballaggi, ordini di test.
- Ritiro per paese; «Revenir au calcul actuel (tous pays)» con conferma; riattivare una versione
  precedente = rollback controllato. Scelta del fallback. Casella della pagina pubblica (default spenta).
- Rapporto: blocco «Commandes facturées au forfait» (forfait pagato, preventivo Packlink del
  momento del pagamento, scarto prima dell'imballaggio — non un margine reale).
- Emballages: campo «Tare du carton (g)».
- API: `POST /api/admin/shipping-tariff-versions/:id/activate` (`{ confirm, acknowledgePerOrderSurcharges }`),
  `POST /api/admin/shipping-tariff-versions/retire`, `PATCH /api/admin/shipping-pricing-mode`
  (`mode`, `fallback`, `publicGrid`), tutte `shipping.manage`.

### 12.8 Limiti rimasti

- Il costo reale degli imballaggi non è in Lepefy: nessun margine completo.
- La tara pesa solo sulla verifica Packlink; il cartone suggerito non è una validazione 3D.
- Le spedizioni restano create a mano in Packlink PRO (nessuna creazione di etichette da Lepefy).
- `applyTariffDraft` (rétrotest delle bozze) non usa ancora `priceFromTariff`.
- Origine `42122` ancora codificata (`FROM_ADDRESS`, `INTELLIGENCE_FROM_ADDRESS`).
- In `provider_cost` (flusso storico) un `flat_rate_override` IT continuerebbe a saltare Packlink per
  Livigno/Campione: il blocco extra-doganale è garantito solo in modalità `tariff`.

---

## 13. Runbook di pubblicazione commerciale

### 13.1 Checklist prima del primo utilizzo

1. Migration `124` e `125` applicate in Supabase; verifica:
   `select shipping_pricing_mode, shipping_tariff_fallback, shipping_public_grid_enabled, count(*) from tenants group by 1,2,3;`
2. Versione IT valida (onglet Forfait): maggiorazioni **par colis** su `IT_SICILY`, `IT_SARDINIA`,
   `IT_CALABRIA`; `IT_EXTRA_CUSTOMS` non consegnabile; collo 15 kg; blocco 30 kg = 19,80 €; limite 50 kg.
3. Prodotti attivi con peso (sezione «Qualité des poids produits»).
4. Cartoni S/M con tranche di suggerimento e tara (Emballages).
5. Costo reale degli imballaggi verificato con il fornitore (≤ 1,79 € TTC per collo, §1).
6. Fallback scelto (consigliato: `unavailable`).
7. Approvazione critica secondo `AGENTS.md`.

### 13.2 Attivazione

Onglet Forfait → versione → «Activer cette tarification pour les clients» → verificare la checklist →
spuntare la conferma → «Activer pour les clients». Subito dopo: un ordine di test verso il continente
e uno verso una zona maggiorata (es. Palermo 90121); controllare in `orders.shipping_details.tariff`
`finalCents`, `zoneSurcharge`, `versionId`, e che `shipping_cost` sia uguale a `finalCents / 100`.

### 13.3 Monitoraggio

Rapporto dell'onglet (blocco commandes au forfait): forfait pagato vs preventivo Packlink TTC e casi
negativi; confrontare con le fatture Packlink reali. Nessuna modifica automatica dei prezzi: una nuova
griglia = nuova bozza → nuova versione → nuova attivazione.

### 13.4 Rollback

- **Un paese:** «Retirer ce tarif» (o riattivare la versione precedente).
- **Tutto:** «Revenir au calcul actuel (tous pays)»; oppure SQL
  `select rollback_shipping_tariff_to_provider_cost('<tenant>', null);`.
- Effetto sui nuovi preventivi immediato; gli ordini pagati conservano il loro snapshot; i checkout
  aperti al forfait devono rifare il preventivo (409 gestito dal client).

### 13.5 Troubleshooting

| Sintomo | Causa / azione |
|---|---|
| «Activer» disabilitato | Migration 125 assente |
| Attivazione rifiutata «par commande» | La versione ha maggiorazioni per ordine: correggere la versione o confermarle esplicitamente |
| «La livraison en ligne n'est pas disponible vers ce code postal» | CAP fuori dalle zone del tenant con fallback `unavailable`: completare `shipping_zones` o scegliere il fallback provider |
| «Les frais de livraison de certains articles…» | Prodotto senza peso con fallback `unavailable` |
| «Impossible de confirmer la livraison…» | Packlink in errore senza evidenza recente del CAP, oppure oltre il limite logistico |
| 409 `SHIPPING_REQUOTE_REQUIRED` frequenti | Tariffa cambiata, carrello o indirizzo modificati dopo il preventivo: comportamento voluto |
| `/livraison` in 404 | Pagina non attivata (default) o nessuna tariffa attiva |
