# Lepefy Food Platform — Project Context

> Documento operativo di riferimento per Codex / Claude Code / sviluppatori.
>
> **Aggiornato:** 9 ottobre 2026 — **v7.21 Current-State Snapshot** (Brouillons d'expédition provider-neutral: Packlink `POST /v1/shipments` da Lepefy, configurabile per tenant, cartone suggerito e contenuto dichiarato, rilascio verificato di una bozza eliminata; migration 151 e 152 applicate; base `main` @ `4fc00385`)
>
> **Source of truth:** codice del repository `lepefy-labs/lepefy-food-platform`. Per lo stato deployed prevalgono branch/commit effettivamente promossi e migration realmente applicate.

---

## Admin → Commandes: cockpit operativo

`/admin` è la work queue di fulfillment. Un classificatore puro unico, `classifyOrderOperation` (`lib/orders/adminOrderOperations.ts`), assegna a ogni ordine: gruppo di priorità, flag KPI, anomalia affidabile, urgenza e prossima azione. Le soglie sono `prepare_hours`, `pickup_hours` e `tracking_stale_hours` del daily digest, con i default del modulo come ripiego. KPI, viste, ordinamento e righe usano tutti lo stesso classificatore.

L'ordinamento predefinito è `sort=priority` («Priorité opérationnelle»), nell'ordine: Action requise → Préparation en retard → Retrait en retard → En préparation → À expédier → Expéditions en cours → Retraits prêts → Terminées. Gli ordini attivi vanno dal più vecchio, i terminati dal più recente. Restano disponibili `newest`, `oldest`, `amount_desc`, `amount_asc`, e le vecchie chiavi `date_*`/`total_*` sono alias.

`lib/orders/loadOrderWorkQueue.ts` legge una sola volta, in forma leggera, gli ordini attivi del tenant (senza items). Gli eventi tracking si leggono solo per le spedizioni in movimento. Da qui escono i KPI tenant-wide e l'ordinamento, che avviene **prima** della paginazione (25/50/100, default 50, `?size=`); i terminati seguono dal DB e le righe complete si leggono solo per la pagina. Oltre 5 000 ordini attivi la lista ripiega sull'ordine per data, con un avviso.

Semantica dei KPI e delle viste:
- `À traiter`: esclude ritiri in attesa normale e transiti regolari.
- `Incidents`: solo stati provider `exception`/`returned`/`cancelled` o `shipping_sync_error`.
- `Urgents`: i primi tre gruppi.

Filtri: un solo sistema (Admin Design System V2, `FilterBar`): viste rapide (Tous/Livraison/Retrait/Urgents/Incidents/Terminés), card KPI e chip « Contrôles » (préparation incomplète, emballage, suivi manquant, paiement à vérifier) come filtri di vista, ricerca istantanea, pannello « Filtres » (statut con conteggi, paiement, période) con chip dei filtri attivi. Lo stato è solo in query string (`lib/orders/orderListParams.ts`), condiviso con `GET /api/admin/orders/export` (CSV della lista filtrata, max 2 000 righe). Selezione multipla → documenti, export della selezione, « Traiter la sélection » con conferma.

Ogni riga separa: stato ordine, modalità, pill `Transport : …` (stato provider persistito), anomalia e CTA.
- Durate in ore sotto 48 h, poi in giorni.
- Reference e tracking copiabili.
- UI in «préparation»/«emballage».
- Le CTA aprono il dettaglio canonico (mutazioni sotto `orders.manage` e transition service); «Voir le suivi» apre invece l'URL transporteur validato.

La riga espansa carica la carton suggestion solo all'apertura, via `/api/admin/orders/[id]/operation-detail` (`orders.view`, tenant-scoped). Nessuna migration, nessuna nuova transizione, nessuna chiamata provider dalla lista. Admin → Livraison continua a gestire configurazione, tariffe, packaging e strumenti tecnici. Dettagli: `docs/SHIPPING_INTELLIGENCE.md` §3.0.

Il dettaglio ordine (`/admin/orders/[id]`) usa lo stesso classificatore.
- **Header:** stato ordine, pill `Transport : …`, un solo alert contestuale e una CTA con lo stesso testo della lista, che porta alla sezione dove l'azione si compie.
- **Transizioni:** vengono da `orderDetailTransition`; con spedizione managed, spedito e consegnato arrivano dalla sync.
- **«Suivi transporteur»:** mostra snapshot e timeline degli eventi persistiti.
- **Senza `orders.manage`:** pagina in sola lettura.
- **UI tenant:** «préparation»/«emballage», anche nei messaggi API; documenti solo come PDF server (sezione «Documents», vedi sotto).
- **Righe articolo:** lette anche per `tenant_id`.

### Brouillons d'expédition (migration 151 — applicata in produzione il 09/10/2026; nessun tenant attivato) — `docs/SHIPPING_INTELLIGENCE.md` §2.4

- **Cosa**: Lepefy crea **solo una bozza** presso il provider (Packlink: `POST /v1/shipments` senza `service_id`); acquisto, servizio ed etichetta restano in Packlink PRO. Prezzo cliente, `shipping_cost`, forfait e versione tariffaria non cambiano; nessun `shipped`, nessuna e-mail.
- **Config tenant**: `tenant_feature_settings('shipping_automation')` (`enabled` + `create_shipment_trigger` `order_created | preparing | manual` + `shipment_content`, contenuto dichiarato, default «Alimenti Non Deperibili», CHECK esteso dalla 152); riga assente = disattivato. UI `Admin → Livraison → Expéditions` (`shipping.view`/`shipping.manage`, `GET/PATCH /api/admin/shipping-automation`); «Au début de la préparation» raccomandato.
- **Trigger**: `order_created` dai tre percorsi reali di creazione (webhook Stripe storefront, `convertCheckoutSessionToOrder` con `created = true`, `/api/checkout` in negozio), mai da `checkout_sessions`; `preparing` = prima scrittura di `picking_started_at` (`new → preparing` in `updateWorkflowOrder` o prima riga prelevata), perché gli ordini nascono già `preparing`.
- **Architettura**: `ShippingProviderAdapter.capabilities.createDraft` + `createShipmentDraft` (Packlink: mittente = magazzino predefinito `GET /v1/clients/warehouses`); la state machine chiama solo `requestShipmentDraft` (`lib/shipping/shipmentDraft/`), che mette in coda (`pending`) senza chiamare il provider e senza mai lanciare eccezioni. Il tick n8n esistente `/api/internal/shipping-sync` crea le bozze dopo la sync tracking.
- **Stato e idempotenza**: `orders.shipping_creation_status` (`null`=not_required, `pending`, `creating`, `draft_created`, `failed`, `ambiguous`) + tentativi/errore classificato/date; claim compare-and-set su stato + tentativi, mai con reference presente. Timeout/5xx≠503/2xx senza reference/claim interrotto ⇒ `ambiguous`, mai ritentato (Packlink non cerca per riferimento ordine): riconciliazione manuale (associare la reference trovata o recreare con conferma). Retry automatico solo `provider_unavailable` (429/503), max 3.
- **Colli**: stesso piano della card «Carton à utiliser» (`planTariffParcels`: colli riempiti, cartone suggerito dai profili Emballages, tara nel peso lordo, fallback profilo di default e scatola `packaging_surcharges`).
- **Scheda ordine**: pannello «Expédition Packlink» con stato, errore leggibile e CTA (`POST /api/admin/orders/[id]/shipment/create`, `orders.manage`); dopo la creazione la reference è `managed` e il tracking esistente prosegue.
- **Correggere una bozza**: Lepefy non elimina mai (nessuna API Packlink verificata); dopo l'eliminazione in Packlink PRO, `POST /api/admin/orders/[id]/shipment/release` stacca la reference solo se il provider conferma 404 o annullamento, poi si ricrea.

### Documenti delle commande e portale QR (migration 145 — applicata in produzione) — `docs/ORDER_DOCUMENTS.md`

- **Due documenti distinti** da un loader condiviso (`lib/orders/documents/`): **Liste de préparation** interna (emplacements, FRAIS/SURGELÉ, riepilogo, emballage suggéré dalla carton suggestion, firme) e **Bon de colis** cliente da mettere nel pacco (titolo «RÉCAPITULATIF DE COMMANDE», marca, «Merci <prénom> !», articoli, QR, contatti). Il bon riceve solo un view-model cliente costruito campo per campo: mai emplacements, carton, note, e-mail, telefono, pagamento o UUID; prezzi storici `order_items` e indirizzo solo se attivati.
- **PDF Gotenberg = fonte di verità**: `GET /api/admin/orders/[id]/documents/{picking-list|packing-slip}` e lotto `GET /api/admin/orders/documents/{kind}?ids=` (`orders.view`, un solo PDF, una commande per pagina nell'ordine della lista, max 50, annullate escluse). Formati da registro (`ORDER_DOCUMENT_FORMATS`: A5 default, A4), scelti per singola stampa con preselezione del default tenant. `htmlToPdf(html, options?)` estesa in modo retro-compatibile (carta, margini, piè di pagina numerato, timeout). `window.print`/`AutoPrint` e le vecchie pagine HTML (ora redirect al PDF) sono rimossi.
- **Preferenze tenant**: `tenant_feature_settings('order_documents')` (config piatta v1, zod + CHECK), `/admin/parametres/documents`, `GET/PATCH /api/admin/order-documents/settings` (`tenant_settings.view/manage`). Default: A5, bon de colis attivo, QR/logo/ringraziamento/contatti sì, prezzi e indirizzo no; indirizzo completo sulla liste de préparation opzionale (`picking_list_show_delivery_address`, migration 146); riga assente o invalida ⇒ default.
- **Lista ordini**: la riga espansa offre «Liste de préparation · A5» e, per le consegne, «Bon de colis · A5» al formato di default; il cambio puntuale di formato resta nel dettaglio e in «Documents…».
- **Accesso pubblico**: tabella `order_public_access_tokens` (nonce + SHA-256 del token, mai in chiaro; token = HMAC `TRACKING_SECRET` troncato a 128 bit; un token attivo per ordine, revocabile con `revoked_at`; RLS senza policy, solo service role). Creato pigramente al primo bon de colis, stesso QR alle ristampe. QR = `<storefront_url>/o/<token>`.
- **Portale `/o/[token]`** (storefront, senza login, noindex, no-referrer, no-store): réf. courte, stage cliente, articoli, snapshot di suivi persistito (transporteur, stato, ETA, link solo se `safeShipmentTrackingUrl`), punto di ritiro; nessuna PII né prezzo. CTA per ciclo di vita: suivi/itinéraire → aiuto prima della consegna; dopo «Commander à nouveau» (proposta in sola lettura `GET /api/order-portal/[token]/reorder` con prezzi/minimi/stock attuali, poi `cartStore.addItem` e checkout che rivalida tutto), «Donner mon avis» solo con invito d'avis utilizzabile (`POST /o/[token]/avis` emette un token d'avis `qr_portal`), «Besoin d'aide ?» dai canali tenant (WhatsApp, e-mail, boutique). Il widget Nala è nascosto su `/o/*` (il token non va negli analytics).
- **Stato**: 145 **applicata in produzione il 05/10/2026** (verificato: `order_documents` registrata non fatturabile, tabella dei token presente, `anon` riceve `permission denied`, nessuna riga di preferenze ⇒ tutti i tenant usano i default). Senza la 145 un ambiente avrebbe preferenze default non salvabili, bon de colis senza QR e portale 404. Test SQL in CI: `supabase/tests/145_order_documents.*`.

### Canale WhatsApp Business multi-tenant (migration 147 — applicata; flag `whatsapp_business` attivo solo su `lepefy-test`) — `docs/WHATSAPP_BUSINESS_PLATFORM.md`

- **Webhook unico** `/api/integrations/whatsapp/webhook` (GET verifica `META_WHATSAPP_VERIFY_TOKEN`, POST firmato `X-Hub-Signature-256` con `META_APP_SECRET`, fail closed). Tenant risolto **solo** da `metadata.phone_number_id` → `tenant_whatsapp_channels` (unique `(provider, phone_number_id)`), mai dal numero cliente né da `NEXT_PUBLIC_TENANT_SLUG`: il webhook è il primo punto di ingresso realmente multi-tenant su un solo deployment. Canale `disabled`, flag spento o numero sconosciuto ⇒ 200 senza persistenza.
- **Persistenza idempotente** (RPC `ingest_whatsapp_inbound_message`, unique `(channel_id, provider_message_id)`), poi elaborazione asincrona: `WHATSAPP_PROCESSING_MODE=inline` (default) o `n8n` (`ops/n8n/whatsapp-inbound-dispatch.json` → `POST /api/internal/whatsapp/process`, solo UUID). Sweep ogni minuto + purge notturna `POST /api/internal/whatsapp/maintenance` (`ops/n8n/whatsapp-maintenance.json`, bearer `WHATSAPP_INTERNAL_SECRET`). Claim atomico `claim_whatsapp_inbound_messages` (max 3 tentativi).
- **Motore** (`lib/whatsapp/automation/`): intent sensibili (operatore, reclamo, pagamento, non ricevuto, media) → handoff; regole deterministiche per priorità tenant (`whatsapp_automation_rules`, riga assente = default) con dati Lepefy (orari/indirizzo via `resolveNalaFastStoreInformation`, spedizione da `tenants.shipping_provider`, stock via `resolveNalaFastProductAvailability`, ordini/tracking via `buildOrderPortalViewModel` solo se `wa_id` = `customers.normalized_phone` univoco del tenant e ordine pagato); poi Nala; poi operatore/fallback. Nessun URL di deployment nei messaggi: solo `tenants.storefront_url`.
- **Nala come canale**: `lib/ai/nalaChannelTurn.ts` riusa prompt, contratto, routing AI Core (`nala`/`structured_chat`), Response Memory e retrieval del widget; storico AI Core separato (`nala_whatsapp`); guardrail: pagamento/ordine/consegna mai dall'IA, confidenza < 0,55 o intent `unknown` ⇒ handoff. Il widget `/api/chat` non è stato migrato.
- **Handoff**: `whatsapp_handoffs` (uno aperto per conversazione); `waiting_human`/`human` ⇒ `automation_status = paused` e nessuna risposta automatica; presa in carico, ripresa manuale o automatica (`auto_resume_minutes`), chiusura, tutto auditato (`whatsapp_audit_events`). Risposte umane dallo stesso numero, solo entro 24 h dall'ultimo messaggio cliente (template non implementati).
- **Segreti**: nessun token in DB; `access_token_env` = nome di variabile `META_WHATSAPP_<X>_TOKEN`, default `META_WHATSAPP_SYSTEM_USER_TOKEN`. Tenant `is_test`: invii solo verso `WHATSAPP_TEST_RECIPIENTS`.
- **Admin** `/admin/canaux/whatsapp` (Vue d'ensemble, Conversations, Automatisations), voce sidebar «Canaux › WhatsApp» solo con flag + `whatsapp.view`; `requireWhatsAppPage/Api` (`lib/whatsapp/server/featureGate.ts`, 404 a flag spento). Capability `whatsapp.view` / `whatsapp.reply` / `whatsapp.manage`; identità Meta del numero e invio `hello_world` riservati al platform owner.
- **Distinto** dallo strumento sperimentale di lettura di cataloghi WhatsApp **esterni** (sotto).
- **Stato (7/10/2026)**: 147 applicata. App Meta *Lepefy Messaging Platform* (pubblicata, portfolio Lepefy) con webhook su `test.lepefy.com`, campo `messages`, app iscritta alla WABA di test. Un solo canale: numero di test Meta su `lepefy-test`, *Actif*, automazione ON, Nala OFF. Collaudati inbound, persistenza, risoluzione tenant, regole `greeting`/`shipping`/`opening_hours`, handoff automatico, risposta dall'inbox operatore e ripresa dell'automazione (ciclo handoff completo), outbound e stati `sent/delivered/read` (dettagli e ID in `docs/WHATSAPP_BUSINESS_PLATFORM.md` §11.1). Token Meta permanente (System User *Lepefy Messaging Bot*), canale gestibile dall'admin con il platform owner; modalità `inline`, workflow n8n non importati. Nessun numero reale collegato (Chloe Food: procedura documentata, non eseguita).

### Import di cataloghi WhatsApp esterni (CLI locale + console platform, migration 149 e 150 applicate) — `docs/WHATSAPP_EXTERNAL_CATALOG_IMPORT.md`

- CLI `pnpm catalog:whatsapp:test` + server di revisione `pnpm catalog:whatsapp:review` (127.0.0.1): lettura del catalogo di un'attività terza via GREEN-API (sessione WhatsApp di un account Lepefy, solo `getStateInstance`/`getProducts`), normalizzazione provider-indipendente (`lib/externalCatalog/`), parser deterministico FR/IT/EN di quantità minima/step/formato, staging immagini anti-SSRF con dedupe sha256, report HTML/JSON. Artefatti solo in `artifacts/whatsapp-catalog/` (git-ignored).
- La CLI non scrive mai in Supabase/storage: le sue decisioni di revisione restano locali.
- **Console platform** `/admin/platform/catalogues-whatsapp` (solo platform owner; flag `external_catalog_import` sul tenant di destinazione): sorgente = venditore (numero obbligatorio, il link `wa.me/c/` contiene l'ID catalogo) → tenant, con sconto di default e consenso scritto obbligatorio per applicare. «Actualiser» legge la prima pagina di `getProducts` (max 10, non pagina: `'after' is not allowed`) e poi tutte le collezioni con i cursori documentati `afterCollectionId`/`afterProduct` a riprese: blocchi da max 40 s/40 richieste che registrano subito i prodotti e restituiscono un punto di ripresa validato, rimandato dal browser al blocco successivo (route Vercel da 60 s, latenza GREEN-API misurata 3–11 s per chiamata). Sul catalogo di test 98 prodotti unici invece di 10. La restrizione WhatsApp *Commerce Features Disabled* (letture troppo frequenti) è riconosciuta (`CATALOG_RESTRICTED`) e mai ritentata. Lettura `complete` / `partial` (collezioni lette ma possibili prodotti fuori collezione) / `truncated`; solo `complete` marca «retiré» e calcola gli stati `new/changed/linked/unavailable/dismissed` (hash del contenuto, prezzo precedente). Il dettaglio applica campo per campo (nome, descrizione, prezzo, minimo, incremento, peso, quantità netta, categoria, foto) a un prodotto nuovo (inattivo, stock 0) o esistente tramite RPC idempotenti con audit prima/dopo. Prezzo unitario = prezzo del lotto WhatsApp ÷ quantità minima × (1 − sconto %), arrotondato al centesimo con scarto mostrato (`lib/externalCatalog/pricing.ts`). Le foto sono copiate in `assets/tenants/<id>/products/<id>/`. L'invalidazione cache raggiunge solo il deployment corrente: lo storefront del tenant si aggiorna al TTL.
- **Stato (8/10/2026)**: lettura reale riuscita (istanza GREEN-API *Developer*, numero di test Lepefy): 10 prodotti, 12 immagini in staging, 4 minimi proposti, 5 da revisionare. Il link `wa.me/c/` contiene l'ID catalogo, non il numero: serve `--chat-id <numero>@c.us`. Prezzi GREEN-API in millesimi (la doc dice ÷100), disponibilità in `availability`, `sale_price` oggetto. Uso in produzione bloccato da condizioni d'uso WhatsApp (client non ufficiale), diritti su testi/foto del venditore e completezza non garantita da GREEN-API (prodotti fuori collezione oltre i primi 10 irraggiungibili; richiesta al supporto in `docs/WHATSAPP_EXTERNAL_CATALOG_IMPORT.md` §2.1).

---

## Briefing operativo mattutino ordini (migration 129; attivazione separata)

Il rapporto operativo alle ore 08:00 locali per tenant usa `POST /api/internal/daily-order-digest` (Bearer `DAILY_DIGEST_CRON_SECRET`), richiamato ogni ora da n8n. L'applicazione classifica gli ordini pagati senza toccarne gli stati; i preordini e i pagamenti esterni ancora da verificare restano checkout session distinte. Le categorie sono: urgente, da trattare oggi, da monitorare. I tracking gestiti senza avanzamenti oltre soglia entrano in monitoraggio; una data di consegna stimata superata è segnalata come urgente senza cambiare lo stato dell'ordine.

**Configurazione.** Nessuna colonna `tenants.daily_digest_*`. Una riga `tenant_feature_settings (tenant_id, 'daily_order_digest')`:
- `enabled` è l'attivazione operativa; se la riga manca il modulo è disattivato, e la migration non crea righe;
- `config` è un JSONB versionato con fuso IANA, `include_empty` e le soglie preparazione, ritiro, verifica pagamento e inattività tracking;
- è validato da zod in `lib/notifications/dailyDigestConfig.ts` e dal CHECK `is_valid_daily_digest_config`, limitato a questa feature_key.

**Catalogo.** `daily_order_digest` è registrata in `platform_features` come `billable = false` / `operations`, senza piani né override: è inclusa nella piattaforma e non viene risolta da `hasTenantFeature()`.

**Comportamento del runner.** Una configurazione invalida sospende il tenant (`invalid_config`) senza ripiegare sui valori predefiniti.

**Admin.** `GET/PATCH /api/admin/daily-digest` con `tenant_settings.view/manage`, usato dalla card "Rapport quotidien" di `/admin/parametres/automatisations`. `/api/admin/tenant` non gestisce più il digest.

**Destinatari e registro.** I destinatari restano opt-in in `tenant_notification_recipients.notify_daily_digest`. Il registro idempotente `tenant_daily_digest_runs` è accessibile con RPC di claim service-role-only.

**Payload n8n.** Il payload per `/webhook/daily-order-digest` include HTML in francese, riepilogo, link protetti admin, snapshot precedente e chiave idempotente tenant/data. Il trasporto email resta n8n.

**Stato.** La migration 129 **è applicata in produzione** (26/09/2026; verificato: feature registrata non fatturabile, nessuna riga di settings, nessuna esecuzione, Nala intatta). Stato al 26/09/2026 sera: il tenant ChloeFood è attivato da Paramètres (config valida, `include_empty = true`) con 1 destinatario opt-in; nessuna esecuzione registrata. L'invio effettivo dipende ancora da secret `DAILY_DIGEST_CRON_SECRET`, scheduler n8n e webhook `/webhook/daily-order-digest`, non verificabili dal repository: controllare `tenant_daily_digest_runs` dopo le 08:00. Runbook: `docs/DAILY_ORDER_DIGEST.md`. Il receiver n8n importabile (`ops/n8n/daily-order-digest-email-receiver.json`) usa Header Auth dedicata (`N8N_DAILY_DIGEST_WEBHOOK_SECRET` sul server), claim SQL Postgres e SMTP; l'helper `notifyN8n` invia l'header esclusivamente per il digest e blocca l'invio se il secret manca.

---

## 1. Piattaforma e stack

Lepefy Food è una piattaforma SaaS food multi-tenant con storefront commerce, admin tenant, pagamenti, shipping, loyalty/referral, digital card, Nala e modulo Événementiel.

Principi:
- unica codebase multi-tenant;
- isolamento dati tramite `tenant_id` e RLS dove previsto;
- Next.js App Router + TypeScript;
- Supabase DB/auth;
- Stripe per pagamenti carta;
- Packlink per shipping;
- Zustand per cart;
- storefront brandizzato tenant; admin con identità piattaforma Lepefy e co-branding tenant nel journey di accesso.

Monorepo principale:

```text
apps/storefront/
packages/types/
supabase/migrations/
docs/
scripts/
AGENTS.md
LEPEFY_PROJECT_CONTEXT.md
```

---

### Tableau de bord client `/compte`

L’account mostra profilo con modifica esplicita, anteprima compatta della carta, ultimo ordine e storico, parrainage/ambassador, informazioni e indirizzi leggibili. Su mobile l’ordine delle sezioni è carta → ordini → vantaggi → accesso Avis clients (se pubblico) → informazioni/indirizzi; su desktop carta/vantaggi/avis e ordini/informazioni occupano due colonne. Il QR/barcode rimane nella pagina carta dedicata; il link Wallet nel riepilogo appare solo se un provider configurato è disponibile.

Le letture account sono parallele e tenant/customer-scoped. L’ultimo ordine reale è letto con `limit(1)`, riusa `getCustomerOrderPresentation` e il token tracking canonico senza alterare ordini o autorizzazioni. Errori saldo/indirizzi/ordini mostrano feedback e retry per sezione; un errore profilo canonico attiva l’error boundary e non simula privilegi/eligibilità. Il saldo non leggibile è `null` (—), distinto da zero; nessun ordine è distinto da errore di lettura.

L’etichetta parrainage usa `referral_access_granted` e `referral_suspended`, coerente con la pagina canonica; non genera codici o cambia l’accesso. Il logout UI verifica risposta HTTP e conferma `ok` prima di notificare e reindirizzare; sessione e provider auth restano invariati. La cancellazione resta raggiungibile in `Gestion du compte`, senza modifica al flusso dedicato. Nessuna migrazione DB.

### Configurazione programma fedeltà (migration 130/131)

Attivazione e tassi del programma vivono **solo** in `tenant_feature_settings('loyalty')` (feature `billable = false`, senza piani): `enabled` + config `{version, purchase_points_rate, points_to_currency_rate}` validata da zod (`src/lib/loyalty/loyaltyConfig.ts`) e dal CHECK `is_valid_loyalty_config`. Il codice legge tramite `getLoyaltySettings(db, tenantId)`: riga valida → valori salvati; riga assente, invalida o illeggibile → programma disattivato (fail closed). Scrittura admin: `PATCH /api/admin/loyalty/settings` (`tenant_settings.manage`, come prima). Le impostazioni referral hanno un proprio modulo (paragrafo seguente). **130 e 131 sono applicate in produzione** (26/09/2026, verificate): le colonne `tenants.loyalty_enabled/purchase_points_rate/points_to_currency_rate` e i trigger di mirror non esistono più, `process_manual_purchase_points_atomic` legge il tasso dalla riga settings. Un nuovo tenant non riceve alcuna riga loyalty: il programma resta disattivato finché un admin non salva la configurazione.

### Admin Avis clients (`/admin/avis`)

- Moderazione da finestra di conferma per ogni azione (Publier / Rejeter / Masquer / Republier): motivo obbligatorio per rifiuto e mascheramento, precisazione obbligatoria per « Autre » (`moderationIssues`, `lib/reviews/reviewAdmin.ts`, applicato anche dall'API). Un avis segnalato si pubblica solo con « Publier malgré le signalement ».
- Stati, motivi e segnali in francese (`possible_personal_data`, `contains_url`, termini della lista di vigilanza); filtri con conteggi per stato; numero d'ordine collegato all'ordine; errori dentro la finestra.
- Configurazione con barra « modifications non enregistrées », conferma di salvataggio e frase su cosa vede il pubblico (« La note moyenne s'affichera à partir de N avis publiés : encore X avis »), stessa regola di `summarizePublicReviewStats`.

### Admin IA — Base de connaissance (`/admin/ai-lab`)

- Voci **modificabili** (`PATCH /api/admin/knowledge-base/[id]`: testo e categoria, nuovo embedding se il testo cambia, uso IA registrato), **in pausa** (`active = false`, già ignorato da `match_knowledge_base`) e cancellazione solo con conferma. Ricerca, filtro Attive / In pausa, testo espandibile.
- **Ignorare un suggerimento**: riga marcatore inattiva senza embedding con `source = nala_dismissed:<chiave>`; il loader la usa solo come esclusione e la pagina non la mostra. Errori dell'API in francese.
- `KNOWLEDGE_INTENTS` (`lib/admin/knowledgeSuggestions.ts`) è condiviso con Nala Analytics: « Questions sans réponse » conta ora solo domande a cui una voce di conoscenza può rispondere (boutique, livraison, recette, événement, info produit). Prima includeva le ricerche di prodotto (« Je veux la Bouillie ») e rimandava qui una lista vuota.

### Admin Funnel checkout (`/admin/checkout-funnel`)

- Calcolo in `lib/admin/checkoutFunnel.ts` da `checkout_sessions` storefront del periodo (7/30/90 giorni, letture paginate; la view `checkout_funnel_30d` resta per gli altri lettori). Le sessioni il cui ordine è `is_test` sono escluse.
- Conversione = commandes / paiements terminés (completati + scaduti + annullati): prima i checkout ancora aperti contavano come persi (2/5 = 40 % invece di 2/3). Valori in euro convertiti, in attesa e persi (articoli + spedizione − riduzione parrainage).
- Liste azionabili: pagamenti esterni da verificare e carrelli da rilanciare (aperti/scaduti negli ultimi 7 giorni, con contatto, dal più alto) con link a `/admin/paiements-en-attente/[id]`.

### Admin Slides d'accueil (`/admin/accueil-slides`)

- **Sicurezza**: i link dei pulsanti erano salvati senza controllo (un `javascript:` finiva come href sulla home). Ora `safeSlideHref` (`lib/home/heroSlideRules.ts`) accetta solo percorsi interni `/…` o `https://` senza credenziali: validato nel form, nelle API (POST/PATCH sul risultato unito) e di nuovo in `HeroCarousel` per i dati già esistenti. Libellé e link vanno insieme anche per il pulsante principale.
- **Cache**: le API delle slide non invalidavano nulla e `/accueil` è ISR 300 s; ora POST/PATCH/DELETE/riordino passano da `withStorefrontInvalidation(['catalog'])`.
- **Riordino** con un solo `PUT /api/admin/hero-slides/order` (lista completa, posizioni riscritte 0..n-1, 409 se la lista è cambiata) al posto di due PATCH paralleli. Upload immagini da `/api/admin/hero-slides/upload-image` (permesso `catalog.manage`, solo kind `hero-slide`; prima serviva `event_content.manage`).
- Editor con anteprima reale (stessi gradienti della home), varianti in francese, conferma prima di nascondere l'ultima slide attiva, errori del server leggibili.

### Platform Prospects — suivi commercial (`/admin/platform/prospects`) — `docs/PLATFORM_PROSPECTS.md`

- Vista di default **À relancer** (`follow_up=due`: prossima azione entro oggi, Europe/Paris, esclusi chiusi e opposizioni) con conteggio dei ritardi; **Pipeline** con chip per stato e conteggi; filtri nell'URL.
- `salesPipeline.ts` applicato dal PATCH: motivo obbligatorio per « Perdu » e « Ne pas contacter », data di contatto automatica sugli stati di contatto, prossima azione chiusa per gagné/perdu/ignoré, `append_note` datata in cima allo storico.
- Fiche: suivi commercial in alto, link di contatto rapidi (nascosti in caso di opposizione), diagnostica tecnica chiusa. Nessuna migrazione.

### Admin Nala Analytics (`/admin/nala-analytics`) — `docs/NALA_ANALYTICS.md`

- **Parcours** conversazioni → panier → paiement → commande (conversazioni distinte, tasso sulle conversazioni del periodo). **Ventes assistées** senza ordini `is_test`, annullati o non `paid` (una query `orders` ogni 200 id; prima erano tutti contati).
- **Liste azionabili** con estratti di messaggio (≤ 120 caratteri, e-mail e telefoni mascherati da `redactMessage`, nessuna identità): domande senza risposta → AI Lab, prodotti introvabili → `/admin/catalogue?q=`, risposte prodotto deboli. Attività su tutto il periodo (giorni 7/30, settimane 90) in Europe/Rome; avviso se l'arricchimento copre < 90 % dei messaggi; « Module IA suspendu » distinto da « non inclus ».
- **Ritenzione**: `purge_expired_nala_analytics()` (095) non era mai chiamata. Ora `POST /api/internal/nala-analytics-purge` (Bearer `NALA_ANALYTICS_PURGE_CRON_SECRET`) + `ops/n8n/nala-analytics-purge.json` (giornaliero 03:30, importato inattivo).

### Admin Programme Ambassadeur (`/admin/ambassadeurs`) — `docs/AMBASSADOR_PROGRAM.md`

- **Regole** salvate solo da `PATCH /api/admin/ambassador/settings` (`tenant_settings.manage`, zod + `ambassadorSettingsIssues`): achat minimum > 0 (prima uno 0 faceva dividere per zero `process_ambassador_commission_atomic` alla consegna), pool > 0, riduzioni ≤ 100 % / ≤ achat minimum, plafond ≥ commission au seuil. I campi ambassadeur non sono più in `/api/admin/tenant`. « Commission minimum » rinominata « Commission au seuil » (definisce il tasso, non è un minimo).
- **À verser** (solo `growth.payouts.manage`, unico ruolo che riceve IBAN/PayPal): un versamento per ambassadeur (`POST /api/admin/ambassador/payouts`, un solo update filtrato tenant + ambassadeur + `CONFIRMED` sugli id mostrati, mai doppio), rifiutato se il profilo è incompleto. Sostituisce il vecchio « Marquer comme payé » per riga (`commissions/[id]/pay`, rimosso).
- **Annullare** una commissione `CONFIRMED` con motivo (`commissions/[id]/cancel`) per ordini rimborsati; definitivo (vincolo unico per invitato). Nomination idempotente, rimozione con conferma, ricerca clienti sotto `/api/admin/ambassador/customers-search` (permesso `growth.manage`, prima richiedeva `loyalty.manage`), errori sempre mostrati.

### Admin Fidélité & parrainage (`/admin/loyalty`)

- **Configurazione** in due sezioni (programma; parrainage + anti-frode), con esempio dei punti e frase che descrive l'anti-frode. Salva solo le sezioni modificate (`changedLoyaltySections`, `lib/loyalty/loyaltyAdmin.ts`) e dice esattamente cosa è stato salvato; barra delle modifiche non salvate, conferma prima di disattivare il programma. Senza `tenant_settings.manage` la configurazione è in sola lettura (le API lo richiedono già).
- **Commissioni per livello** inserite in % (salvate in decimali, invariato); `referralTierIssues` segnala livelli senza commissione, commissioni oltre la profondità e totale > 50 %. `POST /api/admin/loyalty/tiers` inserisce la nuova versione prima di disattivare le precedenti (prima un insert fallito lasciava il livello a 0 %) e limita il livello a 1–5.
- **Accessi, revisioni, bonus**: le azioni cambiano lo stato a schermo solo se il server conferma e mostrano l'errore; `grantReferralAccess`/`revokeReferralAccess` restituiscono un esito (404 cliente non trovato, 500 errore DB) invece di riuscire in silenzio. Revoca con conferma, motivi e tipi in francese, righe in revisione con beneficiario, filleul e ordine (una sola query clienti, tenant-scoped).

### Scan fidélité in cassa (`/admin/loyalty/scan`)

Pagina fuori dal gruppo `(protected)` (accessibile a `tenant_cashier`), protetta dalla stessa permission RBAC delle sue API (`getCurrentAdminAccessContext` + `canAdmin(..., 'loyalty.scan')` + tenant), non più dal solo `admin_users.role`; le route `/api/admin/loyalty/scan/*` richiedono `loyalty.scan` (ruoli `tenant_admin`, `tenant_cashier`). Helper puri condivisi: `src/lib/loyalty/loyaltyScan.ts`.
- **Anteprima**: «≈ +25 pts → nouveau solde 145» con lo stesso arrotondamento della RPC (`round(importo × purchase_points_rate)`, tasso passato dalla pagina); il pulsante dice «Créditer N pts». I punti reali restano calcolati da `process_manual_purchase_points_atomic`.
- **Importo anomalo**: sopra `UNUSUAL_AMOUNT_EUR` (300 €) serve una seconda conferma.
- **Doppio accredito**: `POST scan/confirm` rifiuta con `409 DUPLICATE_RECENT` un acquisto identico (stesso cliente e importo) registrato da meno di 120 s, salvo `confirmDuplicate: true` («Créditer quand même»; il default è «Ne pas recréditer»). Il client invia una sola richiesta alla volta. **Limite**: due richieste strettamente simultanee possono ancora passare; chiuderlo richiede una chiave d'idempotenza nella RPC (migration, non fatta).
- **Carta dimenticata**: `GET scan/search?q=` cerca per nome o telefono (≥ 3 caratteri) solo tra i clienti con carta, massimo 5 risultati, con e-mail mascherata e ultime 4 cifre della carta; la scelta carica il cliente con `scan/lookup?customerId=`. Allarga ciò che vede una cassiera, quindi il payload resta minimo.
- **Ritmo di cassa**: dopo il successo il focus va su «Nouveau scan (Entrée)»; «Cette session» elenca gli ultimi 10 accrediti, solo in memoria nella pagina.
- **Accessibilità**: etichette visibili, errori `role="alert"`, anteprima e successo `aria-live`.

### Livraison › Tarification (`/admin/livraison`)

- Badge della modalità di prezzo effettiva e ordine di applicazione (prezzo base → forfait fisso → remise → gratuità; il paese prima di « Tous les pays »).
- **Una regola attiva per paese**: le API `shipping-rules` rifiutano con `409 COUNTRY_OVERLAP` una sovrapposizione (prima il prezzo diventava indeterminato: la quote prende il primo match non ordinato); i conflitti esistenti sono segnalati. Calcolo, checkout e tariffe invariati.
- **Anteprima** nel form con la stessa `applyCountryRule` delle quote; « Actif » chiede conferma.
- **Zone** raggruppate per paese, ricerca « paese + CAP → zona » con la stessa regola del calcolo (prefisso più lungo); prefissi identici tra zone attive dello stesso paese segnalati e rifiutati (`409 PREFIX_OVERLAP`). Il testo dice ora che in modalità grille tarifaire la zona determina il prezzo.
- Senza `shipping.manage`: « Lecture seule ». Dettagli: `docs/SHIPPING_INTELLIGENCE.md` §3.

### Abbonamento e sospensione (migration 144 — da applicare)

- **Rinnovo**: un pagamento (carta via webhook `saas_subscription`, o bonifico registrato dalla piattaforma) prolunga fino alla fine del mese successivo al mese pagato; dopo una sospensione con arretrati copre il mese del pagamento (mesi senza servizio non addebitati). Registro `tenant_subscription_payments` idempotente sulla sessione Stripe; senza 144 il webhook mantiene il +30 giorni legacy.
- **Sospensione reale**: manuale o automatica dopo N giorni (`suspension_mode`, default **manuale** per tutti), più la sospensione di un singolo modulo. Motore unico `lib/billing/tenantServiceState.ts` (cache 60 s, fail-open): siti pubblici «Service temporairement indisponible», API di checkout/pagamento/prenotazione 503, Nala e avis spenti, admin del tenant limitato ad Abonnement e ordini in lettura (API 423). Webhook mai bloccati; `platform_owner` mai limitato.
- **Platform → Abonnements** (`/admin/platform/abonnements`): virement, sospensione/riattivazione, politica automatica, correzione scadenza, link Stripe, moduli, storico e journal (audit con motivo obbligatorio).
- **`/admin/billing`**: stato veritiero (sospeso, in ritardo, da rinnovare, attivo), mese coperto, riferimento bonifico `LEPEFY <SLUG> <AAAA-MM>` copiabile, ultimi pagamenti. Runbook: `docs/SUBSCRIPTION_LIFECYCLE.md`.
- **Avvisi**: e-mail a 7 giorni, 1 giorno e alla sospensione (tipo notifica `subscription_billing`, idempotenti nel ledger) da `POST /api/internal/subscription-reminders` (secret `SUBSCRIPTION_REMINDERS_CRON_SECRET`, template n8n `ops/n8n/subscription-reminders.json`, da attivare dopo la 144).

### Configurazione parrainage (migration 132)

Profondità, bonus d'iscrizione, modalità di disponibilità, soglia di sblocco e soglie anti-frode vivono in `tenant_feature_settings('referral')` (feature `billable = false`, senza piani). La config è validata da zod (`src/lib/loyalty/referralConfig.ts`) e dal CHECK `is_valid_referral_config`. Il programma continua a seguire `loyalty.enabled`; `referral.enabled` è `true` per tutti e `false` è riservato, non esposto in UI. `getReferralSettings(db, tenantId)` restituisce le stesse chiavi delle ex colonne `tenants.referral_*`, senza alcun ripiego su `tenants`:
- riga valida e attiva → riga;
- riga assente (tenant mai configurato) → valori predefiniti della 040, come un nuovo tenant prima;
- disattivata, invalida o illeggibile → `null`, cioè programma non disponibile: nessun codice, nessuna idoneità automatica, nessun bonus, nessun punto referral. Le superfici cliente usano `REFERRAL_UNAVAILABLE_VIEW`.

Scrittura admin: `PATCH /api/admin/loyalty/referral` (`tenant_settings.manage`, come prima), che rifiuta `SPENDING_THRESHOLD` con soglia ≤ 0; il primo salvataggio di un tenant senza riga la crea attiva. **132 e 133 sono applicate in produzione** (26/09/2026, verificate): le sette colonne `tenants.referral_*` di configurazione, i trigger di mirror e `referral_config_from_tenant` non esistono più; `customers.referral_*` e `referral_codes` sono intatti.

### Configurazione AI e contesto Nala (migration 134)

Flag AI (generazione immagini, generazione descrizioni, ricerca semantica) e limiti di rate limiting vivono in `tenant_feature_settings('ai')`. Il contesto privato dell'assistente vive in `tenant_feature_settings('nala').config.extra_context`, senza toccare l'attivazione Nala.

`src/lib/ai/aiSettings.ts` offre due letture:
- `getAiCapabilities(db, tenantId, tenant)`: riga valida e attiva → riga; riga assente o illeggibile → colonne `tenants.ai_*` (mirror); disattivata o invalida → tutto spento.
- `getNalaExtraContext()`: chiave `extra_context` se presente, altrimenti la colonna legacy.

Regole:
- Le impostazioni si leggono sempre con il client service-role, anche nelle pagine storefront che usano il client anon.
- Gli script `scripts/generate-product-{descriptions,embeddings}.mjs` applicano la stessa precedenza.
- Nessuna UI di scrittura: gestione manuale della piattaforma sulle righe settings, con i trigger che aggiornano le colonne.

**134 è applicata in produzione** (26/09/2026; verificato: riga `ai` identica alle colonne, contesto Nala copiato con attivazione invariata, voce di catalogo `ai` invariata, grant pubblici revocati, altri moduli intatti). Colonne e trigger legacy restano fino alla fase 5.

### Carta fedeltà cliente e Wallet

Le superfici `/compte` e `/compte/carte-fidelite` condividono `LoyaltyCardFace`, logo tenant e palette ChloéFood blu/giallo; gli altri tenant mantengono i colori configurati. QR nero su bianco con quiet zone e barcode continuano a codificare il numero tessera reale per lo scanner esistente.

`GET /api/loyalty/wallet/[provider]` emette Google Wallet tramite API issuer + save JWT RS256 oppure Apple Wallet come storeCard `.pkpass` con CMS detached, WWDR, signing-time e manifest SHA-1. Sessione cliente, tenant, loyalty enabled, consenso CGV e dati canonici sono verificati server-side; nessuna migrazione DB. Credenziali server-side vincolate esplicitamente con `LOYALTY_WALLET_TENANT_SLUG`; i provider non configurati non espongono pulsanti. Configurazione e collaudo su device: `docs/LOYALTY_WALLET.md`.

Il saldo del pass è aggiornato al ri-aggiungimento della carta, con identità stabile tenant/client; non sono implementati push APNs o sync per ordine. Il saldo corrente resta nella pagina cliente. L'attivazione reale richiede account issuer Google/publishing access e certificati Apple configurati su Vercel.

---

## 2. Multi-tenancy, domini e workspace

**Boundary server → client del tenant.** `getTenant()` restituisce la riga completa solo lato server. Tutto ciò che raggiunge il browser (`TenantProvider`, props di Client Components, payload RSC) passa da `toPublicTenant()` (`src/lib/tenant/publicTenant.ts`), che copia la allow-list `PUBLIC_TENANT_FIELDS` / tipo `PublicTenant` di `packages/types/tenant.ts`. Una nuova colonna di `tenants` è privata per default; aggiungerla alla allow-list la pubblica a ogni visitatore. `tests/unit/publicTenant.spec.ts` blocca i Client Components tipizzati con il `Tenant` completo. I componenti che ricevono proiezioni ad hoc (`/card`, `/pay/[token]`, `/compte`, `order-confirmation`) le costruiscono esplicitamente.

Il tenant applicativo è ancora risolto principalmente da `NEXT_PUBLIC_TENANT_SLUG`; `getTenant()` e le query applicative filtrano per `tenant_id`.

`tenants.storefront_url` è l'URL canonico Boutique. Il dominio Events resta configurato tramite `NEXT_PUBLIC_EVENTS_SUBDOMAIN`; `next.config.mjs` usa rewrite host-based nello stesso deployment Vercel.

Admin Core unico, due workspace UX:

```text
shop host   -> workspace shop
events host -> workspace events
```

Resolver canonico: `src/lib/admin/workspace.ts`.

La navigazione admin e la ricerca globale sono permission-aware. Lo switch workspace è mostrato solo se l'utente possiede almeno una capability della surface destinazione.

### Tenant di test e feature flag di rilascio (migration 138)

**Tenant di test.** Slug `lepefy-test` (nome "Lepefy Test"), nello **stesso** progetto Supabase di produzione, isolato come ogni tenant via `tenant_id` + RLS. È marcato da `tenants.is_test = true` (colonna privata: niente grant di colonna, mai in `PUBLIC_TENANT_FIELDS`). Branding volutamente neutro (grigi `#4B5563`/`#9CA3AF`/`#F3F4F6`, nessun logo), così un valore hardcoded di un altro tenant salta subito all'occhio. `shipping_provider = 'flat_rate'` (5,90 €). Si deploya come un secondo progetto Vercel con `NEXT_PUBLIC_TENANT_SLUG=lepefy-test`.

**Noindex.** Il root layout (`app/layout.tsx`, `generateMetadata`) aggiunge `robots: { index: false, follow: false }` quando `tenant.is_test` è vero. Ogni pagina lo eredita, salvo quelle che definiscono già `robots`. I tenant reali non ne sono toccati. L'app non ha `robots.txt`.

**Guard sulle comunicazioni esterne** (`lib/tenant/testTenant.ts`, `lib/notifications/testTenantGuard.ts`). Sono applicati all'ingresso di `sendNotification()` (`lib/events/notifyN8n.ts`), unico punto da cui passano email Brevo/n8n, ledger, retry e dispatch. La notifica è di test se il `tenantId` del payload è un tenant `is_test`, oppure se il deployment corrente lo è.
- Email renderizzate (`send-email`, `order-stock-conflict`, `daily-order-digest`): inviate **solo** ai destinatari di `TEST_TENANT_EMAIL_RECIPIENT` (lista separata da virgole), con oggetto prefissato `[TEST] `. Se la variabile manca, l'email è saltata.
- Tutti gli altri webhook n8n: saltati.
- Packlink (`lib/shipping/packlinkApiKey.ts`, usato da preventivo, tracking, simulatore, inspector, campagne): per un tenant di test solo la chiave propria del tenant, mai `PACKLINK_API_KEY` di piattaforma.
- Ogni salto è loggato come `[test-tenant] skipped: <canale>` e restituisce `ok` (`skipped: true`), così il ledger non riprova all'infinito.
- WhatsApp Cloud API (migration 147): per un tenant di test il response service non invia nulla (né conferme di lettura) verso numeri fuori `WHATSAPP_TEST_RECIPIENTS`; variabile assente = nessun invio (messaggio registrato `failed`/`test_blocked`). I link `wa.me` restano invariati.
- Eccezione nota: la console di test notifiche platform (`/api/admin/platform/notifications/test`) chiama n8n direttamente. È uno strumento esplicito del platform_owner.

**Ordini e prenotazioni.** Il trigger `mark_test_tenant_rows` (BEFORE INSERT su `orders` ed `event_reservations`) forza `is_test = true` per ogni riga di un tenant di test. Copre checkout, webhook Stripe, RPC di conversione e qualsiasi percorso futuro, senza toccare la logica di checkout. Attenzione: `tests/e2e/scripts/cleanup-test-data.ts` cancella gli ordini `is_test` delle ultime 24 h **di tutti i tenant**. Il seed crea quindi ordini retrodatati di più di 48 h.

**Feature flag di rilascio** (`tenant_feature_flags`: `tenant_id`, `flag_key`, `enabled`, `updated_at`, unique `(tenant_id, flag_key)`). RLS attiva: lettura solo del proprio tenant (`current_user_tenant_ids()`, admin attivo o cliente), scrittura solo service role. Regola: **ogni feature nuova nasce con un flag, spento di default**.
1. Dichiara la chiave generica in `lib/featureFlags/featureFlagRegistry.ts`.
2. Proteggi il codice server con `await isFeatureEnabled(tenant.id, '<chiave>')` (`lib/featureFlags/featureFlags.ts`). Riga assente o errore valgono `false`; cache 30 s invalidata a ogni scrittura.
3. Accendi il flag da `/admin/parametres/fonctionnalites` (`GET/PATCH /api/admin/feature-flags`, permessi `tenant_settings.view`/`manage`), prima su `lepefy-test`, poi sugli altri tenant.
4. Quando la feature è attiva ovunque, rimuovi il flag dal codice e dal registro.

Differenza con `tenant_feature_settings` (096): quella tabella resta per i **moduli permanenti** con `config` e FK su `platform_features`. I flag di rilascio sono temporanei e non passano dal catalogo commerciale.

**Seed.** `scripts/seed-test-tenant.mjs`, lanciato dal workflow manuale `.github/workflows/seed-test-tenant.yml`, crea 3 categorie, 12 prodotti, un metodo di pagamento esterno fittizio e 4 ordini finti.
- Rifiuta di girare se il tenant non è `is_test`.
- `SKIP_EXISTING` (default `true`) è applicato in JavaScript dopo la fetch, filtrando solo su `tenant_id`.
- Log per tabella: righe lette, righe da inserire dopo lo skip, inseriti e aggiornati.
- Gli ordini esistenti non vengono mai riscritti. `DRY_RUN=true` non scrive nulla.

**Stato al 30/09/2026 (setup completato e verificato):**
- Migration 138 **applicata in produzione**. Verificato: tenant `lepefy-test` con `is_test = true`, unico tenant di test; `tenant_feature_flags` vuota; `anon` riceve `permission denied` su tabella, colonna `tenants.is_test` e `current_user_tenant_ids()`.
- Seed eseguito da GitHub Actions: dry-run, poi reale (3 categorie, 12 prodotti, 1 metodo, 4 ordini). Un secondo lancio ha inserito 0 righe (idempotente).
- Trigger `is_test` verificato su ordini reali: pagamento in negozio (l'API inserisce `is_test: false`, in DB risulta `true`) e due pagamenti Stripe con carta di test. La mail `order_confirmed` risulta `accepted` nel ledger.
- Admin `tenant_admin` di `lepefy-test` creato da `/admin/team`.

**Progetto Vercel `lepefy-food-test`** (dominio `test.lepefy.com`, Root Directory `apps/storefront`):
- Variabili necessarie (il 30/09 ne sono state lette 10 sul progetto; le ultime tre, aggiunte dopo, sono confermate solo indirettamente da preventivo firmato ed email accettata): `NEXT_PUBLIC_TENANT_SLUG`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` (test), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (test), `STRIPE_WEBHOOK_SECRET` (webhook di test su `/api/webhooks/stripe`, eventi `payment_intent.succeeded` e `payment_intent.payment_failed`), `TEST_TENANT_EMAIL_RECIPIENT`, `BREVO_API_KEY`, `EMAIL_TRANSPORT=brevo`, `N8N_WEBHOOK_URL`, `TRACKING_SECRET` (valore proprio).
- Mai impostare `PACKLINK_API_KEY`, `STRIPE_SECRET_KEY_TEST`, `E2E_TEST_SECRET` o chiavi Stripe live.
- Senza `STRIPE_SECRET_KEY` il **build** fallisce ("Failed to collect page data"): 5 route creano il client Stripe a livello di modulo.
- Senza `TRACKING_SECRET` `/api/shipping/quote` risponde 500 e il checkout con consegna è bloccato.
- Senza `N8N_WEBHOOK_URL` la conferma d'ordine non parte, anche con `EMAIL_TRANSPORT=brevo`.
- **Ignored Build Step = "Only build production"**: solo `main` viene deployato, i branch non generano preview su questo progetto. `chloefood` non è toccato.

**Estendere la procedura a un altro tenant di test o demo** (es. `lepefy-demo`): migration di insert con `is_test = true`, nuovo progetto Vercel con le stesse variabili, seed con `TEST_TENANT_SLUG`.

### Admin Paramètres — Settings Hub

`/admin/parametres` è un hub di configurazione del tenant, non una pagina di form. Registry unico `app/admin/(protected)/parametres/_components/settingsRegistry.ts` (gruppi → sezioni → voci ricercabili) alimenta card dell'hub, sotto-navigazione interna e ricerca client-side (titolo/descrizione/keyword, case- e accent-insensitive, tastiera ↑/↓/Esc); una nuova impostazione si aggiunge al registry con la propria pagina, mai a una pagina monolitica.

```text
/admin/parametres                  hub: ricerca + card con stato
Boutique       /boutique           slogan, storefront_url, WhatsApp
               /retrait            punto di ritiro (click_collect_address, google_maps_url, orari FR/IT); click_collect_enabled in sola lettura
               /apparence          logo/colori in sola lettura + icona app (POST/DELETE /api/admin/app-icon)
               /presence           tenant_social_links + google_review_url
Communication  /notifications      matrice destinatari × gruppi di tipi (tenant_notification_subscriptions, 143)
               /automatisations    card automazione "Rapport quotidien" (tenant_feature_settings 'daily_order_digest')
Commerce       /paiements          tenant_payment_methods (logica invariata)
               /integrations       Stripe, Packlink, n8n (+ Brevo se EMAIL_TRANSPORT=brevo, Wallet se disponibile): solo presente/assente
Organisation   /legal              legal_name, legal_address, legal_email
```

- Gli stati delle card (`loadSettingsData.ts`) derivano solo da dati reali (colonne tenant, conteggi di social link/destinatari/metodi attivi, stato digest, integrazioni); `integrationsStatus.ts` è `server-only` e non restituisce mai chiavi, URL o identificativi di account.
- Le pagine di dettaglio usano `SettingsPageShell` (breadcrumb + sotto-navigazione verticale da `lg`, link "‹ Paramètres" sotto `lg`: su mobile il flusso è hub → dettaglio) e pannelli neutri `SettingsPanel`. I form tenant (`TenantFieldsForm`) inviano a `PATCH /api/admin/tenant` solo i campi della propria pagina.
- La sidebar globale mostra una sola voce "Paramètres". Tutte le route ereditano `tenant_settings.view` dal prefisso; le API restano quelle esistenti (`tenant_settings.view/manage`).
- Fuori da Paramètres, con lo stesso permesso `tenant_settings.view`: `/admin/contenu` (contenuto editoriale storefront: "Notre origine" `story_heading/story_text/story_image_url/countries_served`, upload `/api/admin/upload-story-photo`, link a Slides d'accueil se `catalog.manage`) e `/admin/outils` (QR boutique/carte SVG/PNG via `/api/shop/qr-code` e `/api/card/qr-code`, affiche PDF `/api/admin/card/poster`, link condivisibili). Entrambi sono voci "Commun" della sidebar e sono trovabili dalla ricerca dell'hub.

### Storefront routing, Catalogue, navigation e PWA

Le card Catalogue in promozione mostrano badge rosso, prezzo attuale e barrato affiancati e risparmio monetario derivato da `compare_at_price - price`. Per i cartoni con quantità esplicite nel nome prodotto, mostrano una riga confezioni/bastoncini senza dedurle dal peso. Prezzi, stock e azioni carrello restano canonici.

L'editor prodotto admin espone `compare_at_price` (prezzo barrato, superiore al prezzo di vendita) e `position`, con validazione nelle API create/update. Nel Catalogue raccomandato, le posizioni negative promuovono i prodotti attivi e in stock prima del ranking; filtri, isolamento tenant e paginazione SSR/API restano condivisi. Gli ordinamenti espliciti scelti dal cliente restano rispettati. Nessuna nuova colonna o migration è necessaria.

Le route storefront canoniche sono:

```text
/                     -> Catalogue storefront
/accueil              -> pagina editoriale “Découvrir”
/products             -> redirect permanente 308 verso /
/products/[slug]      -> Product Detail condiviso tra Catalogue e Goodies
/gadgets              -> boutique merchandising tenant (Goodies)
```

**Shopping return UX:** `src/lib/catalog/shoppingReturn.ts` conserva nella sessione del browser una destinazione di ritorno al catalogo (solo `/` o `/gadgets`, con filtri esplicitamente consentiti: category, q, sort, day, page, quantityGroup). Le card ricordano l'origine all'apertura della PDP; PDP e pagina carrello espongono `Continuer mes achats` e tornano al filtro salvato, o al catalogo di fallback per accessi diretti. Il carrello laterale conserva il contesto chiudendosi senza navigazione. Le regole checkout e carrello non cambiano.

La root `/` possiede ricerca, filtro categoria e paginazione tramite query string (`?q=`, `?category=`, `?page=`). I link di navigazione al Catalogue puntano direttamente a `/`; il logo storefront continua a puntare a `/`. La pagina editoriale secondaria è esposta in UI come **Découvrir**, non “Accueil”.

L'hero di `/accueil` è un carousel ibrido limitato a sei slide. Compone automaticamente, quando i dati pubblici esistono, il prossimo evento, i prodotti realmente in offerta, i servizi attivi `traiteur` e `location_materiel` e gli ultimi prodotti inseriti; completa gli slot restanti con le slide editoriali tenant. Alterna promozioni, servizi e immagini editoriali; un evento futuro apre la rotazione e prende il posto del secondo editoriale. Evento e servizi riusano esclusivamente rispettivamente `events.banner_image_url` e `service_offerings.cover_image_url`, senza duplicare media; quando l'immagine del modulo manca, resta il gradient tenant. Le slide prodotto usano immagini e prezzi correnti del catalogo. Il carousel avanza ogni 6,5 secondi, si sospende su hover/focus o tramite controllo esplicito e non parte con `prefers-reduced-motion`. Il banner événementiel separato dalla home è stato rimosso per evitare doppie promozioni. Le slide editoriali supportano `tenant_hero_slides.image_url` e upload admin; gli asset locali generati sono riservati ai fallback editoriali e completano le slide configurate di ChloeFood senza duplicare la stessa immagine.

Il branding PWA usa `tenants.app_icon_url` come artwork quadrato dedicato per manifest, Apple touch icon e futuri wrapper native/TWA; `NULL` mantiene il fallback compatibile su `logo_url`. L’upload admin è PNG-only, 512×512, massimo 1 MB, tenant-scoped e versionato per invalidare le cache. Sia `app_icon_url` sia il fallback `logo_url` sono sorgenti grafiche: la pipeline rimuove il padding uniforme, conserva le proporzioni e centra l’artwork sul canvas pieno `primary_color`, con scala più prudente per il purpose maskable. L’icona Digital Card resta separata e continua a usare `logo_url`; Digital Asset Links resta configurato tramite `android_package_name` e `android_sha256_fingerprint`. Nel repository non è presente una pipeline Android/Gradle/AAB: un nuovo launcher icon richiede la rigenerazione esterna del wrapper/AAB dal manifest live e un nuovo `versionCode`.

Le categorie possiedono `catalog_scope: 'shop' | 'gadgets'` (migration additiva e reversibile `103_category_catalog_scope.sql`, default `shop` per tutte le categorie esistenti). Catalogue `/`, paginazione `/api/products` e ricerca semantica pubblica includono soltanto prodotti delle categorie `shop` del tenant; `/gadgets` filtra server-side categorie e prodotti `gadgets`, con filtro `?category=` e paginazione `?page=`. Prodotti senza categoria non appartengono a nessuno scope. Il prodotto phare viene scelto tramite `featured`, poi `position`/`id`; in assenza di prodotti attivi la boutique mostra uno stato vuoto senza dati artificiali.

Goodies riusa `products`, immagini/prezzi/stock, `ProductCard`, l’azione condivisa `useQuickAdd`, cart store/sync/drawer, checkout e ordini. I carrelli misti rimangono supportati. Le card Goodies usano `/products/[slug]?from=gadgets` per la navigazione attiva; breadcrumb e ritorno derivano dallo scope reale della categoria. La canonical resta `/products/[slug]`; le raccomandazioni per merchandise rimangono nella stessa categoria. Admin `/admin/catalogue/categories` e `/api/admin/catalogue/categories` gestiscono nome, slug e destinazione Catalogue/Goodies con le permission esistenti `catalog.view/manage`. Le selezioni categoria nella creazione/modifica prodotto mostrano la destinazione. La migration deve essere applicata prima della promozione del codice che legge la colonna; non viene eseguita dal build Vercel. La migration correttiva `112_category_service_writes.sql` ripristina soltanto INSERT/UPDATE di `categories` per il ruolo server `service_role`, senza cambiare grant customer, RLS o dati; richiede applicazione manuale approvata in produzione. I fallimenti di save registrano soltanto operation/code/message DB nei log server, mai payload o credenziali.

Lista admin `/admin/catalogue` (`CatalogueTable`, helper puri in `lib/catalog/catalogueFilters.ts`).
- **Filtri e stato**: in query string (`q`, `status`, `category`, `sort`, `page`). La pagina è un Server Component: `loadCatalogueList` (`lib/catalog/catalogueList.ts`, condiviso con `GET /api/admin/catalogue`) legge la pagina richiesta e i `counts`, calcolati sull'intero catalogo del tenant con un `count(head)` per stato, quindi indipendenti dalla pagina. La tabella (`CatalogueTable`) è un'isola client solo per stock/statut inline e attivazione/disattivazione massiva (esito per prodotto, poi `router.refresh()`).
- **Stati**: tutti, attivi, inattivi, rupture (stock ≤ 0), stock basso (1–9, `LOW_STOCK_MAX`, stessa soglia del colore ambra), IA da rivedere.
- **«À compléter»**: senza peso (`weight_grams` nullo o 0, necessario per spedizione e carton), senza foto, senza categoria. I badge compaiono nella riga solo per queste mancanze.
- **Stock**: si salva solo se cambia (Invio o uscita dal campo); Esc ripristina.
- **Senza `catalog.manage`**: stock e stato in sola lettura, nessuna azione di gruppo né «Nouveau produit».
- **Debito noto**: la modifica dello stock dalla lista sovrascrive `products.stock` senza un movimento in `inventory_movements` (modulo Gestion). È un comportamento preesistente, da decidere a parte.

Editor prodotto `/admin/catalogue/[id]` (`ProductEditClient`).
- **Salvataggio**: in modifica invia solo i campi cambiati rispetto allo stato caricato o all'ultimo salvataggio (`lib/catalog/productFormDiff.ts`), con la PATCH che già aggiorna una colonna solo se è presente nel corpo. Così uno stock decrementato dagli ordini, o un prezzo o stato cambiati dalla lista mentre l'editor era aperto, non vengono più sovrascritti. L'embedding IA si rigenera solo se cambiano nome, categoria o descrizioni. La creazione invia ancora il corpo completo.
- **Campi già persistiti**: galleria e fondo d'etichetta, salvati subito dalle loro route, non contano come modifiche.
- **Barra fissa**: elenca le modifiche non salvate, con «Annuler les modifications» ed «Enregistrer»; uscire con modifiche chiede conferma.
- **Descrizioni IA**: «Marquer comme relue» imposta `description_source = 'human'` senza riscrivere il testo.
- **Peso**: se manca è evidenziato (necessario per spedizione e carton) e compare il badge «Poids à compléter».
- **Senza `catalog.manage`**: «Lecture seule», con i campi disattivati via `fieldset` (le schede restano navigabili).
- **Ritorno**: «← Catalogue» torna alla vista della lista (`?from=`, riletto con `parseCatalogueState`).

La Product Detail normalizza `image_url` e il JSONB `images` in una galleria ordinata (massimo 8 immagini): la prima immagine resta la copertina retrocompatibile usata dalle card. Il click apre un lightbox accessibile con chiusura Escape, navigazione tastiera, controlli precedente/successivo e swipe mobile. L’editor admin consente upload multiplo, riordino, scelta della copertina ed eliminazione; per rispettare il limite body di produzione, una selezione multipla viene prima ridimensionata nel browser fino a 1600 px e convertita in WebP ad alta qualità, quindi inviata in richieste sequenziali con progresso visibile e limite di 4 MiB per singola immagine. I nuovi asset usano path Storage univoci tenant/product-scoped e le API verificano sempre `tenant_id`. Non è richiesta una nuova migration perché `products.images` esiste dallo schema iniziale.

Su mobile `/products/[slug]` mantiene sempre accessibile l’azione d’acquisto tramite una purchase bar fissa sopra la `BottomNav`: selettore quantità, CTA **Ajouter au panier**, totale dinamico e stato **Ajouté au panier** condividono lo stesso stato locale della Product Detail; su desktop resta il blocco acquisto inline. La barra gestisce anche lo stato prodotto esaurito, rispetta la safe area e la pagina aggiunge spazio di fondo per non coprire le raccomandazioni. `ChatWidgetGate` segnala a Nala le Product Detail, così launcher e dialog mobile vengono sollevati sopra la purchase bar senza cambiare il comportamento desktop o la logica `cartStore`. Nessuna API o migration DB.

Le ProductCard grid dello shop usano la CTA esplicita **Ajouter au panier**. Dopo l’azione locale esistente, una sola `AddToCartConfirmation` nel layout shop mostra dialog desktop / bottom sheet mobile. `addToCartUiStore` conserva soltanto prodotto e revisione effimeri; quantità e sincronizzazione restano in `cartStore`, senza modifiche al formato persistito o all’attribution. `useQuickAdd` applica il limite stock a ogni clic shop e nelle recommendation; il comportamento visuale Goodies resta invariato.

La utility server `lib/catalog/getRelatedProducts.ts` è condivisa tra Product Detail (8 risultati) e `GET /api/products/[productId]/recommendations?limit=4` (massimo 4). L’endpoint pubblico read-only verifica prodotto attivo e tenant; riusa embedding esistenti / `match_products` e fallback categoria, senza LLM o nuove scritture. La confirmation carica suggerimenti in background con abort/timeout, nasconde gli errori opzionali e filtra i prodotti già nel carrello; le card compatte aggiungono senza aprire altre confirmation. La strategia V1 è `similar`, non co-acquisto. Non esiste un’infrastruttura analytics ecommerce generica riutilizzata da questo flusso; il tracking Nala preesistente resta nello store.

La navigazione storefront mobile usa `BottomNav` con esattamente Découvrir / Catalogue / Panier / Goodies / Compte per le destinazioni operative frequenti e un drawer laterale per esplorazione e servizi secondari. Goodies sostituisce Commandes soltanto nella BottomNav; `/orders`, account e voce Mes commandes del drawer restano disponibili. Goodies compare nel drawer Explorer subito dopo Catalogue, senza aggiungere una voce permanente all’header desktop. Il drawer è data-driven in base alla configurazione tenant. Su desktop le destinazioni principali restano visibili nell'header e lo stesso drawer è accessibile come menu secondario.

Il pattern di drawer è condiviso da Shop ed Events tramite `BrandNavigationDrawer`: overlay, Escape/backdrop, body scroll lock, focus ring, safe-area footer, social e legal sono implementati una sola volta; ogni surface passa sezioni e capability proprie.

### Suppression de compte client

La route pubblica tenant-aware `/supprimer-compte` è disponibile anche senza sessione. Un cliente non autenticato verifica l’identità tramite un flusso OTP dedicato con `shouldCreateUser: false`; questo flusso non esegue signup, upsert customer, consenso o referral. L’inserimento dell’OTP apre soltanto la conferma finale esplicita.

`src/lib/privacy/deleteCustomerAccount.ts` è il servizio server canonico. Blocca l’automazione per identità admin/staff o commissioni ambassador `CONFIRMED`, registrando `manual_review`. La RPC service-role-only `delete_customer_account_data` elimina in transazione profilo, indirizzi, cart, punti/referral propri, consensi standalone e conversazioni Nala/AI collegate; ordini, pagamenti, checkout durevoli, consensi ordine, audit loyalty/commissioni/frode e conversion attribution sono conservati scollegando il customer. L’identità Supabase Auth viene eliminata solo dopo il cleanup dati e la sessione locale viene invalidata. Nessuna cancellazione avviene per semplice corrispondenza email e i record guest omonimi restano fuori scope.

Sul dominio Events la navigazione pubblica usa URL pulite (`/`, `/evenements/[slug]`, `/services/[slug]`) mentre le route interne `/evenementiel/**` restano l'implementazione App Router raggiunta tramite rewrite host-based. I link verso Traiteur/Location/Galerie sono esposti solo se esistono contenuti pubblici attivi.

La PWA usa `start_url: '/'` e lo shortcut prodotti punta a `/`; il service worker pre-cachea la root canonica.

---

## 3. Admin authorization — RBAC dinamico

Il modello authorization canonico è:

```text
auth.users
   -> admin_users (identità/profilo)
   -> admin_memberships (utente + tenant/global)
   -> admin_roles
   -> admin_role_permissions
   -> admin_permissions (catalogo capability stabile)
```

Tabelle introdotte da `085_admin_rbac_permissions.sql` / `086_admin_rbac_role_permission_rpc.sql`:
- `admin_roles`;
- `admin_permissions`;
- `admin_role_permissions`;
- `admin_memberships`;
- `admin_access_audit`.

`admin_users.role` e `admin_users.tenant_id` restano compatibility mirror temporanei, non source of truth di lungo periodo.

Ruoli sistema:
- `platform_owner`: global, protetto;
- `tenant_admin`: accesso completo tenant, protetto;
- `tenant_cashier`: capability operative cassa/scanner;
- `admin_scanner` / “Service repas”: solo scanner Events.

Il Platform Owner gestisce ruoli, permissions e memberships da `/admin/platform/access`. I ruoli tenant custom possono essere creati senza deploy componendo capability esistenti.

### Semantica system role

`platform_owner` bypassa tutte le capability applicative.

`tenant_admin` è contrattualmente “full tenant admin”: `canAdmin()` considera valido qualsiasi permesso non `platform.*` anche se una capability appena deployata non è ancora stata materializzata in `admin_role_permissions`.

Gli altri ruoli, inclusi i custom role, ricevono esclusivamente le capability persistite nel DB.

---

## 4. Enforcement API admin

`src/lib/auth/adminRbac.ts` fornisce `getAdminAccessContext()`, `canAdmin()` e `requirePermission()`.

Scanner usa direttamente `requirePermission()` capability-per-capability.

Le API admin legacy che chiamano ancora `requireAdmin()` sono capability-driven:

```text
/api/admin request
   -> middleware.ts (solo /api/admin/*)
   -> x-lepefy-admin-path + x-lepefy-admin-method
   -> adminApiPermissions.ts
   -> business capability
   -> requirePermission()
```

`apps/storefront/src/lib/auth/adminApiPermissions.ts` è la mappa canonica method+route → capability. La mappa è **fail-closed**.

Capability principali:

```text
orders.view
orders.manage
shop_payments.confirm
catalog.view
catalog.manage
shipping.view
shipping.manage
loyalty.manage
loyalty.scan
growth.manage
growth.payouts.manage
reviews.view
reviews.moderate
reviews.manage
ai_knowledge.manage
events.view
events.manage
event_capacity.manage
event_reservations.view
event_reservations.manage
event_payments.view
event_payments.confirm
event_payments.cancel
event_payments.refund
event_content.manage
scan.access
scan.search
scan.redeem
scan.metrics
scan.undo_own
scan.undo_any
tenant_settings.view
tenant_settings.manage
billing.view
ai_usage.view
suppliers.view / suppliers.manage
purchases.view / purchases.manage
inventory.view / inventory.manage
treasury.view / treasury.manage
supplier_payments.verify
whatsapp.view / whatsapp.reply / whatsapp.manage
platform.*
```

Le capability Gestion (139) sono `standard` in lettura, `sensitive` in scrittura, `supplier_payments.verify` è `critical`. Assegnate solo a `platform_owner`/`tenant_admin`, mai ai ruoli custom esistenti. `/api/admin/gestion/**` è mappata da `lib/gestion/permissions.ts` (fail-closed); le pagine `/admin/gestion/**` da `adminRoutePermissions.ts`, che supporta `anyOf` (la dashboard Gestion accetta una qualsiasi delle 4 capability `.view`).

Le capability money-moving/manual-financial sono isolate e `critical`. La creazione di una prenotazione Events già incassata in negozio è mappata esplicitamente a `event_payments.confirm`, non alla generica `event_reservations.manage`.

La modifica della capacità vendabile di un evento è isolata nella capability `event_capacity.manage`. Il CRUD generico `events.manage` non può più modificare `capacity_total`; l'unico percorso applicativo supportato è l'endpoint dedicato `/api/admin/evenementiel/events/[id]/capacity`, che usa l'RPC atomica `adjust_event_capacity`.

---

## 4.1 CRM tenant / Customer 360

Il CRM tenant è disponibile su `/admin/clients`, con Customer 360 su `/admin/clients/[id]`, segmenti su `/admin/clients/segments` e campagne su `/admin/clients/campagnes`. Le surface usano ricerca e paginazione server-side, filtri URL, KPI tenant-scoped, tabella desktop e card mobile. Le capability dedicate sono `customers.view`, `customers.manage`, `segments.manage`, `campaigns.view` e `campaigns.manage`; vengono assegnate ai soli system role `platform_owner` e `tenant_admin`, non a `tenant_cashier` o ruoli custom.

`customers` è una business entity indipendente da Supabase Auth. `customers.id` resta la PK storica invariata; `auth_user_id` nullable è il collegamento login con `ON DELETE SET NULL`. Il backfill della migration `109_tenant_crm_foundation.sql` copia gli ID Auth esistenti senza rigenerare UUID o modificare FK da ordini, indirizzi, loyalty/referral e analytics. Le RLS account-owned risolvono ora `auth.uid() -> customers.auth_user_id -> customers.id`.

`resolveOrCreateCustomer()` è il resolver centrale tenant-scoped per signup, guest checkout, admin ed Events. L'ordine è Auth ID, e-mail normalizzata, telefono sufficientemente affidabile e creazione. Non usa fuzzy matching sul nome. Un guest viene collegato all'account dopo OTP solo se l'identità è univoca nello stesso tenant; collisioni storiche non vengono fuse. Il backfill valorizza `normalized_email` / `normalized_phone` soltanto per valori univoci e lascia le collisioni a revisione manuale; il trigger impedisce nuove collisioni.

Checkout Shop Stripe/external-link/in-store continua a usare prezzi, stock, pagamento e state machine preesistenti, ma risolve anche i guest nel CRM e propaga sempre il `customer_id` quando l'identità è sicura. Gli ordini assistiti (sezione 8) riusano lo stesso resolver con `source = 'admin'` (ricerca per nome/telefono/e-mail, nessun duplicato, nessuna e-mail inventata, nessun consenso marketing dedotto); `orders.email` è nullable **solo** per `order_origin = 'assisted'` e `order_completed` porta `source = 'assisted_order'` con canale e fonte di conferma. Nessuna attribuzione Nala per le vendite assistite. `event_reservations.customer_id` collega allo stesso customer le prenotazioni realmente riconducibili. `customer_events` è append-only e usa `event_key` tenant-scoped per gli eventi retryable; ordini, loyalty manuale, prenotazioni e consensi restano anche nelle rispettive fonti autorevoli e la timeline Customer 360 le unifica senza creare ordini fittizi.

Il read model `customer_crm_overview` deriva in una query aggregata ordini, valore, panier moyen, spesa online/in-store, saldo loyalty, ultima attività, partecipazioni Events, prodotto/categoria preferiti e consenso marketing corrente. RFM mantiene valori raw e score tecnici separati dal segmento umano; la UI mostra le etichette francesi VIP, Fidèle, Potentiel fidèle, Nouveau, À risque, Inactif e Perdu. Le soglie V1 sono centralizzate nel read model.

Segmenti custom conservano soltanto `definition_json` strutturato e vengono tradotti da un engine applicativo whitelist-based; nessun SQL utente viene persistito o eseguito. I segmenti di sistema vengono seedati per tenant e non sono eliminabili dall'UI. Note e tag CRM sono concetti tenant-scoped distinti da `orders.notes`.

Le campagne V1 supportano il solo canale e-mail realmente instradabile tramite l'adapter centrale n8n `/webhook/marketing-campaign-recipient`. Al dispatch il backend ricalcola l'audience, applica il consenso marketing corrente, richiede una destinazione valida e crea uno snapshot idempotente per recipient prima di inviare payload granulari. SMS, WhatsApp e push sono predisposti nello schema ma rifiutati finché non esiste un provider configurato. I test sopprimono ogni delivery reale. Metriche delivered/opened/clicked/converted vengono mostrate solo quando esistono eventi provider; la finestra di attribution iniziale documentata è 14 giorni.

L'export CSV riusa i filtri correnti, resta tenant-scoped e non include Auth ID, IP, token o metadata tecnici. L'import CSV resta predisposto ma non implementato: richiede preview, mapping, dry-run e gestione collisioni prima di poter essere abilitato in sicurezza.

---

## 4.2 Avis clients vérifiés

La route `/avis/donner` usa un percorso dedicato e compatto: header con logo tenant e ritorno Boutique, sfondo chiaro, Inter per il form e Bricolage per i titoli, footer legal essenziale. Ticker promozionale, BottomNav e Nala sono sospesi soltanto su questa route; il resto dello storefront conserva la propria navigazione. Le stelle sono radio native accessibili da tastiera con voto/etichetta visibile, il commento è esplicitamente facoltativo e limitato a 2000 caratteri. Errori di valutazione sono contestuali; in caso di errore di invio il testo resta nello stato del form e può essere ritentato. Durante l’invio i campi e la CTA sono disabilitati; la conferma comunica soltanto l’avvenuta registrazione. Non sono mostrati messaggi esplicativi sulla moderazione admin; API, token, eligibilità e moderazione server restano invariati. Nessuna migration aggiuntiva.

Il modulo Reviews V1 introduce recensioni complessive del servizio legate a una singola commande Shop verificata. Le surface canoniche sono `/avis` e `/avis/donner` lato storefront e `/admin/avis` lato tenant admin. L'accesso commerciale usa la feature `reviews` in `platform_features`/`platform_plan_features`; l'attivazione operativa e la configurazione tenant restano in `tenant_feature_settings`, separate dal billing. Le capability dedicate sono `reviews.view`, `reviews.moderate` e `reviews.manage`; i system role `platform_owner` e `tenant_admin` le ricevono dalla migration, mentre i custom role non vengono ampliati automaticamente.

Una recensione V1 è sempre di tipo `service`, una sola per `(tenant_id, order_id, review_type)`, e può essere creata soltanto per un ordine dello stesso tenant con `status = delivered` e `payment_status = paid`. Il cliente autenticato deve coincidere con `orders.customer_id`; il percorso guest usa un token invito casuale 32-byte, persistito esclusivamente come SHA-256 e legato a tenant/ordine/invito. Il nome pubblico viene minimizzato (`Prénom I.`) e, in assenza di nome affidabile, usa `Client vérifié` senza derivare dati dall'e-mail.

Tutte le recensioni entrano obbligatoriamente in `pending_moderation`. Voto e testo cliente sono immutabili dopo l'invio; il tenant non può riscriverli. Le transizioni `publish | reject | hide | restore` passano dall'RPC `moderate_review`, che registra un audit append-only in `review_moderation_events`; reject/hide richiedono un reason code. Un voto basso non è mai un criterio di rifiuto. La blacklist tenant è deterministica e normalizzata rispetto a maiuscole, accenti e punteggiatura: genera flag `blocked_term:*` visibili al moderatore ma non pubblica, rifiuta o cancella automaticamente. Anche URL, possibili dati personali e pattern spam producono soltanto flag.

La moderazione AI è predisposta solo semanticamente in `tenant_feature_settings.config`, ma V1 la forza `false` e non effettua alcuna inference. Una futura implementazione dovrà passare dal Lepefy AI Gateway; la decisione umana resterà comunque separata.

Alla consegna di un ordine eleggibile viene creato idempotentemente un `review_invite`; il caso ordine già `delivered` che diventa `paid` successivamente è coperto anche dal PATCH admin ordine. Default: invio dopo 24 ore, reminder dopo 7 giorni, scadenza dopo 30 giorni. `.github/workflows/review-invites.yml` richiama ogni 30 minuti `scripts/process-review-invites.mjs`, che seleziona gli inviti dovuti e chiama `/api/internal/review-invites` sul dominio canonico tenant. La route usa claim retry-safe, token hashato e webhook n8n `/webhook/review-invite`. `notifyN8n()` è trattato come booleano autorevole: `false` non imposta `sent_at`/`reminder_sent_at`, cancella il token creato per quel tentativo e lascia il lavoro ritentabile.

`reviews`, `review_invites`, `review_invite_tokens` e `review_moderation_events` sono service-role-only con RLS forzata e nessuna policy browser diretta. `tenant_review_stats` aggrega esclusivamente recensioni `published`; la media pubblica può essere nascosta fino a `min_public_count` (default 3), mentre `/avis` mostra soltanto righe pubblicate con badge `Commande vérifiée`. La navigazione pubblica Reviews è esposta da `Compte → La communauté → Avis clients`, dalla pagina `/accueil` e, dato che la PWA si avvia sul catalogo `/`, da un teaser compatto sul catalogo iniziale non filtrato. Ogni accesso segue entitlement commerciale, abilitazione operativa e `public_display`; nessun teaser viene mostrato se la funzione è disabilitata. L'icona non rappresenta un voto, non mostra una media o conteggi inventati e non effettua query statistiche per il solo accesso alla pagina. La pagina `/avis` continua a leggere soltanto la view tenant-scoped `tenant_review_stats` e le recensioni `published`, rispettando `min_public_count` per la media. Nessuna nuova migration o modifica alla moderazione.

L'historique autenticato `/orders` mostra una CTA per gli ordini delivered+paid ancora senza recensione. Una submission anticipata completa l'invito eventualmente esistente per evitare e-mail successive inutili.

Per recovery/rollout esiste un backfill manuale tenant-scoped, bounded a 1–30 giorni e idempotente: crea soltanto inviti per ordini `delivered + paid` che non hanno già né review né invito e non abilita mai feature/settings al posto del tenant. Poiché `orders` non persiste ancora un `delivered_at`, la finestra storica usa `orders.updated_at` come miglior proxy disponibile; il dispatcher ricontrolla inoltre l'assenza di una review immediatamente prima dell'invio, evitando mail tardive a chi ha già recensito.

La migration additiva `113_reviews_foundation.sql` deve essere applicata manualmente in Supabase prima dell'attivazione: Vercel non applica migration. Prima dello schema/setting, i resolver falliscono chiusi e il modulo resta invisibile/inattivo.

---

## 5. Profilo e onboarding admin

`admin_users` contiene `first_name`, `last_name`, `nickname`, `phone` opzionale e `profile_completed_at`.

Al primo accesso un admin senza profilo completo viene indirizzato a `/admin/onboarding`; la modalità `/admin/onboarding?edit=1` è reversibile.

Login, onboarding e accept-invite usano co-branding coerente: Lepefy come piattaforma, logo/nome tenant come organizzazione operativa, fallback iniziali se manca il logo e colori admin Lepefy indipendenti dai colori tenant.

---

## 6. Boundary Platform / Tenant

Console Platform interna Lepefy:

```text
/admin/platform
/admin/platform/access
/admin/platform/ai-usage
/admin/platform/ai-routing
/admin/platform/application-mobile
/admin/platform/notifications
/admin/platform/prospects
/admin/platform/prospects/[id]
/admin/team
```

`/admin/platform/**` ha guard server-side platform-owner-only aggiuntivo. `/admin/team` resta gestione utenti amministrativi cross-tenant e non è il futuro Team self-service tenant.

/admin/platform/prospects è il modulo interno di acquisizione tenant, ora Prospects Enrichment V2.
Riusa guard Platform Owner, service client, discovery SIRENE e crawler V1; non introduce nuove
capability, scheduler o migration. La migration 101 resta prerequisito delle quattro tabelle
platform-only con RLS senza accesso browser.

La raccolta segue fonti gratuite prima: sito già noto → OSM se necessario → sito scoperto →
Google Places facoltativo solo senza sito risolto. BusinessLookupProvider separa gli adapter.
OSM usa normalizzazione trade/legal name e confidence deterministica con SIRET prioritario,
nome + posizione/categoria/indirizzo, soglia 85 e margine 12; candidati ambigui non vengono adottati.
Overpass resta bounded (150m/50 risultati), con cache 30 giorni e gate persistente.

Google Places è disabilitato di default e richiede GOOGLE_PLACES_API_KEY +
PLATFORM_PROSPECTS_GOOGLE_PLACES_ENABLED=true. PLATFORM_PROSPECTS_GOOGLE_PLACES_MONTHLY_LIMIT
default 900 limita le richieste, non garantisce gratuità. Ogni tentativo prenota atomicamente uno
slot mensile UTC INSERT-only in platform_prospect_cache (quota:google:YYYY-MM:NNNNNN).
Collisioni, storage indisponibile o quota esaurita falliscono chiusi; tentativi falliti non
rimborsano slot. Nessuna cancellazione dei record quota nel mese corrente. Persistono solo
place ID e diagnostica minimizzata; URL Google transitorio adottato solo dopo analisi diretta
completa con identità compatibile. Contatti/segnali permanenti provengono dal sito.

“Enrichir les non vérifiés” seleziona stato/cooldown, mai fit >=65; selezione manuale max 10.
Discovery max 500 e run sequenziali/riprendibili mantengono lease DB 180s e richiesta 60s.
Cache SIRENE 90 giorni, OSM 30, sito 14, errori sito un'ora. Nessuna scansione live nei test.
Suppression esclude enrichment e candidati outbound; won non crea tenant.

assessment.ts separa Fit Score, data completeness e maturità digitale/ordine, usando campi e
evidence JSON esistenti. Identità SIRENE completa tipica: 25% dati, fit ancora provvisorio.
Valutazione arricchita richiede crawl completo recente e complétude >=65. Unknown non equivale
a false; punti di assenza richiedono ispezione completata. Frammentazione, ordini su richiesta
e canali pubblici forniscono opportunità spiegabili senza aumentare arbitrariamente il peso food.
UI desktop/mobile espone qualità, stato raccolta, filtri/tri e diagnostica provider/quota.
Metriche dettagliate dei run vivono nel cursor JSON.

Il fetch diretto conserva SSRF, DNS/IP fissato, robots, timeout, redirect e same-origin;
gzip/deflate/Brotli hanno limiti sia compressi sia decodificati. Redirect robots HTTP→HTTPS/www
sono consentiti soltanto sullo stesso hostname normalizzato. Eatbu/DISH e link-in-bio non
provano ecommerce da soli. Recrawl parziale/fallito conserva prove/contatti precedenti;
updated_at compare-and-set impedisce overwrite di modifiche manuali concorrenti.
Sito modificato manualmente azzera l'analisi del sito precedente. Note e pipeline commerciale
restano separate. Dettagli e limiti: docs/PLATFORM_PROSPECTS.md.

`public.platform_branding` resta singleton service-role-only.

---

## 7. Platform billing

`084_platform_billing_boundary.sql` separa il billing SaaS dal tenant; `094_feature_entitlements_foundation.sql` normalizza il catalogo e la risoluzione delle feature commerciali:

```text
platform_billing_settings
platform_plans
platform_features
platform_plan_features
tenant_subscriptions
tenant_feature_overrides
tenant_feature_settings
```

`platform_features` è il catalogo canonico estensibile delle capability commerciali. `platform_plan_features.feature_key` referenzia il catalogo senza CHECK hardcoded. `tenant_feature_overrides` contiene soltanto eccezioni temporali o permanenti al piano (`manual`, `addon`, `trial`, `promotion`); in assenza di una riga il tenant eredita il piano attivo. Catalogo e override sono service-role-only, con RLS e nessuna policy browser.

`src/lib/entitlements/tenantEntitlements.ts` è il resolver canonico server-side: un override applicabile secondo `starts_at` / `expires_at` prevale sull'entitlement del piano. `tenant_feature_settings` è invece il layer canonico di configurazione operativa (`enabled` + `config` JSONB versionato), separato da piani, billing e override commerciali. L'accesso tipizzato passa da `src/lib/tenantConfig/moduleConfig.ts` (schema zod, valori predefiniti centralizzati, stati `missing`/`ok`/`invalid`, aggiornamento parziale della sola riga del modulo). Le feature `billable = false` (es. `daily_order_digest`) sono moduli operativi inclusi, registrati nel catalogo solo per la FK dei settings e mai risolti tramite piani. Nuove configurazioni di modulo non aggiungono colonne a `tenants`: architettura, inventario e piano di consolidamento in `docs/TENANT_CONFIGURATION_ARCHITECTURE.md`. Nala è disponibile soltanto quando coesistono entitlement commerciale `nala` e setting operativo `nala.enabled`; assenza del setting o errori di risoluzione fanno fallire il gating in modo chiuso senza interrompere lo storefront.

`src/lib/admin/platformBilling.ts` resta il resolver dello snapshot billing; `/admin/billing` legge piano, features, subscription e coordinate Lepefy dal dominio platform con fallback legacy temporaneo.

`nala_analytics` è una capability commerciale distinta da `nala`, inclusa nel piano all-inclusive `food-platform`. La raccolta è fail-closed: un errore del resolver analytics non interrompe Nala e non produce scritture. `nala_sessions` e `nala_interactions` conservano conversazioni, associazione cliente nullable, pagina sorgente, locale, device category e geografia approssimativa derivata server-side (country/region/city); non conservano IP, user-agent, fingerprint o cookie analytics. Il target di retention raw è 90 giorni tramite RPC service-role-only, da collegare a uno scheduler giornaliero approvato. Conversion Attribution V1 è implementata come capability commerciale separata `nala_conversion_attribution`. Il browser conserva solo touch minimizzati in `sessionStorage`, con finestra esatta di 30 minuti e last qualifying touch per prodotto. Il server riconvalida tenant, entitlement, interaction/session, finestra temporale e appartenenza del prodotto a `matched_product_ids`; tenant, prezzi, currency e valore assistito non sono mai autorevoli dal browser.

Il semantic enrichment Nala è asincrono e separato dal chat path: la migration `097_nala_semantic_enrichment.sql` aggiunge intent/confidence, demand status, retrieval quality, knowledge status, requested product text e stato/versione operativi direttamente a `nala_interactions`. La taxonomy V1 comprende intent prodotto, availability/price/recommendation/substitution, recipe, delivery/store/event information, order/payment help, complaint, small talk, other e unknown. `requested_product_text` è una frase derivata massima di 150 caratteri, non una copia del messaggio, e viene eliminata con la stessa retention della riga.

Il dispatcher `.github/workflows/nala-semantic-enrichment.yml` richiama ogni 10 minuti la route service-role-only `/api/internal/nala-semantic-enrichment`. L'RPC `claim_nala_interactions_for_enrichment` usa `FOR UPDATE SKIP LOCKED`, batch massimo 25, recovery claim dopo 15 minuti e massimo tre tentativi (`pending -> processing -> completed | failed`). Small talk resta deterministico senza AI. Le righe già risolte dal Fast Resolver possono essere semanticamente completate in linea con valori deterministici e `semantic_enrichment_status = completed`, evitando anche la successiva chiamata classification. Le altre righe passano dal Lepefy AI Gateway con policy dedicata `nala_semantic_enrichment / classification`: provider, modello, timeout e fallback sono configurati da `/admin/platform/ai-routing`, non hardcoded nel worker. Prima del claim il worker esegue `assertAiRouteReady`, quindi policy/chain/adapter/credential indisponibili producono HTTP 503 senza consumare `semantic_enrichment_attempts`. Lo structured output usa la taxonomy 097 e un validator stretto: output non conforme viene rifiutato dal router e può attivare il provider successivo. Il prompt resta minimizzato a message/reply/outcome più nomi prodotto e contesto KB associati; identità, sessione, geografia e device non entrano nel prompt. `ai_usage_log` registra endpoint `nala_semantic_enrichment`, consumer `nala_semantic_enrichment`, capability `classification`, provider/model e fallback. La conversion attribution riusa `matched_product_ids` come source of truth del retrieval e non duplica un evento `product_retrieved`.

Nala Structured Product Actions V1 estende `/api/chat` con action `add_to_cart` server-validate e user-confirmed. La UI mostra al massimo una card compatta per risposta e usa `cartStore.addItem(..., 1)`, quindi riutilizza sync, drawer e Conversion Attribution. Le action restano metadata UI; la history canonica è ora server-side in AI Core e il browser invia soltanto conversationId e il messaggio corrente. La copy action usa il locale storefront esplicito risolto da `localeStore` e dalle locale supportate dal tenant; `navigator.language` non è source of truth e il fallback resta francese.

Product Relationships V1 introduce `product_relationships`, layer direzionale tenant-scoped con tipi distinti `similar`, `substitute` e `complementary`. Le relazioni persistenti `manual` precedono `system`; all'interno della stessa source una priority numerica maggiore viene prima. Il trigger DB verifica che source e target appartengano al tenant, vieta self relation e duplicati, e le foreign key eliminano le relazioni con il prodotto. RLS non concede accesso browser: admin e Nala operano server-side con service role e authorization `catalog.view/manage`.

Il resolver canonico `src/lib/catalog/productRelationships.ts` restituisce prodotti canonici acquistabili. Dopo manual/system, `similar` può completare tramite embedding con preferenza di categoria; `substitute` richiede stessa categoria, alta similarità e disponibilità; `complementary` resta explicit-only. Il fallback semantico non viene persistito. Nala deriva il commerce mode dalla structured decision AI Core; il server risolve successivamente la relazione con gli stessi vincoli canonici e mantiene una sola action per turno. Il type `direct|similar|substitute|complementary` accompagna l'action; la risposta non può inventare relazioni o promettere sostituti identici.

`nala_interactions.action_product_ids` e `action_relationship_types` mantengono distinti prodotti retrieved e prodotti effettivamente emessi come action. Conversion Attribution qualifica entrambi senza falsificare `matched_product_ids`; cart, checkout e purchase restano invariati e fail-open rispetto all'analytics. Il tenant gestisce le relazioni dal tab “Produits associés” dell'editor catalogo con ricerca reale, add/remove, priority e active toggle. Nala Cart Builder V1 si attiva da `decision.commerceMode === 'cart_builder'` e usa la stessa chiamata AI Core principale per produrre reply + ingredienti strutturati (4–6 preferiti, massimo 8), senza product ID, prezzi o stock generati dall'AI. Il server esegue embedding batch degli ingredienti, risolve in parallelo prodotti canonici tenant-safe e purchasable, quindi applica direct match forte, substitute esplicito/manual-first o fallback semantico conservativo; complementary non viene usato come sostituto e un match incerto resta unavailable.

La proposta è client-safe e legata all'interaction tramite UUID logico. Il flusso richiede due consensi: apertura della preview e bulk add finale dei soli item selezionati; un follow-up “Oui” viene interpretato server-side con working memory e può riproporre una selezione canonica aggiornata; nessun prodotto viene aggiunto senza conferma. Quantità sempre 1, massimo 8 SKU, nessun quantity editor o calcolo confezioni. Il bulk add riusa `cartStore.addItem()`, protegge dal doppio click, mantiene i successi in caso di errore parziale e apre il drawer esistente tramite `cartUiStore`. I prodotti proposti restano separati dal retrieval in `action_product_ids`; direct/substitute descrivono il match catalogo mentre recipe resta l'intent/action context. Gli eventi add-to-cart, checkout e purchase continuano nella Conversion Attribution esistente. Locale: storefront/tenant, fallback FR, mai `navigator.language`.

Non esiste un recipe database né una tabella `nala_cart_plans`: V1 mantiene il piano nel turn client-side e usa interaction metadata + conversion events esistenti per misurare proposta/accettazione senza una seconda pipeline. Meal planner, automatic quantity optimization, collaborative filtering e persistenza delle ricette restano fuori scope.

Nala Analytics Dashboard V1 è disponibile nel tenant admin su `/admin/nala-analytics`, nel workspace Shop sotto “Croissance”. La route riusa `ai_usage.view` e verifica anche l'entitlement commerciale `nala_analytics`; non introduce nuove capability RBAC, tabelle, view o migration. `src/lib/admin/nalaAnalyticsDashboard.ts` esegue letture service-role tenant-scoped su `nala_sessions`, `nala_interactions` e `nala_conversion_events`, con count/paginazione server-side per non dipendere dal limite PostgREST. Le finestre disponibili sono 7/30/90 giorni.

La dashboard espone soltanto metriche derivate: conversazioni/interazioni, intent, unmet demand e requested product aggregate, knowledge gap, retrieval weak/empty, coverage enrichment, origine delle Product Actions, Cart Builder proposto/accettato, add-to-cart, checkout assistiti, ordini assistiti e gross assisted item value. Non mostra message/reply raw né identità cliente. “Assisted revenue” resta attribution e non causalità; il valore usa i dati durevoli di `nala_conversion_events` e non cambia checkout, ordini o payment state machine.

Le vecchie colonne billing in `tenants` restano compatibilità e non vanno rimosse senza migration dedicata.

---

## 8. Cart / checkout Shop

Modello canonico:

```text
cart -> checkout_session -> pagamento confermato -> order
```

L'attribuzione Nala è un sidecar best-effort e non cambia questo state machine. `nala_checkout_attributions` lega per prodotto il checkout all'ultima interaction qualificante e sopravvive a resume/reuse; `nala_conversion_events` registra solo `add_to_cart`, `checkout_started` e `purchase_completed`. La purchase viene scritta dopo le `order_items` da una RPC idempotente e usa il subtotale lordo reale delle sole righe assistite, prima di sconti order-level e shipping. Errori o schema analytics non disponibile non bloccano carrello, checkout, pagamento o ordine.

**Redirect dopo il pagamento** (`app/(shop)/checkout/CheckoutFlow.tsx`, fix del 30/09/2026). Pagamento con carta, ritiro con pagamento in negozio e ripresa dopo 3D Secure passano tutti da `completeCheckout(url)`: imposta `checkoutCompletedRef`, svuota il carrello e porta su `/order-confirmation`. L'effetto "carrello vuoto → `/cart`" è disattivato una volta che l'ordine esiste. Prima del fix il suo redirect vinceva e il cliente finiva sul carrello vuoto invece che sulla conferma (bug presente per tutti i tenant dal 24/08/2026).

Checkout session lifecycle (`checkout_sessions.origin` = `storefront` | `assisted`, migration 128):

```text
(assisted) draft -> open | cancelled
open -> completed | cancelled | expired
open + external handoff -> awaiting_verification
awaiting_verification -> completed | cancelled | open
(assisted) expired -> open (nuovo link)
```

Spese di spedizione: ogni percorso di pagamento passa da `lib/shipping/tariff/checkoutShipping.ts` (token legacy in `provider_cost`/`shadow`, token V2 ricalcolato in `tariff`; 409 `SHIPPING_REQUOTE_REQUIRED` → nuovo preventivo e nuova conferma del cliente), vedi sezione 13.

Recovery canonica: `/checkout/reprendre/[id]`; legacy `/orders/en-attente/[id]` redirige lì. Tutte le superfici di recovery cliente (`activeCheckoutSession`, `/api/checkout-sessions/*`, `/orders`, reminder admin) filtrano `origin = 'storefront'`; l'indice «una sola sessione open per cliente» vale solo per lo storefront. Le conferme manuali di pagamento esterno Shop sono protette dalla capability critica `shop_payments.confirm`.

Conversione centrale: `lib/orders/convertCheckoutSessionToOrder.ts` → RPC transazionale `convert_checkout_session_to_order` (lock `FOR UPDATE` della sessione, ordine + righe + decremento stock + chiusura sessione in una transazione, indice unico `orders.checkout_session_id`, `created=false` sui replay). Solo la chiamata vincente esegue consenso/CRM/Nala/notifiche/rimborso. La usano la conferma admin dei pagamenti esterni (storefront e assistiti), il webhook Stripe dei preordini assistiti e gli incassi registrati; `createOrderFromCheckoutSession.ts` è stato rimosso. Il webhook Stripe **storefront** conserva la propria creazione inline (debito tecnico, sezione 17).

### Ordini assistiti / preordini (migration 128)

*Review del codice: 25/09/2026, base `main@7fd6054ae8ac49e6d383653a296a1a65261ff3e9`.* Documentazione completa, policy e runbook: `docs/ASSISTED_ORDERS.md`.

`Admin → Commandes` espone **Nouvelle commande** (`/admin/orders/new`) e **Précommandes** (`/admin/orders/precommandes`, scheda `/[id]`, modifica `/[id]/modifier`). Un acquisto WhatsApp/telefono/Instagram/negozio è una checkout_session `origin='assisted'` con `sales_channel`: `draft` (Brouillon), `open` (En attente de paiement, link `/pay/<token>`), `awaiting_verification` (Paiement à vérifier), `completed`, `expired`, `cancelled`. «Déjà payé» crea la sessione e la converte subito (`admin_recorded`). Contenuto sempre validato server-side con `validateCheckoutItems` + `verifyCheckoutShipping` (preventivo firmato `/api/shipping/quote`) + sconto ambassador; nessun prezzo/tenant/stato dal browser; `request_key` rende idempotente la saisie.

La lista Précommandes è una work queue.
- **Classificatore unico**: `preorderQueue.ts`, con gruppi À vérifier → Liens expirés → Brouillons → Attente client → Terminées.
- **«À traiter»**: esclude l'attesa del cliente.
- **Ordinamento e conteggi**: server-side, prima della paginazione (`loadPreorderQueue.ts`).
- **Stato della lista**: in query string (`view`, `q`, `page`).
- **Scheda**: pannello «Prochaine action» con una sola azione primaria; sola lettura senza `orders.manage`.
- **Banner «Paiements à vérifier» di `/admin`**: mostra solo i checkout storefront; i preordini assistiti dichiarati si confermano dalla loro scheda, raggiunta tramite il link dedicato. Dettagli: `docs/ASSISTED_ORDERS.md` §11.

Il form «Nouvelle commande» / «Modifier» (`AssistedOrderForm`):
- **Checklist**: mostra una checklist viva dei passaggi (`assistedFormProgress.ts`) ed elenca tutti i punti mancanti all'invio.
- **Riordino**: propone «Reprendre ces articles» dall'ultima commande del cliente (`lastOrder` in `GET /api/admin/assisted-orders/customers/[id]`), con prezzi, stock e regole attuali.
- **Uscita**: chiede conferma prima di uscire con dati non salvati.
- **Mobile**: usa etichette di azione esplicite.
- **Invariati**: creazione, conversione e pagamenti.

Admin → Clients.
- **Lista**: i KPI aprono il segmento corrispondente (Clients, Actifs 90 j, Nouveaux, À risque) e c'è un chip «Actifs». L'ordinamento è in query string (`sort`: dernière activité, dépensé, commandes, nom, création; `parseCustomerSort`). Le fonti sono tradotte e il «Dernier achat» è relativo.
- **Scheda**:
  - «Nouvelle commande» (`orders.manage`) apre `/admin/orders/new?customer=<id>`.
  - «WhatsApp» (`wa.me`, solo numeri internazionali) ed «E-mail» compaiono solo se il contatto esiste.
  - Modifier, Note e Tag solo con `customers.manage`.
  - Cronologia, commande, punti, consensi e campagne usano etichette francesi (`lib/admin/crmLabels.ts`, `StatusBadge`); i valori sconosciuti restano grezzi.
- **Modali**: etichette ed Esc.
- **Invariati**: segmenti, campagne, RFM e consensi.

Link pubblico: token opaco = HMAC(`TRACKING_SECRET`, sessione + nonce), ricercato per SHA-256 tenant-scoped, revocato cambiando nonce; valido 72 h con prezzi garantiti; ogni emissione riapplica prezzi catalogo, disponibilità e spedizione; una modifica revoca il link, annulla il PaymentIntent (rifiutata se il pagamento è in corso) e riporta in `draft`. `/pay/[token]` (fuori dal layout shop, noindex) mostra solo dati di pagamento e propone Stripe (`StripePaymentStep`, `metadata.type = assisted_preorder`) e i `tenant_payment_methods` attivi del modulo shop (bonifico con riferimento `P-XXXXXXXX`); la scelta di un metodo esterno porta a `awaiting_verification`, mai a una conferma. Il successo è mostrato solo quando il server riporta `completed`.

Audit: `orders.order_origin`, `sales_channel`, `checkout_session_id`, `created_by_admin_id`, `payment_confirmation_source` (`stripe_webhook | admin_verified | admin_recorded`), `payment_received_at`, `payment_reference`, `payment_confirmed_by`, `payment_note`; `payment_method = manual` per gli incassi registrati; journal `assisted_order_events` service-role only. Capability: `shop_payments.confirm` per «Déjà payé» e conferme d'incasso, `orders.manage` per creare/modificare/link/annullare, `orders.view` per leggere. Nessuna riserva di stock: verifica finale prima di ogni pagamento/incasso, conflitto dopo pagamento → `stock_conflict` + rimborso Stripe o intervento manuale.

### Purchase quantity rules (minimo/step SKU e gruppi combinabili)

*Review del codice: 22/09/2026, base `main@2e7b721b8164e0998e5c2a97e3285debde504d05`.*

`products.min_order_quantity` / `products.order_quantity_step` (migration 121, default `1/1`) esprimono `q >= minimum && (q - minimum) % step === 0`. `purchase_quantity_groups` / `purchase_quantity_group_products` introducono regole aggregabili con membership esplicita, indipendente dalla categoria merchandising; lo SKU e il gruppo devono rispettare ciascuno la propria regola. Il gruppo senza membri nel carrello non si applica. Migration 122 aggiunge i due campi alle risposte `match_products`. **Migration 121/122 presenti nel repo non dimostrano l'applicazione al database production: verificarla separatamente prima dell'uso.**

Il motore puro `apps/storefront/src/lib/purchaseQuantityRules.ts` è condiviso: `computeQuantityRuleState`, `getMaximumValidQuantity`, `getNextValidQuantity`, `getPreviousValidQuantity`, `normalizeQuantityForStock`, `validatePurchaseQuantityRules`. Lo stock non coincide necessariamente con una quantità acquistabile: `minimum=4,step=4,stock=10` ammette al massimo 8, non 10. Stock sotto minimo rende impossibile il primo add; ProductCard, quick-add, PDP, conferma aggiunta e controlli cart devono usare gli stessi valori. Il selettore PDP è a pulsanti, senza input libero fuori step. Il cart locale può diventare temporaneamente invalido se regole/stock cambiano in background; la rehydration non tronca la quantità salvata allo stock (evita falsi step e perdita silenziosa d'intento), la UI segnala il problema e offre controlli per ridurla al livello valido; il server rimane autorevole.

Unico validatore server-only `lib/checkout/validateCheckoutItems.ts` rilegge gli SKU attivi tenant-scoped, somma righe duplicate, rilegge le membership dei gruppi attivi, valida quantità SKU+gruppo e stock, produce prezzi e righe canoniche. Viene chiamato sia da `/api/checkout` che da `/api/checkout/external-link`, ma anche dai percorsi di recovery `/api/checkout-sessions/[id]` PATCH e `/api/checkout-sessions/[id]/create-intent` **prima di creare/aggiornare un PaymentIntent**, anche se il cliente non modifica la sessione salvata. La cancellazione della sessione non richiede regole valide. Il GET della sessione arricchisce gli articoli con min/step/stock/attivo correnti, affinché il form recovery mostri i controlli corretti. Le modifiche al prezzo della sessione sono preservate secondo le regole preesistenti fino a un'esplicita modifica degli articoli; il validatore non autorizza prezzi provenienti dal client.

`GET /api/quantity-groups` resta pubblico, tenant-scoped, `no-store`. `useQuantityGroups` espone `groups/loading/error/reload`, e il gate di cart/checkout è **fail-closed** finché la lettura non ha successo. I banner `QuantityGroupProgress` mostrano soltanto i gruppi toccati e collegano `Compléter ma sélection` al catalogo `/?quantityGroup=<id>`. Il filtro passa da `getActiveQuantityGroupFilter`, che risolve la membership attiva tenant-scoped dal DB; né categoria né ID prodotto trasmessi dal client definiscono la lista. SSR e API di paginazione usano lo stesso filtro.

Admin: editor SKU espone warning se stock e regole sono incompatibili, e create/PATCH rifiutano min/step non interi positivi anziché fare clamp silenzioso. CRUD gruppi supporta conflitti strutturati quando si tenta di riattivare un gruppo con SKU presenti in un altro gruppo attivo. Il vincolo di un solo gruppo attivo è ancora **application-side**, inclusi membership POST e group PATCH; resta un possibile rischio di race su richieste admin concorrenti. Una garanzia DB transazionale/trigger richiederebbe un intervento SQL separato e approvato (non incluso in questo hardening). La migration 121 RLS abilita lettura pubblica dei gruppi attivi e scritture service-role.

Nala mantiene minimo/step in product action e Cart Builder, legge anche metadata dei gruppi attivi e mostra progresso e link a completare la selezione; non aggiunge automaticamente unità supplementari o SKU non richiesti. I test includono helper stock/step, store min4/step4/stock10, recovery con cambio min/gruppo/stock, DB group read fail-closed e regressioni cart. La documentazione operativa dettagliata vive in `docs/PURCHASE_QUANTITY_RULES.md`.

---

## 8.1 Gestion du commerce (migration 139, flag `business_management`)

Documentazione completa: `docs/BUSINESS_MANAGEMENT.md`.

Dominio gestionale del tenant **dentro l'admin Shop** (nessuna app separata, nessun `AdminWorkspace = 'gestion'`): fornitori, acquisti, ricezioni, ledger di inventario, debiti, pagamenti fornitore, tesoreria operativa, documenti privati, audit.

- **Rollout**: flag di rilascio `business_management` (`tenant_feature_flags`), spento per tutti. Guard unico `lib/gestion/featureGate.ts`: pagine → 404 e API → 404 se il flag è spento o illeggibile; il layout admin legge il flag solo se l'utente ha una capability Gestion. Sidebar: sezione **GESTION** (Vue d'ensemble, Fournisseurs, Achats & réceptions, Trésorerie) solo con flag attivo.
- **Route**: `/admin/gestion`, `/fournisseurs[/nouveau|/[id]]`, `/achats[/nouveau|/[id][/modifier]]`, `/tresorerie[/nouveau|/[id]]`, `/stocks` (prodotti, ledger, rettifiche); API `/api/admin/gestion/**` (tutte `force-dynamic` + `force-no-store`). Fiche prodotto Catalogue: pannello server-only "Coût d'achat" (flag attivo + capability Gestion).
- **Schema**: `suppliers`, `supplier_purchases`/`_items`, `supplier_receipts`/`_items`, `inventory_movements`, `supplier_payments`, `supplier_payment_allocations`, `business_documents`, `business_audit_events`, `business_reference_counters`; view `supplier_purchase_financials` e `supplier_balances` (`security_invoker`). FK composite `(tenant_id, id)` ovunque: nessun riferimento cross-tenant possibile (anche verso `products`, che riceve il solo vincolo additivo `products_tenant_id_id_key`).
- **Stati separati**: merce `draft → ordered → partially_received → received` (derivati dalle quantità ricevute) o `cancelled`; finanza derivata dalle allocazioni. Una bozza non è un debito (140). Pagamenti `recorded → verified` o `voided`: **solo le allocazioni di pagamenti verificati riducono il debito**. Pagamento a un terzo (`beneficiary_type = third_party`, nome obbligatorio): il creditore resta il fornitore.
- **Stock**: `products.stock` resta il valore canonico **intero** di storefront e checkout (invariati). Una ricezione incrementa `products.stock` e scrive `inventory_movements` nella stessa transazione; una sola entrata per riga di ricezione (indice unico). Rettifiche manuali motivate da `/admin/gestion/stocks` (`adjust_inventory` con motivo e nota, mai stock negativo, nessun costo creato).
- **Quantità e unità (141)**: righe d'acquisto e di ricezione `numeric(14,3)` (al più 3 decimali, mai arrotondate), `purchase_unit` (`unit|kg|g|l|ml|pack|box|carton|other`), conversione `stock_units_per_purchase_unit` per le righe collegate al catalogo; quantità × conversione deve dare un intero di unità di stock (altrimenti rifiuto). Ricezioni e movimenti conservano unità, conversione e delta usati: uno storno non reinterpreta mai la storia. Lato app, aritmetica esatta in `lib/gestion/quantity.ts` (BigInt), quantità inviate alle RPC come stringhe decimali.
- **Costi (141)**: `product_costs` (costo corrente per unità di stock, metodo `last_received_purchase_cost`, frais supplémentaires esclusi) e `product_cost_history` (append-only, `active`/`reversed`); ricalcolo deterministico (`refresh_product_cost`) a ogni ricezione e storno; ordine (142): giorno di ricezione Europe/Paris, poi ordine di registrazione, mai l'orario dentro la giornata. Server-only, mai su `products` né in `PUBLIC_TENANT_FIELDS`. "Marge indicative" = prezzo - ultimo costo, solo admin.
- **Scadenze (141)**: `suppliers.default_payment_terms_days`, `supplier_purchases.payment_due_date` (finanziaria, distinta da `expected_date` e da `payment_date`), fissata alla creazione da `order_date + condizioni`; stato derivato (`dueInfo`: in ritardo, oggi, entro 7 giorni, a venire, pagato, senza scadenza; bozze/annullati mai in ritardo). Dashboard con KPI e "Échéances fournisseurs", filtri pagamento lato server sulla lista acquisti, pannello in Trésorerie.
- **RPC** `RETURNS TABLE (out_*)`, lock + request key univoca per tenant (idempotenza su doppio clic/retry), audit nella stessa transazione. Nessun DELETE per il service role sulle tabelle finanziarie e di audit (si storna o si annulla).
- **Riferimenti** `FOU-000123`, `ACH-2026-000123`, `REC-2026-…`, `PAY-2026-…` da contatori transazionali per tenant (mai `count(*) + 1`).
- **Documenti**: bucket privato `business-documents`, lettura solo via API autorizzata, tipo rilevato dai byte, cancellazione logica.
- **Tesoreria** = uscite verso i fornitori; non è unificata con `tenant_card_payments` (incassi cliente `/card`).
- **Seed**: `scripts/seed-test-tenant-gestion.mjs` (workflow "Seed Test Tenant", input `with_gestion`), solo tenant `is_test`, idempotente.
- **Verifica**: `supabase/verification/139_business_management_verification.sql` (BEGIN/ROLLBACK, schema, privilegi, RPC reali, esempio 2 400 € → resta 1 000 €, cross-tenant, idempotenza).
- **Excel export**: CTA `Exporter Excel` in `/admin/gestion`, endpoint server-side `GET /api/admin/gestion/export/[type]` (`full|suppliers|purchases|treasury|stock`, periodo `from`/`to` opzionale). Snapshot `.xlsx` on-demand con `Synthèse`, fogli di dominio, dettagli acquisti navigabili e link all'admin live del tenant. `full` richiede tutte le quattro capability Gestion `*.view`; gli export specifici richiedono la capability corrispondente. Query tenant-scoped, saldi dalle view Gestion, date Europe/Paris, paginazione e limiti sincroni; nessun import/sync, file persistito o migration. Dettagli separati fino a 100 acquisti, poi foglio condiviso. Vedi `docs/BUSINESS_MANAGEMENT.md`.

---

## 9. Pagamenti condivisi

Componente centrale: `apps/storefront/src/components/payments/StripePaymentStep.tsx`. Verificare tutti i caller shop/events/rental/card prima di modificarlo.

`payment_funnel_logs` è cross-module.

Il Payment Element di `StripePaymentStep` imposta `wallets.applePay = 'never'` per **tutti** i moduli (shop, card, event, rental): la registrazione di un dominio presso Stripe vale per dominio, non per modulo, quindi senza questo flag Apple Pay comparirebbe ovunque appena il dominio è registrato. Google Pay resta `auto`, invariato. Apple Pay è offerto solo dal flusso dedicato di `/card` (sezione 13).

### Azioni manuali pendenti (pagamenti)

- Stripe Link: da disattivare manualmente dal Dashboard Stripe (Settings → Payment Methods → Link) su ogni account usato, come ricordato in `api/card/quick-pay/route.ts` e `api/rental/checkout/route.ts`.
- Apple Pay /card, per ogni account Stripe usato dal modulo carta (`STRIPE_SECRET_KEY_CARD`, fallback `STRIPE_SECRET_KEY`): Dashboard → Impostazioni → Metodi di pagamento → Apple Pay abilitato.
- Apple Pay /card, dall'admin del tenant (`/admin/parametres/paiements`): attivare "Apple Pay" e premere "Enregistrer le domaine" (live; Stripe registra automaticamente anche in sandbox).
- Apple Pay /card, collaudo su dispositivo reale **non ancora eseguito**: iPhone Safari con carta nel Wallet (tile visibile → importo → pulsante nero → Face ID → "Merci !"), PWA installata di `/card` (`display: standalone`, supporto iOS non uniforme: registrare l'esito reale, nessun workaround), iPhone senza carte (pannello "Payer par carte bancaire"), Android/PC Chrome e browser in-app (nessun tile; shop/eventi/noleggio senza Apple Pay), pagamento reale di 1 € con webhook `card_quick_payment` che marca `tenant_card_payments` come `paid`.

---

## 10. Événementiel

External payment requests usano `event_reservation_requests`:

```text
pending -> confirmed | stock_conflict | cancelled
```

Finché `pending`, nessuna capacità è riservata. La conferma admin crea la reservation con capacity-check server-side. L'annullo non rimborsa automaticamente il provider.

Quando una nuova request `external_link` viene creata con successo, l'applicazione invia un alert interno best-effort al tenant tramite n8n (`/webhook/event-external-payment-awaiting-verification`). I destinatari sono risolti da `tenant_notification_recipients` con `notify_external_payment_pending = true`; nessun indirizzo è hardcoded. La CTA porta direttamente a `/admin/evenementiel/paiements-en-attente/[requestId]`. Un errore di notifica non annulla né fallisce la request già creata e non modifica la capacità. Il contratto del payload è documentato in `docs/EVENT_EXTERNAL_PAYMENT_TENANT_ALERT.md`.

Le prenotazioni pagate direttamente nel negozio fisico seguono invece un flusso admin diretto da evento → `Réservations` → `Ajouter une réservation`. L'admin seleziona formule e quantità, inserisce i dati cliente e conferma che il pagamento è già stato incassato in negozio. Il server ricalcola il totale dai prezzi correnti delle formule attive, verifica tenant/evento, usa lo stesso `reserve_event_capacity` atomico degli altri flussi e crea immediatamente una normale `event_reservations` `confirmed` con QR e items. Non viene creata una `event_reservation_requests` intermedia.

`event_reservations` traccia l'origine tramite:
- `source`: `online | external_link | admin_in_store`;
- `payment_method`: `stripe | external_link | in_store`;
- `created_by_admin_id`: admin che ha registrato l'incasso in negozio, nullable per i flussi cliente.

La funzione condivisa `createEventReservationFromRequest()` resta il punto canonico per capacity decrement, creazione reservation/items, QR e notifica di conferma. Le prenotazioni `admin_in_store` entrano quindi senza percorsi paralleli in scanner, report, liste e codici A5. Il rimborso Stripe resta disponibile solo per reservation che possiedono un `stripe_payment_intent_id`; una vendita fisica non viene marcata come rimborsata automaticamente dalla piattaforma senza un flusso di rimborso offline dedicato.

### Chiusura prenotazioni online

Gli eventi possono definire `events.booking_closes_at` come deadline opzionale e modificabile dall'admin. Se il campo è `NULL`, il comportamento storico resta invariato. Quando è valorizzato, la pagina pubblica aumenta progressivamente l'urgenza nelle ultime 24/6/2 ore e nasconde il checkout una volta raggiunta la scadenza.

La deadline è enforcement server-side, non solo UI: sia `/api/events/[id]/checkout` sia `/api/events/[id]/checkout-external-link` rifiutano nuove richieste dopo `booking_closes_at`, prima di creare rispettivamente un PaymentIntent Stripe o una `event_reservation_requests`. La chiusura riguarda esclusivamente i canali pubblici: le prenotazioni manuali `admin_in_store` restano disponibili per vendite o eccezioni gestite dal personale. L'admin API valida che `booking_closes_at` preceda `date_start`.

### Report automatici alla chiusura

Migration `093_event_booking_close_reports.sql` rende automatico l'invio al tenant dei tre export operativi già disponibili in admin:

- CSV dettagliato delle prenotazioni;
- lista prenotazioni stampabile PDF;
- codici prenotazione A5 PDF.

L'orario effettivo è:

```text
booking_closes_at ?? (date_start - booking_close_reports_fallback_hours)
```

`booking_close_reports_fallback_hours` default `2`, configurabile già alla creazione evento e successivamente nella card `Réservations en ligne`. La migration calcola `booking_close_reports_scheduled_for` anche per eventi esistenti; gli eventi già iniziati non vengono mai inviati retroattivamente. Un evento futuro già dentro la finestra fallback diventa immediatamente eleggibile.

Il dispatcher canonico è `.github/workflows/event-booking-close-reports.yml`, schedulato ogni 5 minuti e avviabile anche manualmente. Lo script `scripts/process-event-booking-close-reports.mjs` usa le credenziali Supabase service-role già previste nei GitHub Actions, seleziona solo eventi futuri dovuti e chiama l'applicazione sul dominio canonico del tenant.

Il dispatcher invoca `/api/events/internal/booking-close-reports` con `eventId` e token opaco `booking_close_reports_dispatch_token`. L'RPC service-role-only `claim_event_booking_close_reports` implementa claim atomico/idempotente e recovery di sender bloccati dopo 15 minuti. Stati:

```text
pending -> sending -> sent
             |
             -> error -> retry dispatcher
```

La route rigenera i tre file dalla sorgente canonica `loadEventReservationExportData()` al momento dell'invio, quindi include solo reservation ancora utilizzabili (`confirmed` + `quantity_remaining > 0`). Consegna n8n via `/webhook/event-booking-closed-reports` con tre attachment base64. Destinatari: `tenant_notification_recipients.notify_event_booking_closed_reports = true`, default true per destinatari esistenti. Errori di generazione/trasporto portano a `error` e vengono ritentati dal dispatcher; successo imposta `booking_close_reports_sent_at` e impedisce duplicati. Contratto: `docs/EVENT_BOOKING_CLOSE_REPORTS.md`.

### Visibilità dei posti restanti

Ogni evento può configurare `events.show_remaining_places`. Il default è `true`, quindi gli eventi esistenti mantengono la visualizzazione numerica già in uso. Il tenant admin modifica l'opzione dalla card `Réservations en ligne` insieme alla deadline.

Quando `show_remaining_places = false`, le surface pubbliche Events non espongono il numero esatto di `capacity_remaining`: home, card, dettaglio e messaggi di urgenza usano soltanto stati qualitativi (`Places disponibles`, `Places limitées`, `Presque complet`, `Complet`). La capacità reale resta invariata e continua a essere visibile nell'admin e usata integralmente dai controlli server-side di disponibilità/checkout.

### Gestione capacità evento

Il tenant admin può aumentare o ridurre la capacità dalla card `Occupation` del résumé evento tramite `Gérer la capacité`. L'azione è visibile solo a chi supera il controllo server-side `event_capacity.manage`.

La capacità non viene più modificata dal PATCH generico evento. L'endpoint dedicato usa `adjust_event_capacity`, che:
- acquisisce un lock sulla riga `events`;
- calcola le places già riservate da `capacity_total - capacity_remaining`;
- rifiuta qualsiasi nuova capacità inferiore alle places già riservate;
- aggiorna insieme `capacity_total` e `capacity_remaining`;
- registra la variazione in `event_capacity_adjustments` con delta, motivo, admin e timestamp.

La riduzione di capacità non annulla, rimborsa o invalida prenotazioni esistenti. Se la capacità fisica desiderata è inferiore alle prenotazioni già confermate, l'admin deve prima gestire le prenotazioni interessate tramite i flussi appropriati.

Capability finanziarie Events:
- `event_payments.view`;
- `event_payments.confirm`;
- `event_payments.cancel`;
- `event_payments.refund`.

Scanner canonico `/scan?event_id=<id>` usa ledger `event_reservation_item_redemptions` ed è capability-driven end-to-end.

La surface pubblica Events ha `EventsHeader`/`EventsFooter` propri ma usa il drawer cross-surface condiviso con lo Shop. L'header ricava le capability di navigazione dai record pubblici attivi. La CTA header punta al prossimo evento quando esiste, altrimenti al contatto; il footer privilegia WhatsApp rispetto all'e-mail quando configurato.

La home Événementiel distingue tre contesti editoriali con soglia imminente nominata di 14 giorni: evento imminente, evento futuro non imminente e nessun evento futuro. Il prossimo evento resta la card featured con disponibilità, prezzi, deadline e social sharing invariati. Il hero usa il selettore deterministico `selectHeroMedia`, massimo 6 URL deduplicati: immagini associate all'evento imminente (hero-approved prima delle altre, poi banner; al massimo una ambiance neutra quando l'evento domina), mix evento/Traiteur/ambiance per gli eventi più lontani e Traiteur/Location/ambiance/general quando non esistono eventi futuri. Le immagini dei servizi sono promosse solo per offering attivi; `cover_image_url` resta la cover canonica della card Traiteur e una sorgente fallback del hero. Le card Traiteur e Location della home condividono struttura immagine/testo, fondo bianco e CTA blu specifiche (Demander un devis / Voir le matériel), affiancate da 768 px e impilate su mobile con gap 16 px. Location mostra al massimo tre foto deduplicate di articoli attivi del proprio servizio: lettura pubblica tenant-scoped limitata a 12 candidati ordinati stabilmente, campionamento primo/centrale/ultimo e object-contain senza filtri o crop; in assenza di foto usa la cover, poi un'icona. Traiteur conserva la cover d'ambiente in object-cover. Le card restano link singoli alle pagine servizio con focus visibile; il movimento hover rispetta reduced motion. Data/ora/luogo nel hero compaiono solo nel contesto imminente, mentre il mix editoriale usa copy generale. Senza eventi la CTA primaria privilegia servizi attivi o contatto, mai una sezione eventi vuota. Layout Vimeet, overlay, `EventImageFader` e animazione AVEC/POUR con VOUS statico restano invariati.

La Gallery appartiene all'intero modulo (`events_enabled || services_enabled`), inclusa la discovery della navigazione pubblica. Migration `110_event_gallery_editorial.sql` aggiunge `category` (event/traiteur/location_materiel/ambiance/general), `hero_eligible` default false e `hero_priority` 0–100 default 50. Il backfill classifica le immagini associate come event e le altre come general senza cambiare associazioni, sort order o social sharing. L'admin offre filtri categoria/Hero, configurazione upload ed editor espandibile con priorità Basse/Normale/Haute (25/50/75); `is_social_share` resta indipendente e legato a una foto associata a un evento. Le API mantengono `event_content.manage` e verificano l'associazione evento nel tenant corrente, senza modifiche RBAC. La selezione hero carica candidati limitati per categoria separatamente dalle 10 immagini della sezione Gallery; le immagini evento delle card e i kit social sono limitati agli eventi futuri caricati. Il dettaglio di un evento mantiene esclusivamente la propria associazione e i servizi mantengono devis/rental checkout invariati. Il hero del dettaglio Traiteur usa `EventImageFader` con massimo 6 URL della sola categoria traiteur, caricati nel tenant corrente e ordinati per eligibility, priorità e ordinamento stabile. `selectCateringHeroMedia` deduplica le URL e usa la cover dell'offering solo quando non esistono foto Traiteur utilizzabili; nessuna ambiance o immagine di altri servizi entra nella rotazione. Dissolvenza automatica ogni 5 secondi con rispetto di reduced motion. Il dettaglio Traiteur usa `CateringLanding`: hero con offerta esplicita e modulo unico affiancato su desktop, subito dopo il copy su mobile, tre formati che precompilano il messaggio conservando il testo del cliente, gallery Traiteur, processo compatto, FAQ e contatto WhatsApp se configurato. `DevisForm` mostra nome/email obbligatori, data/ospiti facoltativi e telefono/progetto espandibili; mantiene l'endpoint `/api/services/[slug]/inquiry` e i campi persistiti esistenti. La CTA mobile fissa è nascosta quando il modulo è visibile o la richiesta è stata inviata. Errori conservano i valori e ricevono focus, invio doppio bloccato e stato di successo esplicito. Non sono pubblicati prezzi, SLA, zona servita o recensioni senza dati confermati. Non esiste un collector funnel Events generico: visite/avvio modulo/richieste qualificate non sono ancora raccolti; le richieste inviate restano durevoli in `service_inquiries`, senza riutilizzare impropriamente analytics Nala.

Il catalogo Location si gestisce da `/admin/evenementiel/services`, raggiungibile anche da Locations tramite “Gérer le catalogue”. La creazione di un servizio `location_materiel` usa il mode reservation esistente. `RentalCatalogAdmin` consente creazione/modifica di nome, categoria, prezzo unitario, quantità disponibile, foto e visibilità degli articoli tramite le API tenant-scoped già presenti; le foto usano upload-image con kind rental-item e resize senza enlargement. Il salvataggio attende l'upload e blocca richieste duplicate; errori conservano la bozza. Stock zero rende l'articolo non prenotabile. Le card pubbliche usano object-contain per conservare l'intero prodotto, con griglia desktop, riepilogo laterale e barra mobile esistenti. Non sono introdotte nuove colonne né modifiche ai flussi checkout/pagamento o alle policy di accesso.


La migration 110 deve essere applicata manualmente nel Supabase remoto: Vercel non esegue migration. Durante il rollout la lettura hero può ripiegare su una query legacy limitata se i nuovi campi non sono disponibili; le nuove impostazioni editoriali richiedono lo schema 110. CI esegue test selector/validazione/query e fixture PostgreSQL per sintassi, backfill, default, vincoli e conservazione dei dati storici.

Gli eventi possono avere una `on_site_price_list_image_url`: carta prezzi informativa per piatti/bevande acquistabili e pagabili sul posto, separata da `event_ticket_types`, checkout e capacità prenotabile.

Gli export operativi delle prenotazioni evento (CSV, lista fallback A4 e codici A5) includono solo prenotazioni ancora utilizzabili: `status = confirmed` e `quantity_remaining > 0`. Il dettaglio formule usa il residuo per riga calcolato da `event_reservation_item_redemptions` non annullati.

---

## 11. AI Core e AI usage

Lepefy AI Core is the canonical AI infrastructure layer.

No application consumer may depend directly on Gemini/OpenAI/Anthropic or other external LLM providers. All inference must pass through Lepefy AI Gateway and platform-configured routing.

Conversation state and memory are owned by Lepefy AI Core, never by an external provider or client-provided history. Providers receive bounded context packages assembled server-side by Lepefy Context Engine.

Queste sono le regole canoniche per nuovi consumer; le eccezioni legacy V1 verificate sono elencate sotto.

Foundation migration `100_lepefy_ai_core.sql`:
- `ai_providers`: provider type gemini/openai_compatible/openai/anthropic/lepefy, enabled, credential_ref, base_url e health osservata;
- `ai_models`: ID provider, capabilities, context window e metadata di costo;
- `ai_routing_policies`: consumer + capability;
- `ai_routing_policy_models`: modelli ordinati per priority crescente, parità per model key, timeout e min_confidence opzionale;
- `ai_conversations`, `ai_conversation_turns`, `ai_conversation_state`: memoria breve Lepefy, separate dalle analytics Nala.
Tutte le nuove tabelle sono service-role-only, RLS attiva, nessuna policy browser.

`src/lib/ai/core/aiGateway.ts` carica la policy canonica con cache 30s. Nala chat usa `nala / structured_chat`; semantic enrichment usa `nala_semantic_enrichment / classification`. Adapter implementati: Gemini e HTTP OpenAI-compatible; OpenAI, Anthropic e Lepefy sono tipi predisposti senza adapter dedicato attivo. Nessun provider non configurato viene seedato. Gli endpoint OpenAI-compatible richiedono origine HTTPS approvata via `LEPEFY_AI_ALLOWED_ORIGINS`; niente redirect. `credential_ref` contiene soltanto il nome env server-side, mai una API key raw.

Fallback su timeout, errore provider/rate limit, credenziale assente, modello indisponibile e output strutturato invalido. Budget complessivo routing 18s; min_confidence è ignorata senza confidence calibrata dell'adapter (l'autovalutazione Nala non conta). Business validation resta fuori dal router. Circuit breaker locale best-effort: cinque failure consecutive, pausa cinque minuti, non condiviso tra istanze serverless. `AiRoutingError` normalizzato; UX di errore Nala invariata.

`assertAiRouteReady(consumer, capability)` preflighta i consumer batch prima che acquisiscano lavoro retry-limited: richiede almeno un candidato enabled con adapter implementato e credential server-side disponibile. Semantic enrichment lo esegue prima della RPC di claim, quindi una configurazione routing assente non consuma tentativi delle interazioni.

Conversation ID è UUID v4 casuale generato dal server, bearer opaco conservato in sessionStorage. Ogni accesso DB verifica tenant + consumer; i lease a scadenza serializzano richieste concorrenti. Il browser non invia più history né intercetta “Oui” con regex; il server usa pendingAction e soggetto. Refresh riutilizza il contesto; un nuovo sessionStorage apre una nuova conversazione. La duplicazione esplicita di una scheda può copiare sessionStorage nel browser: non c'è fingerprint o tracking cookie.

TTL: 2 ore di inattività, distinto dalla finestra attribution di 30 minuti. Working memory v1 contiene activeIntent, subject, entities, constraints, referencedProducts, pendingAction/pendingActionContext e locale, con limite DB 4 KB. Si aggiorna dalla risposta corrente senza seconda AI call. Rolling summary è nullable e la compaction AI è differita. Context package: massimo 10 messaggi recenti, 8.000 caratteri recenti, massimo 1.600 per messaggio, system 16.000, summary 2.000, current message 300. Cambio provider a metà conversazione supportato.

Expiry impedisce subito il riuso del contesto; la working memory scaduta viene cancellata dalla RPC esistente invocata da POST /api/internal/ai-core-maintenance, con bearer service-role. Il workflow AI Core maintenance è orario (minuto 17 UTC), con dispatch manuale e URL AI_CORE_APP_URL → NALA_ENRICHMENT_APP_URL → EVENT_REPORTS_APP_URL. Errori restituiscono 503 normalizzato; il job Nala non esegue più questa purge. Raw turns massimi 90 giorni, eliminati dalla stessa RPC. Nessuna memoria personale cross-session, fingerprint, IP o raw UA nel Core. Stato `customer_id` predisposto nullable, non popolato da dati client.

`/admin/platform/ai-routing` riusa il guard Platform Owner per pagina e API, permette creazione/edit/enable di provider e modelli, associazione e priorità numeriche per policy, timeout e confidence. Nessun nuovo RBAC tenant. `ai_usage_log` riusa `logAiUsage` ed estende consumer/capability/latency/fallback; i costi restano telemetry interna. Retrieval embeddings è contabilizzato separatamente come `nala_retrieval`.

Nala Fast Resolver V1 introduce un percorso deterministico prima di retrieval embeddings e inference. Il primo layer copre `store_information` ad alta confidenza: orari, indirizzo e WhatsApp usano i campi tenant canonici `click_collect_hours` / `click_collect_hours_it`, `click_collect_address` e `whatsapp_number`; solo per gli orari può usare come fallback una singola frase schedule-like estratta dal `chatbox_extra_context` curato dall'admin. Product Availability V1 aggiunge un secondo layer per domande esplicite di esistenza/disponibilità prodotto: estrae una frase prodotto bounded, interroga solo prodotti active tenant-scoped tramite match lessicale conservativo su `name` / `name_alt`, richiede un match forte non ambiguo e legge lo stock canonico. Se disponibile genera una risposta breve e riusa la Product Action `add_to_cart`; se stock=0 risponde deterministicamente senza action. Recommendation, substitution, recipe/meal intent, match deboli/ambigui ed errori lookup fanno sempre fall-through verso retrieval + AI Core. Un `pendingAction` conversazionale disabilita i fast path per non interrompere follow-up commerce. Le risposte deterministicamente risolte aggiornano conversation memory, registrano `nala_interactions.ai_call_triggered = false`, telemetry zero-token `provider=lepefy` e semantic enrichment inline `fast_resolver_v1`; non chiamano embeddings, provider LLM né il classifier asincrono 097.

Knowledge Suggestions V1 estende `/admin/ai-lab` senza nuova migration e mantiene `tenant_knowledge_base` come sola fonte autorevole human-reviewed. La discovery deriva on-demand dagli ultimi 90 giorni di `nala_interactions`, con massimo 500 righe tenant-scoped e massimo 10 proposte: considera solo enrichment completati, intent stabili non sensibili (`product_information`, `recipe`, `delivery`, `store_information`, `event_information`) e segnali `knowledge_status = missing` oppure retrieval `weak/empty`. Esclude supporto ordine/pagamento/reclami e righe con email, telefono o riferimenti ordine riconoscibili; raggruppa per intent + requested product quando disponibile, altrimenti per domanda normalizzata. Usa la domanda e l'ultima risposta Nala soltanto come preview/brouillon bounded e non esegue una seconda inference.

Il tenant con `ai_knowledge.manage` può modificare categoria e contenuto prima di `Valider et ajouter`. Solo l'approvazione esplicita chiama l'endpoint knowledge esistente, genera l'embedding e crea una normale riga `tenant_knowledge_base` con `reviewed_by`, `reviewed_at` e source `nala_suggestion:<fingerprint>`. Il fingerprint rende l'approvazione idempotente e sopprime la stessa proposta nei load successivi; eliminare la knowledge validata la rende nuovamente eleggibile. I brouillon non sono mai recuperati da Nala prima della promozione. V1 non aggiunge tabella di queue/reject, scheduler o stato persistente di dismiss: le proposte restano derivate dai segnali esistenti. `/admin/nala-analytics` continua a esporre solo aggregati senza raw message/reply; `/admin/ai-lab`, protetto dalla capability knowledge, può mostrare una domanda rappresentativa e un draft bounded filtrato per aiutare la revisione editoriale.

AI Core V1.2 richiede registry e contesto persistente: migration 100 è già applicata e verificata dal proprietario. Schema/RPC mancanti, errori DB, policy disabilitate e chain vuote falliscono con errori normalizzati; non esistono bootstrap Gemini né contesto stateless. Nessuna nuova migration è richiesta da V1.2. Hugging Face usa l'adapter `openai_compatible` esistente (router.huggingface.co/v1, modello iniziale `openai/gpt-oss-20b:fastest`) e richiede `HUGGINGFACE_API_KEY`, origin HTTPS esatta in `LEPEFY_AI_ALLOWED_ORIGINS` e registry/policy configurati. Gemini resta primario per Nala chat durante il rollout; semantic enrichment dispone di policy classification indipendente e può quindi usare in futuro un ordine/costo diverso senza deploy codice. Health osservazionale non esclude candidati dal routing.

Debt V1 verificato: chiamate dirette ancora in embeddings/retrieval, utility admin immagini/descrizioni e tre script batch generazione immagini/descrizioni/embeddings. Semantic enrichment 097 non è più una chiamata provider diretta. Un errore embedding iniziale non impedisce la risposta generativa routed, ma riduce retrieval e proposte prodotto. Nessun training, billing SaaS o modifica a checkout/payment/order.

Accounting tecnico interno: `ai_usage_log`, `ai_pricing`, `ai_usage_monthly_by_tenant`.

`/admin/platform/ai-usage` mostra costi/provider solo Platform. `/admin/ai-usage` mostra al tenant utilizzo prodotto senza provider/model/token/costo tecnico. `/admin/nala-analytics` è invece la surface business tenant di Nala: usa `ai_usage.view` + entitlement `nala_analytics`, mostra metriche aggregate di domanda, qualità e conversion attribution e non espone costi tecnici o conversazioni raw.

---

## 12. Login admin e sicurezza

Password/OTP supportano `next` solo relativo/same-origin. Non esiste ancora SSO esplicito cross-subdomain shop/events.

Tabelle RBAC: RLS enabled, nessuna policy browser; operazioni tramite service role server-side.

Le route personali di sicurezza/profilo restano accessibili indipendentemente dalle business permissions.

---

### Feedback testeurs multi-tenant

La route pubblica `/feedback` espone la campagna attiva del tenant senza autenticazione. Il browser invia solo testo, reazione/categoria opzionali, consenso e-mail esplicito e un contesto tecnico ridotto; tenant e campagna vengono sempre risolti lato server. L’API `/api/feedback` usa service role, validazione strict, limite payload, controllo same-origin, honeypot e cooldown breve senza salvare IP raw o fingerprint.

La console Platform Owner `/admin/platform/feedback` gestisce feedback e campagne, filtri server-side, paginazione, KPI, workflow status/priority/note e attivazione atomica di una sola campagna per tenant. Ogni campagna può conservare l’URL HTTPS ufficiale `play.google.com` del test chiuso e una lista deduplicata di tester invitati. L’import crea soltanto gli inviti; invio singolo, retry/resend con rotazione token e invio bulk restano azioni esplicite. Ogni invito può inoltre conservare un `phone` opzionale per il contatto operativo WhatsApp/telefono e uno `installation_status` manuale (`unknown | installed | problem`); entrambi sono metadata operativi Platform e non costituiscono prova di opt-in o installazione Google Play.

L’invito tenant-branded usa `/webhook/tester-feedback-invite` sul canale n8n esistente e contiene CTA Google Play e URL personale `/feedback/invite/<token>`. La console Platform Owner delle notifiche può inviare allo stesso webhook un payload `testMode: true` che riusa il template e-mail reale con campagna e URL feedback sintetici non autorizzanti; legge soltanto l’eventuale URL Google Play della campagna attiva e non crea inviti, token o feedback. Il token one-time e la successiva credenziale di sessione sono casuali e persistiti soltanto come SHA-256. Il GET dell’invito non consuma credenziali: l’attivazione avviene esclusivamente via POST, crea un cookie HttpOnly SameSite=Lax e collega i feedback successivi tramite `tester_feedback_entries.tester_invite_id`. La revoca annulla sia link sia sessione senza cancellare i feedback storici. “Attivato” significa soltanto invito Lepefy attivato; conteggio e requisito dei testeur Google Play restano autorevoli in Google Play.

Le tabelle feedback/inviti non hanno accesso browser diretto e forzano RLS. Le migration additive `106_tester_feedback.sql`, `107_tester_feedback_invites.sql` e `108_tester_feedback_contact_status.sql` vanno applicate manualmente in ordine; il deploy applicativo non applica automaticamente lo schema Supabase.

---

## 13. Digital Card / shipping / notifiche

`/card` è hub tenant; location usa `tenant.google_maps_url`, senza Google Maps API/iframe.

**App Android (TWA) del tenant**: `tenants.android_package_name`, `android_sha256_fingerprint` (lista separata da virgole) e `android_public` pilotano `/go` (Android → scheda Play Store solo se package **e** `android_public`), `/.well-known/assetlinks.json` (package + fingerprint) e il blocco Google Play della mail cliente `/card`. Si gestiscono solo da **Plateforme → Application mobile** (`/admin/platform/application-mobile`, platform owner; API `GET/PATCH /api/admin/platform/mobile-app` e `POST …/mobile-app/listing`, nessuna capability tenant). Regole pure in `lib/mobileApp/androidApp.ts` (`planAndroidAppUpdate`): package validato; cambio package vietato mentre l’app è pubblica (409, prima «Repasser en test»); fingerprint modificabili solo dopo sblocco esplicito in UI + checkbox, e il PATCH le accetta solo con `fingerprints.confirm = true` (formato SHA-256 32 coppie, normalizzate maiuscole, deduplicate); pubblicazione/ritorno in test con conferma che elenca gli effetti. «Vérifier la fiche publique» interroga lato server solo `play.google.com` (404 = closed testing) e, se la scheda non è pubblica, la conferma mostra un avviso senza bloccare. Ogni scrittura chiama `revalidateTenantCache()`. Il tenant è quello del deploy (`NEXT_PUBLIC_TENANT_SLUG`).

**Schermata di esito `/card`** (`components/card/CardPaymentResult.tsx`, helper puri `lib/card/cardPaymentOutcome.ts`): dopo `onSucceeded` mostra «Paiement confirmé», importo, riferimento `CP-XXXXXX` (stessa funzione `cardPaymentReference` della mail), email di conferma mascherata (`m•••@dominio`) o, senza email, l’invito a salvare la schermata, poi CTA «Commander en ligne» verso `/` solo se `storefront_ready` (colore primario, testo a contrasto) e «Retour à la carte». Ritorno dopo redirect (metodi redirect-based / autenticazione bancaria con `return_url = /card`): `CardQuickPay` non è montato, quindi `DigitalCard` usa `useCardPaymentReturn` (`lib/card/useCardPaymentReturn.ts`), legge il PaymentIntent con la chiave pubblica e apre direttamente l’esito: `succeeded` → conferma; `processing`/`requires_capture` → «en cours de validation, ne payez pas une seconde fois»; `requires_payment_method`/`requires_action`/`canceled` → «non abouti, aucun montant débité» + «Réessayer»; stati sconosciuti → home. Il `client_secret` viene sempre rimosso dall’URL. Riferimento ed email sopravvivono al redirect tramite `sessionStorage` (chiave per PaymentIntent, try/catch); l’importo viene dal PaymentIntent. Nessun cambio a PaymentIntent, importi o webhook; `usePaymentRedirectRecovery` resta usato da shop/eventi/noleggio. Copy FR/IT.

**Admin → Paiements carte** (`/admin/paiements-carte`, sidebar Boutique): lista di `tenant_card_payments` del tenant (`GET /api/admin/card-payments`, `orders.view`) renderizzata lato server (`lib/card/cardPaymentsList.ts`, condiviso con l’API; stato lista solo nell’URL, FilterBar/AdminStatCard/Pagination del kit, isola client per dettaglio riga e renvoi) con periodo (oggi in fuso Europe/Rome, 7/30 giorni, tutto, oppure «Personnalisé»: `period=custom&from=AAAA-MM-GG&to=AAAA-MM-GG`, giorni interi in fuso Europe/Rome con giorno di fine incluso — `created_at >= since` e `< until` —, date invertite scambiate, lato mancante aperto), pulsante «Actualiser» (ricarica con gli stessi filtri, ora dell’ultimo aggiornamento nell’intestazione; una data scelta nel pannello filtri passa a «Personnalisé»), stato, ricerca per nome/email o per riferimento `CP-XXXXXX` (= primi 6 hex dell’uuid → range `gte/lte` sull’id, su tutte le date), totale incassato/pagati/non finalizzati del periodo, paginazione 50. Stati mostrati: `paid` → Payé; `pending` < 1 h → En cours; `pending` ≥ 1 h → Non finalisé (regola di sola visualizzazione, il DB conosce solo pending/paid). Dettaglio con email completa e link Stripe (`dashboard.stripe.com/payments/pi_…`). «Renvoyer la confirmation» (`POST /api/admin/card-payments/[id]/resend-confirmation`, `orders.manage`, conferma modale) solo per pagamenti `paid` con email: destinatario sempre `customer_email` salvato, chiave ledger `card-quick-payment-customer:<pi>:resend:<uuid>` distinta dall’invio automatico. La ricerca globale admin riconosce `CP-XXXXXX` e porta alla pagina. Helper puri in `lib/card/cardPaymentsAdmin.ts`. Nessuna migration.

È un registro di riconciliazione, non una work queue.
- **Filtri**: periodo, date, stato, ricerca e pagina sono in query string (`parseCardPaymentsState` / `cardPaymentsQueryString`), con i default omessi.
- **KPI cliccabili**: Payés e Non finalisés filtrano la lista.
- **Totali**: oltre 5 000 pagamenti nel periodo l'API segnala `summary.truncated` e la pagina mostra «Totaux partiels».
- **Righe**: «En cours» indica da quanto tempo è in attesa.
- **Notifiche automatiche**: la conferma al cliente e l'alert all'équipe sono letti da `notification_deliveries` in un'unica query batch per pagina (`cardNotificationState`). La riga avvisa solo in caso di `failed`/`dead`; il dettaglio mostra lo stato completo. Una riga assente nel registro è «Aucune trace d'envoi», mai un errore.
- **Valori copiabili**: riferimento e PaymentIntent usano `CopyableValue`.

**Pagamento `/card` riuscito → notifiche**: `payment_intent.succeeded` con `metadata.type = 'card_quick_payment'` marca `tenant_card_payments` `paid` (idempotenza sul `status`), poi chiama `notifyCardQuickPaymentPaid` (`lib/notifications/notifyCardQuickPayment.ts`), best-effort e mai bloccante per il webhook: (1) alert tenant `cardQuickPaymentEmail` ai destinatari `notify_card_payment`, chiave `card-quick-payment:<pi>`; (2) solo se `customer_email` è presente, conferma cliente `cardQuickPaymentCustomerEmail`, `notificationType = card_quick_payment_customer`, chiave `card-quick-payment-customer:<pi>` (ledger `notification_deliveries`: un retry Stripe non reinvia nessuna delle due; un errore del secondo invio non tocca pagamento né alert tenant). La mail cliente è transazionale prima (importo, data, stato, riferimento `CP-XXXXXX` derivato dall'id `tenant_card_payments`, mai l'id Stripe), poi un solo ingresso commerciale visuale verso `storefrontUrl` (root = catalogo): usa per Chloé Food l'asset email dedicato `/images/email/chloefood-shop-assortment.png` risolto dalla configurazione tenant in `getTenantNotificationContext`; per gli altri tenant usa `tenants.hero_image_url` se è un URL HTTP(S), altrimenti un pannello nel colore primario come fallback; immagine e CTA aprono lo shop. Titolo, benefici e CTA seguono la locale FR/IT del tenant; colore primario con testo bianco/nero scelto per contrasto, benefit derivati da `click_collect_enabled` (livraison sempre offerta dal checkout). Il blocco è assente se `storefrontUrl` manca o `storefront_ready = false`. Blocco Android con la stessa regola di `/go`: `android_package_name` + `android_public` → link Play Store; package senza `android_public` → «Bientôt disponible sur Google Play» non cliccabile; nessun package → nessun blocco. Nessuna PWA, coupon, UTM o opt-in marketing. Footer «Propulsé par Lepefy Labs» se `show_powered_by`. `TenantNotificationContext` espone `branding.heroImageUrl`, `branding.emailHeroImageUrl`, `commerce` e `mobileApp` (colonne tenant esistenti, nessuna migration). Anteprime (config reale, fallback senza immagine, app bientôt, app pubblicata) in Admin → Plateforme → Notifications → Modèles. Il campo email di `CardQuickPay` resta opzionale, con label «Email pour recevoir votre confirmation» e helper. Badge Google Play ufficiale (FR, non alterato) in `apps/storefront/public/badges/google-play-fr.png`, servito da `assetBaseUrl` (`storefront_url`, poi `NEXT_PUBLIC_APP_URL`; mai `legal_website`) con la menzione marchi Google LLC; senza `assetBaseUrl` il link resta testuale.

**Apple Pay in `/card` (migration `126`)**: `tenant_payment_methods.method = 'apple_pay'` è un on/off senza `value`/`extra` (come `card`), scopato da `enabled_modules` (default `['card']` alla creazione admin) e indipendente dalla riga `card`. Il tile "Apple Pay" compare solo se `isApplePayEnabledForCard` (riga attiva con `'card'`) E il dispositivo supporta Apple Pay: `useApplePaySupport` legge `window.ApplePaySession.canMakePayments()` solo dopo il mount (helper puri in `lib/payments/applePay.ts`, test `tests/unit/applePay.spec.ts`). Il filtro `visibleCardPaymentMethods` è applicato in `DigitalCard` sia alla lista sia al bouton "Voir les moyens de paiement" (mai una lista vuota). Flusso dedicato: `CardQuickPay mode="apple_pay"` (stesso step 1 importo/nome/email, pulsante nero) → `StripeExpressWalletStep` (Express Checkout Element, solo Apple Pay, pulsante nero `plain` 48 px; stessa sequenza `elements.submit → createIntent → confirmPayment` e stessi `event_type` di funnel con `detail.wallet = 'apple_pay'`). Senza carte nel Wallet o su `onLoadError` mostra il fallback "Payer par carte bancaire" verso la riga `card` se visibile. Server invariato: riusa `api/card/quick-pay`, il PaymentIntent (`automatic_payment_methods`) e il webhook `card_quick_payment`. Registrazione dominio self-serve: `GET/POST /api/admin/payment-methods/apple-pay/domain` (`tenant_settings.view/manage`), account Stripe del modulo `card`, dominio = hostname di `tenant.storefront_url` con fallback `NEXT_PUBLIC_APP_URL` (422 se assente, mai un default), POST idempotente (list → create o riattivazione → validate); card di stato in `PaymentMethodsSection` quando `apple_pay` è attivo. Le route admin `payment-methods` chiamano `revalidatePath('/card')` dopo ogni scrittura (`/card` ha `revalidate = 300`). Azioni manuali: sezione 9.

Il tracking operativo post-ordine è provider-neutral: `src/lib/shipping/providers/types.ts` definisce `ShippingProviderAdapter` e il modello canonico snapshot/eventi; il registry server-side espone capability e metadata UI serializzabili. Packlink è il primo adapter, con credenziale tenant `packlink_api_key` e fallback server `PACKLINK_API_KEY`, API shipment + track bounded, unico adapter con `capabilities.createDraft` (brouillons d'expédition, migration 151, vedi sezione dedicata in testa), tracking primario `carrier_shipment_tracking_number` e fallback `trackings[]`. Platform → Livraison technique → Diagnostic Packlink (`/admin/platform/livraison/diagnostic-packlink`, solo `platform_owner`) resta indipendente dal tracking: elenco read-only «Expéditions Packlink PRO» (`GET /api/admin/packlink-shipments`, solo chiave del tenant, `requirePlatformOwner()`, una chiamata per clic, paginazione `limit`/`offset` (la route Lepefy espone `?page=N`) auto-verificata su `pagination.current_page` (API non documentata; totale annunciato da Packlink), associazione agli ordini solo in lettura) + diagnostico per riferimento; dettagli in `docs/SHIPPING_INTELLIGENCE.md` §3. Nessuna conversione MyBRT, scraping o callback provider non verificata viene introdotta.

Per provider con capability provider-reference, l’admin termina picking, controlli freddo e packing, quindi verifica e associa la reference tramite POST `/api/admin/orders/[id]/shipment/attach`. `/shipment/sync` consente aggiornamento manuale; `/shipment/manual` è il fallback esplicito per ordine. Tutte le route sono tenant-scoped, protette da `orders.manage` e fail-closed. La modalità manuale disassocia la reference, mantiene gli snapshot compatibili `tracking_code/carrier` e impedisce aggiornamenti automatici; provider senza adapter conservano il flusso manuale. `shipping.view` separa consultazione da `shipping.manage` per le regole di configurazione.

Migration `111_managed_shipping_tracking.sql` aggiunge alle sole `orders` metadata provider/reference/status/sync, normalized status, tracking URL/eventi, stima consegna, errore sanitizzato e modalità nullable managed/manual. `shipping_details` resta snapshot/preventivo checkout. Gli ordini storici non ricevono backfill; RLS e grant esistenti non cambiano. Indice parziale sulle spedizioni attive e unicità reference per tenant/provider rendono il contratto queryable. Il codice non è production-ready per managed tracking finché lo schema 111 non è applicato e verificato nel Supabase remoto: attach e worker falliscono chiusi se lo schema manca, mentre letture/manual/pickup legacy rimangono compatibili. Vercel non applica migration automaticamente.

`syncOrderShipment` carica ordine e il suo tenant, usa l’adapter associato, persiste lo snapshot e normalizza verso la state machine Lepefy: ready-for-collection mantiene preparing; in-transit/out-for-delivery porta preparing a shipped; delivered porta shipped a delivered. Stati exception/returned/cancelled/unknown non inventano cancellazioni ordine o azioni finanziarie. Picking e packing restano precondizioni canoniche. Manual admin e provider convergono in `orderTransitionService` per validazione, timestamps, compare-and-set tenant/status/updated_at e side effects del workflow esistente. Solo l’update vincente può emettere notifiche/loyalty; stati ripetuti non duplicano side effects. Catch-up delivered da preparing valida entrambe le tappe ma persiste direttamente delivered ed emette soltanto completion, mai due e-mail spedito+consegnato retroattive. Notifiche restano best-effort come nel workflow precedente, senza nuovo outbox/retry delivery: un errore dopo la transizione non provoca reinvio automatico.

La pagina cliente `/orders/[id]` mostra timeline Lepefy sincronizzata più recente prima, descrizioni francesi note/raw fallback, carrier e tracking copiabile. Il link HTTPS risolto dal provider è secondario; managed tracking non usa il VAS BRT legacy. Il tracking manuale e il token/customer access esistenti non cambiano. Le notifiche `/webhook/order-shipped` e `/webhook/order-completed` (`completionType=delivered`) e le regole loyalty restano originate esclusivamente da Lepefy tramite `adminOrderWorkflow`, mai dall’adapter. L’e-mail `order_shipped` include «Livraison estimée» (fr-FR, Europe/Rome) quando `orders.shipping_estimated_delivery_at` persistito è valido, altrimenti resta invariata; il renderer non interroga mai il provider.

Scheduler primario previsto: n8n Hetzner con il template importabile `ops/n8n/shipping-sync.json` (schedule ogni 15 minuti, trigger manuale, POST `/api/internal/shipping-sync` con timeout 55 s e al massimo due tentativi, nodo `Check sync outcome` che fallisce con `shipping_sync_batch_failed` se `ok !== true` o `failed > 0`), autenticato con la credenziale Header Auth dedicata `SHIPPING_SYNC_SCHEDULER_TOKEN` (env Vercel server-side, confronto timing-safe; mai la service-role key in n8n). Cutover come per lo shipping-campaign-worker: importare il template, impostare il token su Vercel e nella credenziale n8n, eseguire `Manual test`, attivare il workflow, verificare due esecuzioni consecutive, poi impostare la repository variable GitHub `SHIPPING_SYNC_N8N_ACTIVE=true`; rollback impostandola a `false` dopo aver disattivato n8n. `.github/workflows/shipping-sync.yml` resta fallback: salta i job schedulati quando la variabile è `true`, `workflow_dispatch` resta eseguibile e richiama `scripts/process-shipping-sync.mjs` → stesso endpoint con bearer service-role legacy (ancora accettato durante la transizione). `SHIPPING_SYNC_APP_URL` è la URL preferita; fallback AI_CORE_APP_URL → NALA_ENRICHMENT_APP_URL → EVENT_REPORTS_APP_URL solo sullo stesso deployment storefront. Il worker DB multi-tenant seleziona al massimo 6 spedizioni managed con reference, adapter supportato, ordini preparing/shipped e shipment non terminale, in ordine di ultimo sync. Due worker limitati isolano i failure per ordine; nessuna scansione dello storico, payload provider raw o secret viene persistito/esposto. Le credenziali di ciascun ordine provengono dal suo tenant.

**Shipping Intelligence (V1A–V1E)** sépare trois concepts auparavant fusionnés dans `tenants.shipping_provider` : le provider logistique (inchangé), la stratégie de tarification client (depuis la V1F : `tenants.shipping_pricing_mode`, voir le paragraphe « Forfait shadow » ci-dessous — aucun prix forfait facturé) et l'intelligence expédition (nouveau, décrit ici). Cinq tables additives (migration `119`) : `shipping_packaging_profiles` (catalogue de boîtes par tenant, un profil `is_default` seedé depuis `packaging_surcharges.box_*` existant — `calculateShipping.ts` continue de lire `packaging_surcharges` directement, aucun changement de comportement checkout), `shipping_zones` (zones tenant par préfixe postal, saisie manuelle ; la résolution automatique des campagnes applique désormais le préfixe le plus spécifique à chaque CAP), `shipping_quote_observations` (dataset normalisé provider-neutral d'observations de devis : `source` distingue `synthetic_simulation | real_quote | real_shipment`, `eligible`/`exclusion_reason` par service Packlink retourné, jamais de clé API ni de payload brut — `real_shipment` n'est jamais peuplé en V1 car le coût final réel d'une expédition n'est pas capturé séparément du devis dans le schéma actuel), `shipping_simulation_campaigns`/`shipping_simulation_campaign_items` (campagnes bornées et reprenables, état `draft→queued→running→completed|completed_with_errors|cancelled`, traitées par `runCampaignBatch` — workers bornés comme `shippingSyncBatch.ts`, lot de 40 scénarios par tick, 3 appels Packlink simultanés et budget de 30 s par tick — via `.github/workflows/shipping-campaign-worker.yml` (cron 5 min encore actif pendant la migration, `SUPABASE_SERVICE_ROLE_KEY` bearer) et le template importable n8n Hetzner `ops/n8n/shipping-campaign-worker.json` (schedule 5 min, credential Bearer dédié `SHIPPING_CAMPAIGN_SCHEDULER_TOKEN` côté Vercel ; activation manuelle n8n à vérifier avant de définir la variable GitHub `SHIPPING_CAMPAIGN_N8N_ACTIVE=true` qui désactive les jobs schedulés GitHub tout en gardant `workflow_dispatch`), et côté `platform_owner` (`requirePlatformOwner()`), par un tick borné immédiat `POST /api/admin/shipping-simulation-campaigns/:id/process` sans secret exposé ; le déclenchement admin applique un cooldown court, les items sont claimés en compare-and-set `pending→running` pour éviter les doublons cron/admin et les claims abandonnés sont récupérés après 10 minutes), `shipping_tariff_drafts` (brouillons de tarifs commerciaux, **jamais lus par le checkout**, rétrotestés via `/api/admin/shipping-tariff-drafts/:id/simulate` qui distingue toujours métriques scénario-pondérées et commande-pondérées, jamais moyennées ensemble). L'onglet Admin → Livraison (tenant) compte 7 onglets : Tarification (ex-Règles par pays, inchangé), Emballages, Expéditions (brouillons d'expédition, migration 151), Assistant, Historique, Analyse tarifaire, Forfait ; le Laboratoire et le Diagnostic Packlink sont des outils techniques réservés au `platform_owner` sous Platform → Livraison technique (`/admin/platform/livraison/*`, API `shipping-simulator`, `shipping-simulation-campaigns/**`, `shipping-postal-code-import`, `packlink-*` protégées par `requirePlatformOwner()`, anciennes URL redirigées). Laboratoire (absorbe l'ancien Simulateur en mode « Test rapide », qui persiste désormais chaque service Packlink retourné comme observation au lieu de le jeter, + campagnes ; une commune est résolue en ses CAP connus (index GeoNames interne `shipping_postal_code_index`, repli Nominatim/Zippopotam.us/GeoNames) en conservant pays + codes administratifs jusqu'à la création de campagne — les homonymes non départageables ne sont jamais fusionnés (choix explicite ou CAP manuel) et l'exhaustivité officielle des CAP n'est jamais revendiquée ; chaque CAP devient une destination distincte ; échantillonnage « Couverture initiale » (~6 poids par profil calés sur sa capacité, défaut), « Analyse approfondie » (paliers transporteur + seuils multi-colis, confirmation explicite obligatoire) ou poids manuels, poids par profil calculés côté serveur (`weightsByProfileId`), limite 2000 scénarios conservée avec découpage déterministe par CAP proposé au-delà ; mode « Par zone (CAP témoins) » (`zoneSentinels.ts`, `GET …/zone-sentinels`) : les devis Packlink mesurés étant identiques pour tous les CAP d'une même zone, la couverture recommandée mesure 1–3 CAP témoins par zone tarifaire (capitale de zone + périphérie, CAP génériques pré-réforme et CAP refusés exclus) au lieu de tous les CAP ; Livigno (23041) et Campione d'Italia (22061) ne sont desservis par aucun service Packlink : `/api/shipping/quote` reste indisponible pour ces CAP mais affiche un message « zone extra-douanière » explicite (`lib/shipping/extraCustomsTerritories.ts`, retrait proposé seulement si `click_collect_enabled`) ; l'Assistant estime strictement par zone (zone recalculée depuis le CAP de chaque observation) et le rétrotest applique les surcharges de zone via la même résolution ; les devis Packlink sont HT (`tax_price = 0`) : Historique/Assistant les affichent « HT » et le rétrotest compare les brouillons (prix TTC) aux devis TTC (TVA du pays ajoutée), filtrés par pays (défaut IT) ; le coût réel comparé inclut les frais d'emballage actuels (le forfait tenant étant TTC emballage compris), avec un tableau « Coûts réels Packlink vs forfait » par poids et groupe de zones, et le formulaire expose les stratégies multi-colis (dont « 1er colis plein tarif + remise % par colis supplémentaire », calcul colis par colis)), Assistant expédition (estimation déterministe par similarité — aucune IA/embedding — toujours accompagnée d'un niveau de confiance et d'une taille d'échantillon, jamais présentée comme un prix garanti), Historique des coûts, Analyse tarifaire, Diagnostic Packlink (déplacé dans la console plateforme, voir ci-dessus). Toutes les nouvelles tables suivent le pattern RLS-backstop + GRANT explicite déjà établi par `shipping_country_rules` ; `shipping_quote_observations`/`shipping_simulation_campaigns`/`shipping_simulation_campaign_items`/`shipping_tariff_drafts` n'ont aucune policy publique (coûts fournisseur internes, service-role uniquement). **Qualité des données (V1E, sans migration)** : l'identité d'une demande provider = tenant + provider + origine + pays/CAP de destination + colis (poids et dimensions exacts) ; `request_hash` sert de clé et la correspondance est revérifiée champ par champ (`requestIdentity.ts`). Le worker ne réemploie qu'un devis strictement identique encore frais (`equivalence.ts`) — plus jamais la zone commerciale ni une tolérance de poids/volume, qui restent réservées à l'Assistant expédition présenté comme estimation. Chaque exécution Packlink persiste toutes les offres (y compris non éligibles et motifs) et désigne UNE observation opérationnelle : service éligible au coût base + taxes le plus bas ; « aucun service », « aucun service éligible », erreur provider/persistance et observation choisie absente marquent l'item `failed` (jamais un faux succès). `skipped_duplicate` signifie réemploi valide (pas un nouvel appel). Le détail campagne calcule une couverture vérifiée par CAP × profil (`campaignCoverage.ts`/`campaignData.ts`, items paginés et observations relues par lots tenant-scopées) qui classe les items historiques (réemploi valide, autre CAP, divergent/périmé, observation manquante, non vérifiable) sans modifier les données de production ; un CAP n'est complet que si tous ses scénarios ont un devis valide ; un « Diagnostic des erreurs » par motif (`campaignErrorReasons.ts` : libellé, explication, CAP/poids concernés, inclus ou non dans la remesure) précède la remesure (`POST …/:id/resample`), qui crée sur action explicite une campagne limitée aux scénarios dont le motif est remesurable. Un HTTP 400/404/422 Packlink (ex. CAP génériques pré-réforme listés par GeoNames : 40100, 41100…) est un refus de destination (`provider_rejected`, arrêté sans nouvel appel après deux poids) et non un incident : le worker renvoie `failed` (incidents d'exécution, seul contrôlé par n8n/GitHub) séparément de `rejected` (issues de donnée). Historique, Assistant et rétrotest comptent des scénarios mesurés (dernier devis valide par `request_hash`), jamais les offres alternatives ; le rétrotest synthétique expose taille réelle d'échantillon, CAP/zones couverts, concentration et fiabilité prudente (`insufficient | limited | indicative`), et distingue scénarios synthétiques, devis Packlink enregistrés sur les commandes et coûts finaux vérifiés (non alimentés).

**Forfait shadow (V1F, migration `124`)** : `tenants.shipping_pricing_mode` (`provider_cost` par défaut | `shadow` | `tariff` réservé, traité comme `provider_cost`) est indépendant de `shipping_provider` (dont `flat_rate` reste le forfait unique historique). `shipping_tariff_versions` stocke des snapshots **immuables** copiés d'un brouillon (tranches en grammes `min < poids ≤ max`, prix en centimes, suppléments de zone par colis/commande, zones non livrables, colis max, blocs au-delà de N kg, limite logistique vérifiée, TVA incluse ou non) ; statuts `validated | shadow | retired | active` (`active` jamais écrit), une seule `shadow` par tenant+pays, trigger d'immuabilité, aucun DELETE, sélection atomique par RPC. Le moteur pur `lib/shipping/tariff/priceFromTariff.ts` (entiers grammes/centimes, colis remplis via `splitParcelWeightsFilled`, règles pays via `applyCountryRule`) est appelé côté serveur par `resolveCheckoutShippingDetails` (`shadowTariff.ts`) depuis `/api/checkout`, `/api/checkout/external-link` et le PATCH de session : en mode `shadow` et livraison seulement, il ajoute `shipping_details.shadow_tariff` (version, poids net depuis `products.weight_grams`, zone, tranche, colis, supplément, prix shadow, montant facturé, devis Packlink vérifié contre le total signé, écart) sans jamais modifier `shippingTotal`, le total, le token HMAC, le PaymentIntent ni les champs Packlink ; toute clé `shadow_tariff` venue du navigateur est retirée ; timeout 2,5 s et erreurs non bloquantes ; aucun repli de poids (produit sans poids → simulation incomplète) ; retrait en magasin exclu. Admin → Livraison → **Forfait shadow** (`/admin/livraison/forfait-shadow`, `shipping.view`/`shipping.manage`) : création de version depuis un brouillon, sélection/rollback, activation de la seule collecte, qualité des poids produits, rapport sur commandes réelles (période, version, fiabilité prudente). La tarification commerciale n'est pas implémentée. Détail et runbook : `docs/SHIPPING_FLAT_RATE_CHECKOUT.md` §10–11.

**Forfait commerciale (V1G, migration `125`)** : `shipping_pricing_mode = tariff` s'obtient uniquement par l'action admin « Activer cette tarification pour les clients » (RPC atomique `activate_shipping_tariff_version` : une seule version `active` par tenant+pays, activée par/le tracés ; retrait par pays `retire_shipping_tariff_country`, retour global `rollback_shipping_tariff_to_provider_cost`). En mode `tariff`, `/api/shipping/quote` calcule côté serveur le prix de la version active (poids net depuis `products.weight_grams`, zone tenant — CAP hors zones non couvert par le forfait (repli du tenant, ex. Corse/outre-mer/Monaco), territoires extra-douaniers toujours refusés même avec `flat_rate_override` —, `priceFromTariff`, règles pays dans l'ordre du live, jamais `packaging_surcharges`), vérifie la disponibilité logistique avec le même plan de colis que la préparation (`cartonsForWeight` + `tare_g`) : devis identique récent (7 j), sinon appel Packlink limité à 6 s (services persistés en `real_quote`), sinon preuve récente du même CAP (30 j, jamais au-delà du poids logistique vérifié), et signe un **token V2** (`v2.` + HMAC : tenant, montant en centimes, pays, CAP normalisé, poids, empreinte du panier validé, mode, version, devis provider, expiration). `lib/shipping/tariff/checkoutShipping.ts` recalcule et compare dans `/api/checkout` (Stripe + magasin), `/api/checkout/external-link`, le PATCH de session ; `revalidateSessionShipping` protège `create-intent` et le PATCH sans nouveau devis ; toute divergence → 409 `SHIPPING_REQUOTE_REQUIRED`, le client refait le devis et le client reconfirme. Token legacy refusé en `tariff`, token V2 refusé hors `tariff`. `tenants.shipping_tariff_fallback` (`unavailable` défaut | `provider_cost`) règle explicitement les pays sans tarif, les CAP hors zones et les produits sans poids. L'ordre conserve `shipping_details.pricingMode = tariff` + `tariff{versionId, version, zone, poids, tranche, blocs, colis, supplément, TVA, règles, finalCents, providerQuoteTtcCents}` sans `packlinkCost`. Admin « Forfait » : états Brouillon / Shadow / Active / Retirée, confirmation avec checklist (`activationChecklist.ts`), retrait, rollback, repli, tare dans Emballages, rapport « Commandes facturées au forfait ». Page publique `/livraison` (FR/IT, générée depuis la version active) présente mais **masquée** : `tenants.shipping_public_grid_enabled` défaut false. Aucun tenant n'est activé par le déploiement. Runbook : `docs/SHIPPING_FLAT_RATE_CHECKOUT.md` §12–13.

Ordini senza e-mail (assistiti, cliente solo telefono): `order-confirmed` e tutte le notifiche di stato cliente sono saltate senza dichiararle inviate (loyalty e recensioni invariate); il token di tracking è HMAC(`orderId` + e-mail vuota) e il link si condivide dall'admin (copia / `wa.me`). Per gli incassi registrati il tenant sceglie se inviare `order-confirmed`.

`docs/NOTIFICATION_JOURNEY_V1.md` resta riferimento notifiche; `tenant_notification_recipients` è source of truth destinatari interni. Gli alert pagamento esterno Shop/Events condividono `notify_external_payment_pending` ma webhook/payload distinti. Gli eventi aggiungono `notify_event_booking_closed_reports` per i tre report automatici di chiusura.

---

## 14. Migration recenti

La presenza nel repo non prova l'applicazione in ogni Supabase remoto.

`152` ridefinisce solo `is_valid_shipping_automation_config` per accettare `shipment_content` (stringa 1–60 dopo trim); nessuna tabella o dato toccati, config 151 ancora valide. **Applicata in produzione il 09/10/2026** (verificato: nuova chiave accettata, config 151 valide, contenuto vuoto o > 60 rifiutato, `anon` rifiutato). Test CI: `supabase/tests/152_shipping_automation_content.test.sql`.

`151` (brouillons d'expédition) è additiva e rieseguibile, senza backfill: registra `shipping_automation` in `platform_features` (non fatturabile) con il CHECK `is_valid_shipping_automation_config` su `tenant_feature_settings`, aggiunge a `orders` `shipping_creation_status` (CHECK sui 6 stati), `shipping_creation_attempts` (default 0), `shipping_creation_error` (≤ 64), `shipping_creation_updated_at`, `shipping_provider_created_at` e l'indice parziale `orders_shipping_creation_queue_idx`. Nessuna riga esistente modificata, nessun tenant attivato; RLS/grant invariati. **Applicata in produzione il 09/10/2026** (verificato: modulo registrato non fatturabile, nessuna riga di settings, colonne presenti con stato vuoto su tutti gli ordini, `anon` rifiutato). Test CI: `supabase/tests/151_shipping_shipment_creation.{fixture,test}.sql`. Rollback nell'intestazione. Vedi `docs/SHIPPING_INTELLIGENCE.md` §2.4.

`149` (import cataloghi WhatsApp esterni) è additiva e rieseguibile, senza backfill: `external_catalog_sources`, `external_catalog_items` (FK composita `(tenant_id, linked_product_id)` → `products`, `on delete set null (linked_product_id)`), `external_catalog_events` (audit append-only, `request_key` univoca per tenant), RLS forzata senza policy, solo `service_role` senza DELETE; RPC `external_catalog_record_fetch`, `external_catalog_apply_item`, `external_catalog_attach_images`, `external_catalog_set_item_status`. Nessuna tabella esistente modificata (riusa `products_tenant_id_id_key` della 139). **Applicata l'8/10/2026** (verificato: tabelle presenti, `anon` rifiutato su tabelle e RPC). `150` concede a `service_role` l'EXECUTE sulle tre funzioni di supporto della 149 (senza, ogni RPC fallisce con «permission denied for function external_catalog_text»): **applicata l'8/10/2026**. Test CI: `supabase/tests/149_external_catalog_import.{fixture,test}.sql`. Rollback in fondo al file. Vedi `docs/WHATSAPP_EXTERNAL_CATALOG_IMPORT.md` §12.

`147` (WhatsApp Business Platform) è additiva e rieseguibile, senza backfill: 6 tabelle nuove (`tenant_whatsapp_channels`, `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_automation_rules`, `whatsapp_handoffs`, `whatsapp_audit_events`) con RLS forzata senza policy e GRANT espliciti al solo `service_role` (canali senza DELETE, audit append-only), FK composite `(tenant_id, …)`, trigger di coerenza tenant cliente↔conversazione, 4 RPC service-role (ingest idempotente, claim, stato monotono, purge 180/365 giorni) e 3 capability RBAC (`platform_owner`/`tenant_admin`). Nessuna tabella esistente modificata (`tenants.whatsapp_number` intatto). **Applicata il 7/10/2026** (verifica indiretta: admin WhatsApp e scritture canale/messaggi operative; verifica completa di grant/RLS lato produzione ancora da eseguire). Test CI: `supabase/tests/147_whatsapp_business_platform.{fixture,test}.sql`. Rollback nell'intestazione. Vedi `docs/WHATSAPP_BUSINESS_PLATFORM.md`.

`146` ridefinisce solo `is_valid_order_documents_config` per accettare `picking_list_show_delivery_address`; nessuna tabella o dato toccati, compatibile all'indietro, rieseguibile. **Applicata in produzione il 05/10/2026** (verificata: nuova chiave booleana accettata, valore non booleano rifiutato, config 145 ancora valide, `anon` 401); senza, il salvataggio delle preferenze documenti risponderebbe 409. Test CI: `supabase/tests/146_order_documents_picking_address.test.sql`.

`145` è additiva e rieseguibile, senza backfill: registra `order_documents` in `platform_features` (non fatturabile) con il CHECK `is_valid_order_documents_config`, crea `order_public_access_tokens` (RLS forzata senza policy, grant solo `service_role`, unique `(tenant_id, token_hash)`, indice unico parziale «un token attivo per ordine») ed estende `review_invite_tokens.purpose` a `qr_portal`. **Applicata in produzione il 05/10/2026** (verificata); senza, i documenti funzionano con i default e senza QR. Test CI: `supabase/tests/145_order_documents.{fixture,test}.sql` (doppia applicazione, CHECK, grant/RLS, un token attivo per ordine). Rollback nell'intestazione del file. Vedi `docs/ORDER_DOCUMENTS.md`.

```text
074_checkout_recovery_lifecycle.sql
075_external_payment_verification.sql
079_tenant_storefront_url.sql
080_external_payment_tenant_notifications.sql
081_event_gallery_social_share.sql
082_event_checkin_operations.sql
083_event_external_payment_cancellation.sql
084_platform_billing_boundary.sql
085_admin_rbac_permissions.sql
086_admin_rbac_role_permission_rpc.sql
087_admin_rbac_completion_permissions.sql
088_event_on_site_price_list.sql
089_event_manual_reservations.sql
090_event_capacity_management.sql
091_event_booking_closes_at.sql
092_event_remaining_places_visibility.sql
093_event_booking_close_reports.sql
094_feature_entitlements_foundation.sql
095_nala_conversation_analytics.sql
096_tenant_feature_settings.sql
097_nala_semantic_enrichment.sql
098_nala_conversion_attribution.sql
099_nala_product_relationships.sql
100_lepefy_ai_core.sql
101_platform_prospects.sql
102_nala_response_memory.sql
103_category_catalog_scope.sql
112_category_service_writes.sql
104_customer_account_deletion.sql
105_tenant_app_icon.sql
106_tester_feedback.sql
107_tester_feedback_invites.sql
108_tester_feedback_contact_status.sql
109_tenant_crm_foundation.sql
110_event_gallery_editorial.sql
111_managed_shipping_tracking.sql
119_shipping_intelligence_foundation.sql
121_purchase_quantity_rules.sql
122_match_products_quantity_rules.sql
123_packaging_profile_carton_suggestion.sql
124_shipping_tariff_versions.sql
125_shipping_tariff_activation.sql
126_tenant_payment_apple_pay.sql
127_hero_slide_images.sql
128_assisted_orders.sql
129_tenant_daily_digest.sql
130_tenant_loyalty_settings.sql
131_tenant_loyalty_legacy_cleanup.sql
132_tenant_referral_settings.sql
133_tenant_referral_legacy_cleanup.sql
134_tenant_ai_settings.sql
```

`128` è additiva ma **operativamente significativa** (checkout, pagamenti, ordini): origine/canale/link/audit su `checkout_sessions`, stato `draft`, e-mail nullable per le sole sessioni/ordini assistiti (vincoli CHECK), colonne di audit incasso e `order_origin` su `orders`, `payment_method = 'manual'`, indice unico `orders.checkout_session_id`, indice «una sessione open per cliente» limitato allo storefront, trigger funnel e vista `checkout_funnel_30d` limitati allo storefront, journal `assisted_order_events` service-role only e RPC `convert_checkout_session_to_order` (EXECUTE solo service_role). Deve essere applicata **prima** del codice (recovery storefront e conferme esterne ne dipendono), poi verificata con `supabase/verification/128_assisted_orders_verification.sql` (transazione annullata). Runbook e rollback: `docs/ASSISTED_ORDERS.md` §10.

`087` aggiunge le capability emerse dal full admin authorization audit e le assegna ai system role `platform_owner` e `tenant_admin`; non amplia automaticamente alcun custom role.

`088` aggiunge il campo nullable `events.on_site_price_list_image_url`; non modifica formule, disponibilità, checkout o pagamenti.

`089` è additiva: aggiunge a `event_reservations` `source`, `payment_method` e `created_by_admin_id`, effettuando un backfill deterministico dell'historico (`stripe_payment_intent_id` presente → online/stripe, assente → external_link/external_link). Abilita la tracciabilità delle prenotazioni incassate in negozio senza cambiare il modello di capacità o QR.

`090` è additiva: introduce `event_capacity_adjustments`, la capability `event_capacity.manage` e l'RPC `adjust_event_capacity`. L'RPC rende atomiche le modifiche di capacità e impedisce di scendere sotto le places già prenotate. La capability viene assegnata ai system role `platform_owner` e `tenant_admin`; i custom role non vengono ampliati automaticamente.

`091` è additiva: introduce `events.booking_closes_at` nullable. Gli eventi esistenti non ricevono backfill e conservano il comportamento precedente; quando valorizzata, la deadline chiude i checkout pubblici Events ma non le prenotazioni manuali admin.

`092` è additiva: introduce `events.show_remaining_places boolean NOT NULL DEFAULT true`. L'opzione controlla esclusivamente la disclosure pubblica del numero residuo; non modifica capacità, disponibilità reale, checkout o prenotazioni.

`093` è additiva ma operativa: introduce configurazione fallback report, schedule/dispatch/idempotency su `events`, flag destinatario `notify_event_booking_closed_reports`, trigger di calcolo schedule, backfill degli eventi esistenti e RPC di claim service-role-only. Non modifica checkout, prezzi, capacità o pagamenti.

`094` è additiva: introduce il catalogo `platform_features`, sostituisce il CHECK hardcoded di `platform_plan_features.feature_key` con una foreign key, include `nala` nel piano `food-platform` e crea gli override sparsi `tenant_feature_overrides`.

`095` è additiva: introduce l'entitlement `nala_analytics`, le tabelle service-role-only `nala_sessions` e `nala_interactions`, la risoluzione atomica delle sessioni e la purge raw a 90 giorni. I customer sono referenziati solo per UUID nullable; geografia e metadata sono minimizzati. Lo scheduling giornaliero della purge resta da collegare a infrastruttura approvata.

`096` introduce `tenant_feature_settings` come configuration layer operativo service-role-only, effettua il backfill verificato del toggle Nala per ogni tenant e rimuove dal current schema il boolean legacy. I nuovi tenant senza setting Nala restano operationally disabled per default.

`129` è additiva e opt-in: registra `daily_order_digest` (non fatturabile, senza piani) e il CHECK di config limitato a quella feature, aggiunge `notify_daily_digest` ai destinatari, il registro `tenant_daily_digest_runs` e la RPC di claim service-role-only. Non crea righe di settings e non tocca Nala/reviews; il backfill condizionale da eventuali colonne `tenants.daily_digest_*` di una bozza precedente conserva le colonne, revocandone la lettura pubblica.

`130` è additiva: registra `loyalty` (non fatturabile, senza piani), fa il backfill di una riga `tenant_feature_settings` per ogni tenant con verifica di conteggio e valori, installa i trigger di mirror bidirezionale con le colonne legacy (anche per i nuovi tenant) e revoca il grant pubblico 076 sulle tre colonne loyalty. Nessuna colonna rimossa, `points_ledger` non toccato.

`131` è **distruttiva** (fase 5 loyalty): verifica che ogni tenant abbia una riga loyalty identica alle colonne legacy (altrimenti abort senza modifiche), riscrive `process_manual_purchase_points_atomic` per leggere il tasso da `tenant_feature_settings` (stessa firma e calcolo), elimina i trigger/funzioni di mirror della 130 e le colonne `tenants.loyalty_enabled`, `purchase_points_rate`, `points_to_currency_rate`. Rollback nei commenti della migration. Ordine obbligatorio: deploy del codice, poi migration.

`132` è additiva (referral, fasi 1–4): registra `referral` (non fatturabile, senza piani), fa il backfill di una riga `tenant_feature_settings` per ogni tenant (`enabled = true`, config con i sette valori `referral_*`) con verifica dei valori, installa il mirror bidirezionale con le colonne legacy (anche per i nuovi tenant) e revoca il grant pubblico 076 sui sette campi, soglie anti-frode incluse. Nessuna colonna rimossa; `referral_codes`, catene e storico punti non toccati.

`133` è **distruttiva** (fase 5 referral): verifica che ogni tenant abbia una riga referral identica alle sette colonne legacy (altrimenti abort senza modifiche), elimina trigger e funzioni di mirror della 132 (incluso `referral_config_from_tenant`) e le colonne `tenants.referral_*` di configurazione. Non tocca `customers.referral_*`, `referral_codes` né le catene. Rollback nei commenti. Ordine obbligatorio: deploy del codice, poi migration.

`134` è additiva (AI/Nala, fasi 1–4): crea una riga `tenant_feature_settings('ai')` per tenant (`enabled = true`, flag immagini/descrizioni/ricerca semantica e i tre limiti di rate limiting) senza cambiare la semantica commerciale della voce `ai` (094). Sposta `chatbox_extra_context` in `tenant_feature_settings('nala').config.extra_context` senza toccare l'attivazione Nala. Installa il mirror bidirezionale con le colonne legacy e revoca il grant pubblico 013/076 su flag e limiti. `check_ai_rate_limit` (027) continua a leggere i limiti dal mirror. `catalogue_search_threshold` non viene toccato. Il codice deployato funziona prima e dopo l'applicazione.

`097` è additiva e operativa: estende `nala_interactions` con classificazioni semantiche controllate, stato/versione/tentativi, indici dashboard-ready e claim RPC service-role-only concurrency-safe. Le righe esistenti restano eleggibili e vengono drenate in piccoli batch; small talk e le nuove risoluzioni Fast Resolver possono essere completate deterministicamente senza AI. Il worker scheduled non modifica outcome, chat response, retrieval o retention. Il provider non è più hardcoded: la classificazione passa dalla policy AI Core `nala_semantic_enrichment / classification`, con preflight prima del claim per non consumare tentativi quando il routing non è operativo.

`098` è additiva e service-role-only: introduce l'entitlement `nala_conversion_attribution`, la lineage prodotto/checkout `nala_checkout_attributions`, gli eventi conversione durevoli e la RPC idempotente `record_nala_purchase_attribution`. La purge delle conversazioni porta a `NULL` solo i riferimenti session/interaction; product ID, checkout/order ID, quantità, prezzi snapshot e gross assisted value restano disponibili per reporting.

`099` è additiva e service-role-only: introduce `product_relationships` con semantica direzionale, vincoli same-tenant/self/duplicate, priority e source manual/system. Estende `nala_interactions` con metadata action separati dal retrieval per qualificare correttamente similar/substitute/complementary nelle conversioni. Non effettua backfill e la tabella può restare vuota; in quel caso il direct retrieval continua, similar/substitute possono usare fallback sicuri e complementary non viene inventato.

`100` è additiva: registry, routing, context server-side, telemetry e RPC di lease/retention. Applicazione Supabase remota completata e verificata dal proprietario come prerequisito AI Core; V1.2 riusa lo schema esistente e non aggiunge migration.

`105` aggiunge `tenants.app_icon_url` nullable con grant SELECT esclusivamente column-level per `anon` e `authenticated`; non esegue backfill e mantiene `logo_url` come fallback.

`106` introduce campagne e feedback testeurs tenant-scoped, vincolo atomico di una sola campagna attiva, relazione composita anti cross-tenant, RLS forzata e privilegi esclusivamente service-role. Nessun IP raw o fingerprint viene persistito; l’applicazione in Supabase resta manuale.

`107` estende le campagne con l’URL del test Google Play, introduce gli inviti tester tenant/campaign-scoped e collega opzionalmente i feedback a un invito attivato. Token invito/sessione sono hashati, email normalizzate uniche per campagna, relazioni cross-tenant impedite da foreign key composite e accesso limitato al service role. Invio n8n accettato, attivazione Lepefy e partecipazione ufficiale Google Play restano stati distinti; l’applicazione Supabase resta manuale.

`108` aggiunge agli inviti tester un numero di telefono/WhatsApp opzionale e uno stato installazione manuale `unknown | installed | problem`. I campi sono soltanto metadata operativi per il follow-up Platform, non vengono usati per autenticazione e non rendono Lepefy autorevole sull'installazione Google Play; l'applicazione Supabase resta manuale.

`110` estende la Gallery all'editorial media library Événementiel come descritto sopra. Migration additiva, rollback delle sole tre colonne editoriali e indice documentato nel SQL; i campi storici e RLS non cambiano. L'applicazione in Supabase resta manuale.

`109` introduce il CRM tenant e il disaccoppiamento identity sopra descritto. È una migration additiva e ID-preserving, ma operativamente significativa: deve essere applicata manualmente prima del codice applicativo perché il build Vercel non esegue migration Supabase. Crea read model CRM, RFM, eventi, note, tag, segmenti e campagne service-role-only con RLS forzata e vincoli compositi anti cross-tenant.

`104` abilita la cancellazione account cliente tenant-scoped. Introduce soltanto lo stato minimo service-role-only per retry/manual review, rende esplicite le FK CASCADE/SET NULL necessarie a separare dati di profilo e storico durevole, e aggiunge una RPC transazionale per il cleanup dati. La migration deve essere applicata manualmente prima di usare il flusso; il build Vercel non la esegue.

`113` introduce Reviews V1 verificato: entitlement/settings tenant, capability RBAC dedicate, recensioni service one-per-order paid+delivered, inviti token-hashati, moderazione umana obbligatoria con contenuto immutabile e audit append-only, blacklist deterministica, statistiche pubbliche sulle sole recensioni published e dispatcher retry-safe. L’AI moderation resta disabilitata in V1. La migration è additiva e richiede applicazione manuale in Supabase prima dell’attivazione del modulo.

`127` aggiunge `tenant_hero_slides.image_url` nullable per l'artwork editoriale dell'hero Découvrir. Non esegue backfill, non modifica le slide dinamiche e va applicata prima di caricare immagini editoriali dall'admin; il frontend ripiega sulla query legacy se la colonna non esiste ancora.

Nala Analytics Dashboard V1 non richiede migration: consuma lo schema 095/097/098/099 esistente tramite query service-role tenant-scoped e mantiene invariati retention, checkout, payment e order lifecycle.

`123` è additiva e reversibile: due colonne nullable `suggest_min_weight_g`/`suggest_max_weight_g` su `shipping_packaging_profiles` per suggerire il cartone per collo nel dettaglio ordine admin (card «Carton à utiliser», motore puro `lib/shipping/cartonSuggestion.ts`, split pieno 15 kg + resto). Nessun impatto su checkout, prezzo o `packaging_surcharges`; finché non è applicata manualmente in Supabase la card resta nascosta e l'editor Emballages non invia i nuovi campi. Dossier del futuro forfait checkout: `docs/SHIPPING_FLAT_RATE_CHECKOUT.md` (prezzi tenant IVA inclusa).

`124` è additiva e reversibile: `tenants.shipping_pricing_mode` (default `provider_cost`, nessun cambio per i tenant esistenti) e la tabella service-role-only `shipping_tariff_versions` (snapshot immutabili via trigger, nessun DELETE, una sola versione `shadow`/`active` per tenant+paese, RPC `select_shipping_tariff_shadow_version`). Nessun backfill. Finché non è applicata manualmente in Supabase, il checkout resta invariato (il mode assente vale `provider_cost`) e l'onglet Forfait shadow mostra «migration non appliquée». Rollback documentato in fondo al file SQL.

`125` è additiva: `shipping_tariff_versions.activated_at/activated_by/retired_by`, `tenants.shipping_tariff_fallback` (default `unavailable`), `tenants.shipping_public_grid_enabled` (default false), `shipping_packaging_profiles.tare_g`, e le RPC service-role di attivazione/ritiro/rollback. Nessun backfill e nessun tenant attivato: il forfait è addebitato solo dopo l'attivazione esplicita in admin. Da applicare manualmente dopo la 124; senza di essa l'attivazione è indisponibile e il checkout resta invariato. Rollback documentato nel file SQL.

`126` è additiva: ricrea soltanto `tenant_payment_methods_method_check` aggiungendo `'apple_pay'` (idempotente, nessun dato toccato, nessuna nuova tabella quindi nessun nuovo GRANT). Da applicare manualmente prima di attivare Apple Pay in admin: senza di essa l'insert di una riga `apple_pay` fallisce sulla CHECK, il resto è invariato.

`142` (correzione della 141, solo funzione + default): `refresh_product_cost()` ordina per giorno di ricezione (Europe/Paris) poi per ordine di registrazione (`created_at`, ora default `clock_timestamp()`) invece del timestamp `received_at`, che il form valorizzava alle 12:00 (futuro per una ricezione del mattino); ricalcola `product_costs` per tutti i prodotti con storico. Storico append-only non toccato. Verifica: `supabase/verification/142_business_management_cost_order_verification.sql`.

`141` (Gestion Fase 1.1, significativa): converte `supplier_purchase_items.ordered_quantity` e `supplier_receipt_items.quantity` da integer a `numeric(14,3)` preservando i valori (view dei saldi ricreate nella stessa transazione), aggiunge unità, conversione e snapshot di ricezione, completa i movimenti di ledger esistenti (quantità/unità sorgente) senza riscrivere i valori storici, aggiunge `suppliers.default_payment_terms_days`, `supplier_purchases.payment_due_date`, `inventory_movements.reason/source_*`, le tabelle server-only `product_costs`/`product_cost_history` (backfill dalle ricezioni esistenti), la view `inventory_product_overview`, `set_supplier_purchase_due_date`, e riscrive `record_supplier_receipt`, `reverse_supplier_receipt`, `adjust_inventory` (nuova firma con nota; la vecchia è rimossa). `products.stock` resta integer. Verifica: `supabase/verification/141_business_management_units_costs_due_dates_verification.sql`.

`140` corregge le sole view dei saldi Gestion: un acquisto `draft` non è un debito (`outstanding = 0`, escluso da totale acquistato e numero acquisti del fornitore); nessun dato modificato. Verifica: `supabase/verification/140_business_management_draft_not_due_verification.sql`.

`139` (Gestion du commerce) è additiva: 11 tabelle nuove con RLS senza policy e GRANT espliciti al solo `service_role` (niente DELETE sulle tabelle finanziarie/audit), 2 view `security_invoker`, RPC `RETURNS TABLE (out_*)`, bucket privato `business-documents`, 9 capability RBAC (solo `platform_owner`/`tenant_admin`), vincolo additivo `products_tenant_id_id_key`. Non attiva nessun tenant e non modifica dati esistenti. Verifica: `supabase/verification/139_business_management_verification.sql`. Vedi sezione 8.1 e `docs/BUSINESS_MANAGEMENT.md`.

`138` è additiva: `tenants.is_test` (default false, privata), tabella `tenant_feature_flags` con RLS + GRANT espliciti, funzione `current_user_tenant_ids()`, trigger `mark_test_tenant_rows` su `orders`/`event_reservations` e inserimento del tenant `lepefy-test` (`on conflict do nothing`). Nessun tenant esistente viene modificato. Dettagli nella sezione 2 ("Tenant di test e feature flag di rilascio"). **Applicata in produzione il 30/09/2026** (verificata). Senza la 138, `isFeatureEnabled()` restituisce sempre `false` e la pagina Fonctionnalités mostra un errore di caricamento.

`119` è additiva : 5 nuove tabelle (Shipping Intelligence, vedi sezione 13), zero colonne modificate su `tenants`/`orders`/`packaging_surcharges`/`shipping_country_rules`, zero impatto checkout. Seed non distruttivo: un `shipping_packaging_profiles` di default per tenant derivato da `packaging_surcharges` esistente. L'applicazione in Supabase resta manuale.

Knowledge Suggestions V1 non richiede migration: deriva candidati temporanei dagli stessi segnali 095/097 e li rende persistenti esclusivamente dopo approvazione tenant dentro la tabella `tenant_knowledge_base` già esistente. Nessuna tabella di candidate queue, backfill o modifica retention viene introdotta.

`121` è additiva: `products.min_order_quantity`/`order_quantity_step` (default `1`/`1`, nessun cambio di comportamento sui prodotti esistenti) e le nuove tabelle `purchase_quantity_groups`/`purchase_quantity_group_products` per il minimo aggregato su gruppo combinabile (vedi sezione 8). RLS pubblica in lettura sui soli gruppi/membership attivi, scrittura service-role-only. Applicazione manuale richiesta prima del codice che la usa.

`122` è additiva e operativa: ridefinisce la funzione `match_products` (introdotta da `028_semantic_search.sql`) per restituire anche `min_order_quantity`/`order_quantity_step`, così ricerca semantica, prodotti correlati semantici e Cart Builder Nala ereditano la regola senza query di compensazione dedicata. Richiede `drop function` esplicito prima del `create` — Postgres rifiuta un `create or replace` che cambia le colonne di output (`42P13`). Applicazione manuale richiesta.

---

## 15. UI conventions

Admin/storefront principale in francese. Tabler Icons, mobile-first, touch target ~44px+, focus visibile, safe-area, reduced motion, niente dati fake.

Storefront usa branding tenant. Admin usa branding Lepefy con tenant identity contestuale nei touchpoint di accesso.

**Admin Design System V2** (`docs/ADMIN_DESIGN_SYSTEM.md`, regole in `AGENTS.md`): token unici in `lib/admin/tokens.ts` (chiari su `:root`, scuri su `:root.dark`, esposti a Tailwind come `a-*` e `tone-*`; toni `info/success/warning/urgent/danger/neutral` verificati AA in test), formattazione `lib/admin/format.ts`, stati di dominio `lib/admin/statusRegistry.ts`, kit `app/admin/_components/ui` (Button/ButtonLink/IconButton, Badge/StatusBadge, AdminStatCard unica, AdminPageHeader). `tests/unit/adminDesignGuard.spec.ts` blocca su tutto `app/admin` testo < 12 px, palette diretta, `dark:`, `confirm()`, overlay fatti a mano e `var(--color-*)`. Adozione completata il 10/10/2026 (U0–U12): niente più rete di sicurezza dark né rimappatura `--color-*` in admin; il colore del tenant compare solo come `--tenant-*` (identità, anteprime storefront).

Font di piattaforma (Inter per il testo, Bricolage Grotesque per i titoli) via `next/font`: le classi variabile (`inter.variable`, `bricolage.variable`) stanno su `<html>`, non su `<body>`. `globals.css` dichiara `--font-body: var(--font-inter), …` su `:root`, e una custom property che riferisce una variabile non definita a quel livello è invalida: con le classi su `<body>` (fino al 10/10/2026) `--font-body` era vuota e tutto lo storefront e l'admin ricadevano sul serif del browser. Il dev server locale su Windows può generare per l'SSR un hash di classe diverso da quello del CSS (font assente solo in locale); in produzione coincidono.

Solo `app/layout.tsx` emette `<html>/<head>/<body>`: `app/admin/layout.tsx` è un layout annidato (token `--admin-*` in un `<style>` nel body, dopo il blocco `:root` del tenant, più un contenitore `min-h-screen`); un secondo `<html>` rompe l'idratazione di tutto il documento. Il CSS di quel `<style>` è passato con `dangerouslySetInnerHTML`, mai come testo figlio: l'SSR converte `>` in `&gt;` ma `<style>` è un elemento raw-text, quindi il client vede un testo diverso (#425 → #418 → #423, poi #329 sui Suspense ancora disidratati, idratazione ritardata di secondi su tutte le pagine admin). Tema admin: chiave `localStorage` `lepefy-admin-theme`, classe `dark` su `<html>` (copre anche i portal); `AdminThemeProvider` (solo area protetta) emette uno script inline anti-flash, sincronizza la classe dopo il mount e la rimuove all'uscita dall'area protetta. I token scuri `--admin-*` stanno su `:root.dark` (più `color-scheme: dark`), emessi da `adminTokensCss` nello stesso `<style>`; non esiste più una rete di sicurezza per classi legacy (rimossa in U12). Un elemento volutamente chiaro in entrambi i temi (logo, QR, anteprima) usa `bg-white` esplicito; i CSS module con colori fissi richiedono regole `:global(.dark)` proprie.

---

## 16. File/moduli ad alto impatto

```text
apps/storefront/middleware.ts
apps/storefront/src/lib/auth/adminRbac.ts
apps/storefront/src/lib/auth/adminApiPermissions.ts
apps/storefront/src/lib/auth/adminRoutePermissions.ts
apps/storefront/src/lib/auth/requireAdmin.ts
apps/storefront/src/components/layout/BrandNavigationDrawer.tsx
apps/storefront/src/components/payments/StripePaymentStep.tsx
apps/storefront/src/components/checkout-session/*
apps/storefront/src/stores/cartStore.ts
apps/storefront/src/lib/cart/*
apps/storefront/src/lib/checkout/*
apps/storefront/src/lib/orders/*
apps/storefront/src/app/pay/*
apps/storefront/src/app/api/pay/*
apps/storefront/src/lib/purchaseQuantityRules.ts
apps/storefront/src/lib/catalog/*
apps/storefront/src/components/catalog/ProductCard.tsx
apps/storefront/src/lib/shipping/*
apps/storefront/src/lib/tenant/getTenant.ts
apps/storefront/src/app/api/pwa-icon/route.ts
apps/storefront/src/app/api/admin/app-icon/route.ts
apps/storefront/src/lib/privacy/*
apps/storefront/src/lib/admin/workspace.ts
apps/storefront/src/lib/admin/platformBilling.ts
apps/storefront/src/lib/admin/nalaAnalyticsDashboard.ts
apps/storefront/src/lib/admin/knowledgeSuggestions.ts
apps/storefront/src/lib/ai/*
apps/storefront/src/lib/whatsapp/*
apps/storefront/src/app/api/integrations/whatsapp/*
apps/storefront/src/lib/notifications/*
apps/storefront/src/app/api/admin/*
apps/storefront/src/app/admin/*
apps/storefront/src/app/scan/*
packages/types/*
supabase/migrations/*
```

---

## 17. Known technical debt

- collisione storica prefisso migration `071`: non rinominare retroattivamente;
- telefono checkout non uniformemente server-enforced;
- legacy `CheckoutForm.tsx`: verificare caller prima della rimozione;
- il webhook Stripe storefront (`payment_intent.succeeded` senza `metadata.type`) crea ancora l'ordine inline invece di usare la RPC `convert_checkout_session_to_order`: due implementazioni di scrittura ordine restano (idempotenza garantita dall'indice unico sul PaymentIntent);
- ordini assistiti: nessuna riserva di stock durante la validità del link (per design) e indirizzi inseriti dall'operatore non salvati nella rubrica cliente;
- abandoned-checkout outbound automatico non abilitato senza policy consenso/timing;
- tenant resolution resta deployment/env-based (`NEXT_PUBLIC_TENANT_SLUG`);
- URL Events resta temporaneamente env-based;
- SSO esplicito cross-subdomain shop/events non introdotto;
- colonne billing legacy in `tenants` restano temporaneamente;
- le colonne ambassador restano leggibili via PostgREST per il grant di colonna 076: da revocare durante la migrazione del dominio (loyalty: revocato da 130; referral: revocato da 132);
- la `packlink_api_key` del tenant è stata inviata ai visitatori di `/cart` e `/checkout` fino alla Fase 0 (26/09/2026): va considerata compromessa e ruotata lato Packlink;
- ambassador, moduli Événementiel e shipping restano colonne di `tenants`; la migrazione progressiva verso `tenant_feature_settings` è completata per loyalty (130/131) e referral (132/133) e avviata per AI/Nala (134);
- AI/Nala: fino alla fase 5 `check_ai_rate_limit` legge i limiti da `tenants` (mirror della 134) e le colonne `tenants.ai_*`/`chatbox_extra_context` restano; `catalogue_search_threshold` non ha lettori (candidato alla rimozione);
- Settings Hub: profilo, ritiro, avis Google, dati legali e contenuto "Notre origine" restano colonne di `tenants` (nessuna migration nel redesign); il ritiro è un solo punto (`click_collect_*` + orari testuali FR/IT): la UI è già organizzata come lista di punti in vista di una futura `tenant_locations` con orari strutturati; `click_collect_enabled`, logo e colori non sono modificabili dall'admin tenant;
- Console Platform non è ancora CRUD completo di piani/tenant;
- tenant Team self-service non esiste ancora;
- `admin_users.role/tenant_id` restano compatibility mirror finché tutti i job/script non saranno auditati e migrati;
- le API admin legacy mantengono il nome helper `requireAdmin()` per compatibilità, ma l'enforcement è già capability-driven tramite `adminApiPermissions.ts`;
- in `provider_cost`/`shadow` `shipping_details` resta un eco del quote inviato dal browser (solo `shippingTotal` è firmato); in `tariff` lo snapshot è interamente ricostruito dal server;
- il rétrotest delle bozze (`applyTariffDraft`) non usa ancora il motore condiviso `priceFromTariff`;
- in `provider_cost` un `flat_rate_override` IT salterebbe Packlink anche per Livigno/Campione (il blocco extra-doganale è garantito solo in `tariff`);
- costo reale degli imballaggi non registrato: nessun margine completo sugli ordini al forfait;
- Shipping Intelligence : il mapping città→CAP dipende dall'indice GeoNames importato (`shipping_postal_code_index`) con repli Nominatim/Zippopotam.us/GeoNames e fallback manuale; l'esaustività dei CAP non è verificabile e le città GeoNames suddivise per arrondissement (es. `Lyon 01`…`Lyon 09`) non sono raggruppate automaticamente; il mapping CAP→zona commerciale resta tenant-owned (`shipping_zones.postal_prefixes`) e non costituisce un mapping regionale ufficiale della piattaforma; `shipping_quote_observations.source = 'real_shipment'` non è mai popolato perché il costo finale reale di una spedizione non è catturato separatamente dal preventivo; gli item storici con riuso incompatibile restano in produzione (esclusi solo dalla copertura) finché non viene lanciata una remesure esplicita; il range di costo mostrato per un item storico `succeeded` usa l'osservazione collegata all'epoca (scelta sul solo prezzo base prima della V1E), mentre Historique/Assistant/rétrotest ricalcolano l'osservazione operativa; la tariffazione commerciale forfait è implementata (V1G) ma nessun tenant è attivato finché un admin non lo fa esplicitamente;
- AI credits predisposti semanticamente ma non monetizzati/applicati;
- WhatsApp (147, in collaudo su `lepefy-test`): migration 148 (username/BSUID, eco dall'app Business in coexistence) e relativo codice pronti solo in locale; coexistence possibile solo come Solution Partner/Tech Provider (Lepefy non ancora struttura giuridica); nessun template message (risposte solo entro 24 h), nessuna notifica all'équipe sugli handoff (solo badge inbox, polling 10 s), media in arrivo non scaricati, interazioni WhatsApp non incluse in Nala Analytics, widget `/api/chat` non ancora migrato su `runNalaChannelTurn` (cascata Nala in due punti); uno status Meta che arriva prima dell'aggiornamento `provider_message_id` dell'outbound viene ignorato (`status_unmatched`);
- brouillons d'expédition: il telefono del destinatario esiste solo come riga `Téléphone: …` in `orders.notes` (nessuna colonna `orders.phone`); Packlink non permette di ritrovare una bozza dal riferimento ordine (`LEPEFY-<8>`), quindi un esito ambiguo richiede verifica manuale; l'annullamento di un ordine non annulla la bozza Packlink; i colli inviati seguono il cartone suggerito, non il numero reale di colli registrato in preparazione (`packing_parcel_count`);
- documenti delle commande: nel PDF di lotto la numerazione «Page X/Y» è quella dell'intero file (Chromium non riparte da 1 per commande); nessuna UI di revoca del token del portale (solo `revokeOrderPublicTokens`); una rotazione di `TRACKING_SECRET` invalida i QR già stampati, come i link di suivi e `/pay`.

---

## 18. Checklist delivery

Prima di consegnare codice:
- target/base SHA verificati;
- diff limitato allo scope;
- tenant isolation e authorization preservati;
- nessun secret esposto;
- project context aggiornato quando cambia architettura;
- migration remota verificata quando necessaria;
- remote validation sullo SHA finale;
- Vercel `READY` quando applicabile.

---

# Fine snapshot v6.98

**Base audit:** `main` @ `8e08df3789168364cf12b2a6beda769a2ffedc84` — stato revisionato per l'export Excel Gestion.
**Data:** 1 ottobre 2026
**Obiettivo:** descrivere lo stato architetturale corrente, non la cronologia delle conversazioni.

**Priorità logistica Commandes (ottobre 2026):** il classificatore `adminOrderOperations.ts` usa i dati sintetici del tenant per contrassegnare ordini internazionali rispetto a `tenant.country`, freschi (`fresh`) e surgelati (`frozen`). Nella coda di preparazione gli ordini pagati con estero + catena del freddo precedono gli altri; incidenti e ritardi restano superiori. `loadOrderWorkQueue` legge `shipping_address` e `order_items(storage_type)` in forma light prima della paginazione; nessun cambiamento allo stato dell'ordine. La lista mostra data e ora nel fuso Europe/Rome.

**Admin Shell V2 (ottobre 2026).** Navigazione da un solo registry tipizzato (`lib/admin/navigation.ts`: voci, gruppi, permessi `anyOf`, feature flag, badge, posizione nella barra mobile, azioni rapide), risolto nel layout protetto con gli stessi permessi del controllo di rotta; `tests/unit/adminNavigation.spec.ts` verifica che ogni capability che mostra una voce apra anche la pagina e che `defaultAdminDestination` porti sempre a una pagina aperta dagli stessi permessi (nessun ciclo di redirect; un ruolo con solo `event_payments.view` non ha pagina d'atterraggio admin → `/scan` se ha `scan.access`, altrimenti login non autorizzato). In `adminRoutePermissions` i prefissi corrispondono a segmenti interi di percorso; « Locations » (`/admin/evenementiel/reservations-materiel`) richiede `event_reservations.view`, come le API delle prenotazioni di noleggio che usa (fix del 10/10/2026: prima la regola era catturata per errore dal prefisso `/admin/evenementiel/reservations`, con lo stesso effetto ma la voce di menu richiedeva `events.view`). `AdminShell` (`app/admin/_components/shell/`): rail desktop comprimibile (stato `localStorage` `lepefy-admin-sidebar` applicato su `<html data-admin-sidebar>` prima del paint), drawer mobile e barra in basso (max 3 voci + « Plus »), palette comandi Ctrl/⌘ K e « / » (pagine e azioni dal registry, ricerca remota `/api/admin/search` estesa a fornitori e acquisti con flag `business_management`). Header: switcher di workspace come menu accessibile (solo se entrambi gli spazi sono disponibili), notifiche, tema, account. La query `categories` del layout è stata rimossa (non usata). Nessuna migrazione.
