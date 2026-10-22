# Assistance & suggestions (Smart Assistance & Feedback Hub)

> Stato: codice su `main` dal commit `6fc23843` (base `a87e2d0e`, 22/10/2026). Migration `163_support_assistance.sql` **applicata in produzione il 22/10/2026** (verificata in sola lettura: 6 tabelle + vista, bucket privato 5 Mo JPEG/PNG/WebP, `support.use` a platform_owner/tenant_admin, 6 tipi audit, policy IA `support` attiva (timeout ≤ 12 s), RPC eseguibili dal service role, `anon` rifiutato su tabelle e RPC, update diretto del service role rifiutato, nessun flag acceso). Flag `support_assistance` spento ovunque: prossimo passo §10.3 (Lepefy Test).
> Proposta approvata: artifact «Lepefy Assistance» (mockup PRE/POST e specifica).

Obiettivo: segnalare un problema, chiedere una modifica o fare una domanda **più velocemente che su WhatsApp** e seguire la risposta senza uscire dall'admin. Non è un helpdesk per sviluppatori: una sola informazione obbligatoria (il testo), tutto il resto è facoltativo o automatico.

## 1. Architettura

```text
Admin boutique (ogni pagina)                         Console Lepefy (/admin/platform/assistance)
  Header « Assistance » ─┐                              lista server (vista support_ticket_queue)
  Menu Administration ───┼─> SupportProvider ──> Drawer  dettaglio: conversazione + note interne + pannelli
  Palette « Contacter » ─┘    (SupportComposer)          saisie manuelle WhatsApp / téléphone / e-mail
  ErrorState « Signaler »                                     │
            │                                                │
  /api/admin/assistance/**  (support.use + flag)    /api/admin/platform/assistance/** (requirePlatformOwner)
            │                                                │
            └──────── RPC security definer migration 163 ────┘
                         │                │
               tabelle support_* (RLS forzata, nessun accesso browser)
               bucket privato support-attachments (URL firmati 60 s)
                         │
      notifiche: dispatcher interno (support_reply) · e-mail Lepefy facoltativa · Journal d'activité (modulo support, platform-only)
```

- **Tenant**: sempre `getTenant()` lato server (deployment), mai dal browser. Ogni API boutique chiama `supportTenantApi()` (`lib/support/server/access.ts`): `requirePermission(tenant, 'support.use')` (auth, tenant, sospensione), poi flag, poi contesto admin. Le scritture rifiutano il platform owner (nessun messaggio Lepefy attribuito alla boutique).
- **Console**: `supportPlatformApi()` = `requirePlatformOwner()` + attore registrato per l'audit. Le route `/api/admin/platform/assistance/**` sono assenti dalla mappa capability (come le altre route piattaforma).
- **Letture boutique solo tramite RPC di proiezione**: `support_tenant_ticket_page`, `support_tenant_thread`, `support_tenant_unread_count`, `support_similar_tickets`. Non restituiscono mai note interne, allegati interni, eventi privati, priorità, assegnatario o link GitHub. Un test unitario vieta `.from('support_…')` nel servizio boutique.
- **Scritture solo tramite RPC** (atomiche, idempotenti, con le regole di stato in SQL). Il service role ha solo `SELECT` sulle tabelle (più `INSERT/DELETE` sugli allegati in attesa).
- Nessun WebSocket: la conversazione si aggiorna ogni 45 s quando la scheda è visibile e al ritorno sulla scheda.

## 2. Modello dati (migration 163)

| Tabella | Contenuto |
|---|---|
| `support_tickets` | numero leggibile (identity da 1001, « n° 1042 »), tenant, origine (`tenant_app`/`platform_manual`), `source_channel` (`app`/`whatsapp`/`phone`/`email`/`internal`), `external_reference`, richiedente (admin o etichetta), titolo derivato, `summary` (600 car.), categoria, stato, priorità, `declared_urgent`, assegnatario, `visible_to_tenant`, `context` jsonb (≤ 2 000 byte), risorsa verificata, fusione, feedback boutique, `client_key`, timestamp (creazione, attività, ultimo messaggio boutique, ultima risposta Lepefy, ultimo aggiornamento pubblico, prima risposta, risoluzione, chiusura, riapertura + contatore), `search_document` tsvector francese |
| `support_messages` | autore `tenant`/`lepefy`, `kind` `message`/`internal_note` (nota solo Lepefy, CHECK), `relayed_from` + `original_sent_at` per i messaggi ricevuti altrove e **saisis par Lepefy** (CHECK: solo autore Lepefy), `client_key` unico per richiesta |
| `support_attachments` | percorso privato `<tenant>/<uuid>.<ext>`, MIME verificato sui byte, ≤ 5 Mo, dimensioni dall'header, `internal` (allegato di nota), « in attesa » finché il messaggio non è salvato |
| `support_events` | storico (`created`, `imported`, `status_changed`, `priority_changed`, `assigned`, `category_changed`, `visibility_changed`, `title_changed`, `merged_into/from`, `link_added/removed`, `tenant_feedback`, `reopened`) con `public` (mostrato alla boutique o no) |
| `support_read_states` | lettura per admin e per richiesta (`side` tenant/lepefy): niente booleano globale |
| `support_links` | issue / PR / commit / release GitHub, URL verificato da CHECK, mai esposto alla boutique |

Riapertura = una demande terminée (`resolved`/`closed`) che torna verso uno stato aperto (Lepefy « Rouvrir », messaggio o avis « non risolto » della boutique): evento `reopened`, `reopen_count` +1, `resolved_at` azzerato. `resolved → closed` è un semplice `status_changed` che conserva `resolved_at` (migration 164: in 163 era registrato come riapertura; la 164 ripara gli eventi e i contatori delle demandes toccate, es. n° 1001).

Tutte le FK interne sono composite `(tenant_id, id)`: un messaggio, un allegato o un evento non può puntare alla richiesta di un altro tenant.

Vista `support_ticket_queue` (`security_invoker`, solo service role): ticket + nome boutique + `awaiting_lepefy` (aperta, non in attesa della boutique, ultimo messaggio boutique più recente dell'ultima risposta) + `stale` (in attesa da più di 24 h) + `attention_rank` (0 urgente da rispondere · 1 nuova · 2 senza risposta > 24 h · 3 da rispondere · 4 in lavorazione · 5 attesa boutique · 6 terminata).

## 3. Workflow

| Stato interno | La boutique vede | Transizioni Lepefy (`support_transition_allowed`) | Automatiche |
|---|---|---|---|
| `new` | Envoyée | → triaged, planned, in_progress, waiting_tenant, resolved, closed | prima risposta → `triaged` |
| `triaged`, `planned`, `in_progress` | En cours | tra loro, → waiting_tenant, resolved, closed | — |
| `waiting_tenant` | Nous attendons votre réponse | → triaged, in_progress, resolved, closed | messaggio boutique → `in_progress` |
| `resolved` | Terminée + « Est-ce que le problème est résolu ? » | → closed, in_progress (riapertura) | « Oui, merci » → `closed`; « Non » o nuovo messaggio → `in_progress` (riapertura) |
| `closed` | Terminée | → triaged (riapertura) | la boutique apre una nuova richiesta |

- Mirror TS: `lib/support/rules.ts` (`SUPPORT_TRANSITIONS`, `tenantStatus`), parità verificata da `tests/unit/supportAssistance.spec.ts` sul testo della migration.
- `support_set_status` accetta `p_expected_status`: due operatori sulla stessa richiesta ricevono `support_status_conflict` invece di sovrascriversi.
- « C'est urgent » alza la priorità a `high`, mai a `critical`; Lepefy la corregge.
- Una PR fusa **non** chiude la richiesta: la si marca risolta quando il correttivo è in produzione, poi la boutique conferma.
- Fusione (`support_merge_ticket`): stessa boutique, la sorgente diventa `closed` con `merged_into_ticket_id`; entrambi gli storici portano l'evento; la boutique vede « regroupée avec n° X ».

## 4. API

Boutique (`support.use` in `adminApiPermissions.ts`, flag verificato da `supportTenantApi`):

| Metodo e percorso | Uso |
|---|---|
| `POST /api/admin/assistance/tickets` | nuova richiesta: `text`, `category?`, `urgent?`, `pathname`/`includePage`/`pageLabel`, `locale`, `viewport`, `attachmentIds`, `clientKey` |
| `GET /api/admin/assistance/tickets/[id]` | conversazione (proiezione pubblica), per l'aggiornamento periodico |
| `POST …/tickets/[id]/messages` | messaggio successivo (stesso `clientKey` al retry) |
| `POST …/tickets/[id]/read` | letto per questo admin (no-op per il platform owner in anteprima) |
| `POST …/tickets/[id]/feedback` | `{ solved }` |
| `GET /api/admin/assistance/similar?q=` | richieste aperte simili **della stessa boutique** |
| `GET/POST /api/admin/assistance/improve` | disponibilità / suggerimento IA |
| `POST /api/admin/assistance/attachments`, `GET/DELETE …/[id]` | caricamento, lettura (redirect 60 s), rimozione prima dell'invio |

Console (`requirePlatformOwner`): `POST /api/admin/platform/assistance/tickets` (saisie manuelle), `GET/PATCH …/tickets/[id]` (stato, priorità, assegnatario, categoria, titolo, visibilità), `POST …/messages` (`kind` `message`/`internal_note`, `waitForTenant`), `POST …/merge`, `POST/DELETE …/links`, `POST …/read`, `POST /api/admin/platform/assistance/attachments` (`tenantId` nel form), `GET/DELETE …/attachments/[id]`.

Errori: le RPC sollevano `support_<codice>`, tradotti in francese da `lib/support/errors.ts`; qualsiasi altro errore diventa un messaggio generico (nessun dettaglio interno al browser).

## 5. Contesto acquisito

`buildSupportContext` (`lib/support/rules.ts`): nome della pagina (registro di navigazione), **pattern** della route con gli id mascherati (`/admin/orders/[id]`), lingua, tipo di dispositivo + OS + browser (mai lo user agent grezzo), dimensione dello schermo, versione (`VERCEL_GIT_COMMIT_SHA` a 7 caratteri). Mai query string, hash, token, contenuto di pagina, dati di pagamento.

Risorsa: dedotta da `/admin/orders|catalogue|clients/<uuid>`, conservata solo se appartiene al tenant **e** l'admin può aprirla (`orders.view`, `catalog.view`, `customers.view`); etichetta « Commande #3F2A91BC », « Produit … », « Fiche client » (mai il nome del cliente). La boutique può cambiare la pagina o rimuoverla dal pannello.

## 6. UX

- **Ingresso**: pulsante « Assistance » nella barra admin (icona sola su telefono, pallino blu se una risposta non è letta), voce « Assistance » nel gruppo Administration con contatore, azione della palette « Contacter l'assistance Lepefy » (`/admin/assistance?nouvelle=1`), link « Signaler ce problème à Lepefy » sotto ogni `ErrorState` (mai popup né modale automatica). Nessun FAB.
- **Pannello** (`SupportComposer`, Drawer: laterale su desktop, schermo intero su telefono): « Comment pouvons-nous vous aider ? », tre scelte facoltative, campo « Expliquez-nous ce qui se passe… », captures (bottone galleria/fotocamera, incolla, trascina), « Page concernée : … » con Changer / ✕, « C'est urgent », « Améliorer mon message » se l'IA è disponibile, « Vous avez déjà une demande similaire » con « Voir la conversation ». Conferma « Votre demande a bien été envoyée. » con il numero, che resta finché non la si chiude.
- **Bozza**: solo il testo, la categoria e l'urgenza, in `localStorage` sul dispositivo per 24 h, cancellata all'invio (le immagini no).
- **Dettatura vocale**: non aggiunta. Web Speech API non è affidabile su tutti i browser (assente su Firefox, invio audio a terzi su Chrome); il pannello suggerisce il microfono della tastiera del telefono. Evoluzione possibile documentata al §11.
- **« Mes demandes »** (`/admin/assistance`): nuove risposte in testa, poi « En cours »; scheda « Terminées »; ricerca (parola o numero); card leggibili, nessuna tabella; stato vuoto « Vous n'avez aucune demande en cours. ».
- **Conversazione** (`/admin/assistance/[id]`): messaggi della boutique a destra, Équipe Lepefy a sinistra, cambi di stato al centro, separatore « Nouveau », immagini in linea (dimensioni riservate), invio confermato solo dopo il salvataggio (testo conservato e « Réessayer » con la stessa chiave), richiesta risolta → « Est-ce que le problème est résolu ? » con « Oui, merci » / « Non, j'ai encore un problème » (il campo messaggio si apre con « Écrire un message »).
- **Console**: KPI-filtro (À répondre, Nouvelles, Urgentes, Sans réponse > 24 h, En attente boutique, Résolues 30 j), FilterBar (boutique, statut, catégorie, priorité, assignée, période, ricerca n°/testo/boutique/contatto), ordinamento « Besoin d'intervention », DataTable con card mobile e banda di tono, contatore in navigazione piattaforma. Dettaglio: conversazione + note interne (gialle tratteggiate, lucchetto), composer « Répondre à la boutique » / « Note interne » con « J'attends une réponse de la boutique », pannelli richiudibili Traitement, Contexte, Dates, GitHub, Doublon.
- **Saisie manuelle** (`/admin/platform/assistance/nouvelle`): boutique, canale, messaggio incollato (data e mittente della prima riga WhatsApp ripresi), titolo facoltativo, contatto, data originale, tipo, priorità, riferimento esterno, captures, « Visible tout de suite par la boutique ».

## 7. Notifiche (infrastruttura esistente)

| Evento | Destinatari | Canale |
|---|---|---|
| Risposta Lepefy, attesa della boutique, richiesta risolta | abbonati al tipo `support_reply` (catalogo notifiche, gruppo Compte, default attivo per i nuovi destinatari, visibile solo con il flag) + il richiedente se non è già abbonato | `dispatchTenantNotification` (evento + ledger `notification_deliveries` + retry dello scheduler, e-mail e WhatsApp staff se `staff_whatsapp_notifications`) + `sendTenantEmail` per il richiedente |
| Nuova richiesta, nuovo messaggio boutique, riapertura | Lepefy: `SUPPORT_NOTIFY_EMAILS` (facoltativa, max 10 indirizzi separati da virgola) | e-mail `send-email` senza ledger del tenant (gli indirizzi Lepefy non compaiono nello storico della boutique) |

- Antiraffica: una notifica per richiesta e per finestra di 15 minuti (`notificationWindow`, chiave d'idempotenza).
- Le e-mail non contengono mai il testo dei messaggi (solo numero, titolo, stato e link).
- Il salvataggio non dipende mai dalle notifiche: `notify*` non solleva eccezioni.
- Interno piattaforma: contatore « Assistance tenants » nella navigazione e KPI della console. WhatsApp verso Lepefy non attivato (§11).

## 8. Sicurezza e limiti

- RLS forzata senza policy su tutte le tabelle, `revoke all` da `anon`, `authenticated` **e** `service_role` (privilegi di default Supabase), poi solo `SELECT`; RPC eseguibili solo da `service_role`.
- IDOR: ogni RPC boutique confronta il tenant passato dal server con quello della richiesta (`support_ticket_not_found` altrimenti); test SQL negativi cross-tenant su messaggio, lettura, stato di lettura, feedback, allegati, fusione, similarità.
- Allegati: tipo dai magic bytes (JPEG/PNG/WebP; SVG/HTML rifiutati), ≤ 5 Mo (riduzione automatica sul dispositivo oltre 3,5 Mo), 5 per messaggio, 30 caricamenti/ora/admin, solo i propri file in attesa da meno di 24 h dello stesso tenant possono essere allegati, lettura tramite route autorizzata → URL firmato 60 s (`Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`).
- Testo: caratteri di controllo e di direzione rimossi, 5 000 caratteri, reso sempre come testo (nessun `dangerouslySetInnerHTML` nel modulo, verificato da test).
- Antispam: 10 nuove richieste/ora/admin, 30 messaggi/10 min/admin (in SQL), idempotenza `client_key` su richieste e messaggi.
- Note interne: mai nelle RPC boutique, mai nelle notifiche, mai nel Journal visibile alla boutique (modulo `support` `platformOnly`), mai nella ricerca boutique (verificato da test SQL).
- IA: policy `support/structured_chat` (stessa catena di modelli di Nala, timeout ≤ 12 s), quota giornaliera admin del tenant (`check_ai_rate_limit`), il suggerimento viene scartato se aggiunge o perde un numero; nessun invio senza scelta esplicita; senza IA il pannello funziona e il pulsante non appare.

## 9. Feature flag e attivazione

- Flag `support_assistance` (`tenant_feature_flags`, `platformOnly`): riga assente = modulo invisibile e API 404. Nessuna condizione su un tenant specifico nel codice.
- Capability `support.use` (migration 163): `platform_owner` e `tenant_admin`; i ruoli custom la ricevono da `/admin/platform/access`; il cassiere no.
- Tenant sospeso: le scritture sono bloccate da `requirePermission` (423) come per gli altri moduli; renderle possibili in sospensione è una decisione sull'abbonamento non presa qui.

## 10. Runbook

1. **Applicare la 163** (dopo approvazione): SQL Editor Supabase o `supabase db push`. È additiva, rieseguibile, con rollback in fondo al file. Verifica rapida:
   ```sql
   select count(*) from information_schema.tables where table_name like 'support_%';        -- 6
   select public from storage.buckets where id = 'support-attachments';                      -- false
   select key from admin_permissions where key = 'support.use';                              -- 1 riga
   select count(*) from audit_event_types where module = 'support';                          -- 6
   select consumer from ai_routing_policies where consumer = 'support';                      -- 1 riga
   ```
2. Facoltativo: `SUPPORT_NOTIFY_EMAILS` sul progetto Vercel (e-mail Lepefy).
3. Accendere il flag su **Lepefy Test** (da platform owner: `/admin/parametres/fonctionnalites` sul deployment `test.lepefy.com`, oppure `insert into tenant_feature_flags (tenant_id, flag_key, enabled) values ('<id lepefy-test>', 'support_assistance', true)`), provare: richiesta con cattura dal telefono, risposta, nota interna, risoluzione, « Non », saisie manuelle WhatsApp.
4. Poi su **ChloeFood** con la stessa procedura. Nessun deploy separato.
5. Spegnere: flag a `false` (i dati restano; nessuna perdita).

**Conservazione**: allegati e messaggi restano finché esiste la richiesta (cancellazione del tenant = `on delete cascade` sulle righe; i file del bucket vanno rimossi dal dashboard Storage, cartella `<tenant_id>/`). Un caricamento mai inviato non è allegabile dopo 24 h; pulizia manuale:
```sql
select storage_path from support_attachments where message_id is null and created_at < now() - interval '7 days';
-- rimuovere i file dal bucket, poi:
delete from support_attachments where message_id is null and created_at < now() - interval '7 days';
```

**Troubleshooting**
- Console « Demandes indisponibles »: migration 163 non applicata.
- Pulsante « Assistance » assente: flag spento, oppure admin senza `support.use`, oppure account Lepefy (vede l'anteprima in sola lettura).
- « Améliorer mon message » assente: policy IA `support` disattivata o chiave del provider mancante (`GET /api/admin/assistance/improve` → `available: false`).
- Nessuna e-mail alla boutique: nessun abbonato a `support_reply` e richiedente senza e-mail attiva; storico in Console → Notifications → Historique.

## 11. Limiti noti ed evoluzioni

- Nessuna chiusura automatica delle richieste `resolved` senza risposta (da schedulare con n8n se utile).
- Nessuna purga automatica degli allegati non inviati (query del §10).
- WhatsApp: modello pronto (`source_channel`, `external_reference`, `relayed_from`), nessuna sincronizzazione; un'integrazione futura deve seguire `docs/WHATSAPP_BUSINESS_PLATFORM.md` e non leggere conversazioni private.
- GitHub: link verificati; nessuna creazione automatica di issue (richiederebbe un token e un'app GitHub).
- Dettatura: valutare Web Speech solo dietro rilevamento affidabile, senza API di trascrizione a pagamento.
- Notifica WhatsApp verso Lepefy: possibile tramite il dispatcher con un destinatario piattaforma dedicato.
- Similarità: testo integrale francese (lessemi in comune); embeddings solo se una misura mostra il bisogno.

## 12. Mappa dei file

```text
supabase/migrations/163_support_assistance.sql        schema, RLS, bucket, RPC, vista coda, capability, audit, policy IA
supabase/tests/163_support_assistance.{fixture,test}.sql
supabase/migrations/164_support_close_is_not_reopen.sql  resolved → closed non è una riapertura + riparazione dati
supabase/tests/164_support_close_is_not_reopen.{fixture,test}.sql
apps/storefront/src/lib/support/
  domain.ts  rules.ts  files.ts  errors.ts  types.ts  platformList.ts
  server/access.ts  tenantService.ts  platformService.ts  attachments.ts  notify.ts  improve.ts  input.ts
apps/storefront/src/app/admin/_components/support/     SupportProvider, SupportComposer, SupportHeaderButton (+ SupportHint, SupportOpenButton),
                                                        ThreadComposer, AttachmentStrip, SupportImage, useSupportUploads, supportClient
apps/storefront/src/app/admin/(protected)/assistance/  page.tsx (Mes demandes), [id]/ (conversazione), SupportAutoOpen
apps/storefront/src/app/admin/(protected)/platform/assistance/  page.tsx (console), [id]/, nouvelle/
apps/storefront/src/app/api/admin/assistance/**        API boutique
apps/storefront/src/app/api/admin/platform/assistance/**  API console
apps/storefront/tests/unit/supportAssistance.spec.ts
```
