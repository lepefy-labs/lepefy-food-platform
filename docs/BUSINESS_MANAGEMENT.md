# Gestion du commerce (fornitori, acquisti, stock, debiti, tesoreria)

> **Stato:** implementato nel codice, dietro il feature flag di rilascio `business_management` (spento per tutti i tenant).
> Migration `139_business_management.sql` + verifica `supabase/verification/139_business_management_verification.sql`.
> **Base analizzata:** `main@58380c67` (30/09/2026).

## Overview

Dominio gestionale omnicanale del tenant, dentro l'admin Shop esistente (nessuna seconda applicazione):

- anagrafica **fornitori**;
- **acquisti** fornitore con righe (collegate o no a un prodotto del catalogo);
- **ricezioni** merce complete o parziali, con **ledger di inventario** e incremento atomico di `products.stock`;
- **debiti** derivati (mai un saldo memorizzato);
- **pagamenti** fornitore a rate, a **beneficiari terzi** su istruzione del fornitore, da verificare;
- **allocazioni** di un pagamento su uno o più acquisti;
- **tesoreria** operativa (registro delle uscite verso i fornitori);
- **documenti** privati e **audit** completo.

Fuori scope: POS, cassa, fiscalità, IVA, riconciliazione bancaria, OCR, lotti/scadenze, multi-magazzino, costo medio/FIFO, previsioni, automazioni n8n.

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

- `lib/gestion/domain.ts`: costanti, etichette FR, regole pure (`purchasePaymentState`, `validateAllocationPlan`, `isMoneyAmount`, formati di riferimento).
- `lib/gestion/schemas.ts`: validazione zod degli input (importi arrotondati al centesimo).
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

Le sezioni interne sono mostrate secondo le capability (es. i pagamenti di un acquisto solo con `treasury.view`).

| API (`/api/admin/gestion`) | Metodo | Capability |
|---|---|---|
| `/suppliers`, `/suppliers/[id]` | GET / POST, PATCH | `suppliers.view` / `suppliers.manage` |
| `/products` (ricerca catalogo) | GET | `purchases.view` |
| `/purchases`, `/purchases/[id]` | GET / POST, PATCH | `purchases.view` / `purchases.manage` |
| `/purchases/[id]/status` | POST | `purchases.manage` |
| `/purchases/[id]/receipts` | POST | `inventory.manage` |
| `/receipts/[id]/reverse` | POST | `inventory.manage` |
| `/inventory/adjustments` | POST | `inventory.manage` |
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
| view `supplier_purchase_financials`, `supplier_balances` | Saldi derivati (`security_invoker`) |

`products` riceve solo il vincolo additivo `products_tenant_id_id_key unique (tenant_id, id)` (necessario alle FK composite; `id` è già PK).

## Supplier model

Campi: `code`, `name`, `legal_name`, `contact_name`, `email` (normalizzata minuscola), `phone`, `whatsapp_phone`, `address`, `country` (ISO 2), `currency` (ISO 3, default valuta tenant), `notes`, `active`. **Nessun saldo** in tabella: vedi `supplier_balances` (totale acquistato, pagato verificato, registrato non verificato, residuo, pagamenti non allocati, ultimo acquisto/pagamento). Un fornitore inattivo non riceve nuovi acquisti. Nessuna cancellazione (si disattiva).

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
- Stato finanziario (UI, `purchasePaymentState`): `À payer`, `Payé partiellement`, `Paiement à vérifier`, `Payé vérifié`, `Annulé`.

## Receipt model

Una ricezione (`REC-AAAA-NNNNNN`) è un evento distinto dall'acquisto: data reale, note, autore, righe con quantità. Ammesse più ricezioni per acquisto, parziali o complete. Rifiutata una quantità oltre il residuo della riga (`quantity_exceeds_remaining`). Uno **storno** (`reverse_supplier_receipt`, motivo obbligatorio) scala lo stock solo se disponibile (altrimenti `insufficient_stock_for_reversal`), crea movimenti `reversal` e conserva la ricezione con stato `reversed`.

## Inventory ledger

`inventory_movements`: `movement_type` ∈ `supplier_receipt | manual_adjustment | reversal`, `quantity_delta`, `stock_after`, `source_type` (`supplier_receipt_item | manual`), `source_id`, nota, autore.

- `products.stock` **resta il valore operativo canonico** (storefront e checkout invariati). La ricezione incrementa `products.stock` e scrive il movimento **nella stessa transazione**.
- Indice unico `(movement_type, source_type, source_id)`: una riga di ricezione produce al più un'entrata e uno storno.
- Righe senza prodotto collegato: ricevute ma senza effetto sullo stock (dichiarato in UI).
- Rettifica manuale: RPC `adjust_inventory` + `POST /api/admin/gestion/inventory/adjustments` (motivo obbligatorio, mai stock negativo). Nessuna schermata dedicata in questa fase.

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
outstanding     = total - paid_verified            (0 se annullato)
allocatable     = total - paid_verified - paid_unverified
```

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

## RPC

Tutte `RETURNS TABLE (out_…)`, colonne SQL qualificate con alias, `set search_path = public`.

| RPC | Output |
|---|---|
| `create_supplier`, `update_supplier` | `out_supplier_id, out_code, out_created` / `out_supplier_id, out_updated` |
| `save_supplier_purchase` (crea o modifica) | `out_purchase_id, out_reference, out_created, out_total` |
| `set_supplier_purchase_status` (`ordered`/`cancelled`) | `out_purchase_id, out_status, out_changed` |
| `record_supplier_receipt` | `out_receipt_id, out_reference, out_created, out_purchase_status` |
| `reverse_supplier_receipt` | `out_receipt_id, out_reversed, out_purchase_status` |
| `adjust_inventory` | `out_movement_id, out_created, out_stock_after` |
| `record_supplier_payment` (+ allocazioni) | `out_payment_id, out_reference, out_created` |
| `allocate_supplier_payment` | `out_allocation_id, out_created` |
| `reverse_supplier_payment_allocation` | `out_allocation_id, out_changed` |
| `verify_supplier_payment` | `out_payment_id, out_status, out_changed` |
| `void_supplier_payment` | `out_payment_id, out_status, out_changed, out_reversed_allocations` |

Interne: `next_business_reference`, `log_business_event`, `business_text`, `replace_supplier_purchase_items`, `refresh_supplier_purchase_receipt_status`, `apply_supplier_payment_allocation`. Pattern: validazione → lock (`FOR UPDATE`, ordine acquisto → ricezione, pagamento → acquisti per id) → controllo stato → controllo importi/quantità → scritture → audit → risultato autorevole. Errori: `raise exception '<codice>[:dettaglio]'`, tradotti in francese da `lib/gestion/errors.ts`.

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

1. Applicare `139_business_management.sql`, poi eseguire `139_business_management_verification.sql` (deve terminare con "Migration 139 - vérifications OK").
2. Deploy del codice: nessun tenant vede Gestion (flag assente), nessuna modifica per i tenant reali.
3. Seed `lepefy-test` (`with_gestion = true`).
4. Attivare "Gestion du commerce" **solo** su `lepefy-test` da `/admin/parametres/fonctionnalites`.
5. Test reale, poi eventuale attivazione di altri tenant solo dopo verifica esplicita.

Il codice deployato prima della migration resta inerte finché il flag è spento (legge solo `tenant_feature_flags`, 138). Accendere il flag prima della 139 farebbe fallire le pagine Gestion: applicare sempre prima la migration.

## Operational runbook

- **Registrare un acquisto**: Achats → Nouvel achat → righe (catalogo o libere) → "Enregistrer et commander".
- **Ricevere merce**: aprire l'acquisto → "Enregistrer une réception" → quantità per riga (o "Tout le reste est reçu").
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

## Known limitations

- Nessuna chiusura "ricevuto con ammanco definitivo": un acquisto con merce mai consegnata resta `partially_received` (annotare in nota; storno/annullamento non applicabili se c'è già una ricezione).
- Quantità intere (coerenti con `products.stock` intero); nessuna unità di misura.
- Costi di acquisto non riportati sul costo prodotto (nessun costo medio).
- Documenti caricabili dall'UI su fornitore, acquisto e pagamento; il tipo `receipt` è supportato da DB/API ma l'UI allega i bolle di consegna all'acquisto.
- Nessuna schermata per le rettifiche manuali di stock (solo API).
- La ricerca globale admin non indicizza fornitori/acquisti.
- Concorrenza verificata per costruzione (lock, vincoli unici) e con la verification SQL a connessione singola, non con un test di carico concorrente.

## Future roadmap

Workspace autonomo `gestion`, schermata movimenti di stock e rettifiche, costo medio e margini, scadenze di pagamento e promemoria, cash-flow consolidato con gli incassi (`tenant_card_payments`, ordini), import fatture/OCR, multi-magazzino e lotti, riconciliazione bancaria.
