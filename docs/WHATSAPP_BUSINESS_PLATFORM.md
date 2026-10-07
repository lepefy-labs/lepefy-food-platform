# WhatsApp Business Platform — canale multi-tenant

> Stato al **7 ottobre 2026**: **attivo in test end-to-end sul numero di test Meta** (tenant `lepefy-test`, deployment `test.lepefy.com`). Migration `147_whatsapp_business_platform.sql` **applicata** sul progetto Supabase condiviso. Flag `whatsapp_business` attivo **solo** su `lepefy-test`. Nessun numero reale collegato; Chloe Food non configurato (vedi §14).
>
> Base del codice: `main` @ `560ccbb8`. Esito dei test reali: §11.1.

## 1. Obiettivo e principi

Ogni tenant Lepefy può collegare il proprio numero WhatsApp Business (WhatsApp Cloud API di Meta). I clienti scrivono al numero del tenant; Lepefy riceve, risponde con dati reali (regole deterministiche), con Nala per le domande aperte, oppure passa la conversazione all'équipe del tenant, che risponde dallo **stesso numero**.

Principi non negoziabili:

- **Meta è un provider esterno.** Tutta la logica di business vive in Lepefy (`apps/storefront/src/lib/whatsapp/**`). Un solo modulo parla con Graph API: `lib/whatsapp/provider/metaCloudProvider.ts`.
- **Tenant risolto solo lato server, dal numero destinatario**: `metadata.phone_number_id` → `tenant_whatsapp_channels` → `tenant_id`. Mai dal numero del cliente, mai da un `tenant_id` inviato dal client, mai dal deployment che riceve il webhook.
- **Nessun segreto in DB o nel repository.** Il canale memorizza al più il *nome* di una variabile d'ambiente server.
- **Deterministico prima dell'IA.** Prezzi, stock, spedizioni, stato ordine, tracking e pagamenti non passano mai da Nala.
- **n8n orchestra, non decide.** n8n trasporta solo UUID interni e richiama Lepefy.
- **Nessuna configurazione hardcoded per tenant** (niente Chloe Food nel codice).

## 2. Architettura

```text
Cliente WhatsApp
   │
   ▼
Numero WhatsApp del tenant ──► Meta WhatsApp Cloud API
                                   │  POST firmato (X-Hub-Signature-256)
                                   ▼
            /api/integrations/whatsapp/webhook   (un solo URL per tutti i tenant)
                                   │ 1. verifica firma (META_APP_SECRET) — fail closed
                                   │ 2. parse minimale (webhookPayload.ts)
                                   │ 3. phone_number_id → canale → tenant (ingestion.ts)
                                   │ 4. flag whatsapp_business + stato canale
                                   │ 5. ingest idempotente (RPC ingest_whatsapp_inbound_message)
                                   │ 6. dispatch (inline | n8n) → 200 a Meta
                                   ▼
             claim atomico (RPC claim_whatsapp_inbound_messages)
                                   │
                                   ▼
               Automation Engine (automation/processInbound.ts)
        conversation ─ customer (telefono verificato) ─ handoff attivo?
                                   │
           ┌───────────────┬───────┴──────────┬──────────────────┐
           ▼               ▼                  ▼                  ▼
     intent sensibile   regola deterministica   Nala (se attiva)   nessuna risposta
     → handoff          (dati Lepefy)           + guardrail        → handoff / fallback
           └───────────────┴───────┬──────────┴──────────────────┘
                                   ▼
                  Response service (responseService.ts)
            finestra 24 h · guard tenant di test · traccia in DB
                                   ▼
                    Meta Graph API (numero del tenant) ──► Cliente
```

Stati delle conversazioni: `open` (nuova/riaperta), `automated` (ultima risposta automatica), `waiting_human` (operatore richiesto), `human` (operatore in carico), `closed`. `automation_status = paused` in `waiting_human`/`human`: l'automazione non risponde mai mentre un operatore gestisce il cliente.

### Elaborazione asincrona

Il webhook persiste sempre prima di elaborare e risponde 200 a Meta. Due modalità (`WHATSAPP_PROCESSING_MODE`):

| Modalità | Uso | Comportamento |
|---|---|---|
| `inline` (default) | numero di test, volumi bassi | il webhook elabora i messaggi appena persistiti prima di rispondere (`maxDuration` 60 s) |
| `n8n` | produzione | il webhook invia solo gli UUID a n8n (`webhook/whatsapp-inbound`, timeout 3 s) e risponde subito; n8n richiama `POST /api/internal/whatsapp/process` |

In entrambi i casi lo **sweep** di manutenzione (ogni minuto) riprende i messaggi rimasti `pending` da più di 30 s o `processing` da più di 120 s (massimo 3 tentativi, poi `failed`). Il claim è atomico (`FOR UPDATE SKIP LOCKED`): un messaggio non viene mai elaborato due volte in parallelo; un retry Meta non crea un secondo messaggio.

## 3. Modello dati (migration 147)

| Tabella | Ruolo | Note di sicurezza |
|---|---|---|
| `tenant_whatsapp_channels` | numero WhatsApp di un tenant | `UNIQUE(provider, phone_number_id)`; un solo canale non disattivato per tenant; `access_token_env` = nome variabile (`META_WHATSAPP_<X>_TOKEN`), mai il token; mai cancellato (`status = disabled`) |
| `whatsapp_conversations` | una per (canale, `wa_id`) | FK composita `(tenant_id, channel_id)`; trigger: un `customer_id` deve essere dello stesso tenant |
| `whatsapp_messages` | storico minimo | `UNIQUE(channel_id, provider_message_id)` = idempotenza; FK composita `(tenant_id, conversation_id, channel_id)`; payload Meta grezzo mai salvato |
| `whatsapp_automation_rules` | override per tenant delle regole | codici chiusi (CHECK), configurazione JSON ≤ 4 KB validata da Zod |
| `whatsapp_handoffs` | passaggi a operatore | un solo handoff aperto per conversazione (indice unico parziale) |
| `whatsapp_audit_events` | audit append-only | `detail` senza testo dei messaggi né numeri |

Tutte le tabelle: RLS attiva e **forzata**, nessuna policy, nessun grant ad `anon`/`authenticated`; solo `service_role`. Le route server filtrano sempre per `tenant_id` (oltre all'id).

RPC (solo `service_role`): `ingest_whatsapp_inbound_message`, `claim_whatsapp_inbound_messages`, `apply_whatsapp_message_status` (stato monotono `sent < delivered < read`; `failed` solo prima della consegna), `purge_expired_whatsapp_data`.

Capability RBAC: `whatsapp.view` (standard), `whatsapp.reply` (sensitive), `whatsapp.manage` (sensitive) — assegnate a `platform_owner` e `tenant_admin`. L'identità Meta del numero (associare un `phone_number_id` a un tenant) e l'invio di prova sono **riservati al platform owner**: un tenant non deve poter rivendicare il numero di un altro.

Test SQL: `supabase/tests/147_whatsapp_business_platform.{fixture,test}.sql` (CI, job dedicato): grant, RLS, unicità cross-tenant, idempotenza dell'ingest, FK composite, stati monotoni, claim, retention.

### Decisione omnicanale

Tabelle **specifiche WhatsApp** (non un modello generico "channel/inbox"), per non generalizzare prematuramente. L'estendibilità è garantita a livello di codice:

- `tenant_whatsapp_channels.provider` (oggi solo `meta_cloud`) e l'interfaccia `WhatsAppProvider`;
- `runNalaChannelTurn({ channel })` (`lib/ai/nalaChannelTurn.ts`) è già multicanale;
- motore deterministico (`automation/engine.ts`, `intents.ts`, `replies.ts`) indipendente dal trasporto;
- inbox admin costruita su un view-model (`InboxItem`, `ConversationDetail`) che un futuro `inbox_conversations` omnicanale può produrre senza cambiare la UI.

Quando arriverà un secondo canale (Instagram DM / Messenger), la via prevista è una vista o tabella `inbox_conversations` alimentata dai canali, non la riscrittura di queste tabelle.

## 4. Codice

```text
apps/storefront/src/
  app/api/integrations/whatsapp/webhook/route.ts   GET verifica, POST eventi (pubblico)
  app/api/internal/whatsapp/process/route.ts       elaborazione (n8n, bearer)
  app/api/internal/whatsapp/maintenance/route.ts   sweep + auto-resume / purge (n8n, bearer)
  app/api/admin/whatsapp/**                         admin (vedi §8)
  app/admin/(protected)/canaux/whatsapp/**          UI admin
  lib/whatsapp/
    config.ts            env, flag, modalità
    signature.ts         verifica GET + HMAC X-Hub-Signature-256
    webhookPayload.ts    parse minimale (puro)
    ingestion.ts         risoluzione tenant + idempotenza (store iniettato)
    types.ts, log.ts     tipi riga, log strutturato senza PII
    provider/            WhatsAppProvider, adattatore Meta, credenziali da env
    automation/          intents, rules, engine (puro), replies, processInbound
    responseService.ts   unico percorso di invio
    handoff.ts           richiesta / presa in carico / ripresa / chiusura
    adminQueries.ts      letture admin tenant-scoped
    adminSchemas.ts      validazione admin + proiezione canale
    server/              implementazioni Supabase, processing, dispatch, feature gate
  lib/ai/nalaChannelTurn.ts                         Nala come canale
```

## 5. Regole deterministiche (MVP)

Ordine: intent sensibili → regole per priorità (configurabile) → Nala → operatore → fallback.

| Codice | Fonte dati (mai duplicata) | Comportamento |
|---|---|---|
| `human_handoff` | — | richiesta esplicita, reclamo, pagamento problematico, ordine non ricevuto, media senza testo → pausa + handoff |
| `order_status` / `tracking` | `orders` + view-model del portale `/o/[token]` (`buildOrderPortalViewModel`) e snapshot tracking persistito | solo se il `wa_id` (numero verificato da WhatsApp) corrisponde **esattamente e univocamente** a `customers.normalized_phone` del tenant; solo ordini `payment_status = paid`; dati minimi (riferimento, fase, vettore, ETA, link portale). Nessuna chiamata Packlink |
| `product_availability` | `products` (stock reale) via `resolveNalaFastProductAvailability` | risponde solo su corrispondenza non ambigua; altrimenti Nala/operatore |
| `opening_hours` / `location` | `tenants.click_collect_*` + contesto Nala via `resolveNalaFastStoreInformation` | nessuna risposta se il dato manca |
| `shipping` | `tenants.shipping_provider`, `flat_rate_amount`, ritiro, griglia pubblica `/livraison` | nessun prezzo inventato: per Packlink indica che il costo è calcolato al checkout |
| `catalog` | `tenants.storefront_url` (+ `path`, default `/products`) | mai l'URL del deployment che elabora |
| `greeting` | testo opzionale per tenant (`{boutique}`) | al primo messaggio di una nuova conversazione |

Lingua: rilevata dal messaggio (fr/it/en), poi lingua della conversazione, poi `default_language` del canale.

## 6. Nala

WhatsApp è un **canale** di Nala, non un secondo assistente. `runNalaChannelTurn` riusa: `buildSystemPrompt`, contratto di decisione `nalaResponseSchema`, routing AI Core (`consumer = nala`, `capability = structured_chat`), Response Memory, small talk, retrieval `match_products` / `match_knowledge_base`, contesto privato `getNalaExtraContext`, entitlement `canUseNala`, rate limit (`endpoint = nala_whatsapp`). Differenze: storico AI Core separato (`consumer` di conversazione `nala_whatsapp`), istruzioni di formato canale, nessuna card prodotto/carrello.

Guardrail (`evaluateNalaGuardrails`): intent `payment_help` → handoff; `order_help` → regola `order_status`; `delivery` → regola `shipping`; `unknown` o confidenza < 0,55 → handoff. Errore provider AI → handoff `automation_error`. Analytics `nala_interactions` non alimentate dal canale WhatsApp in questa versione (l'uso AI è comunque loggato in `ai_usage_logs`).

Debito noto: la cascata storefront in `app/api/chat/route.ts` non è stata migrata su `runNalaChannelTurn` (scelta deliberata: nessun refactor del widget in produzione in questo ciclo).

## 7. Human handoff

- Richiesta automatica: crea `whatsapp_handoffs` aperto, conversazione `waiting_human`, automazione `paused`, messaggio di presa in carico al cliente, audit.
- **Prendre la main** (o primo messaggio di un operatore): `human`, `assigned_to`, automazione in pausa.
- **Rendre à l'automatisation**: risolve gli handoff aperti, `open` + automazione attiva.
- **Fermer**: `closed`; un nuovo messaggio del cliente riapre la conversazione con automazione attiva.
- Reprise automatique opzionale (`auto_resume_minutes`: 1 h / 4 h / 24 h) eseguita dallo sweep di manutenzione.
- Messaggi umani: solo entro 24 h dall'ultimo messaggio del cliente (oltre serve un template approvato — non implementato in questa versione).

## 8. Admin

`Admin › Canaux › WhatsApp` (`/admin/canaux/whatsapp`), visibile solo con flag `whatsapp_business` attivo e capability `whatsapp.view`. Ogni pagina chiama `requireWhatsAppPage()`, ogni API `requireWhatsAppApi()` (404 se flag spento).

| Pagina | Contenuto |
|---|---|
| Vue d'ensemble | stato, numero, nome verificato, Automatisations/Nala/Handoff ON-OFF, lingua, reprise automatique; pannello **Connexion Meta** solo platform owner (identità, URL webhook, invio template `hello_world`) |
| Conversations | inbox: filtri, lista, filo, stati (Nala, Automatisation, Opérateur demandé, Opérateur, Fermée, Nouvelle), prendere la mano / restituire / chiudere, composer (Ctrl+Invio), polling 10 s; mobile lista ↔ filo |
| Automatisations | attivazione, priorità e testi opzionali per regola |

API (`/api/admin/whatsapp/…`, mappa fail-closed in `adminApiPermissions.ts`):

| Endpoint | Capability |
|---|---|
| `GET channel` | `whatsapp.view` (identificativi Meta solo per platform owner) |
| `PUT channel` | `whatsapp.manage` + platform owner |
| `PATCH channel/settings` | `whatsapp.manage` |
| `POST channel/test` | `whatsapp.manage` + platform owner |
| `GET / PUT rules` | `whatsapp.view` / `whatsapp.manage` |
| `GET conversations`, `GET conversations/[id]` | `whatsapp.view` |
| `POST conversations/[id]/messages` | `whatsapp.reply` |
| `POST conversations/[id]/actions` (`take_over`, `resume`, `close`, `mark_read`) | `whatsapp.reply` |
| `DELETE conversations/[id]` (cancellazione RGPD) | `whatsapp.manage` |

## 9. Segreti e variabili d'ambiente

| Variabile | Dove | Ruolo |
|---|---|---|
| `META_WHATSAPP_VERIFY_TOKEN` | deployment che riceve il webhook | token della verifica GET (stringa casuale ≥ 32 caratteri, scelta da noi) |
| `META_APP_SECRET` | idem | App Secret dell'app Meta (firma `X-Hub-Signature-256`). Più valori separati da virgola per la rotazione. Assente = webhook POST 503 (fail closed) |
| `META_WHATSAPP_API_VERSION` | tutti | versione Graph API. Impostarla sempre esplicitamente (`v25.0` su `test.lepefy.com` al 7/10/2026, versione mostrata dalla console Meta); il default del codice `v23.0` è più vecchio e serve solo da ultima rete |
| `META_WHATSAPP_SYSTEM_USER_TOKEN` | tutti i deployment che inviano | token **permanente** di un System User Meta (permessi `whatsapp_business_messaging`, `whatsapp_business_management`) |
| `META_WHATSAPP_<X>_TOKEN` | opzionale | token dedicato a un canale, referenziato da `access_token_env` |
| `WHATSAPP_PROCESSING_MODE` | deployment webhook | `inline` (default) o `n8n` |
| `WHATSAPP_INTERNAL_SECRET` | deployment webhook + n8n | bearer di `/api/internal/whatsapp/*` e header `X-Lepefy-Webhook-Secret` verso n8n |
| `WHATSAPP_TEST_RECIPIENTS` | deployment di test | numeri autorizzati (internazionali senza `+`, separati da virgola) per i tenant `is_test`; assente = nessun invio per un tenant di test |
| `N8N_WEBHOOK_URL` | esistente | base n8n (modalità `n8n`) |

**Development/test**: numero di test Meta + token temporaneo (24 h) consentito solo per il collaudo iniziale (usato il 7/10/2026 su `test.lepefy.com`, da sostituire con un token System User per qualsiasi uso continuativo). Il token deve essere generato **dopo** il consenso dell'app sulla WABA di test: un token precedente produce `131005 Access denied`. **Production**: mai token temporaneo; System User dedicato, token conservato solo in Vercel (Sensitive). Nessun file `.env.example` nel repository: le variabili sono documentate qui e in `CLAUDE.md`.

Deployment: Meta accetta **un** URL di callback per app. Il webhook è multi-tenant (risolve il tenant dal `phone_number_id` sul DB condiviso), quindi può puntare a un unico deployment "hub" (es. `test.lepefy.com` durante la fase di test, poi il dominio piattaforma). Le risposte in uscita dall'admin partono dal deployment del tenant: ogni deployment che invia deve avere `META_WHATSAPP_SYSTEM_USER_TOKEN` (o il token del canale). Gli URL inviati ai clienti usano sempre `tenants.storefront_url`, mai l'URL del deployment.

## 10. n8n

- `ops/n8n/whatsapp-inbound-dispatch.json`: webhook `whatsapp-inbound` (credenziale Header Auth `X-Lepefy-Webhook-Secret` = `WHATSAPP_INTERNAL_SECRET`) → valida che il payload contenga solo UUID → `POST /api/internal/whatsapp/process` (credenziale Header Auth `Authorization: Bearer <WHATSAPP_INTERNAL_SECRET>`).
- `ops/n8n/whatsapp-maintenance.json`: ogni minuto `{"action":"sweep"}`, ogni notte 03:45 `{"action":"purge"}`.

Sostituire `REPLACE_WITH_LEPEFY_APP_URL`, collegare l'Error Workflow esistente, importare **inattivi** e attivarli solo dopo i test. Un solo workflow per tutti i tenant: n8n non conosce né tenant né contenuti.

## 11. Collegare il numero di test Meta (tenant `lepefy-test`)

Procedura effettivamente seguita il 7 ottobre 2026 (UI Meta in italiano; i nomi dei menu cambiano spesso, cercare la sezione per significato).

1. **Migration** `147_whatsapp_business_platform.sql` applicata (verifica indiretta: `/admin/canaux/whatsapp` carica e le scritture sul canale riescono).
2. **Account sviluppatore**: se `developers.facebook.com/apps/` rimanda alla home con "Get Started", registrare l'account come sviluppatore (accettazione termini + verifica telefono/e-mail, a cura del titolare dell'account).
3. **App Meta**: *Crea app* → caso d'uso **"Connettiti con i clienti tramite WhatsApp"** → portfolio **Lepefy** (non verificato: sufficiente per il numero di test) → *Crea app* (richiede di reinserire la password). Meta **rifiuta "WhatsApp" nel nome dell'app** (marchio): nome usato *Lepefy Messaging Platform*.
4. **Numero di test**: *Casi d'uso › Personalizza › Passaggio 1. Prova* → *Continua* (accetta Condizioni WhatsApp Business + hosting Cloud API). Meta crea la WABA di test e il numero di test e mostra Phone Number ID e WABA ID.
5. **Destinatari**: stesso pannello › *Destinatario › Gestisci elenco di numeri di telefono* → aggiungere fino a 5 numeri; Meta invia un codice a 5 cifre **su WhatsApp** al numero, inserito dal titolare.
6. **Token**: *Genera token* apre un popup di consenso su account/WABA; solo dopo il consenso il token può inviare. Per un uso continuativo: System User del portfolio con `whatsapp_business_messaging` + `whatsapp_business_management` (vedi §9).
7. **Vercel `lepefy-food-test`** (Production): segreti `META_WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET` (*Impostazioni app › Di base › Chiave segreta*), `META_WHATSAPP_SYSTEM_USER_TOKEN`, `WHATSAPP_INTERNAL_SECRET`; config `META_WHATSAPP_API_VERSION`, `WHATSAPP_TEST_RECIPIENTS`, `WHATSAPP_PROCESSING_MODE=inline`. **Redeploy**. Controllo senza segreti: GET del webhook con un token sbagliato → **403** (era 503 senza configurazione); POST senza firma → **401**.
8. **Webhook**: §12 (verifica, campo `messages`, `subscribed_apps`, app pubblicata).
9. **Flag**: `/admin/parametres/fonctionnalites` su `lepefy-test` → *WhatsApp Business* attivato (cache 30 s).
10. **Canale**: `/admin/canaux/whatsapp` › Connexion Meta (solo platform owner): environnement *Test*, statut *En test*, WABA ID, Phone Number ID, numero visualizzato, nome; variabile token vuota. Il 7/10 l'account admin connesso non era platform owner: la riga è stata creata via service role con evento `whatsapp_audit_events` (`channel_created`).
11. **Prima conversazione**: il numero di test **non è ricercabile** su WhatsApp. Inviare prima un template (*Passaggio 1. Prova › Invia messaggio*, template "Ciao mondo"/`hello_world`) al destinatario, poi rispondere in quella chat.
12. **Inbound in test**: con statut *En test* il messaggio è salvato con `processing_result = channel_not_active` (nessuna risposta).
13. **Automazione**: statut *Actif* + Réponses automatiques ON (Nala OFF per il primo collaudo). Provare: "Ciao"/"Bonjour", "Vous livrez à domicile ?", poi "Quels sont vos horaires ?", "Avez-vous du manioc ?", "Où en est ma commande ?", "Je veux parler à un conseiller".
14. **Handoff**: dall'inbox rispondere come operatore, verificare la pausa, poi "Rendre à l'automatisation" (non ancora collaudato, vedi §11.1).

### 11.1 Ambiente di test attuale ed esiti (7 ottobre 2026)

Identificativi (non segreti):

| Elemento | Valore |
|---|---|
| Business Portfolio | Lepefy — `4931233883595900` (non verificato) |
| App Meta | Lepefy Messaging Platform — App ID `1806050800594885`, **pubblicata** (Live), unico caso d'uso WhatsApp |
| WABA di test | `2200021060719675` |
| Numero di test | +1 555 639 2192 — Phone Number ID `1367677619765571` |
| Destinatari autorizzati | 2 numeri interni (in Meta e in `WHATSAPP_TEST_RECIPIENTS`) |
| Webhook | `https://test.lepefy.com/api/integrations/whatsapp/webhook`, verificato; campo `messages` (v26.0); app iscritta alla WABA |
| Canale Lepefy | `lepefy-test`, canale `e08aaece-c08e-4172-a223-3067827612c5`, *Test*, *Actif*, automazione ON, Nala OFF, handoff ON |

| Test | Esito |
|---|---|
| Verifica webhook (GET) | PASS |
| Firma `X-Hub-Signature-256` | PASS (evento di prova Meta → 200; senza firma → 401) |
| Risoluzione tenant | PASS (`phone_number_id` reale → `lepefy-test`; ID di esempio `123456123` → `unknown_phone_number_id`) |
| Inbound + persistenza | PASS (conversazione unica, `wamid` salvato, un messaggio per evento) |
| Outbound | PASS (template dalla console; risposte Lepefy `sent → delivered → read` tramite webhook di stato) |
| Risposta automatica | PASS (`rule:greeting`, `rule:shipping`, ~4 s) |
| Errore provider | PASS (token senza accesso → messaggio `failed` `131005`, nessun crash) |
| Idempotenza | non provocata in reale; coperta da indice unico + test SQL CI |
| Handoff, Nala, stato ordine | non ancora collaudati sul numero di test |

## 12. Configurare il webhook Meta

1. App Dashboard › WhatsApp › Configuration › Webhook › *Edit*:
   - Callback URL: `https://<deployment-hub>/api/integrations/whatsapp/webhook` (mostrato nel pannello Connexion Meta);
   - Verify token: il valore di `META_WHATSAPP_VERIFY_TOKEN`.
   Meta invia `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`; la route risponde con il challenge (403 se token errato, 503 se non configurato).
   Nella UI attuale il blocco si trova in *Casi d'uso › Personalizza › Passaggio 2. Configurazione di produzione › Configura webhook*.
2. *Campi del webhook*: sottoscrivere **solo `messages`** (messaggi in arrivo + stati sent/delivered/read/failed). Il pulsante *Test* della riga invia un evento di esempio con `phone_number_id` fittizio: atteso **200** e log `unknown_phone_number_id` (prova connettività + firma).
3. **Iscrivere l'app alla WABA** — obbligatorio: senza, il webhook è verificato ma **nessun evento reale arriva** (né messaggi né stati). Con un token valido:
   ```text
   POST https://graph.facebook.com/<versione>/<WABA_ID>/subscribed_apps   (Authorization: Bearer <token>)
   GET  https://graph.facebook.com/<versione>/<WABA_ID>/subscribed_apps   → l'app deve comparire
   ```
4. **App pubblicata (Live)**: un'app non pubblicata riceve solo i webhook di prova della dashboard. Requisiti soddisfatti il 7/10: URL privacy policy (`/politique-confidentialite`), istruzioni di cancellazione dati (`/supprimer-compte`), categoria *Messaggistica*. Nessuna verifica aziendale richiesta per i permessi standard.
5. Controllo: un messaggio reale produce nei log Vercel `[whatsapp] webhook_received` → `tenant_resolved` → `message_ingested`.

## 13. Onboarding di un nuovo tenant

1. Contratto/requisiti Meta del tenant (Business verificato, nome visualizzato approvato, politica commerce).
2. Onboarding del numero nella WABA (oggi manuale con l'équipe Lepefy; Embedded Signup previsto più avanti, vedi §16).
3. Assegnare la WABA del tenant al System User della piattaforma (o creare un token dedicato → `META_WHATSAPP_<TENANT>_TOKEN` + `access_token_env`).
4. Iscrivere l'app alla WABA (`subscribed_apps`).
5. Attivare il flag `whatsapp_business` sul tenant; creare il canale (`Production`, `En test`).
6. Test inbound/outbound/handoff su numeri interni; poi `Actif` + automazioni.
7. Aggiornare questo documento se cambia un passaggio.

## 14. Onboarding Chloe Food (futuro — NON eseguito)

Nessuna azione automatica. Il WhatsApp Business attualmente usato dal tenant non deve essere messo a rischio.

1. **Requisiti Meta**: Business Manager verificato, nome visualizzato, numero idoneo, accettazione termini WhatsApp Business.
2. **Coexistence**: verificare se il numero può usare *WhatsApp Business App coexistence* (stesso numero nell'app Business e in Cloud API) — disponibilità per paese/versione app, limiti (es. funzioni dell'app non supportate, storico sincronizzato). In alternativa valutare un numero dedicato. Decisione documentata prima di procedere.
3. **Backup/verifiche operative**: backup chat dell'app Business, elenco automazioni/etichette attuali, finestra di intervento concordata, piano di ritorno.
4. **Onboarding del numero** (Embedded Signup coexistence o migrazione) eseguito con il tenant presente.
5. **Associazione WABA** e assegnazione al System User.
6. Annotare **phone_number_id** e WABA ID.
7. **Canale Lepefy**: `Production`, statut *En test*, flag attivo, automazioni spente.
8. **Webhook**: iscrizione dell'app alla WABA del tenant.
9. **Test inbound** da un numero interno: conversazione visibile, nessuna risposta automatica.
10. **Test outbound** dall'inbox (entro 24 h).
11. **Test handoff**: presa in carico, ripresa, chiusura.
12. **Attivazione automazioni** progressiva: prima solo regole deterministiche, poi Nala; monitorare log e inbox per alcuni giorni.

Checklist produzione prima del punto 12:

- [x] migration 147 applicata (7/10/2026; resta da eseguire la verifica completa di grant/RLS lato produzione);
- [ ] token **permanente** System User al posto del token temporaneo;
- [ ] gestione dei clienti con username WhatsApp (messaggi senza numero di telefono, vedi §16);
- [ ] account platform owner per la configurazione dei canali dall'admin (non via service role);
- [ ] `META_APP_SECRET`, `META_WHATSAPP_VERIFY_TOKEN`, `META_WHATSAPP_SYSTEM_USER_TOKEN` (permanente), `WHATSAPP_INTERNAL_SECRET` su Vercel produzione;
- [ ] `WHATSAPP_PROCESSING_MODE=n8n` + workflow n8n importati, credenziali, Error Workflow, attivati;
- [ ] sweep di manutenzione attivo (prima di qualsiasi traffico reale);
- [x] numero di test verificato end-to-end su `lepefy-test` (inbound, persistenza, regole, outbound, stati — §11.1);
- [ ] handoff, Nala e stato ordine collaudati sul numero di test;
- [ ] `tenants.storefront_url` del tenant corretto (link catalogo/portale);
- [ ] orari e indirizzo di ritiro compilati (Paramètres › Retrait), modalità di spedizione corretta;
- [ ] clienti con telefono E.164 (`customers.normalized_phone`) per lo stato ordine;
- [ ] équipe formata sull'inbox e sulla pausa dell'automazione;
- [ ] informativa privacy del tenant aggiornata (canale WhatsApp, finalità, retention).

## 15. Privacy, sicurezza, retention

- **Minimizzazione**: nessun payload grezzo; posizione e contatti condivisi ridotti a un marcatore; media non scaricati (solo `media_id`/MIME).
- **Retention**: contenuto messaggi 180 giorni, conversazioni inattive 365 giorni (`purge_expired_whatsapp_data`, notturno). Cancellazione su richiesta: `DELETE /api/admin/whatsapp/conversations/[id]` (cascade messaggi/handoff/audit della conversazione).
- **Log**: `[whatsapp] <evento>` con soli UUID, codici e contatori — mai corpo, numero cliente, nome, token, payload.
- **Divulgazione ordini**: solo al titolare verificato (numero WhatsApp = telefono cliente univoco nel tenant), dati minimi del portale, nessun indirizzo/prezzo/pagamento.
- **Tenant di test**: nessun invio verso numeri fuori `WHATSAPP_TEST_RECIPIENTS` (anche le conferme di lettura).
- **Webhook**: firma HMAC obbligatoria, confronto a tempo costante, corpo ≤ 1 MB, `phone_number_id` sconosciuto ignorato (200, loggato).

## 16. Non ancora attivato / evoluzioni

- Stato: migration 147 applicata; flag attivo solo su `lepefy-test`; un solo canale (numero di test Meta); token temporaneo; modalità `inline`; workflow n8n non importati (nessuno sweep di manutenzione attivo).
- **Username WhatsApp (BSUID)**: Meta introduce gli username; per un cliente che li ha attivati i webhook possono arrivare **senza numero di telefono** (identificativo utente al posto di `from`/`wa_id`; la console di test mostra lo "Scenario nome utente"). `webhookPayload.ts` oggi scarta un messaggio senza `from` numerico e lo schema richiede `wa_id`/`customer_phone`: da gestire (identificativo cliente generico + invio tramite l'ID utente) prima della produzione.
- Template message (fuori finestra 24 h), media in uscita nell'inbox, notifiche push/email all'équipe su handoff, Meta Embedded Signup, analytics Nala per il canale, migrazione del widget storefront su `runNalaChannelTurn`, inbox omnicanale (Instagram DM, Messenger, web chat, email).

## 17. Troubleshooting

| Sintomo | Causa probabile | Verifica |
|---|---|---|
| Meta: "The callback URL or verify token couldn't be validated" | `META_WHATSAPP_VERIFY_TOKEN` diverso o assente (503) | log `webhook_rejected` `method: GET` |
| Nessun evento in Lepefy (il *Test* della dashboard invece arriva) | app **non iscritta alla WABA** o app **non pubblicata** | `GET /{WABA_ID}/subscribed_apps`; *Pubblicazione* = Pubblicata (§12) |
| Nessun evento, nemmeno il *Test* | campo `messages` non sottoscritto, firma errata | log `webhook_rejected reason: invalid_signature` → `META_APP_SECRET` |
| Numero di test "non registrato su WhatsApp" | il numero di test non è ricercabile | inviare prima un template dalla console, poi rispondere (§11 punto 11) |
| Invio fallito `131005 Access denied` | token senza accesso alla WABA (generato prima del consenso, o di un'altra app) | rigenerare il token dopo il consenso / token System User con la WABA assegnata, poi redeploy |
| GET webhook 503 / POST 503 | segreti assenti sul deployment | variabili Vercel + redeploy (atteso poi 403 / 401 senza credenziali valide) |
| `unknown_phone_number_id` | canale non creato o `phone_number_id` errato | pannello Connexion Meta |
| Messaggi salvati, nessuna risposta | canale `En test`, automazione OFF, flag OFF, conversazione in pausa, tenant sospeso | `processing_result` del messaggio (`channel_not_active`, `automation_disabled`, `automation_paused`, `tenant_suspended`) |
| Messaggi bloccati `pending` | dispatch n8n fallito e sweep non attivo | workflow manutenzione |
| Invio fallito `131030` | destinatario non autorizzato sul numero di test | lista destinatari Meta + `WHATSAPP_TEST_RECIPIENTS` |
| Invio fallito `131047` / "Plus de 24 h" | fuori finestra di servizio | serve un template (non implementato) |
| `auth` / `190` | token scaduto o senza permessi | rigenerare il token System User |
| `test_blocked` | tenant di test, numero non in allow-list | `WHATSAPP_TEST_RECIPIENTS` |
| Stato ordine "commande introuvable" | telefono cliente non E.164 o duplicato, ordine non pagato | `customers.normalized_phone` |
