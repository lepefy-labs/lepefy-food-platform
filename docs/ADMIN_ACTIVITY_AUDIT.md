# Journal d'activité — audit centralizzato multi-tenant

> **Stato:** implementato; migration `153_admin_activity_audit.sql` **applicata il 10/10/2026**, script di verifica OK (§13.1–13.2). Da confermare: attribuzione dell'autore su una modifica reale (§13.3). Accesso: solo platform owner; i tenant solo dopo l'attivazione del flag `activity_journal` da parte del platform owner.
> **Base codice verificata:** `main@72f06d0e3f69fd55bdbfc4cb2cf8b9ab72e86ce9` (10/10/2026).
> **Proposta approvata (audit, mockup PRE/POST, permessi, rischi):** artifact «Journal d'activité Lepefy».
> Il codice resta la fonte di verità; questo documento descrive lo stato corrente.

## 1. Architettura

```text
              scrittura                                         lettura
┌─────────────────────────────────────┐        ┌────────────────────────────────────────────┐
│ A. Trigger DB (stessa transazione)  │        │ audit_feed (vista, security_invoker)        │
│    orders · products · customers    │        │   = audit_events                            │
│    tenants · flags · settings ·     │──┐     │   ∪ adapter: business_audit_events,         │
│    payment methods · RBAC           │  │     │     whatsapp_audit_events,                  │
│ B. record_audit_event() in un'RPC   │──┼──►  │     assisted_order_events, review_moderation│
│ C. recordAuditEvent() (TS: export,  │  │     │     tenant_subscription_audit, ext. catalog,│
│    accesso privilegiato)            │──┘     │     event_capacity, notification failures,  │
└─────────────────────────────────────┘        │     admin_access_audit (< installazione)    │
          ▲ attore da header                   └──────────────┬─────────────────────────────┘
          │ x-lepefy-audit-* (service_role)                   │ RPC audit_feed_page/count/summary/actors
┌─────────┴───────────────────────────┐        ┌──────────────▼─────────────────────────────┐
│ middleware: x-request-id rigenerato │        │ lib/audit/feed.ts (server-only)            │
│ requirePermission: registra l'admin │        │   scope (permessi + flag) → filtri SQL     │
│ createServiceClient: header sulle   │        │   sanitizzazione → AuditEventView          │
│ scritture (requestContext.ts)       │        └──────────────┬─────────────────────────────┘
└─────────────────────────────────────┘          /admin/activite · ResourceActivity · API · CSV
```

- **Un registro, tre canali di scrittura.** I trigger coprono tutti i percorsi che modificano una riga (admin, azioni massive, webhook, RPC, worker) senza toccare la logica dei flussi. `record_audit_event` è l'unico punto d'inserimento (security definer); `recordAuditEvent` (TS) serve per gli eventi senza riga business (export, consultazione privilegiata).
- **Attore.** Il middleware rigenera `x-request-id` per `/admin/**` e `/api/admin/**` (mai preso dal client). `requirePermission()` registra l'admin verificato sotto quell'id (`lib/audit/requestContext.ts`, registro in memoria con TTL 60 s). Il client service role (`createServiceClient`) usa una `fetch` che, **solo per le scritture** (tabelle, più le RPC elencate in `AUDITED_WRITE_RPCS`), aggiunge `x-lepefy-audit-actor-type|id|label|ref|source|correlation-id`. PostgREST li espone in `request.headers`; `audit_request_context()` li crede solo se il JWT della richiesta è `service_role`. Le letture e le RPC di lettura delle pagine ISR non chiamano mai `headers()`: lo storefront resta statico.
- **Attore dedotto dalla riga, mai inventato.** Ordine creato: `created_by_admin_id` (admin), `order_origin = 'storefront'` (cliente, `actor_ref` = fonte di conferma, es. `stripe_webhook`), altrimenti l'attore della richiesta o `unknown`. Pagamento manuale: `payment_confirmed_by`. Il ruolo `platform_owner`/`admin` viene da `admin_users.role`, non dall'header. Worker: attore esplicito (`createServiceClient({ auditActor })`, es. sync spedizioni = `automation / shipping-sync`). SQL diretto (dashboard, migration, script): `unknown`, `source = 'sql'`.
- **Correlazione.** `correlation_id` = `x-request-id` (o `x-vercel-id`): un'azione massiva su 20 ordini produce 20 eventi con lo stesso id; il dettaglio offre «Voir les événements de la même action».

## 2. Decisioni tecniche e alternative scartate

| Decisione | Motivo | Alternative scartate |
|---|---|---|
| Trigger nella transazione business | L'evento esiste solo se la modifica è committata; copre sync, webhook e RPC senza modificarli | Chiamate TS dopo ogni update (non transazionali, facili da dimenticare: è il difetto di `admin_access_audit`) |
| Fail-open su ordini/pagamenti/prodotti/spedizioni/clienti/réglages moduli, fail-closed su RBAC/tenant/flag/metodi di pagamento | Il checkout e il webhook Stripe non devono mai fallire per il registro; un cambio di accesso senza traccia non è accettabile | Fail-closed ovunque (rischio sul checkout); fail-open ovunque (permessi non tracciati) |
| Adapter di lettura sulle fonti storiche | Nessuna copia, nessun backfill, le garanzie transazionali di Gestion/recensioni/abbonamenti restano dove sono | Proiezione con trigger (dual write), backfill massivo |
| Catalogo con FK + registro TS verificato da test | Nessuna stringa libera come contratto, crescita senza modifiche di schema | Enum Postgres (ALTER TYPE per ogni evento), stringhe libere |
| Allow-list di campi nei trigger | I segreti e le PII non entrano mai nel registro (default: valore non registrato) | Deny-list (un campo nuovo finirebbe in chiaro) |
| Niente FK su `tenant_id`/`actor_admin_id` | Il registro sopravvive alla cancellazione della riga; un `ON DELETE CASCADE` urterebbe l'append-only; schema pronto al partizionamento | FK con cascade |
| Paginazione offset (UI) + cursore (API, export, test) | Riuso del kit `Pagination`; ordinamento stabile `occurred_at, id`; offset massimo 5 000 | Solo cursore (perde «page N sur M» del kit) |
| Nessun transactional outbox | Nessun evento esce verso sistemi esterni; `audit_events` può fare da sorgente per un consumer futuro | Outbox + worker (infrastruttura senza consumatore) |
| Nessun partizionamento | Volume attuale modesto; da riconsiderare oltre ~20 M righe o 10 GB (§10) | Partizioni mensili subito |

## 3. Catalogo eventi

Fonte: `audit_event_types` (SQL) = `AUDIT_EVENT_TYPES` (`lib/audit/eventCatalog.ts`). Chiave `<modulo>.<risorsa>.<azione>`.

| Chiave | Categoria | Gravità | Trigger / fonte |
|---|---|---|---|
| `orders.order.created` | activity | info | INSERT `orders` |
| `orders.order.status_changed` | activity | info | `orders.status` |
| `orders.order.tracking_updated` | activity | info | `tracking_code`, `tracking_carrier`, `shipping_tracking_mode` |
| `orders.order.updated` | activity | info | `fulfillment_type`, importi (valori); `full_name`, `email`, `shipping_address`, `notes` (solo nome del campo) |
| `payments.payment.manually_confirmed` | activity | notice | `payment_confirmation_source` ∈ `admin_verified`/`admin_recorded` (insert o update) |
| `support.ticket.created`, `support.ticket.status_changed`, `support.ticket.priority_changed`, `support.ticket.assigned`, `support.ticket.linked` | activity | info | RPC Assistance della migration 163 (`audit_emit` fail-open, mai il testo dei messaggi); modulo `support` **platform-only** — `docs/SMART_ASSISTANCE.md` |
| `support.ticket.merged` | activity | notice | `support_merge_ticket` (163) |
| `payments.payment.status_changed` | activity | info | `orders.payment_status` |
| `shipping.shipment.draft_requested` · `draft_created` · `creation_failed` · `creation_ambiguous` · `draft_detached` | automation | info → critical | `orders.shipping_creation_status` |
| `shipping.shipment.status_changed` | automation | info/warning | `orders.shipping_normalized_status` (exception/returned/cancelled = échec) |
| `shipping.tracking.sync_failed` | automation | warning | `shipping_sync_error` da null a valorizzato |
| `catalog.product.created` · `deleted` · `price_updated` · `availability_changed` · `quantity_rule_changed` · `updated` | activity | info/notice | `products` |
| `catalog.product.stock_adjusted` | activity | info | `products.stock`, **solo** se l'attore è un admin (i decrementi del checkout restano negli ordini) |
| `customers.customer.created` · `updated` | activity | info | `customers`, solo se l'attore è un admin; solo nomi dei campi |
| `admin.settings.updated` | activity | notice | `tenants` (allow-list; segreti e testi lunghi senza valore) — fail-closed |
| `admin.feature_flag.changed` | activity | notice | `tenant_feature_flags` — fail-closed |
| `admin.module_settings.changed` | activity | notice | `tenant_feature_settings` (`enabled` + nomi delle chiavi di config) |
| `admin.payment_method.changed` | activity | notice | `tenant_payment_methods` (`value`/`extra` senza valore) — fail-closed |
| `security.permission.granted` · `revoked` | security | warning | `admin_role_permissions` (un evento per ruolo e istruzione) — fail-closed |
| `security.role.created` · `updated` | security | warning | `admin_roles` — fail-closed |
| `security.membership.created` · `updated` · `deleted` | security | warning | `admin_memberships` — fail-closed |
| `security.admin.created` · `updated` · `deactivated` · `reactivated` | security | notice/warning | `admin_users.active/role/tenant_id` — fail-closed |
| `audit.export.generated` | security | notice | export CSV (TS) |
| `audit.journal.cross_tenant_viewed` | security | notice | consultazione del platform owner (una per perimetro e giorno, `event_key`) |

Tipi degli adapter (non nel catalogo, etichette in `eventCatalog.ts`): `gestion.*`, `whatsapp.conversation.*`, `orders.preorder.*`, `reviews.review.*`, `billing.subscription.*`, `catalog.external_import.*`, `events.event.capacity_adjusted`, `notifications.delivery.failed|abandoned`, `security.legacy.*`.

## 4. Modello dati

- `audit_events`: `id`, `tenant_id` (null = evento di piattaforma), `event_type` (FK), `module`, `category`, `severity`, `outcome` (`success|failure|pending|unknown`), `actor_type` (`admin|platform_owner|customer|system|provider|automation|unknown`), `actor_admin_id`, `actor_label` (snapshot del nome, mai l'e-mail), `actor_ref` (route/job/provider), `resource_type|id|label`, `changes` (array `{field, before, after}` o `{field, redacted: true}`, ≤ 16 KB), `metadata` (oggetto, ≤ 4 KB), `correlation_id`, `event_key` (unico per tenant), `source` (`trigger|rpc|app|webhook|worker|sql`), `schema_version`, `retention_class`, `occurred_at`, `recorded_at`.
- Indici: `(tenant_id, occurred_at desc, id desc)`, `(tenant_id, resource_type, resource_id, occurred_at desc)`, `(tenant_id, actor_admin_id, occurred_at desc)`, parziale «attenzione» (`failure|unknown` o `warning|critical`), `correlation_id`, unico `(coalesce(tenant_id, 0…), event_key)`.
- `audit_event_types` (catalogo), `audit_write_failures` (fallimenti fail-open), `audit_settings` (singleton: `installed_at` = cutover di `admin_access_audit`, `retention`), vista `audit_volume_stats`.
- Riferimenti alla risorsa: `order`, `preorder`, `product`, `customer`, `supplier`, `purchase`, `payment`, `event`, `review`, `whatsapp_conversation`, `tenant`, `feature_flag`, `payment_method`, `module_settings`, `admin_role`, `admin_user` (link in `auditResourceHref`).

## 5. Affidabilità e idempotenza

- **Transazione:** trigger `AFTER` nella stessa transazione; rollback business ⇒ nessun evento (test SQL §3).
- **Fail-open:** `audit_emit(false, …)` apre un savepoint; in caso d'errore la modifica business passa, `audit_write_failures` registra tipo, SQLSTATE e messaggio (≤ 300), `RAISE WARNING`. Ogni trigger fail-open è inoltre avvolto in un blocco `EXCEPTION` globale.
- **Fail-closed:** RBAC, `tenants`, `tenant_feature_flags`, `tenant_payment_methods`: l'errore annulla la modifica (`audit_event_type_unknown:*` se il tipo è disattivato).
- **Append-only:** `service_role` ha solo `SELECT`; trigger `BEFORE UPDATE/DELETE/TRUNCATE` rifiuta anche il proprietario (`42501`), salvo `purge_audit_events('PURGE')` (GUC `lepefy.audit_purge`, solo SQL).
- **Idempotenza:** gli eventi da trigger nascono dalla riga effettivamente modificata (un retry che non cambia nulla non produce eventi; i CAS esistenti garantiscono un solo vincitore); TS/RPC usano `event_key` + `on conflict do nothing`.
- **Webhook Stripe:** invariato. L'evento d'ordine nasce dall'INSERT (idempotente lato ordine: indice unico `checkout_session_id`, controllo sull'intent); i retry Stripe non duplicano.
- **Dimensioni:** `changes` > 15 KB ⇒ solo nomi dei campi + `changes_truncated`; `metadata` > 4 KB ⇒ `metadata_truncated`.

## 6. API, permessi e isolamento tenant

| Capability | Rischio | platform_owner | tenant_admin | altri ruoli |
|---|---|---|---|---|
| `audit.view` | standard | ✓ | ✓ (+ flag) | assegnabile |
| `audit.export` | sensitive | ✓ | ✓ (+ flag) | assegnabile |
| `audit.security.view` | sensitive | ✓ | ✓ (+ flag) | assegnabile |
| `platform.audit.view` | critical | ✓ | — | — |

- **Flag `activity_journal`** (`featureFlagRegistry.ts`, `platformOnly: true`): finché è spento, `/admin/activite` è 404 e l'API risponde 404 per tutti salvo il platform owner; solo il platform owner può accenderlo (`PATCH /api/admin/feature-flags` rifiuta gli altri con 403; la riga è in sola lettura in Paramètres › Fonctionnalités).
- **Pagine:** `requireActivityJournalPage()`; rotta `/admin/activite` → `audit.view` (`adminRoutePermissions.ts`); voce di navigazione `activity` (gruppo Commun, flag `activity`).
- **API** (mappa centrale `adminApiPermissions.ts`, solo GET, scritture fail-closed): `GET /api/admin/activite` (`audit.view`, cursore `cursor_at`/`cursor_id`, `limit` ≤ 100), `GET /api/admin/activite/:id` (`audit.view`; id di un altro tenant ⇒ 404), `GET /api/admin/activite/export` (`audit.export`, max 5 000 righe, `X-Export-Truncated`, CSV UTF-8 BOM `;` con formule neutralizzate; ogni export è auditato).
- **Scope per modulo** (`lib/audit/scope.ts`): un evento è leggibile solo se l'admin può leggere il modulo d'origine (`orders.view`, `catalog.view`, `customers.view`, `tenant_settings.view`, `suppliers|purchases|inventory|treasury.view` + flag Gestion, `whatsapp.view` + flag, `reviews.view`, `events.view`); categoria `security` e moduli `security`/`audit` solo con `audit.security.view`; `platform_billing` ed `external_catalog` solo platform owner.
- **Tenant:** sempre `getTenant()` lato server. Il parametro `tenant` (id o `all`) è considerato solo con `platform.audit.view`; la vista globale include gli eventi di piattaforma (`tenant_id` null: ruoli, permessi). Le RPC rifiutano (zero righe) un filtro senza perimetro tenant o senza moduli.
- **Timeline contestuali** (`app/admin/_components/data/ResourceActivity.tsx`): permesso della pagina ospite + gate del journal; nessun rendering se il journal non è aperto all'admin o non leggibile. Integrate in: dettaglio ordine (`orders.view`), editor prodotto (`catalog.view`), hub Paramètres (modulo `admin`, `tenant_settings.view`); Gestion conserva `AuditTimeline` + link «Voir dans le journal» (`JournalLink`). Mai sulle pagine cliente (`/orders/[id]`, `/o/[token]` invariati).
- **Sanitizzazione in uscita** (`lib/audit/sanitize.ts`): chiavi sensibili rimosse (token, secret, api_key, iban, card, email, phone, recipients, payload, address…), e-mail/telefoni/IBAN/carte mascherati nei testi, stringhe ≤ 200, profondità ≤ 3.

## 7. Strategia di migrazione delle fonti esistenti

- **Read adapter** per tutte le tabelle storiche (nessuna eliminata, nessuna modificata, nessun backfill). Identificatore originale conservato con prefisso di fonte (`ba:`, `wa:`, `ao:`, `ts:`, `rv:`, `xc:`, `cp:`, `nd:`, `aa:`): nessun duplicato possibile.
- La vista include un adapter solo se la tabella esiste (moduli non ancora installati). **Dopo l'applicazione di una migration di modulo successiva alla 153, rieseguire la 153** (idempotente) per agganciare il suo adapter.
- `admin_access_audit`: le route continuano a scriverla; il feed ne mostra solo le righe anteriori a `audit_settings.installed_at` (dopo, la fonte sono i trigger RBAC). Gli stati prima/dopo non sono esposti (contengono e-mail).
- Migrazione progressiva futura: un modulo che riscrive le sue RPC chiama `record_audit_event` nella stessa transazione e la sua tabella storica diventa di sola lettura; la rimozione di una tabella storica richiede approvazione esplicita.
- Nessuna reinterpretazione: gli eventi storici senza autore restano «Auteur non enregistré».

## 8. Lifecycle e retention

- Politiche in `audit_settings.retention` (consultazione): **business 24 mesi**, **technical 90 giorni**, **security 36 mesi**; `retention_class` registrata per evento dal catalogo.
- `purge_audit_events()` restituisce solo i conteggi (dry run). La cancellazione (`purge_audit_events('PURGE')`) è eseguibile solo da SQL dal proprietario, **non è schedulata** e richiede prima la verifica dei requisiti legali/operativi (decisione separata).
- Le tabelle storiche mantengono le loro politiche (es. WhatsApp 180/365 giorni, Nala 90 giorni).

## 9. Integrare un nuovo modulo

1. Aggiungere i tipi in `AUDIT_EVENT_TYPES` e, in una nuova migration, l'insert in `audit_event_types` (stessi modulo/categoria/gravità/retention: il test di parità lo verifica).
2. Se il modulo è nuovo: voce in `AUDIT_MODULES` (permesso di lettura, flag eventuale) e link in `auditResourceHref`.
3. Scrittura: trigger con allow-list (`audit_diff(old, new, campi, campi_con_valore)`) **oppure** `perform record_audit_event(...)` dentro l'RPC del modulo (stessa transazione). Mai valori personali o segreti nei `campi_con_valore`.
4. Se l'RPC scrive tabelle auditate ed è chiamata da un admin: aggiungerla ad `AUDITED_WRITE_RPCS` (`requestContext.ts`) per l'attribuzione.
5. Worker/job senza admin: `createServiceClient({ auditActor: { actorType: 'automation', ref: '<job>', source: 'worker' } })`.
6. Timeline: `<ResourceActivity tenant hostPermission resourceType resourceId />`.
7. Test SQL nel file `supabase/tests/<n>_*.test.sql` del modulo (evento presente dopo commit, assente dopo rollback, nessuna PII).

## 10. Performance e volume

- Ogni RPC costruisce un `WHERE` dinamico con soli valori quotati (`%L`), filtrato per tenant e periodo; i rami UNION ricevono i predicati. Periodo predefinito 7 giorni (massimo 24 mesi), pagina ≤ 100, offset ≤ 5 000, conteggio plafonato a 10 000 («plus de»), riepilogo plafonato a 100 000.
- Monitoraggio: `select * from audit_volume_stats order by month desc;` (eventi e byte per tenant/mese/classe) e `select count(*) from audit_write_failures where occurred_at > now() - interval '7 days';`.
- Partizionamento mensile di `audit_events` da valutare oltre ~20 M righe o 10 GB o se le query del journal superano 500 ms su 30 giorni.

## 11. Troubleshooting

| Sintomo | Causa probabile | Verifica / azione |
|---|---|---|
| Pagina «Journal non installé» | Migration 153 non applicata | Applicare 153 (§13) |
| `/admin/activite` 404 per un tenant | Flag `activity_journal` spento | Il platform owner lo attiva in Paramètres › Fonctionnalités |
| Autore «Auteur non enregistré» per azioni admin | Header non arrivati (route che non passa da `requirePermission`, RPC non in `AUDITED_WRITE_RPCS`, PostgREST senza `request.headers`) | Verificare con `supabase/verification/153_…` e un'azione reale su `lepefy-test`; aggiungere l'RPC alla lista |
| Evento mancante dopo una modifica | Campo fuori allow-list, fallimento fail-open | `select * from audit_write_failures order by occurred_at desc limit 20;` |
| Modifica di ruolo rifiutata con `audit_event_type_unknown` | Tipo disattivato nel catalogo (fail-closed) | `update audit_event_types set active = true where key = '…';` |
| Adapter di un modulo assente | Tabella del modulo creata dopo la 153 | Rieseguire la 153 |
| Export troncato | > 5 000 righe | Restringere il periodo o i filtri (`X-Export-Truncated: true`) |

## 12. Matrice di copertura

| P | Evento | Stato | Affidabilità | Test |
|---|---|---|---|---|
| P0 | Cambio di stato ordine | ✅ trigger | stessa tx, fail-open | SQL §3, §4 |
| P0 | Creazione ordine (storefront, assistito, in negozio) | ✅ trigger | stessa tx (anche nella RPC 128) | SQL §3 |
| P0 | Modifica ordine (tracking, indirizzo, note, importi) | ✅ trigger | stessa tx | SQL §3 |
| P0 | Conferma pagamento manuale | ✅ trigger (`payment_confirmed_by`) | stessa tx della RPC 128 | SQL §3 |
| P0 | Ruoli, permessi, membership, attivazione admin | ✅ trigger | fail-closed | SQL §4, §5 |
| P0 | Configurazione critica tenant, flag, metodi di pagamento | ✅ trigger | fail-closed | SQL §4, §5 |
| P1 | Prezzi, disponibilità, minimo/step, stock (admin), scheda prodotto | ✅ trigger | fail-open | SQL §6 |
| P1 | Brouillons d'expédition, stato transporteur, sync fallita | ✅ trigger | fail-open | SQL §3 |
| P1 | Dati cliente (solo nomi dei campi, solo admin) | ✅ trigger | fail-open | SQL §6 |
| P1 | Réglages dei moduli | ✅ trigger | fail-open | SQL §5 |
| P1 | Gestion, moderazione recensioni, capacità eventi, import cataloghi, precommande | 📖 adapter | transazionali all'origine (precommande: best-effort esistente) | SQL §7 |
| P1 | Stati delle prenotazioni Événementiel | ⏳ predisposto | — | — |
| P2 | Notifiche fallite/abbandonate, WhatsApp | 📖 adapter | ledger esistenti | SQL §7 |
| P2 | Export, consultazione privilegiata | ✅ TS | idempotente (`event_key`) | SQL §8, unit |
| P2 | Login admin, campagne marketing, digest, retry n8n | ⏳ predisposto | — | — |

## 13. Applicazione e attivazione (runbook)

1. **Prima su `lepefy-test`** (stesso progetto Supabase: la migration è globale; nessun tenant viene attivato): applicare `supabase/migrations/153_admin_activity_audit.sql` (`supabase db push` o SQL Editor).
2. Eseguire `supabase/verification/153_admin_activity_audit_verification.sql` (transazione annullata): deve terminare con «Migration 153 - vérifications OK».
3. Prova funzionale di attribuzione: da `test.lepefy.com/admin` cambiare lo stato di un ordine di test, poi aprire `/admin/activite` come platform owner: l'evento deve mostrare il nome dell'admin e un ID di correlazione. Se l'autore è «non enregistré», PostgREST non espone `request.headers`: gli eventi restano validi, l'attribuzione degli admin va rivista prima di aprire il journal ai tenant.
4. Controllare `audit_write_failures` (deve essere vuota) dopo qualche ora di traffico.
5. Apertura a un tenant: il platform owner attiva «Journal d’activité» in Paramètres › Fonctionnalités di quel tenant.
6. **Rollback:** blocco commentato in fondo alla migration (rimuove trigger, vista, funzioni, tabelle e capability). Il codice degrada da solo («Journal non installé»; le timeline non si mostrano).

## 14. Rischi residui

- Attribuzione admin dipendente da `request.headers` di PostgREST (verificato in test con GUC simulati; da confermare in produzione, §13.3).
- Le route admin che scrivono senza passare da `requirePermission` (nessuna nota) o le RPC di scrittura non elencate in `AUDITED_WRITE_RPCS` producono eventi con autore `unknown`.
- Eventi del webhook Stripe sugli ordini esistenti (`payment_status`) hanno autore `unknown` (webhook volutamente non modificato).
- Le scritture fatte dalla dashboard Supabase o da script sono `unknown`/`sql`.
- Gli adapter mostrano gli storici così come scritti dai moduli (formati e autori eterogenei).
- Il registro attori in memoria è per istanza serverless: una richiesta è sempre servita da una sola istanza, quindi non è un limite funzionale.
- `audit_write_failures` va sorvegliata (nessun alert automatico in questa versione).
