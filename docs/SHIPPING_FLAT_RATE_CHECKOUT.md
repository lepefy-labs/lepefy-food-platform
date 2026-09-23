# Forfait di spedizione nel checkout — dossier di implementazione

> **Stato:** decisione commerciale in corso — **nulla di questo documento è attivo nel checkout**.
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
(`shipping_tariff_drafts.id = cdae3da2-1c5b-47a4-b47d-b260cd12cea5`). La regola a blocchi oltre 30 kg
non è modellabile nelle bozze attuali (vedi §5.3).

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
| Bozze | `shipping_tariff_drafts` + `lib/shipping/intelligence/tariffBacktest.ts` (`applyTariffDraft`) | **invariante attuale: il checkout non legge le bozze** |

---

## 5. Design raccomandato

### 5.1 Separare *prezzo cliente* e *provider logistico*

Oggi `shipping_provider` mescola due concetti. Raccomandazione:

- `tenants.shipping_provider` resta il **provider logistico** (Packlink: disponibilità, etichette, tracking);
- nuovo `tenants.shipping_pricing_mode`: `'provider_cost'` (default, comportamento attuale) | `'tariff'`.

Così un tenant può avere forfait + Packlink per le spedizioni, e un altro provider in futuro senza
toccare il pricing. Default `provider_cost` → **zero cambiamenti** per i tenant non migrati.

### 5.2 Tariffe pubblicate, versionate e immutabili

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
