# Shipping Intelligence — documentazione tecnica e operativa

> **Modulo:** Admin → Livraison / Shipping Intelligence
> **Repository:** `lepefy-labs/lepefy-food-platform`
> **Base codice verificata:** `main@4fc003851296c4a47663215d621220dedd966795`
> **Ultima verifica:** 9 ottobre 2026
> **Schema di base:** `supabase/migrations/119_shipping_intelligence_foundation.sql` + `120_shipping_postal_code_index.sql` (V1E senza migration) + `123_packaging_profile_carton_suggestion.sql` + `124_shipping_tariff_versions.sql` (V1F: versioni tariffarie, shadow mode) + `125_shipping_tariff_activation.sql` (V1G: tariffazione commerciale) + `151_shipping_shipment_creation.sql` + `152_shipping_automation_content.sql` (brouillons d'expédition, §2.4)
>
> Dossier per il futuro forfait nel checkout (dati, griglia, design): `docs/SHIPPING_FLAT_RATE_CHECKOUT.md`.
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

Tracking: `orders.shipping_*` (migration 111) sincronizzati da `syncOrderShipment`. Creazione di una bozza presso il provider a partire da un ordine: §2.4.

#### Data di consegna stimata (suivi automatique)

- La data arriva dal provider (Packlink: `estimated_delivery_date`, `YYYY/MM/DD`) tramite l'adapter (`parsePacklinkShipment` → `snapshot.estimatedDeliveryAt`).
- `syncOrderShipment` / `applyShipmentSnapshot` la persistono in `orders.shipping_estimated_delivery_at` nello stesso update compare-and-set che porta l'ordine a `shipped`.
- È mostrata nella pagina cliente `/orders/[id]` e nel pannello admin della spedizione.
- È inclusa nell'e-mail `order_shipped` («📅 Livraison estimée : 6 oct. 2026», dopo transporteur e numéro de suivi, prima del CTA, con nota che si tratta di una stima del trasportatore): `orderTransitionService.updateWorkflowOrder` passa la riga salvata a `runOrderTransitionSideEffects` → `orderShippedEmail`. Formato `fr-FR`, `dateStyle: 'medium'`, timezone `Europe/Rome` (`formatEstimatedDeliveryDate` in `customerEmails.ts`). Valore `null` o non valido → nessuna riga, e-mail identica a prima.
- La console di test notifiche (platform owner, evento «Commande expédiée») ha un campo data «Livraison estimée» (`YYYY-MM-DD` → mezzanotte UTC via `estimatedDeliveryFromDateInput`, stessa forma persistita dall'adapter); vuoto → e-mail senza stima.
- Il renderer non interroga mai il provider. Sync ripetute senza cambio di stato non emettono e-mail; il catch-up `preparing → delivered` continua a emettere solo `order_completed`.

### 2.2 Pricing cliente

Le regole cliente correnti restano separate:

- `shipping_country_rules`;
- `tenants.shipping_provider`;
- `packaging_surcharges`;
- flusso `/api/shipping/quote`.

I record di `shipping_tariff_drafts` sono solo bozze di analisi.

**Invariante:** il checkout non legge `shipping_tariff_drafts`. Legge `shipping_tariff_versions` (snapshot immutabili): in modalità `shadow` la versione `shadow` per un confronto mai addebitato (V1F); in modalità `tariff` **solo** la versione `active` del paese, attivata esplicitamente in admin, con preventivo e pagamento verificati server-side (V1G, §18.5, `docs/SHIPPING_FLAT_RATE_CHECKOUT.md` §12).

### 2.3 Shipping Intelligence

Comprende:

- profili di imballaggio;
- zone logistiche tenant;
- osservazioni di costo provider;
- campagne di simulazione;
- stima per similarità;
- storico aggregato;
- laboratorio tariffario.

### 2.4 Creazione dei brouillons d'expédition (migration 151)

Lepefy può creare **solo una bozza** (draft) della spedizione presso il provider a partire da un ordine reale. Acquisto, scelta definitiva del servizio, pagamento ed etichetta restano in Packlink PRO. Prezzo cliente (`shipping_cost`, totale, versione tariffaria, forfait) e costo operativo provider restano separati: la bozza non li legge né li modifica.

**Configurazione tenant.** Modulo `shipping_automation` di `tenant_feature_settings` (nessuna colonna `tenants.*`): `enabled` = «Créer les brouillons d'expédition depuis Lepefy», `config = { version: 1, create_shipment_trigger: 'order_created' | 'preparing' | 'manual', shipment_content: string (1–60, default « Alimenti Non Deperibili ») }` (CHECK `is_valid_shipping_automation_config`, 151 ridefinita da 152 per `shipment_content`; senza 152 la lettura funziona con il default ma il salvataggio risponde 409). Riga assente, invalida o illeggibile = **disattivato** (nessuna creazione, nemmeno manuale): la migration non attiva nessun tenant. UI: `Admin → Livraison → Expéditions` (`/admin/livraison/expeditions`, lettura `shipping.view`, scrittura `shipping.manage` via `GET/PATCH /api/admin/shipping-automation`). Alla prima attivazione la UI preseleziona «Au début de la préparation» (raccomandato). Se il provider del tenant non ha la capability `createDraft` la pagina lo dice e non mostra opzioni. Il cambio di impostazione vale per gli eventi successivi, nessun effetto retroattivo.

**Condizioni (`draftIneligibility`, pura).** Impostazione attiva; adapter del `tenants.shipping_provider` con `capabilities.createDraft` e `createShipmentDraft`; `fulfillment_type = 'delivery'`; `shipping_provider_reference` nullo; ordine `new`/`preparing`; `shipping_tracking_mode` diverso da `manual` (il team ha scelto il suivi manuel). Chiave API e dati mancanti producono un errore classificato, non un salto silenzioso.

**Trigger.** Nessun trigger su `checkout_sessions`: solo veri ordini.

| Trigger | Evento | Punto nel codice |
|---|---|---|
| `order_created` | ordine realmente creato | webhook Stripe storefront (dopo inserimento righe, fuori dal ramo stock_conflict); `convertCheckoutSessionToOrder` solo con `created = true` e senza conflitto di stock (Stripe assistito, pagamenti esterni, «Déjà payé»); `/api/checkout` ramo `in_store` |
| `preparing` | **inizio della preparazione** = prima scrittura di `picking_started_at` | `updateWorkflowOrder` (`new → preparing`, vincitore del CAS) e `PATCH /api/admin/orders/[id]/picking` (prima riga prelevata, CAS `is('picking_started_at', null)` + `select`) |
| `manual` | nessuno | solo dalla scheda ordine |

Tutti i percorsi di creazione attuali creano l'ordine direttamente in `preparing`: una transizione letterale `new → preparing` non avverrebbe quasi mai, per questo l'evento canonico è la prima scrittura di `picking_started_at`. `preparing → preparing` e i tick successivi del picking non rilanciano nulla (CAS + stato non più `not_required`).

**Provider-neutral.** La state machine ordini chiama solo `requestShipmentDraft` (`lib/shipping/shipmentDraft/shipmentDraftService.ts`), che usa il registry: `ShippingProviderAdapter.capabilities.createDraft` + `createShipmentDraft(context, input) → ProviderShipmentDraftResult { provider, providerReference, providerStatus?, createdAt }`. Input neutro `ProviderShipmentDraftInput` (riferimento ordine, destinatario, colli kg/cm, contenuto, valore merce = `orders.subtotal`). Packlink: `createDraft = true`; nessun altro adapter oggi.

**Packlink.** Verificato sul connettore ufficiale `packlink-dev/ecommerce_module_core` (`Proxy::sendDraft`, `Draft::toArray`, `OrderService::convertOrderToDraftDto`):
- mittente = magazzino predefinito dell'account (`GET /v1/clients/warehouses`, `default_selection`; un unico magazzino vale come predefinito; `postal_code` può essere `"<cap> - <città>"`). Nessun mittente hardcoded; l'origine `IT/42122` delle quote (§5) non è usata qui;
- `POST /v1/shipments` JSON con `from`, `to` (`name`, `surname`, `street1`, `street2`, `zip_code`, `city`, `country`, `phone`, `email`), `packages` (`weight` kg a 2 decimali, `width/height/length` cm interi), `content` (= `shipment_content` del tenant, ≤ 60 car., mai l'elenco articoli), `contentvalue`, `contentValue_currency`, `content_second_hand: false`, `shipment_custom_reference`. **Nessun `service_id`**: il connettore ufficiale lo omette quando nessun servizio è scelto; il servizio si sceglie e si paga in Packlink PRO;
- risposta: `{ reference }` (es. `IT2026PRO0006415025`), validata `^[A-Z0-9]{6,40}$`.

**Riferimenti.** `shipment_custom_reference = LEPEFY-<8 caratteri>` (stesso codice del numero ordine admin `#3F2A91C0`, nessun dato personale) ↔ `orders.shipping_provider_reference = <reference Packlink>`.

**Dati.** `buildShipmentDraftInput` (puro, `buildDraftInput.ts`):
- destinatario da `orders.shipping_address` (`full_name` o `orders.full_name` → nome/cognome sull'ultimo spazio), e-mail opzionale (ordini assistiti senza e-mail), telefono letto dalla riga `Téléphone: …` di `orders.notes` (unico punto in cui i tre percorsi di creazione lo persistono). Campo mancante → `invalid_recipient:<campi>`, nessuna chiamata;
- peso: `orders.shipping_details.totalWeightG`, altrimenti Σ `order_items.quantity × products.weight_grams` **solo** se ogni riga ha un peso (nessun `WEIGHT_FALLBACK_G`). Assente → `invalid_parcel:poids`;
- colli: **lo stesso piano fisico della card «Carton à utiliser»** del dettaglio ordine, tramite `planTariffParcels` (`tariff/tariffQuote.ts`, già usato dal controllo di disponibilità del forfait): colli riempiti fino a `packaging_surcharges.max_pack_kg` (default 15 kg come `loadCartonContext`; 12,5 kg → 10 + 2,5), cartone per collo da `cartonsForWeight` sui profili `shipping_packaging_profiles` attivi, poi il profilo `is_default`, poi la scatola `packaging_surcharges`; peso inviato = netto + `tare_g` del cartone. Nessuna formula aggiuntiva. `packing_parcel_count` non è letto: se la preparazione usa colli diversi la bozza si corregge in Packlink PRO. Nessun cartone né scatola → `invalid_parcel:dimensions`; `shipment_content` vuoto → `invalid_parcel:contenu`.

**Stato di provisioning (`orders.shipping_creation_*`, separato da `shipping_normalized_status`).**

```text
null (= not_required) ──evento──▶ pending ──claim CAS──▶ creating ──▶ draft_created (reference salvata)
                                     ▲                        ├──▶ failed     (errore sicuro: dati, 4xx, 401/403, 429/503)
                                     └── retry automatico ────┘    ambiguous  (timeout, rete, 5xx≠503, 2xx senza reference,
                                         (solo provider_unavailable,           claim interrotto > 10 min)
                                          max 3 tentativi, ≥ 10 min)
```

Colonne: `shipping_creation_status`, `shipping_creation_attempts`, `shipping_creation_error` (`<codice>` o `<codice>:<dettaglio>`, ≤ 64, mai payload provider/PII), `shipping_creation_updated_at`, `shipping_provider_created_at`. Codici: `missing_configuration`, `invalid_recipient`, `invalid_parcel`, `provider_timeout`, `provider_unavailable`, `provider_rejected`, `invalid_provider_response`, `ambiguous_creation` (messaggi francesi in `shipmentDraftPresentation.ts`).

**Idempotenza.** (1) Nessuna creazione se `shipping_provider_reference` è valorizzato (eleggibilità + filtro `is(reference, null)` in ogni update). (2) Claim compare-and-set su stato **e** numero di tentativi letti (`pending|failed|null → creating`): doppio clic, due worker, tick + clic → una sola chiamata provider. (3) Il salvataggio finale è CAS su `creating`; se fallisce (stato cambiato nel frattempo) l'ordine passa `ambiguous` e la reference viene solo loggata. (4) `orders_tenant_shipping_reference_idx` (111) impedisce la stessa reference su due ordini. Il frontend non è il controllo.

**Timeout ambiguo.** Packlink non offre lookup per `shipment_custom_reference` (il connettore ufficiale documenta solo `GET shipments/{reference}`; la lista `GET /v1/shipments` non è documentata né filtrabile, §Diagnostic). Quindi nessun retry cieco: timeout, errore di rete, 500/502/504, 2xx senza reference e claim interrotto diventano `ambiguous` e non vengono mai ritentati automaticamente. Riconciliazione manuale nella scheda ordine: «Associer la référence» (verificata con `resolveShipment`) oppure «Aucun brouillon trouvé ? → recréer» con conferma esplicita (`confirmNoExistingDraft`).

**Esecuzione asincrona.** Gli eventi fanno solo un update CAS `→ pending` e non lanciano mai eccezioni (migration assente, lettura fallita: log `queue_unavailable`): errore provider ≠ errore di creazione ordine ≠ errore di preparazione. La creazione avviene nel tick esistente `POST /api/internal/shipping-sync` (n8n ogni 15 min, §23) dopo la sync tracking (`runShipmentDraftBatch`: claim interrotti → `ambiguous`, poi ≤ 3 ordini `pending`/`failed` ritentabili; nessuna nuova creazione dopo 35 s per restare in `maxDuration = 60`). Timeout adapter: magazzini 8 s, bozza 12 s. Nessuna nuova infrastruttura.

**Fallback manuale.** Scheda ordine, pannello «Expédition Packlink» (`ManagedShipmentPanel` → `ShipmentDraftBlock`), visibile per delivery `new`/`preparing` senza reference quando l'impostazione è attiva: «Aucun brouillon créé» → «Créer le brouillon Packlink»; «Création en attente» → «Créer maintenant»; «Échec de création» + messaggio → «Réessayer»; «Création incertaine» → associare/recreare; dopo il successo «✓ Brouillon Packlink créé», reference copiabile, data, stato transporteur. Endpoint `POST /api/admin/orders/[id]/shipment/create` (`orders.manage`, come attach/sync/manual: è un'azione sull'ordine, non un réglage; tenant dal deploy, ordine filtrato per `tenant_id`). Corpo: `{}` | `{ confirmNoExistingDraft: true }` | `{ providerReference }`.

**Bozza da correggere (eliminazione).** Packlink non offre un'API verificata di eliminazione/annullamento (il connettore ufficiale non ne ha; l'unica `DELETE` riguarda le integrazioni): Lepefy **non elimina mai** una bozza. Il team la elimina in Packlink PRO, poi nel pannello «Brouillon supprimé dans Packlink PRO ? Recréer» → `POST /api/admin/orders/[id]/shipment/release` (`orders.manage`, `releaseDeletedShipmentDraft`). Il server verifica con `resolveShipment` che la bozza non esista più (404 `shipment_not_found`, stessa logica di `isDraftExpired` del connettore ufficiale) o sia `cancelled`; solo allora azzera, con CAS su reference + `draft_created`, reference, snapshot provider e stato di provisioning (→ not_required), e la bozza si ricrea con «Créer le brouillon». Rifiutato se la bozza esiste ancora (`still_exists`), se il provider non risponde (nessun rilascio senza prova), se il collo è già in movimento (stato normalizzato diverso da pending/unknown/cancelled), se la reference non è stata creata da Lepefy (associazione manuale: usare il suivi manuel) o per un altro tenant.

**Dopo la creazione.** Patch: `shipping_tracking_mode = 'managed'`, `shipping_provider_key`, `shipping_provider_reference`, `shipping_normalized_status = 'pending'`, `shipping_provider_synced_at = null`. Lo stato ordine non cambia: una bozza **non** è una spedizione, nessun `shipped`, nessuna e-mail (né alla creazione né all'associazione). Da lì `runShippingSyncBatch`/`syncOrderShipment` gestiscono `pending → ready_for_collection → in_transit → … → delivered/exception/returned/cancelled`; `order_shipped` parte solo dalla vera transizione `shipped`. «Utiliser un suivi manuel» stacca la reference e blocca nuove creazioni (`manual_tracking`).

**Osservabilità.** Log `[shipping/draft] queued|started|created|failed|skipped_existing|ambiguous|linked` con solo tenant id, order id, provider e codice. Mai chiave API, indirizzo, telefono, e-mail o payload Packlink.

---

## 3. Navigazione Admin

### 3.0 Confine con il cockpit ordini

`Admin → Commandes` (`/admin`) è la **work queue di fulfillment**, non una lista cronologica. Ogni riga tiene separati cinque assi:

- stato interno dell'ordine (`StatusBadge`, `orders.status`);
- modalità (`Livraison` / `Retrait magasin`);
- stato logistico del provider (pill `Transport : …` da `shipping_normalized_status` / `shipping_sync_error`, via `shipmentStatusLabel`);
- prossima azione;
- anomalia o urgenza.

Stato ordine e stato provider non vengono mai fusi. La sincronizzazione provider resta l'unico punto che può far avanzare `orders.status` (`syncOrderShipment` → `orderTransitionService`).

**Classificatore unico.** `classifyOrderOperation(order, thresholds, now)` (`lib/orders/adminOrderOperations.ts`, puro e client-safe) restituisce gruppo di priorità, flag della coda, anomalia affidabile, urgenza, nota contestuale e prossima azione. KPI, viste, ordinamento, righe e card mobile lo usano tutti: nessuna regola della coda vive nel JSX o in un SQL separato. Le soglie sono quelle tenant-scoped del modulo `daily_order_digest` (`prepare_hours`, `pickup_hours`, `tracking_stale_hours`); se la config non è valida valgono i default dello stesso modulo.

| Gruppo (ordine "Priorité opérationnelle") | Regola | Ordine interno |
|---|---|---|
| Action requise | `stock_conflict`; incidente provider (`exception`/`returned`/`cancelled`) o `shipping_sync_error` su delivery attiva; pagamento non `paid`; delivery `shipped` senza tracking né reference; suivi senza movimento oltre `tracking_stale_hours`; ETA superata in transito | `created_at` crescente |
| Préparation en retard | `new`/`preparing` non ancora imballato, oltre `prepare_hours` da `picking_started_at` (o `created_at`) | più vecchio prima |
| Retrait en retard | `ready_for_pickup` oltre `pickup_hours` da `updated_at` | più vecchio prima |
| En préparation | `new`/`preparing` | più vecchio prima |
| À expédier | delivery `preparing` con `picking_completed_at` e `packing_completed_at` | `packing_completed_at` crescente |
| Expéditions en cours | `shipped` senza anomalie | `shipped_at` crescente |
| Retraits prêts | `ready_for_pickup` non in ritardo | più vecchio prima |
| Terminées | `delivered`/`cancelled` | `updated_at` decrescente |

A parità di valori decidono `created_at` e poi `id`, quindi l'ordinamento è stabile.

**KPI**

- `À traiter`: tutti i gruppi tranne `Expéditions en cours`, `Retraits prêts` e `Terminées`. Un ritiro in attesa normale o un transito regolare non sono azioni.
- `Urgents`: i primi tre gruppi.
- `Incidents`: solo anomalie confermate dal provider (stato normalizzato o errore di synchro), mai stime euristiche.
- `En préparation`, `À expédier`, `En transit` (`in_transit`/`out_for_delivery`) e `Retraits prêts`: flag diretti.

Le categorie possono sovrapporsi. Per i ritiri, `updated_at` è solo l'ultima attività (il testo dice «Inactive depuis…»): non esiste un timestamp certo di «prête depuis».

**Caricamento server-side (`lib/orders/loadOrderWorkQueue.ts`, nessuna migration)**

1. Una lettura leggera degli ordini **attivi** del tenant: colonne di stato, timestamp e snapshot, senza `order_items`. Se ci sono filtri, si aggiunge la stessa lettura filtrata.
2. Gli eventi tracking JSON si leggono solo per le spedizioni in movimento con reference, a batch di 200 id.
3. La classificazione produce i KPI tenant-wide.
4. Con `sort=priority` gli attivi sono ordinati **prima** della paginazione. La finestra di pagina (`planPriorityPage`) prende gli id attivi del set ordinato, poi prosegue con i terminati letti dal DB (`updated_at` desc, `range`).
5. Le righe complete (con items) si leggono solo per i ≤ 50 id della pagina.

Le viste di classificazione (`to_treat`, `urgent`, `incidents`, …) filtrano lo stesso set classificato, quindi coincidono con i KPI. Restano invece paginati dal DB `Terminés`, gli ordinamenti per data/importo e le viste di controllo legacy (`payment_pending`, `aged`, `picking_incomplete`, `packing_pending`, `tracking_missing`).

**Compromesso documentato:** la coda attiva è tenuta in memoria lato server. Oltre `ACTIVE_ORDER_LIMIT` (5 000 ordini attivi) la lista ripiega sull'ordine per data con un avviso, e i KPI diventano parziali. Nessuna riga interroga Packlink/BRT live; il poller della pagina rilegge solo il DB.

**Query string.** Parametri: `view`, `status`, `fulfillment`, `payment`, `dateFrom`, `dateTo`, `q`, `sort`, `page`. `sort` accetta `priority` (default, omesso dall'URL), `newest`, `oldest`, `amount_desc`, `amount_asc`; i vecchi `date_desc`/`date_asc`/`total_desc`/`total_asc` restano alias. Esiste un solo sistema di filtri: i filtri rapidi (`Tous`, `Livraison`, `Retrait`, `Urgents`, `Incidents`, `Terminés`) più i select `Statut` / date / `Paiement`. Ogni filtro conserva gli altri parametri.

**Riga e azioni**

- **Durate:** `formatOperationalDuration` (ore sotto 48 h, poi giorni).
- **Reference e tracking:** su righe separate (`Réf.` / `Suivi`), in monospace, copiabili.
- **Avvisi:** solo per anomalie reali o per la nota `Expédition à associer` (delivery imballata, modalità managed, senza reference).
- **CTA:** solo flussi esistenti. Tutte aprono il dettaglio canonico, dove le mutazioni restano sotto `orders.manage` e passano dal transition service. Fanno eccezione `Voir le suivi` / `Vérifier le suivi`, che aprono l'URL transporteur validato da `safeShipmentTrackingUrl` (fallback al dettaglio).
- **Terminologia tenant:** «préparation» ed «emballage», non «picking»/«packing».
- **Ordini terminati:** testo attenuato e CTA terziaria `Voir`.
- **Riga espansa**, tre sezioni:
  - preparazione: articoli, ubicazione, peso, colli, carton suggestion caricata solo all'apertura via `GET /api/admin/orders/[id]/operation-detail` (`orders.view`), righe senza peso;
  - spedizione: destinazione, transporteur e servizio, provider, reference e tracking copiabili, stato provider con ultima synchro, ultimo movimento, ETA; per i ritiri: urgenza e contatto;
  - azioni esplicite: `Liste de préparation · A5` (PDF al formato di default del tenant, indicato nell'etichetta), per le consegne `Bon de colis · A5` se attivo, `Voir la commande`, `Voir le suivi transporteur`.
- **Azione di gruppo `Documents…`:** dialog con documento (listes de préparation / bons de colis) e formato A5/A4 → un solo PDF (§3.1).
- **Mobile:** card operative con CTA a tutta larghezza (44 px), pulsante di dettaglio e le stesse intestazioni di gruppo.

**Dettaglio ordine (`/admin/orders/[id]`).** Usa lo stesso classificatore della lista, con le stesse soglie tenant.

- **Header:** `StatusBadge` più il pill separato `Transport : …` (`transportState`) e la modalità.
- **Alert:** un solo alert per anomalia, urgenza oltre soglia o `Expédition à associer`. Spariscono il vecchio «+24 h» fisso e «Ouverte depuis» sugli ordini terminati.
- **CTA dell'header:** stesso testo della lista. Porta alla sezione indicata da `NextOrderAction.section`: checklist, `#order-packing`, `#order-shipment`, `#order-tracking`, `#order-payment`/`#order-origin` o il pannello transizioni.
- **Transizioni di stato:** vengono da `orderDetailTransition(order, managed)` (helper puro unico) e passano da `PATCH /api/admin/orders/[id]` → `orderTransitionService`. Con spedizione managed, «expédiée» e «livrée» arrivano solo dalla sync.
- **Prossima azione senza transizione:** se l'azione è primaria (un intervento dell'équipe), il pannello mostra solo una guida verso la sezione competente, senza duplicare mutazioni. Una semplice consultazione, come il transito regolare, non genera guida.
- **Nomi dei transporteur:** normalizzati per la lettura con `carrierDisplayName` (`shipmentPresentation.ts`), sia nella lista sia nel dettaglio.
- **`ShipmentTrackingCard` (sezione «Suivi transporteur»):** mostra stato provider, transporteur, servizio, colli, peso, ETA, reference e tracking copiabili (`CopyableValue`), ultima synchro, link transporteur validato e la timeline degli eventi persistiti (`shipmentEventsNewestFirst` + `shipmentEventLabel`, 4 visibili poi «Afficher tout»). Nessuna chiamata live.
- **`ManagedShipmentPanel`:** resta il solo punto per creare il brouillon d'expédition (`ShipmentDraftBlock`, §2.4), associare, sincronizzare o passare al suivi manuel, con un riepilogo compatto.
- **Senza `orders.manage`:** la pagina è in lettura (banner «Lecture seule», nessun controllo di modifica); l'API resta il controllo autorevole.
- **Righe articolo:** lette con `order_id` e `tenant_id`, anche nei documenti PDF.
- **Documenti:** sezione «Documents» (`OrderDocumentsCard`) con Liste de préparation e Bon de colis, scelta A5/A4 per la singola stampa (preselezione = default tenant), «Ouvrir le PDF» / «Télécharger». Dettagli §3.1.

Questo cockpit non sostituisce `Admin → Livraison`: quella sezione conserva tariffe, packaging, intelligence e strumenti tecnici. Il dettaglio ordine conserva la gestione completa della spedizione, comprese associazione reference e sincronizzazione. La sincronizzazione provider può già avanzare `orders.status` tramite `syncOrderShipment`/`orderTransitionService`; il cockpit non introduce nuove transizioni o side effects.

### 3.1 Documents des commandes (PDF Gotenberg)

Due documenti distinti costruiti da un loader condiviso, mai lo stesso markup:

| Documento | Destinatario | Contenuto | Mai |
|---|---|---|---|
| **Liste de préparation** (`pickingListHtml.ts`) | équipe | réf. courte, data, LIVRAISON/RETRAIT, nome + CAP/città, articoli ordinati per `warehouse_location` con casella 6/7 mm, quantità 16–17 pt, FRAIS/SURGELÉ in testo, riepilogo unità/ref./peso/colli, **emballage suggéré** (solo consegna non annullata, `cartonSuggestion.ts`), firme; indirizzo completo di consegna solo con l'opzione tenant `picking_list_show_delivery_address` (destinatario ripetuto solo se diverso dal cliente) | UUID completo, e-mail |
| **Bon de colis** (`packingSlipHtml.ts`, titolo stampato «RÉCAPITULATIF DE COMMANDE») | cliente, nel pacco | logo/nome tenant, «Merci <prénom> !», réf. courte e data, articoli, totale articoli, QR portale (§3.2), ringraziamento, contatti; prezzi storici `order_items` e indirizzo solo se attivati | emplacements, caselle, carton, peso, e-mail, telefono, note, pagamento, errori provider, UUID |

- **Formati:** registro unico `lib/orders/documents/formats.ts` (`ORDER_DOCUMENT_FORMATS`: `a5` 148×210 default/raccomandato, `a4` 210×297; portrait). A5 e A4 hanno layout propri (A4: colonne Conservation/Emplacement, dettaglio per collo, zona note). Un formato nuovo = una voce del registro + layout + CHECK della migration.
- **Preferenze tenant:** `tenant_feature_settings('order_documents')` (migration 145, config piatta v1 validata da zod `lib/orders/documents/settings.ts` e dal CHECK `is_valid_order_documents_config`). Riga assente o invalida ⇒ default sicuri (A5, bon de colis attivo, prezzi e indirizzo nascosti). UI `/admin/parametres/documents`, API `GET/PATCH /api/admin/order-documents/settings` (`tenant_settings.view/manage`).
- **Route PDF (`orders.view`, non mutanti sull'ordine):** `GET /api/admin/orders/[id]/documents/{picking-list|packing-slip}?format=&download=1` e `GET /api/admin/orders/documents/{kind}?ids=a,b&format=` (lotto). `format` assente ⇒ default tenant; presente ma sconosciuto ⇒ 400. Risposta `application/pdf`, `inline` (o `attachment`), `Cache-Control: private, no-store`, nome `commande-CC4314FE-preparation-a5.pdf` / `preparation-2026-10-05-a5.pdf`.
- **Lotto:** un solo PDF, una `<section class="doc">` per ordine con salto pagina, ordine = ordine degli `ids` (quello della lista), ordini di altro tenant/assenti/annullati esclusi (`X-Documents-Skipped`). Massimo `MAX_BULK_ORDER_DOCUMENTS = 50` (= una pagina della lista; budget Vercel 30 s) ⇒ 413. Dati in lotto: 1 query `orders`, 1 `order_items` (anche per `tenant_id`), 1 contesto carton (`loadCartonContext` + `computeCartonSuggestion` puro) per tutto il lotto.
- **Multipagina:** righe `break-inside: avoid`, titoli `break-after: avoid`, `thead` ripetuto con «#REF» come intestazione ridotta, piè di pagina Gotenberg «#REF · Page X/Y» (in lotto la numerazione è quella dell'intero PDF). Nessun font informativo sotto 10 pt.
- **Gotenberg:** `htmlToPdf(html, options?)` di `lib/labels/gotenberg.ts`; senza opzioni la richiesta resta identica (etichette, affiche, biglietti). Con opzioni: `paperWidth/Height` e margini in pollici dal registro, `printBackground`, `footer.html`, timeout 25 s. Errori: Gotenberg assente/irraggiungibile/503 ⇒ 503 «Le service PDF est indisponible», altra risposta d'errore ⇒ 502; navigazione diretta ⇒ pagina HTML francese (mai JSON grezzo). Nessuna chiamata provider live nei documenti.
- **Errori ordine:** ordine assente o di altro tenant 404, annullato 409, bon de colis disattivato 409.
- Le vecchie pagine `/admin/orders/[id]/picking-list` e `/admin/orders/picking-list` redirigono al PDF; `window.print`/`AutoPrint` e il CSS `.pl-*` non esistono più.

### 3.2 Portale QR `/o/[token]`

Il QR del bon de colis punta a `<storefront_url del tenant>/o/<token>` (base da `getAdminWorkspaceUrls`, mai dall'header Host). Token = base64url(HMAC-SHA256(`TRACKING_SECRET`, `order-portal:<rowId>:<nonce>`)) troncato a 128 bit (22 car.), tabella `order_public_access_tokens` (migration 145: nonce + SHA-256 del token, unique `(tenant_id, token_hash)`, un solo token attivo per ordine, `revoked_at`, RLS senza policy, solo service role). Creazione pigra al primo bon de colis (`getOrCreateOrderPublicTokens`, in lotto); ristampa = stesso token.

La pagina mostra solo: marca, réf. courte, data, stage cliente (`getCustomerOrderPresentation`), modalità, articoli (nome + quantità); per la consegna transporteur / stato normalizzato / ETA `shipping_estimated_delivery_at` / ultimo aggiornamento dallo **snapshot persistito**, link transporteur solo se `safeShipmentTrackingUrl(shipping_tracking_url)` è valido; per il ritiro l'indirizzo pubblico del punto di ritiro. Nessun nome, e-mail, telefono, indirizzo di consegna, prezzo o pagamento. CTA: prima della consegna suivi (se URL valido) + aiuto; dopo la consegna «Commander à nouveau» → «Donner mon avis» (solo con invito d'avis utilizzabile) → aiuto. Dettagli: `docs/ORDER_DOCUMENTS.md`.

`Admin → Livraison` (tenant, `shipping.view` / `shipping.manage`) contiene sette superfici di business:

| Tab | Route | Responsabilità |
|---|---|---|
| Tarification | `/admin/livraison` | regole paese esistenti + zone logistiche |
| Emballages | `/admin/livraison/emballages` | catalogo profili di imballaggio |
| Expéditions | `/admin/livraison/expeditions` | creazione dei brouillons d'expédition: attivazione e momento (§2.4) |
| Assistant expédition | `/admin/livraison/assistant` | stima deterministica dallo storico |
| Historique des coûts | `/admin/livraison/historique` | aggregati delle osservazioni |
| Analyse tarifaire | `/admin/livraison/analyse-tarifaire` | bozze e retrotest forfait |
| Forfait | `/admin/livraison/forfait-shadow` | versioni immutabili, collecte shadow, attivazione commerciale e rollback, fallback, qualità pesi, rapporto ordini reali (§18.5) |

Source:
`apps/storefront/src/app/admin/(protected)/livraison/LivraisonTabs.tsx`.

#### Tarification (`/admin/livraison`)

- **Contesto**: un badge mostra la modalità effettiva (`effectivePricingMode` su `loadPricingMode`: coût Packlink / grille en observation / grille tarifaire) e l'ordine reale di applicazione: prezzo base → forfait fisso → remise → gratuità, con la regola del paese prioritaria su « Tous les pays ».
- **Una sola regola attiva per paese**: `resolveCountryRule` prende il primo match di un insieme non ordinato, quindi due regole attive sullo stesso paese esplicito renderebbero il prezzo indeterminato. `POST`/`PATCH /api/admin/shipping-rules` rispondono `409 COUNTRY_OVERLAP` quando una regola creata, modificata o riattivata condivide un paese con un'altra regola attiva; la UI segnala i conflitti già presenti. Il calcolo (`/api/shipping/quote`, `tariffQuote`) non cambia.
- **Anteprima**: il form calcola « le client paie » con la stessa `applyCountryRule` delle quote, su un prezzo base e un carrello d'esempio, senza chiamate di rete.
- **Attivazione**: la casella « Actif » chiede conferma (effetto immediato sui prossimi devis).
- **Zone**: raggruppate per paese; « Quelle zone pour … » applica la stessa regola di `resolveZoneCodeFromRows` (prefisso più lungo) e mostra il prefisso vincente. Lo stesso prefisso in due zone attive dello stesso paese è ambiguo: segnalato in UI e rifiutato da `POST`/`PATCH /api/admin/shipping-zones` (`409 PREFIX_OVERLAP`). In modalità grille tarifaire la zona determina il prezzo e un CAP fuori zona va in fallback: testo e conferma d'eliminazione lo dicono.
- **Permessi**: senza `shipping.manage` la pagina è in « Lecture seule » (nessuna azione), le API restano il controllo.
- Helper puri: `lib/shipping/shippingRuleConflicts.ts` (test `tests/unit/shippingRuleConflicts.spec.ts`).

Gli strumenti tecnici sono nella console piattaforma, gruppo **Platform → Livraison technique** (`platformNavConfig.ts`, id `shipping`), riservati al `platform_owner` (layout `platform/layout.tsx` + `requirePlatformOwner()` in ogni pagina e in ogni API):

| Pagina | Route | Responsabilità |
|---|---|---|
| Laboratoire | `/admin/platform/livraison/laboratoire` (+ `/:id`) | test rapido Packlink, campagne, indice CAP |
| Diagnostic Packlink | `/admin/platform/livraison/diagnostic-packlink` | elenco «Expéditions Packlink PRO» (sola lettura, paginato) + diagnostica per riferimento |

Il layout `platform/livraison/layout.tsx` mostra il tenant interrogato (quello del deploy, `NEXT_PUBLIC_TENANT_SLUG`). I vecchi URL `/admin/livraison/laboratoire`, `/admin/livraison/laboratoire/:id`, `/admin/livraison/diagnostic-packlink` e `/admin/livraison/simulateur` reindirizzano ai nuovi; un `tenant_admin` viene poi rimandato a `/admin` dal layout piattaforma. I dati prodotti dal Laboratoire (osservazioni) continuano ad alimentare Assistant, Historique, Analyse tarifaire e Forfait del tenant.

### Diagnostic Packlink: elenco «Expéditions Packlink PRO»

La pagina `/admin/platform/livraison/diagnostic-packlink` (`PacklinkWorkspace.tsx`, solo `platform_owner`) contiene due blocchi indipendenti:

1. **Expéditions Packlink PRO** (`PacklinkShipmentList.tsx`, solo se `shipping_provider = 'packlink'`): pulsante «Charger les expéditions» / «Actualiser», nessuna interrogazione automatica né polling. Mostra ora dell'ultimo aggiornamento, «page X sur Y», record della pagina, numero associati a un ordine e totale «annoncées par Packlink». Paginazione: «Précédente» / «Suivante» / «Page N sur Y» + «Aller» (una chiamata per clic). Pagina verificata → avviso informativo (totale annunciato da Packlink, ricerca e filtri **limitati alla pagina mostrata**); risposta senza metadati di pagina → avviso «liste potentiellement incomplète». Se una pagina richiesta fallisce (es. `page_not_honored`) la pagina già mostrata resta visibile con l'errore e il diagnostico della richiesta fallita. Ricerca client-side (riferimento, riferimento cliente, destinatario, tracking, ordine), filtro per stato costruito **solo** dai valori presenti nella risposta (etichetta = valore Packlink grezzo, nessuna traduzione inventata), filtro associato / non associato. Desktop (`lg`): tabella; sotto `lg`: schede compatte. La colonna «Suivi» appare solo se almeno un record contiene un codice. Il clic su una riga apre un pannello laterale (bottom sheet su mobile) con destinatario, indirizzo, colli/peso/dimensioni, corriere/servizio, costo, tracking, date, origine, ordine Lepefy, JSON redatto del record e il pulsante «Diagnostic complet» che precompila ed esegue il diagnostico per riferimento qui sotto. Sezione espandibile «Diagnostic technique»: endpoint (con `?page=N`), HTTP Packlink, durata, record ricevuti/mostrati, pagina richiesta/renvoyée, stato della paginazione (pagine, totale, base 0/1), contenitore, chiavi radice, campi del primo record, contenuto grezzo (redatto) degli indizi di paginazione o della risposta di forma sconosciuta.
2. **Diagnostic par référence** (`PacklinkDiagnostic.tsx`, invariato nel comportamento): `POST /api/admin/packlink-inspector` su shipment/track/labels; accetta ora anche una richiesta programmata dall'elenco (`request {reference, nonce}`). Nota: questo endpoint usa ancora `tenant.packlink_api_key ?? PACKLINK_API_KEY` (fallback globale mantenuto per scelta esplicita del 28/09/2026).

`GET /api/admin/packlink-shipments` (logica in `lib/shipping/packlinkShipmentList.ts`, route sottile) è in sola lettura e protetto da `requirePlatformOwner()` (solo GET; assente dalla mappa di capability tenant). Anche `POST /api/admin/packlink-inspector` usa `requirePlatformOwner()`. Usa **esclusivamente** `tenant.packlink_api_key` (nessun fallback globale) e non accetta chiavi o tenant dal browser; l'unico parametro accettato è `?page=N` (solo cifre, 1–10 000, altrimenti `400 invalid_page` senza chiamare Packlink). Una sola chiamata `GET https://api.packlink.com/v1/shipments` (pagina 1 senza parametro, pagina N con `?limit=10&offset=(N-1)*10`) per clic, timeout 12 s, `redirect: 'error'`, corpo letto in streaming con tetto 512 KB, massimo 200 record restituiti (`truncated` se di più), redazione ricorsiva delle chiavi sensibili (`authorization`, `api_key`, `*token`, `password`, `secret`). Una sola `SELECT id, status, created_at, shipping_provider_reference FROM orders` filtrata per `tenant_id`, `shipping_provider_key = 'packlink'` e i riferimenti ricevuti: indica l'ordine già associato (`#` + 8 caratteri dell'id), non crea mai associazioni; se la lettura fallisce l'elenco resta visibile con `orderLookup: 'error'`. Nessuna scrittura su DB o Packlink.

**Paginazione auto-verificata:** `readPacklinkPagination` legge `pagination { current_page, total_pages, total_registers, is_one_indexed }` e normalizza a pagine 1-based. Una pagina è `verified` (e il risultato `completeness: 'paginated'`) solo se `current_page` restituito = pagina richiesta e `total_pages` è presente. Se Packlink restituisce un'altra pagina, oppure nessun metadato per pagina > 1, l'esito è `502 page_not_honored` e **nessun record** viene restituito: una pagina non è mai presentata come un'altra. Pagina 1 senza metadati resta visibile con `completeness: 'unverified'`. Dopo un primo `page_not_honored` la UI nasconde la navigazione fino al ricaricamento.

Scelta dei parametri (28/09/2026): `?page=N` è **ignorato** da `v1/shipments` (verificato in produzione: `current_page` resta 1 per `page=2` e `page=245`). L'app web Packlink PRO pagina il proprio elenco spedizioni con `limit` + `offset` (bundle pubblico `pro.packlink.com`: `{inbox, limit: 20, offset: (page-1)*20}` su `pro/shipments`) e le fatture con `page`/`size` e lo stesso oggetto `pagination`. Il server usa quindi `limit=10&offset=(N-1)*10`: 10 = dimensione di pagina osservata, così gli offset restano coerenti anche se `limit` fosse ignorato. Il rispetto di `offset` su `v1/shipments` si verifica a ogni richiesta tramite `current_page`.

Esiti (`available: false` + `reason` + `message` FR + `diagnostics`): `invalid_page` 400, `page_not_honored` 502, `provider_not_packlink` 400, `tenant_api_key_missing` 409, `packlink_unavailable` 503 (rete/timeout), `list_endpoint_not_available` 501 (upstream 404/405 — **non** un elenco vuoto), `packlink_unauthorized` 502 (401/403), `packlink_error` 502, `response_too_large` 502, `invalid_packlink_response` 502, `list_response_shape_unknown` 502 (nessun array in radice, `shipments`, `results` o `data`). Il body Packlink d'errore non viene mai inoltrato.

**Comportamento verificato con la chiave reale ChloeFood (28/09/2026):** HTTP 200, radice `{ shipments, pagination }`, **10** record per pagina (pagina 1: 7 `DELIVERED`, 3 `IN_TRANSIT`), `pagination = { current_page: 1, total_pages: 245, total_registers: 2448, is_one_indexed: true }`. Campi per record: `reference` (es. `IT2026PRO…`), `status`, `delivery{name, surname, company, street1, street2, zip_code, postalcode, city, state, country, phone, email, address_id}`, `collection{…}` (mittente), `parcels[{width, height, length, weight}]` (stringhe), `weight` (totale, stringa), `parcel_number`, `carrier` (stringa, es. `brt`, `Poste Italiane`), `service`, `content`, `price` (stringa, osservato `"0"` su tutti i record: non è il costo reale), `orderDate`/`collectionDate` (`YYYY/MM/DD`), `shipment_custom_reference`, `has_customs`, `source` (`PRO`), `canceled`. **Nessun codice tracking** nell'elenco: si ottiene solo con il diagnostico per riferimento (`/track`). Il riepilogo legge prima questi campi e ripiega sulle chiavi dei DTO ufficiali (`packlink_reference`, `state`, `to`, `packages`, `trackings`, `order_date`, `price.base_price`).

**Limiti:** il connettore ufficiale `packlink-dev/ecommerce_module_core` documenta solo `GET shipments/{reference}` (+ `/track`, `/labels`); la lista è usata da client terzi (`?inbox=STATUS`, dichiarata «BETA») ma non è documentata ufficialmente. Né i parametri `limit`/`offset` né l'oggetto `pagination` sono documentati per `v1/shipments`: la paginazione si basa sul comportamento osservato ed è verificata a ogni richiesta (vedi sopra); il totale mostrato è quello **annunciato** da Packlink. Dimensione di pagina fissa (10, nessun parametro noto per cambiarla): ricerca e filtri non coprono l'intero account. Il filtro `inbox` resta non implementato e non verificato. Per un elenco affidabile degli ordini Lepefy spediti, la fonte resta `orders.shipping_provider_reference` + adapter per riferimento.


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
- `position`;
- `suggest_min_weight_g` / `suggest_max_weight_g` (migration `123_packaging_profile_carton_suggestion.sql`, nullable).

Al momento **non sostituisce** `packaging_surcharges` nel checkout.

**Carton suggerito in preparazione.** Un profilo attivo con `suggest_max_weight_g` valorizzato è un cartone "di magazzino": il dettaglio ordine admin (stati `new`/`preparing`, solo consegna) mostra la card «Carton à utiliser»; la liste de préparation PDF (singola e in lotto, §3.1) riporta lo stesso suggerimento nel riquadro «EMBALLAGE SUGGÉRÉ» (caricamento condiviso `lib/shipping/loadCartonSuggestion.ts`: `loadCartonContext` una volta per lotto + `computeCartonSuggestion` puro). Il bon de colis cliente non lo mostra mai. Il peso dell'ordine è `shipping_details.totalWeightG` del checkout, altrimenti ricalcolato da `order_items` × `products.weight_grams` (le righe senza peso sono segnalate). Il peso è diviso in colli pieni di `packaging_surcharges.max_pack_kg` (default 15 kg) più il resto (20 kg → 15 + 5, non 10 + 10 come lo split del checkout). Per ogni collo: carton = primo profilo per `position` con `min < peso ≤ max`; gli altri profili che coprono lo stesso peso sono proposti «si volumineux». Motore puro `lib/shipping/cartonSuggestion.ts` (test `tests/unit/cartonSuggestion.spec.ts`); editor in Admin → Livraison → Emballages. Solo aiuto alla preparazione: nessun effetto sul prezzo o sul checkout. Senza migration applicata le colonne mancano e la card resta nascosta.

Configurazione ChloeFood prevista: Carton S commerce 35×25×22 (0–5 kg), Standard 40×30×30 (5–15 kg), Carton L commerce 45×35×40 (12,5–15 kg, alternativa per colli voluminosi).

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

### 4.7 `shipping_tariff_versions` (migration 124 V1F, 125 V1G)

Snapshot **immutabili** di una bozza (fasce in grammi `min_g_exclusive < peso ≤ max_g_inclusive`, prezzi in centesimi, maggiorazioni di zona per collo/ordine, zone non consegnabili, colli max, blocchi oltre N kg, limite logistico verificato, IVA inclusa o no). Stati `validated | shadow | retired | active` (`active` riservato, mai scritto in V1F); una sola `shadow` e una sola `active` per tenant+paese (indici parziali); trigger di immutabilità dei parametri economici; nessun `DELETE`; selezione atomica via RPC `select_shipping_tariff_shadow_version`. Accanto: `tenants.shipping_pricing_mode` (`provider_cost` default | `shadow` | `tariff` riservato), indipendente da `shipping_provider`.

V1G (migration 125): `activated_at/activated_by/retired_by`; RPC atomiche `activate_shipping_tariff_version`, `retire_shipping_tariff_country`, `rollback_shipping_tariff_to_provider_cost`; su `tenants` `shipping_tariff_fallback` (`unavailable` default | `provider_cost`) e `shipping_public_grid_enabled` (default false); su `shipping_packaging_profiles` `tare_g` (solo peso lordo per la verifica Packlink).

---

## 5. Origine logistica usata nelle simulazioni

La campagna usa oggi:

```text
country = IT
zip_code = 42122
```

(I brouillons d'expédition, §2.4, non usano questa origine: il mittente è il magazzino predefinito dell'account Packlink PRO del tenant.)

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

### 10.3 Platform owner

Il `platform_owner` mantiene `Lancer la campagne`, `Traiter maintenant` e `Annuler` (Platform → Livraison technique → Laboratoire). L'endpoint manuale `POST /api/admin/shipping-simulation-campaigns/:id/process` usa la sessione `platform_owner` (`requirePlatformOwner()`), senza esporre il token dello scheduler. Tutte le API `shipping-simulation-campaigns/**`, `shipping-simulator` e `shipping-postal-code-import` sono riservate al `platform_owner`; il worker interno (`/api/internal/shipping-campaign-worker`) e l'import interno dei CAP restano sul loro bearer dedicato.

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

Route: `/admin/platform/livraison/laboratoire/:id` — API equivalente: `GET /api/admin/shipping-simulation-campaigns/:id`.

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

`POST /api/admin/shipping-simulation-campaigns/:id/resample` (`platform_owner`), su conferma esplicita (`{ confirm: true }`) dal pulsante «Remesurer N scénario(s)»:

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

`multi_parcel_strategy` (JSON, validato server-side da `validateMultiParcelStrategy` in POST/PATCH; `null` = banda sul peso totale). Selezionabile nel form «Colis supplémentaires»:

| Tipo | Calcolo |
|---|---|
| `weight_bands_whole_order` / `null` | banda applicata al peso totale dell'ordine |
| `first_parcel_plus_percentage` | colli riempiti fino a `parcelMaxKg` (`splitParcelsFilled`: 20 kg / 15 → 15 + 5); 1° collo al prezzo della sua banda, ogni collo in più al prezzo della **sua** banda − `percentageDiscount` % |
| `first_parcel_plus_discounted` | come sopra, ma ogni collo in più aggiunge `discountedParcelRate` (senza `parcelMaxKg`: comportamento storico, banda sul totale + importo × colli extra) |
| `flat_multi_parcel_rate` | prezzo unico da 2 colli |

La maggiorazione di zona si applica una volta per ordine (default) oppure **a ogni collo** (`zoneSurchargeMode = per_parcel`, selettore «Par commande / Par colis» accanto alle surcharges; salvato in `multi_parcel_strategy`, anche con la banda sul peso totale). Esempio (proposta tenant 0–10 kg 10,50 €, 10–15 kg 12,50 €, −50 % sui colli in più, 15 kg/collo): 20 kg → 17,75 €, 30 kg → 18,75 €, 45 kg → 25,00 €. Il form mostra un'**anteprima dei prezzi cliente** (stesso motore `applyTariffDraft`) e cliccando una bozza esistente la ricopia nel form per testare una variante.

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

**Base TTC e paese.** I brouillons sono prezzi cliente TTC: il costo confrontato è il devis Packlink **TTC** — `providerCostTtc`: TVA del paese di destinazione da `shipping_vat_rates` aggiunta quando Packlink non restituisce la taxe — e per gli ordini `packlinkCost + vatAmount` (`orderBacktestRows`). Scenari e ordini sono filtrati sul paese del rétrotest (body `{ country }`, default `IT`; la UI invia IT). **Costo reale** = devis Packlink TTC + frais d'emballage attuali (`packaging_surcharges`, per collo o per ordine: `packagingCostFor`), cioè ciò che il cliente paga oggi e ciò che il forfait (TTC, emballage compreso) sostituisce: è la base delle metriche principali (`withPackagingCost`); `scenarioWeightedPacklinkOnly` resta disponibile. Per gli ordini il costo reale è `packlinkCost + vatAmount + packagingSurchargeTotal` (= quanto pagato dal cliente). Il blocco in evidenza **«Coûts réels Packlink vs forfait»** mostra KPI (costo reale medio, forfait medio, scarto medio, % in perdita, scarto peggiore) e la tabella `buildCostComparison` per peso misurato × gruppo di zone con la stessa maggiorazione: Packlink TTC (mediana/max), + emballage, = coût réel (mediana e caso più caro), forfait, **écart typique** (forfait − costo reale mediano) e **pire écart** (caso più caro del gruppo: scatola grande, zona cara…), colorati. Metriche: `maxLoss` = perdita più forte (≤ 0, 0 se nessuna), `minMargin` = margine più basso (mostrato in UI come «Marge minimale»). «Enregistrer et rétrotester» lancia ora davvero il rétrotest dopo il salvataggio.

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

Le tariffe restano bozze: nessuna attivazione nel checkout. Per confrontarle con gli ordini reali senza addebitarle, una bozza si copia in una versione immutabile (§18.5).

### 18.5 Forfait shadow (V1F) e tariffazione commerciale (V1G)

Route `/admin/livraison/forfait-shadow` (lettura `shipping.view`, scritture `shipping.manage`). Una bozza (solo strategia «prezzo sul peso totale») diventa una versione immutabile con collo max, blocchi, zone non consegnabili e limite logistico; la versione `shadow` selezionata è calcolata a ogni checkout con consegna quando `shipping_pricing_mode = shadow`, con il motore puro `lib/shipping/tariff/priceFromTariff.ts`, e registrata in `orders.shipping_details.shadow_tariff` senza cambiare importo, token, PaymentIntent o dati Packlink. Peso = `products.weight_grams` server-side (nessun fallback 400 g: prodotto senza peso → simulazione incompleta). Il rapporto lavora solo sugli ordini reali (mai sugli scenari sintetici), conta solo le simulazioni `complete` e separa «forfait − addebitato» (due prezzi cliente) da «écart avant emballage» (forfait − preventivo Packlink TTC verificato contro il totale firmato). Il rétrotest delle bozze (`applyTariffDraft`) resta un motore distinto. Dettaglio e runbook: `docs/SHIPPING_FLAT_RATE_CHECKOUT.md` §10–11.

**V1G.** Dalla stessa route («Forfait») una versione si attiva per i clienti con conferma e checklist (maggiorazioni `per_order` da confermare esplicitamente, zona extra-doganale, pesi mancanti, cartoni, limite logistico, costo imballaggi). In modalità `tariff` `/api/shipping/quote` calcola il prezzo sul server (versione `active`, peso da `products.weight_grams`, zona tenant, regole paese), verifica la disponibilità logistica con il piano colli della preparazione e firma un token V2 (tenant, importo, paese/CAP, peso, impronta del carrello, versione); ogni percorso di pagamento ricalcola e confronta (`checkoutShipping.ts`). Un CAP fuori da ogni zona tenant non è coperto dal forfait e segue il fallback del tenant (`zone_not_covered`): la copertura geografica del forfait si governa dalle zone (es. Francia continentale senza Corsica, oltremare e Monaco). Le osservazioni dei preventivi live sono salvate come `real_quote` e riusate. Il rapporto separa gli ordini al forfait (forfait pagato vs preventivo Packlink) dalle simulazioni shadow. Dettaglio e runbook: `docs/SHIPPING_FLAT_RATE_CHECKOUT.md` §12–13.

---

## 19. Sicurezza e tenant isolation

Regole obbligatorie:

- tutte le query intelligence devono essere `tenant_id` scoped, comprese le letture paginate (`.range()`) e per lotti di id (`.in('id', …)` sempre accompagnato da `tenant_id`);
- i costi provider interni non devono diventare pubblici;
- API admin passano dal sistema admin/capability esistente;
- letture operative del tenant usano `shipping.view`;
- mutazioni del tenant (tariffe, imballaggi, zone, forfait) usano `shipping.manage`;
- Laboratoire, campagne, test rapido, import CAP e diagnostica Packlink sono riservati al `platform_owner` (`requirePlatformOwner()`), non figurano nella mappa `adminApiPermissions.ts` e sono verificati da `tests/unit/shippingPlatformTools.spec.ts`;
- il worker interno usa service-role bearer;
- non loggare secret, URL sensibili o payload provider raw;
- non indebolire RLS/grant esistenti;
- brouillons d'expédition: creazione sotto `orders.manage`, réglage sotto `shipping.view`/`shipping.manage`; chiave Packlink solo server-side (mai al browser, nei log, nelle risposte o in `shipping_creation_error`); ogni operazione filtra l'ordine per `tenant_id` del deploy e il tick usa il `tenant_id` della riga (§2.4);
- documenti di commande: route PDF sotto `orders.view` e tenant-scoped; il bon de colis riceve solo il view-model cliente; `order_public_access_tokens` è service-role only e il token del portale non viene mai salvato in chiaro né loggato (§3.2).

Tabelle con costi/simulazioni non hanno policy pubbliche e sono pensate per accesso service-role/admin server-side.

---

## 20. Dipendenze esterne

### Packlink

Usato per:

- quotazioni live;
- servizi/carrier;
- dataset sintetico;
- brouillons d'expédition (`GET /v1/clients/warehouses`, `POST /v1/shipments`, mai acquisto) e verifica di una reference (`GET /v1/shipments/{reference}`), §2.4.

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
2. `shipping_tariff_drafts` non è letto dal checkout; `shipping_tariff_versions` è letto solo in shadow mode e mai addebitato in V1F.
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
22. Una versione tariffaria non cambia mai i propri parametri economici: una correzione crea una nuova versione.
23. Lo shadow mode non modifica mai importo, token HMAC, PaymentIntent o dati Packlink; un suo errore non blocca il checkout; uno `shadow_tariff` inviato dal browser è sempre scartato.
24. Il peso di fascia è calcolato dal server da `products.weight_grams`, mai dal browser e mai con un peso di fallback.
25. La tariffazione commerciale (`tariff`/`active`) si attiva solo con l'azione esplicita «Activer cette tarification pour les clients» (conferma + checklist); nessuna attivazione automatica.
26. In modalità `tariff` un ordine non arriva mai al pagamento con un importo di spedizione diverso da quello ricalcolato dal server e confermato dal cliente (token V2 + ricalcolo in ogni percorso; differenza → nuovo preventivo).
27. La disponibilità logistica non è mai dedotta dalla sola formula: preventivo identico recente, chiamata provider limitata nel tempo, o evidenza recente dello stesso CAP (mai oltre il limite logistico verificato). I territori extra-doganali restano non consegnabili anche con `flat_rate_override`.
28. La liste de préparation (interna) e il bon de colis (cliente) restano renderer distinti; il bon de colis non riceve mai la riga `orders` né item grezzi e non può mostrare emplacements, carton, note, e-mail, telefono o UUID.
29. Il PDF Gotenberg è la fonte di verità dei documenti di commande (mai `window.print`); il lotto produce un solo PDF, al massimo 50 ordini, nell'ordine della selezione.
30. Il QR del bon de colis non contiene mai UUID, PII o URL provider: solo `<storefront_url>/o/<token opaco>`; il portale legge solo lo snapshot persistito, nessuna chiamata provider live.
31. Lepefy crea al massimo **una** bozza per ordine e mai con una reference già presente; la protezione è server-side (CAS su stato + tentativi), mai solo nel frontend.
32. Una bozza non acquista, non paga, non sceglie il servizio e non modifica prezzo cliente, `shipping_cost`, versione tariffaria o forfait; non porta l'ordine a `shipped` e non invia e-mail.
33. Un errore del provider o della coda bozze non fa mai fallire la creazione dell'ordine né l'inizio della preparazione; l'evento mette solo in coda.
34. Un esito che può seguire una bozza creata (timeout, rete, 5xx ≠ 503, 2xx senza reference, claim interrotto) è `ambiguous` e non viene mai ritentato automaticamente; si riconcilia a mano.
35. La state machine ordini dipende solo dall'interfaccia provider (`capabilities.createDraft`), mai da Packlink; la migration e l'assenza di riga lasciano la funzione disattivata.
36. Lepefy non elimina né annulla mai una bozza presso il provider; stacca una reference solo dopo che il provider conferma l'assenza (404) o l'annullamento della bozza.

---

## 22. File map

### UI Admin

```text
apps/storefront/src/app/admin/(protected)/livraison/       (tenant: shipping.view / shipping.manage)
  LivraisonTabs.tsx
  page.tsx
  ZonesSection.tsx
  emballages/
  expeditions/                (page.tsx + ShipmentCreationSection.tsx: réglage brouillons, §2.4)
  assistant/
  historique/
  analyse-tarifaire/
  forfait-shadow/
  laboratoire/page.tsx, laboratoire/[id]/page.tsx,
  diagnostic-packlink/page.tsx, simulateur/page.tsx      solo redirect verso /admin/platform/livraison/…

apps/storefront/src/app/admin/(protected)/platform/livraison/   (solo platform_owner)
  layout.tsx                         intestazione «Livraison technique», tenant interrogato, schede
  laboratoire/
    page.tsx
    ShippingSimulator.tsx            Test rapide
    CampaignManager.tsx              modalità di campionamento, limite, suddivisione
    CampaignDestinationPicker.tsx    ricerca/disambiguazione commune
    ZoneSentinelPicker.tsx           Couverture par zone (CAP campione)
    PostalCodeIndexAdmin.tsx
    [id]/page.tsx                    Vue d'ensemble + couverture
    [id]/CampaignCoverageTable.tsx   Couverture par CAP (filtri, mobile)
    [id]/CampaignErrorDiagnostic.tsx Diagnostic des erreurs
    [id]/ResampleCampaignButton.tsx  remesure esplicita (motivi inclusi/esclusi)
  diagnostic-packlink/
    page.tsx
    PacklinkWorkspace.tsx            elenco + diagnostico (richiesta di diagnostico dall'elenco)
    PacklinkShipmentList.tsx         Expéditions Packlink PRO (tabella/schede, filtri, pannello, diagnostic technique)
    PacklinkDiagnostic.tsx           diagnostico per riferimento (shipment/track/labels)

apps/storefront/src/app/admin/_components/platformNavConfig.ts   gruppo «Livraison technique» (id shipping)
```

### API Admin

```text
apps/storefront/src/app/api/admin/
  shipping-simulator/              (platform_owner)
  shipping-packaging-profiles/
  shipping-zones/
  shipping-automation/route.ts     (GET/PATCH réglage brouillons: shipping.view / shipping.manage)
  orders/[id]/shipment/create/route.ts  (POST creazione/associazione bozza: orders.manage)
  orders/[id]/shipment/release/route.ts (POST rilascio di una bozza eliminata in Packlink PRO, verificato: orders.manage)
  shipping-simulation-campaigns/   (platform_owner, tutte le route)
    route.ts                    GET lista / POST creazione (samplingMode, contesto città, destinationMode)
    zone-sentinels/route.ts     GET anteprima CAP campione per zona (sola lettura)
    city-postal-codes/route.ts  search / resolve (resolved | ambiguous)
    [id]/route.ts               GET copertura
    [id]/process/route.ts
    [id]/cancel/route.ts
    [id]/resample/route.ts      POST remesure
  shipping-postal-code-import/     (platform_owner)
  shipping-observations/summary/
  shipping-advisor/
  shipping-tariff-drafts/
  shipping-tariff-versions/        GET lista / POST da bozza (+ select) · [id]/select POST
  shipping-pricing-mode/           GET / PATCH (solo provider_cost | shadow)
  shipping-shadow-report/          GET rapporto ordini reali (+ ordini al forfait)
  shipping-tariff-versions/[id]/activate/  POST attivazione commerciale (conferma + checklist)
  shipping-tariff-versions/retire/         POST ritiro della tariffa di un paese
  packlink-shipments/route.ts      GET elenco spedizioni Packlink del tenant (sola lettura, platform_owner)
  packlink-inspector/route.ts      POST diagnostico per riferimento (shipment/track/labels, platform_owner)
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

apps/storefront/src/lib/shipping/tariff/          (V1F)
  priceFromTariff.ts        motore puro (grammi/centesimi) + regole paese
  tariffVersion.ts          validazione versioni, bozza → versione
  shadowTariff.ts           calcolo shadow server-side al checkout
  shadowReport.ts           aggregati ordini reali
  adminData.ts              dati onglet Forfait
  tariffQuote.ts            (V1G) preventivo autorevole, disponibilità logistica, snapshot ordine
  checkoutShipping.ts       (V1G) verifica in ogni percorso di pagamento, 409 SHIPPING_REQUOTE_REQUIRED
  activationChecklist.ts    (V1G) checklist di attivazione
  publicGrid.ts             (V1G) griglia pubblica /livraison (nascosta di default)
  resolveZone.ts
  schedulerAuth.ts
  unzip.ts
```

### Test

```text
apps/storefront/tests/unit/orderDocuments.spec.ts   (formati, settings, view-model, HTML, lotto, Gotenberg mock, permessi)
apps/storefront/tests/unit/orderPortal.spec.ts      (token, portale, supporto, riordino)
apps/storefront/tests/unit/shippingIntelligenceDataQuality.spec.ts
apps/storefront/tests/unit/helpers/fakeShippingSupabase.ts   (client in memoria con tetto 1000 righe + log tenant scope)
apps/storefront/tests/unit/shippingSchedulerAuth.spec.ts
apps/storefront/tests/unit/shippingTariffEngine.spec.ts
apps/storefront/tests/unit/shadowTariff.spec.ts
apps/storefront/tests/unit/shadowReport.spec.ts
apps/storefront/tests/unit/tariffCheckout.spec.ts
apps/storefront/tests/unit/packlinkShipmentList.spec.ts     (elenco Packlink: mock fetch, nessuna chiamata reale)
apps/storefront/tests/unit/shippingPlatformTools.spec.ts    (API tecniche solo requirePlatformOwner, navigazione, redirect)
apps/storefront/tests/unit/shipmentDraft.spec.ts           (brouillons: trigger, idempotenza, errori, ambiguous, retry, isolamento; Packlink mock)
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
supabase/migrations/124_shipping_tariff_versions.sql
supabase/migrations/125_shipping_tariff_activation.sql
supabase/migrations/151_shipping_shipment_creation.sql   (modulo shipping_automation + orders.shipping_creation_*)
supabase/migrations/152_shipping_automation_content.sql  (shipment_content nel CHECK del modulo)
packages/types/shippingIntelligence.ts   (ShippingScenarioMatrix: samplingMode, weightsByProfileId, part, sourceCampaignId; destinazione con city/adminCode1/adminCode2/adminName)
```

La V1E non introduce migration: i nuovi campi vivono nel JSON `scenario_matrix` e la semantica di esecuzione usa colonne esistenti (`request_hash`, `observed_at`).

### Shipping core correlato

```text
apps/storefront/src/lib/shipping/calculateShipping.ts
apps/storefront/src/lib/shipping/resolveCountryRule.ts
apps/storefront/src/lib/shipping/packlinkShipmentList.ts   (elenco Packlink read-only: fetch limitato, riepilogo, redazione, esiti)
apps/storefront/src/lib/shipping/syncOrderShipment.ts      (snapshot provider → orders.shipping_*; incl. shipping_estimated_delivery_at)
apps/storefront/src/lib/shipping/providers/types.ts        (ShippingProviderAdapter: capabilities.createDraft, createShipmentDraft, ShipmentDraftError)
apps/storefront/src/lib/shipping/providers/packlink.ts     (resolveShipment + createShipmentDraft: magazzino predefinito, payload Draft, classificazione HTTP)
apps/storefront/src/lib/shipping/shipmentDraft/            (settings, buildDraftInput puro, shipmentDraftService: coda/claim/batch/link, shipmentDraftPresentation client-safe)
apps/storefront/src/app/admin/orders/[id]/ShipmentDraftBlock.tsx  (stati e CTA della bozza nel pannello spedizione)
apps/storefront/src/app/api/internal/shipping-sync/route.ts  (tick n8n: sync tracking, poi coda bozze)
apps/storefront/src/lib/orders/adminOrderOperations.ts      (classificatore unico del cockpit: gruppi di priorità, flag KPI, anomalie, durate, prossima azione, sort; puro)
apps/storefront/src/lib/orders/loadOrderWorkQueue.ts        (work queue server-side: set attivo leggero, KPI, sort prima della paginazione, righe di pagina)
apps/storefront/src/lib/orders/loadOrderOperationDetail.ts  (letture tenant-scoped dell'espansione)
apps/storefront/src/app/admin/(protected)/page.tsx          (KPI, filtri unificati e query string del cockpit)
apps/storefront/src/app/admin/(protected)/OrdersSortSelect.tsx  (select di ordinamento, default priority)
apps/storefront/src/app/admin/(protected)/OrdersTable.tsx   (righe desktop e card mobile, gruppi di priorità, stato ordine e Transport separati)
apps/storefront/src/app/api/admin/orders/[id]/operation-detail/route.ts  (carton suggestion lazy)
apps/storefront/src/lib/shipping/loadCartonSuggestion.ts   (loadCartonContext per lotto + computeCartonSuggestion puro; dettaglio, espansione e PDF)
apps/storefront/src/lib/orders/documents/                  (formats, settings, loadOrderDocumentData, viewModels, pickingListHtml, packingSlipHtml, documentHtml, documentQr, renderOrderDocuments)
apps/storefront/src/lib/orders/portal/                     (orderPublicToken, portalViewModel, loadOrderPortal, reorderProposal, supportChannels)
apps/storefront/src/app/api/admin/orders/[id]/documents/[kind]/route.ts  (PDF singolo)
apps/storefront/src/app/api/admin/orders/documents/[kind]/route.ts       (PDF di lotto)
apps/storefront/src/app/admin/orders/[id]/OrderDocumentsCard.tsx         (sezione Documents del dettaglio)
apps/storefront/src/app/admin/(protected)/BulkDocumentsDialog.tsx        (azione di gruppo Documents…)
apps/storefront/src/app/(shop)/o/[token]/page.tsx                        (portale QR)
apps/storefront/src/lib/labels/gotenberg.ts                (client Gotenberg unico, opzioni papier/marges/footer retro-compatibili)
apps/storefront/src/app/admin/(protected)/orders/[id]/page.tsx  (dettaglio ordine: header/alert dal classificatore, ordine dei pannelli, RBAC in lettura)
apps/storefront/src/app/admin/orders/[id]/ShipmentTrackingCard.tsx  (suivi transporteur: snapshot provider + timeline eventi persistiti)
apps/storefront/src/app/admin/orders/[id]/ManagedShipmentPanel.tsx  (associazione, sync manuale, passaggio a suivi manuel)
apps/storefront/src/app/admin/orders/[id]/OrderDetail.tsx  (transizioni via orderDetailTransition, emballage, note, documenti)
apps/storefront/src/app/admin/_components/ui/CopyableValue.tsx  (reference/tracking copiabili, condiviso lista e dettaglio)
apps/storefront/src/lib/orders/orderTransitionService.ts   (CAS + side effects; passa la stima salvata all'e-mail shipped)
apps/storefront/src/lib/notifications/customerEmails.ts    (orderShippedEmail, formatEstimatedDeliveryDate)
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

**Brouillons d'expédition.** Nessuna nuova configurazione n8n: il workflow «Lepefy · Shipping sync scheduler» esistente (`/api/internal/shipping-sync`, ogni 15 min) elabora anche la coda; la risposta include `drafts: { processed, created, failed, ambiguous }`. Attivazione per tenant solo da `Livraison → Expéditions`. Rollback: disattivare il réglage (le bozze già create restano associate); in emergenza la riga `tenant_feature_settings` `shipping_automation` può essere messa a `enabled = false`.

---

## 24. Troubleshooting

### Brouillon d'expédition non creato o «Création incertaine»

- **Resta «Création en attente»:** il tick n8n non gira (vedi Executions) o la risposta ha `drafts: null`/`unavailable` (migration 151 assente). «Créer maintenant» crea subito.
- **`missing_configuration`:** chiave Packlink assente (un tenant di test non usa mai la chiave di piattaforma) o rifiutata (401/403), oppure nessun magazzino predefinito in Packlink PRO (Paramètres → Entrepôts).
- **`invalid_recipient:<campi>`:** campi mancanti nell'indirizzo o telefono assente da `orders.notes`; correggere nella commande / in Packlink PRO, poi «Réessayer».
- **`invalid_parcel:poids` / `:dimensions`:** `shipping_details.totalWeightG` assente e prodotto senza `weight_grams`, oppure nessun profilo Emballages adatto né profilo di default né riga `packaging_surcharges` con dimensioni.
- **Cartone diverso da quello atteso:** la bozza usa il cartone mostrato in «Carton à utiliser» (tranches `suggest_min/max_weight_g` dei profili Emballages); correggere le tranches o il profilo di default, non la bozza.
- **Salvataggio del réglage → 409 «migration 152»:** applicare `152_shipping_automation_content.sql`.
- **`provider_rejected`:** Packlink ha rifiutato il payload (4xx). Il messaggio grezzo non viene salvato: riprodurre la bozza a mano in Packlink PRO per vedere il campo.
- **`ambiguous`:** cercare `LEPEFY-<8 car.>` (riferimento mostrato nel pannello) in Packlink PRO. Trovata → «Associer la référence». Assente → «Aucun brouillon trouvé ? → recréer». Mai ricreare senza verificare: Packlink non permette la ricerca automatica per riferimento ordine.
- **Bozza sbagliata (cartone, contenuto, indirizzo):** eliminarla in Packlink PRO, poi «Brouillon supprimé dans Packlink PRO ? Recréer». `still_exists` = Packlink la vede ancora (eliminazione non ancora effettiva o bozza solo modificata); 503 = Packlink non raggiungibile, riprovare.
- **n8n «Shipping sync scheduler» in errore ogni 15 min con `shipment_not_found`:** una bozza creata da Lepefy è stata eliminata in Packlink PRO e la sync tracking riceve 404 (`failed > 0` → `Check sync outcome` fallisce). Nella scheda ordine: «Brouillon supprimé dans Packlink PRO ? Recréer» (rilascio verificato), poi ricreare la bozza.
- **Il pannello non appare:** réglage disattivato, provider del tenant senza `createDraft`, ordine in ritiro, già associato, `shipped`/`cancelled`, o suivi manuel attivo.

### Cockpit ordini: un ordine non appare dove atteso

- **Soglie di ritardo:** vengono da `Paramètres → Automatisations` (rapporto quotidiano). Con config invalida valgono i default del modulo.
- **Incidents:** mostra solo anomalie confermate dal provider. Un suivi fermo o un'ETA superata stanno in `Urgents` / `Action requise`, non in `Incidents`.
- **Ritiro "in ritardo":** si basa su `updated_at` (ultima attività), quindi qualunque modifica dell'ordine riavvia il conteggio.
- **Avviso «Plus de 5 000 commandes actives»:** la coda attiva supera `ACTIVE_ORDER_LIMIT` e la lista è ordinata per data. Chiudere gli ordini consegnati o ritirati, oppure rivedere il limite in `loadOrderWorkQueue.ts`.


### Documenti di commande

- **503 «Le service PDF est indisponible»:** `GOTENBERG_URL`/`GOTENBERG_AUTH` mancanti su Vercel, Gotenberg spento o oltre 25 s. Verificare anche etichette e biglietti (stesso client).
- **502:** Gotenberg ha rifiutato l'HTML; in lotto ridurre la selezione.
- **413:** più di 50 ordini selezionati.
- **Bon de colis senza QR:** migration 145 non applicata, `TRACKING_SECRET` assente o nessun URL boutique (`tenants.storefront_url`/`NEXT_PUBLIC_APP_URL`); il dettaglio ordine mostra l'avviso quando la migration manca.
- **QR «Lien indisponible»:** token revocato, `TRACKING_SECRET` ruotato (invalida i QR già stampati) o QR di un altro tenant.
- **Preferenze non salvabili:** migration 145 assente (409) o permesso `tenant_settings.manage` mancante.

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

### Forfait shadow: simulazioni incomplete, onglet «migration non appliquée», collecte

Vedere `docs/SHIPPING_FLAT_RATE_CHECKOUT.md` §11.6. Stop immediato: «Désactiver la collecte» (`shipping_pricing_mode = provider_cost`).

### Costo storico diverso dal live Packlink

È normale: lo storico è decision support. Richiedere un preventivo provider live quando serve il prezzo corrente.

### «Expéditions Packlink PRO»: pagine, nessun tracking, costo 0

- Packlink restituisce 10 record per pagina; il totale («annoncées par Packlink») e il numero di pagine vengono da `pagination`. Ricerca e filtri valgono solo per la pagina mostrata.
- `502 page_not_honored`: Packlink ha restituito una pagina diversa da quella richiesta (o nessun metadato). Nessun dato viene mostrato per quella pagina; controllare nel «Diagnostic technique» `Page demandée / renvoyée` e le chiavi di paginazione: probabilmente Packlink ha cambiato parametro o indicizzazione (`is_one_indexed`).
- Avviso giallo «liste potentiellement incomplète» sulla pagina 1: la risposta non contiene più metadati di paginazione riconoscibili.
- L'elenco Packlink non contiene codici tracking: usare «Diagnostic complet» nel pannello (chiama `/track`).
- `price` dell'elenco vale `"0"` sui record osservati: non usarlo come costo di spedizione.
- `501 list_endpoint_not_available`: la chiave non espone l'elenco; non significa zero spedizioni. `409 tenant_api_key_missing`: il tenant non ha `packlink_api_key` (l'elenco non usa la chiave globale). «Non associée» significa solo che nessun ordine del tenant ha quel `shipping_provider_reference`.

---

## 25. Limiti correnti e sviluppi futuri

Non ancora implementato:

- costo reale degli imballaggi e margine completo per ordine al forfait;
- acquisto/etichette Packlink da Lepefy (Lepefy crea solo bozze, §2.4) e ricerca automatica di una bozza per riferimento ordine (non offerta da Packlink: un esito ambiguo si riconcilia a mano);
- annullamento automatico della bozza Packlink quando l'ordine Lepefy viene annullato (da fare in Packlink PRO);
- filtro `inbox` / ricerca lato Packlink sull'intero account (oggi ricerca e filtri valgono solo per la pagina mostrata) e associazione manuale spedizione ↔ ordine dall'elenco;
- rétrotest delle bozze sul motore condiviso `priceFromTariff` (oggi `applyTariffDraft` distinto);
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
