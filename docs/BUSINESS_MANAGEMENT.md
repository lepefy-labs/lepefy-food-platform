# Gestion du commerce (fornitori, acquisti, stock, debiti, tesoreria)

> **Stato:** implementato nel codice, dietro il feature flag di rilascio `business_management` (spento per tutti i tenant).
> Migration `139_business_management.sql`, `140_business_management_draft_not_due.sql`, `141_business_management_units_costs_due_dates.sql` (Fase 1.1), con le rispettive verifiche in `supabase/verification/`.
> **Base analizzata:** `main@8d9b1a74` (01/10/2026).

## Overview

Dominio gestionale omnicanale del tenant, dentro l'admin Shop esistente (nessuna seconda applicazione):

- anagrafica **fornitori**;
- **acquisti** fornitore con righe (collegate o no a un prodotto del catalogo);
- **ricezioni** merce complete o parziali, quantità **decimali** con **unità di misura** e **conversione** verso le unità di stock vendibili, con **ledger di inventario** e incremento atomico di `products.stock`;
- schermata **stock** (prodotti, ledger dei movimenti, rettifiche manuali motivate);
- **costo d'acquisto prodotto** (ultimo costo ricevuto, per unità di stock) con storico append-only;
- **scadenze di pagamento** fornitori (condizioni di default del fornitore, scadenza per acquisto, dashboard);
- **debiti** derivati (mai un saldo memorizzato);
- **pagamenti** fornitore a rate, a **beneficiari terzi** su istruzione del fornitore, da verificare;
- **allocazioni** di un pagamento su uno o più acquisti;
- **tesoreria** operativa (registro delle uscite verso i fornitori);
- **documenti** privati e **audit** completo.

Fuori scope: POS, cassa, fiscalità, IVA, riconciliazione bancaria, OCR, lotti/scadenze alimentari, multi-magazzino, landed cost, costo medio ponderato/FIFO, previsioni, riordino automatico, vendita frazionaria in storefront, automazioni n8n.

## Feature flag

- Chiave: `business_management` (registry `lib/featureFlags/featureFlagRegistry.ts`), label "Gestion du commerce".
- Tabella `tenant_feature_flags` (migration 138): riga assente, `enabled = false` o errore di lettura = **modulo inesistente**.
- La migration 139 **non** attiva nessun tenant. L'attivazione passa solo da `/admin/parametres/fonctionnalites`.
- Guard unico `lib/gestion/featureGate.ts`:
  - `requireBusinessManagementPage(permissions)`: flag spento → `notFound()` (404); capability mancante → redirect `/admin`; tenant diverso → login.
  - `requireBusinessManagementApi(extra?)`: flag spento → 404 JSON; poi `requireAdmin()` (mappa centrale) ed eventuale capability extra.
  - `isBusinessManagementEnabled(tenantId)`: usato dal layout admin **solo** se l'utente ha almeno una capability Gestion (nessuna query inutile).
- Nascondere il menu non è un controllo di sicurezza: ogni pagina e ogni handler chiamano il guard (test `tests/unit/gestion.spec.ts` lo verifica per tutti i file).

## Architecture

```text
UI (Server Components + form client) ─┐
                                      ├─> /api/admin/gestion/** ──> requireBusinessManagementApi ──> RPC (service role)
Pagine /admin/gestion/** ─────────────┘        (flag + capability)                               │
        letture: lib/gestion/queries.ts (service role, filtro tenant_id, view dei saldi) <─────────┘
```

- `lib/gestion/domain.ts`: costanti, etichette FR, regole pure (`purchasePaymentState`, `validateAllocationPlan`, `isMoneyAmount`, `dueInfo`, `summarizeDues`, `receiptProgress`, `latestActiveCostEntry`, `indicativeMargin`, formati di riferimento).
- `lib/gestion/quantity.ts`: aritmetica decimale esatta (BigInt scalati): parsing di quantità e conversioni, residuo, impatto stock, costo per unità di stock. Nessun float JS fa autorità.
- `lib/gestion/schemas.ts`: validazione zod degli input (importi arrotondati al centesimo, quantità trasmesse come stringhe decimali canoniche).
- `lib/gestion/permissions.ts`: mappa route → capability (usata da `adminApiPermissions.ts`).
- `lib/gestion/rpc.ts`: chiamata RPC + traduzione errori (`lib/gestion/errors.ts`) + `revalidateGestion()`.
- `lib/gestion/documents.ts`, `files.ts`: allegati privati.
- Gestion è un dominio funzionale dentro il workspace `shop` (nessun `AdminWorkspace = 'gestion'`, nessun host dedicato). Il modello dati non dipende dal workspace: potrà diventare un workspace autonomo senza migrazioni.

## Routes

| Pagina | Capability |
|---|---|
| `/admin/gestion` (vue d'ensemble) | una fra `suppliers.view`, `purchases.view`, `treasury.view`, `inventory.view` |
| `/admin/gestion/fournisseurs`, `/[id]` | `suppliers.view` |
| `/admin/gestion/fournisseurs/nouveau` | `suppliers.manage` |
| `/admin/gestion/achats`, `/[id]` | `purchases.view` |
| `/admin/gestion/achats/nouveau`, `/[id]/modifier` | `purchases.manage` |
| `/admin/gestion/tresorerie`, `/[id]` | `treasury.view` |
| `/admin/gestion/tresorerie/nouveau` | `treasury.manage` |
| `/admin/gestion/stocks` (prodotti, `?vue=mouvements`, rettifica `?ajuster=`) | `inventory.view` (rettifica: `inventory.manage`) |
| Fiche produit Catalogue `/admin/catalogue/[id]`: pannello "Coût d'achat" | flag attivo + `inventory.view` o `purchases.view` |

Le sezioni interne sono mostrate secondo le capability (es. i pagamenti di un acquisto solo con `treasury.view`).

| API (`/api/admin/gestion`) | Metodo | Capability |
|---|---|---|
| `/suppliers`, `/suppliers/[id]` | GET / POST, PATCH | `suppliers.view` / `suppliers.manage` |
| `/products` (ricerca catalogo) | GET | `purchases.view` |
| `/purchases`, `/purchases/[id]` (filtri `status`, `pay`) | GET / POST, PATCH | `purchases.view` / `purchases.manage` |
| `/purchases/[id]/status` | POST | `purchases.manage` |
| `/purchases/[id]/due-date` | POST | `purchases.manage` |
| `/purchases/[id]/receipts` | POST | `inventory.manage` |
| `/receipts/[id]/reverse` | POST | `inventory.manage` |
| `/inventory/adjustments` | POST | `inventory.manage` |
| `/inventory/products` (ricerca per la rettifica) | GET | `inventory.view` |
| `/payments` | GET / POST | `treasury.view` / `treasury.manage` |
| `/payments/[id]/allocations` | POST | `treasury.manage` |
| `/payments/[id]/verify` | POST | `supplier_payments.verify` |
| `/payments/[id]/void` | POST | `treasury.manage` (+ `supplier_payments.verify` se il pagamento è già verificato) |
| `/allocations/[id]/reverse` | POST | `treasury.manage` |
| `/documents/{supplier\|purchase\|receipt\|supplier_payment}/[entityId][/documentId]` | GET / POST, DELETE | `.view` / `.manage` del dominio dell'entità |

Tutte le pagine e le API: `dynamic = 'force-dynamic'` + `fetchCache = 'force-no-store'`; le API che scrivono chiamano `revalidatePath('/admin/gestion', 'layout')`.

## Domain model

Tutte le tabelle hanno `tenant_id` (FK `tenants`, indice) e una chiave `unique (tenant_id, id)`: ogni riferimento fra entità è una **FK composita** `(tenant_id, …)`.

| Tabella | Ruolo |
|---|---|
| `suppliers` | Fornitore (codice `FOU-`) |
| `supplier_purchases` / `supplier_purchase_items` | Acquisto e righe |
| `supplier_receipts` / `supplier_receipt_items` | Evento di ricezione e quantità per riga |
| `inventory_movements` | Ledger inventario |
| `supplier_payments` / `supplier_payment_allocations` | Uscite e loro ripartizione sugli acquisti |
| `business_documents` | Metadati degli allegati privati |
| `business_audit_events` | Journal append-only |
| `business_reference_counters` | Contatori dei riferimenti leggibili |
| `product_costs` | Costo d'acquisto corrente per prodotto (cache deterministica dello storico) |
| `product_cost_history` | Storico append-only dei costi per riga di ricezione |
| view `supplier_purchase_financials`, `supplier_balances` | Saldi e scadenze derivati (`security_invoker`) |
| view `inventory_product_overview` | Stock, ultimo movimento, ultima ricezione, costo corrente per prodotto (`security_invoker`) |

`products` riceve solo il vincolo additivo `products_tenant_id_id_key unique (tenant_id, id)` (necessario alle FK composite; `id` è già PK).

## Supplier model

Campi: `code`, `name`, `legal_name`, `contact_name`, `email` (normalizzata minuscola), `phone`, `whatsapp_phone`, `address`, `country` (ISO 2), `currency` (ISO 3, default valuta tenant), `notes`, `active`, `default_payment_terms_days` (0-3650 o nullo; UI "Conditions de paiement": immédiat, 30, 60, 90 jours, personnalisé; nessuna enum). **Nessun saldo** in tabella: vedi `supplier_balances` (totale acquistato, pagato verificato, registrato non verificato, residuo, pagamenti non allocati, ultimo acquisto/pagamento). Un fornitore inattivo non riceve nuovi acquisti. Nessuna cancellazione (si disattiva).

## Purchase state machine

Stato merce (`supplier_purchases.status`), separato dallo stato finanziario:

```text
draft ──(Passer la commande)──> ordered ──ricezione parziale──> partially_received ──ricezione completa──> received
  │                               │  └────────────ricezione completa────────────────────────────────────────┘
  └──────────(annulla)────────────┴──> cancelled   (solo senza ricezioni attive e senza allocazioni attive)
```

- `partially_received` / `received` sono **derivati** dalle quantità ricevute (`refresh_supplier_purchase_receipt_status`), mai scelti dall'utente. Uno storno di ricezione riporta lo stato indietro.
- Modifica (righe, spese, date, note): solo `draft`/`ordered` **senza nessuna ricezione**; il totale non può scendere sotto l'importo già allocato.
- Totali calcolati in DB: `line_total = round(qty × unit_cost, 2)`, `subtotal = Σ line_total`, `total = subtotal + additional_costs` (CHECK).
- Righe: `ordered_quantity numeric(14,3)` (> 0, al più 3 decimali, mai arrotondata: `quantity_precision`), `purchase_unit` (`unit | kg | g | l | ml | pack | box | carton | other`, UI: unité, kg, g, L, ml, pack, boîte, carton, autre), `unit_cost` per unità d'acquisto, e per una riga collegata al catalogo `stock_units_per_purchase_unit` (default 1; es. 2 per kg, 12 per carton). Riga fuori catalogo: conversione nulla, nessun effetto stock.
- Avanzamento ricezione mostrato **per riga** (`receiptProgress`): kg, L e cartoni non si sommano.
- Stato finanziario (UI, `purchasePaymentState`): `Pas encore engagé` (bozza), `À payer`, `Payé partiellement`, `Paiement à vérifier`, `Payé vérifié`, `Annulé`.

## Receipt model

Una ricezione (`REC-AAAA-NNNNNN`) è un evento distinto dall'acquisto: data reale, note, autore, righe con quantità decimale nell'unità d'acquisto. Ogni riga conserva lo **snapshot** `purchase_unit`, `conversion_factor` e `stock_units` (delta intero applicato allo stock): una modifica successiva della conversione non reinterpreta mai la storia.

Conversione: `stock_units = quantità × conversione` deve essere **intero** (es. 12,5 kg × 2 = 25 unità); altrimenti la ricezione è rifiutata (`stock_units_not_integer`, es. 3,5 L × 1), mai arrotondata. Il form mostra commandé, déjà reçu, reste, quantità attuale, unità e impatto stock con aritmetica esatta. Ammesse più ricezioni per acquisto, parziali o complete. Rifiutata una quantità oltre il residuo della riga (`quantity_exceeds_remaining`). Uno **storno** (`reverse_supplier_receipt`, motivo obbligatorio) scala esattamente `stock_units` storici (mai la conversione corrente), solo se disponibile (altrimenti `insufficient_stock_for_reversal`), crea movimenti `reversal`, marca `reversed` le voci di storico costo corrispondenti, ricalcola il costo corrente e conserva la ricezione con stato `reversed`.

## Inventory ledger

`inventory_movements`: `movement_type` ∈ `supplier_receipt | manual_adjustment | reversal`, `quantity_delta` (intero, variazione di `products.stock`), `stock_after`, `source_type` (`supplier_receipt_item | manual`), `source_id`, `source_quantity` + `source_unit` + `conversion_factor` (es. "12,5 kg reçus → +25 unités"), `source_reference` (REC-…), `reason` (motivo della rettifica), `note`, autore. I movimenti esistenti prima della 141 sono stati completati (1 unità = 1 unità di stock) senza riscrivere i valori storici.

- `products.stock` **resta il valore operativo canonico** (storefront e checkout invariati). La ricezione incrementa `products.stock` e scrive il movimento **nella stessa transazione**.
- Indice unico `(movement_type, source_type, source_id)`: una riga di ricezione produce al più un'entrata e uno storno.
- Righe senza prodotto collegato: ricevute ma senza effetto sullo stock (dichiarato in UI).
- Rettifica manuale da `/admin/gestion/stocks` ("Ajuster le stock"): prodotto, variazione intera +/-, motivo obbligatorio (erreur de comptage, inventaire physique, casse, produit perdu, produit périmé, autre), nota facoltativa. RPC `adjust_inventory(…, p_reason, p_note, …)`: stock + movimento + audit nella stessa transazione, idempotente, mai stock negativo. **Una rettifica non crea né modifica il costo d'acquisto.**

## Stock UI

`/admin/gestion/stocks`:

- **Prodotti** (view `inventory_product_overview`, paginazione server-side 25): stock attuale, ultimo movimento, ultima ricezione, ultimo costo d'acquisto, allarmi (Rupture, Sans coût connu, Inactif); filtri ricerca, "Avec mouvement", "Sans coût connu", "En rupture", tipo di movimento e periodo (prodotti con almeno un movimento corrispondente).
- **Mouvements** (ledger, paginazione server-side 30): data, prodotto, tipo, quantità e unità sorgente, conversione, variazione, stock dopo, riferimento, motivo/nota, autore; filtri prodotto, tipo, dal, al.
- Mobile: card/righe adattive, nessuna tabella compressa.

## Product costs

- Metodo unico **`last_received_purchase_cost`**: l'ultima ricezione valida (per data di ricezione, poi creazione) di una riga collegata al catalogo definisce `product_costs.current_purchase_cost`, **per unità di stock**: `round(unit_cost / conversione, 4)` (es. 12,5 kg a 8 €/kg con 2 unità/kg → 4 € per unità).
- **Frais supplémentaires exclus du coût produit en V1.1** (`additional_costs` non ripartiti; nessun landed cost).
- `product_cost_history`: una riga per riga di ricezione (prodotto, fornitore, acquisto, ricezione, quantità e unità d'acquisto, conversione, unità di stock, costo d'acquisto, costo per unità, valuta). Append-only (trigger): può cambiare solo lo stato `active → reversed`.
- `refresh_product_cost()` ricalcola deterministicamente il costo corrente dall'ultima voce attiva: dopo lo storno di una ricezione torna il costo precedente; senza voci attive il costo scompare. Mai il costo di una ricezione annullata.
- Ordine della "ultima voce" (migration 142): giorno di ricezione nel fuso Gestion (Europe/Paris) più recente, poi ordine di registrazione (`created_at`, default `clock_timestamp()`), poi `received_at`, poi `id`. L'orario dentro la giornata non conta: il form invia l'istante reale per una ricezione di oggi (mai un orario futuro) e l'API rifiuta una `received_at` futura. Il pannello Catalogue marca "Coût courant" tramite `product_costs.source_history_id`, senza ricalcolare la regola in TypeScript.
- Nessun costo medio ponderato (stock preesistente, vendite e rettifiche senza costo noto lo renderebbero inaffidabile).
- Tabelle server-only (RLS senza policy, solo `service_role`), mai colonne su `products`, mai in `PUBLIC_TENANT_FIELDS`, mai inviate al storefront.
- UI: colonna "Dernier coût d'achat" in Stocks; pannello read-only "Coût d'achat" nella fiche prodotto Catalogue (ultimo costo, data, fornitore, acquisto sorgente, storico recente, prezzo di vendita e **"Marge indicative"** = prezzo - ultimo costo, mai presentata come margine netto o contabile), renderizzato lato server solo con flag attivo e capability Gestion.

## Payment due dates

- `supplier_purchases.payment_due_date` (scadenza **finanziaria**) è distinta da `expected_date` (consegna prevista) e da `supplier_payments.payment_date` (data del pagamento).
- Alla creazione: data fornita, altrimenti `order_date + suppliers.default_payment_terms_days` se definito. La data è **salvata sull'acquisto**: cambiare le condizioni del fornitore non modifica le scadenze esistenti.
- Modificabile da "Échéance de paiement" sul dettaglio acquisto (`set_supplier_purchase_due_date`, anche dopo le ricezioni, mai su un acquisto annullato).
- Stato derivato, mai memorizzato (`dueInfo`): `Pas encore engagé` (bozza), `Annulé`, `Payé` (residuo 0, anche con scadenza passata), `Pas d'échéance`, `En retard de N jours`, `Aujourd'hui`, `À payer sous N jours` (≤ 7), `À venir`. Bozze e annullati mai in ritardo. "Oggi" è calcolato nel fuso `Europe/Paris` (`GESTION_TIME_ZONE`).
- Dashboard: KPI À payer, À payer sous 7 jours, En retard, Paiements à vérifier e sezione "Échéances fournisseurs" per urgenza. Lista acquisti: filtri Paiement (Tous, À payer, À échéance bientôt, En retard, Payés, Sans échéance) calcolati lato server sulla view. Trésorerie: pannello "Échéances ouvertes" separato dal registro dei pagamenti.

## Supplier payments

`supplier_payments` (`PAY-AAAA-NNNNNN`): importo, valuta, data (non futura), metodo `cash | bank_transfer | card | other`, stato `recorded | verified | voided`, conto/cassa usato, riferimenti, note, autore, verificatore, annullamento con motivo.

- Un pagamento nasce **`recorded`** ("enregistré, à vérifier"): **non riduce il debito**.
- `verify_supplier_payment` (capability critica) lo porta a `verified`: solo allora le sue allocazioni riducono il residuo.
- `void_supplier_payment`: stato `voided`, motivo obbligatorio, allocazioni attive stornate; la riga resta (nessun DELETE possibile).

## Third-party beneficiaries

`beneficiary_type = supplier | third_party`. Con `third_party`: `beneficiary_name` obbligatorio (DB, API, UI), più `beneficiary_reference`, `supplier_instruction_note` e documenti `payment_proof` / `supplier_instruction`. UI: "Payé à un tiers sur instruction du fournisseur". **Il creditore resta `supplier_id`**: il debito verso il fornitore si riduce solo con un'allocazione attiva di un pagamento verificato.

## Payment allocations

`supplier_payment_allocations`: un pagamento può coprire un acquisto intero, parte di un acquisto o più acquisti; un acquisto può ricevere più pagamenti (rate). Vincoli (RPC sotto lock + DB):

- somma delle allocazioni attive ≤ importo del pagamento (`payment_over_allocated`);
- allocazione ≤ residuo allocabile dell'acquisto (`purchase_over_allocated`);
- stesso tenant (FK composite), stesso fornitore, stessa valuta;
- pagamento non annullato, acquisto non annullato;
- una sola allocazione attiva per coppia pagamento/acquisto (indice unico parziale).

Storno: `reverse_supplier_payment_allocation` (motivo obbligatorio, riga conservata).

## Outstanding balance rules

Per acquisto (view `supplier_purchase_financials`):

```text
paid_verified   = Σ allocazioni attive di pagamenti verified
paid_unverified = Σ allocazioni attive di pagamenti recorded
outstanding     = total - paid_verified            (0 se bozza o annullato, migration 140)
allocatable     = total - paid_verified - paid_unverified
```

La view espone anche `payment_due_date`, `order_date` e quantità ordinate/ricevute `numeric(16,3)`.

Una **bozza** non è un debito: non entra nel residuo né nei totali del fornitore (stato UI "Pas encore engagé"), ma resta allocabile (acconto). Diventa dovuta quando passa a `ordered`.

Esempio verificato (verification SQL, seed): acquisto 2 400 € = 600 € bonifico fornitore + 500 € bonifico a un terzo + 300 € contanti, tutti verificati → **resta 1 000 €**. Il client non invia mai un saldo: il server lo calcola.

## RBAC

| Capability | Rischio |
|---|---|
| `suppliers.view`, `purchases.view`, `inventory.view`, `treasury.view` | standard |
| `suppliers.manage`, `purchases.manage`, `inventory.manage`, `treasury.manage` | sensitive |
| `supplier_payments.verify` | critical (verifica e annullamento di un pagamento già verificato) |

La migration le assegna solo ai ruoli di sistema `platform_owner` e `tenant_admin` (che per contratto le ha comunque via `canAdmin`); **nessun ruolo custom esistente le riceve**. File aggiornati: `admin_permissions` (139), `adminRoutePermissions.ts` (con `anyOf` per la dashboard), `adminApiPermissions.ts`, `adminRbac.ts` (fallback legacy tenant_admin), `AdminSidebar` (sezione GESTION, solo con flag attivo e capability), layout protetto.

## Security / RLS

- Tutte le tabelle: RLS attiva **senza policy**, `REVOKE ALL` da `public`, `anon`, `authenticated` **e** `service_role`, poi GRANT espliciti al solo `service_role`.
- Nessun `DELETE` per il service role su tabelle finanziarie e di audit (`suppliers`, acquisti, ricezioni, movimenti, pagamenti, allocazioni, documenti, audit). Solo `supplier_purchase_items` ha DELETE (sostituzione righe prima di ogni ricezione).
- View dei saldi `security_invoker`, lette solo da `service_role`.
- RPC: `EXECUTE` revocato a `public/anon/authenticated`, concesso a `service_role`.
- Bucket storage `business-documents` **privato**, nessuna policy su `storage.objects`.
- `product_costs`, `product_cost_history`, `inventory_product_overview`: stessi principi; nessun DELETE sullo storico costi.

## RPC

Tutte `RETURNS TABLE (out_…)`, colonne SQL qualificate con alias, `set search_path = public`.

| RPC | Output |
|---|---|
| `create_supplier`, `update_supplier` | `out_supplier_id, out_code, out_created` / `out_supplier_id, out_updated` |
| `save_supplier_purchase` (crea o modifica) | `out_purchase_id, out_reference, out_created, out_total` |
| `set_supplier_purchase_status` (`ordered`/`cancelled`) | `out_purchase_id, out_status, out_changed` |
| `record_supplier_receipt` | `out_receipt_id, out_reference, out_created, out_purchase_status` |
| `reverse_supplier_receipt` | `out_receipt_id, out_reversed, out_purchase_status` |
| `adjust_inventory` (motivo + nota, 141) | `out_movement_id, out_created, out_stock_after` |
| `set_supplier_purchase_due_date` | `out_purchase_id, out_payment_due_date, out_changed` |
| `record_supplier_payment` (+ allocazioni) | `out_payment_id, out_reference, out_created` |
| `allocate_supplier_payment` | `out_allocation_id, out_created` |
| `reverse_supplier_payment_allocation` | `out_allocation_id, out_changed` |
| `verify_supplier_payment` | `out_payment_id, out_status, out_changed` |
| `void_supplier_payment` | `out_payment_id, out_status, out_changed, out_reversed_allocations` |

Interne: `next_business_reference`, `log_business_event`, `business_text`, `business_quantity`, `business_payment_terms`, `replace_supplier_purchase_items`, `refresh_supplier_purchase_receipt_status`, `refresh_product_cost`, `apply_supplier_payment_allocation`. `record_supplier_receipt`: validazione → lock → quantità decimali → residuo → delta stock intero → stock → movimento → costo → storico costo → audit, in una transazione. Pattern: validazione → lock (`FOR UPDATE`, ordine acquisto → ricezione, pagamento → acquisti per id) → controllo stato → controllo importi/quantità → scritture → audit → risultato autorevole. Errori: `raise exception '<codice>[:dettaglio]'`, tradotti in francese da `lib/gestion/errors.ts`.

## Idempotency

- Ogni creazione porta una **request key** (UUID generato dal form, riusato per retry/doppio clic, rinnovato solo dopo un successo: `useGestionMutation`).
- Vincoli unici `(tenant_id, request_key)` su fornitori, acquisti, ricezioni, pagamenti, allocazioni, rettifiche; `pg_advisory_xact_lock` sulla chiave per le creazioni senza riga padre da bloccare.
- Una seconda chiamata con la stessa chiave restituisce la riga esistente con `out_created = false` (nessun secondo incremento di stock, nessun secondo pagamento); stessa chiave su un'altra entità → `request_key_conflict`.
- Verifica, annullamento e storni sono idempotenti sullo stato (`out_changed = false`).

## Audit

`business_audit_events` (append-only: niente UPDATE/DELETE per il service role). Eventi: `supplier.created|updated`, `purchase.created|updated|status_changed`, `receipt.recorded|reversed`, `inventory.adjusted`, `payment.recorded|verified|voided`, `allocation.created|reversed`, `document.uploaded|deleted`. Scritti **nella stessa transazione** dell'operazione (RPC) tranne i documenti (API). Metadata limitati a riferimenti, importi, stati, motivi troncati; mai segreti, file o dati bancari completi (CHECK ≤ 8 KB). Visibili nelle sezioni "Historique".

## Attachments

`business_documents` collegabili a `supplier | purchase | receipt | supplier_payment`; tipi `invoice | receipt | delivery_note | payment_proof | supplier_instruction | other`.

- Storage privato `business-documents`, percorso `<tenant_id>/<entità>/<id>/<uuid>-<nome>` (CHECK sul prefisso tenant).
- Trigger `business_documents_check_entity`: l'entità deve esistere **nello stesso tenant**.
- Upload: max 10 MB, tipo reale rilevato dai byte (PDF, JPEG, PNG, WebP), nome ripulito; lettura solo via `GET /api/admin/gestion/documents/...` (`Cache-Control: private, no-store`, `nosniff`).
- Eliminazione logica (`deleted_at`): il file resta per l'audit. Nessun OCR.

## Seed

`scripts/seed-test-tenant-gestion.mjs` (workflow "Seed Test Tenant", input `with_gestion`):

- rifiuta i tenant con `is_test != true`;
- passa sempre dalle RPC;
- crea 4 fornitori e 6 acquisti (bozza, ordinato, ricevuto in parte, ricevuto non pagato, pagato in parte = esempio 2 400 €, pagato interamente), ricezioni, pagamenti a rate, un pagamento a un terzo e un pagamento da verificare;
- idempotente (request key `seed-gestion-*`, skip in JS dopo la fetch, log letti / da creare / creati), `DRY_RUN`.

Richiede il seed catalogo (`seed-test-tenant.mjs`).

## Rollout

1. Applicare in ordine `139`, `140`, `141` con le rispettive verification SQL (il SQL Editor mostra "Success": ogni controllo fallito solleva un'eccezione; la notice finale è "Migration 14x - vérifications OK"). La verifica 139 usa la firma di `adjust_inventory` precedente alla 141: va eseguita prima della 141.
2. Deploy del codice: nessun tenant vede Gestion (flag assente), nessuna modifica per i tenant reali.
3. Seed `lepefy-test` (`with_gestion = true`).
4. Attivare "Gestion du commerce" **solo** su `lepefy-test` da `/admin/parametres/fonctionnalites`.
5. Test reale, poi eventuale attivazione di altri tenant solo dopo verifica esplicita.

Il codice deployato prima della migration resta inerte finché il flag è spento (legge solo `tenant_feature_flags`, 138). Accendere il flag prima della 139 farebbe fallire le pagine Gestion: applicare sempre prima la migration.

## Operational runbook

- **Registrare un acquisto**: Achats → Nouvel achat → righe (catalogo o libere) → "Enregistrer et commander".
- **Ricevere merce**: aprire l'acquisto → "Enregistrer une réception" → quantità per riga nell'unità d'acquisto (o "Tout le reste est reçu"); controllare l'impatto stock mostrato.
- **Rettificare lo stock**: Stocks → "Ajuster le stock" (o "Ajuster" sulla riga) → variazione, motivo, nota.
- **Scadenze**: definire le condizioni di pagamento del fornitore; controllare "Échéances fournisseurs" in dashboard o il filtro "En retard" degli acquisti.
- **Pagare**: Trésorerie → Enregistrer un paiement (o dal dettaglio acquisto) → ripartizione sugli acquisti → allegare la prova → "Vérifier" quando il denaro è effettivamente uscito.
- **Errore di ricezione**: annullare la ricezione (motivo) e registrarla di nuovo.
- **Errore di pagamento**: ritirare l'allocazione o annullare il pagamento (motivo); mai cancellare.

## Troubleshooting

| Sintomo | Causa | Azione |
|---|---|---|
| `/admin/gestion` risponde 404 | flag spento o illeggibile | attivare "Gestion du commerce" per il tenant; verificare migration 138 |
| Voce GESTION assente nel menu | flag spento o nessuna capability Gestion | idem, oppure assegnare le capability al ruolo |
| "Stock insuffisant pour annuler cette réception" | merce già venduta | rettifica manuale motivata invece dello storno |
| "Le montant affecté dépasse le reste à payer" | allocazioni già presenti (anche non verificate) | ridurre l'importo o ritirare un'allocazione |
| Pagamento non riduce il debito | stato `recorded` | verificarlo (capability `supplier_payments.verify`) |
| Upload rifiutato | tipo non ammesso o > 10 MB | PDF/JPEG/PNG/WebP ≤ 10 MB |
| "…doit être un nombre entier" in ricezione | quantità × conversione non intera | correggere la quantità ricevuta o la conversione della riga (prima di ogni ricezione) |
| "Quantité trop précise" | più di 3 decimali | arrotondare consapevolmente la quantità |
| Costo prodotto assente | nessuna ricezione valida di una riga collegata | registrare la ricezione; le rettifiche non creano costi |

## Known limitations

- Nessuna chiusura "ricevuto con ammanco definitivo": un acquisto con merce mai consegnata resta `partially_received` (annotare in nota; storno/annullamento non applicabili se c'è già una ricezione).
- `products.stock` resta intero: la vendita frazionaria (es. al kg) in storefront non è supportata; le conversioni devono dare unità intere.
- Costo prodotto = ultimo costo d'acquisto ricevuto: niente costo medio ponderato, niente landed cost (frais supplémentaires esclusi), niente valorizzazione dell'inventario; la marge indicative non è un margine contabile.
- La conversione di una riga non è modificabile dopo la prima ricezione (come le altre modifiche della riga).
- Documenti caricabili dall'UI su fornitore, acquisto e pagamento; il tipo `receipt` è supportato da DB/API ma l'UI allega i bolle di consegna all'acquisto.
- La ricerca globale admin non indicizza fornitori/acquisti.
- Concorrenza verificata per costruzione (lock, vincoli unici) e con la verification SQL a connessione singola, non con un test di carico concorrente.

## Future roadmap

Workspace autonomo `gestion`, landed cost e costo medio ponderato con valorizzazione dell'inventario, promemoria delle scadenze, cash-flow consolidato con gli incassi (`tenant_card_payments`, ordini), import fatture/OCR, multi-magazzino e lotti, riconciliazione bancaria.
