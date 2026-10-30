# Lepefy Help Center (Centre d'aide contestuale multi-tenant)

> Stato: codice implementato su `main` (base `2a688bce`, 30/10/2026). Migration `174_help_center.sql` **scritta e validata in locale (PGlite, due applicazioni + test), NON applicata in produzione**. Nessuna riga di piano concessa: il modulo è inerte ovunque finché §10.3 non viene eseguito con l'approvazione esplicita del richiedente.
> Proposta approvata: artifact «Lepefy Help Center — Mockup PRE/POST» (drawer desktop/mobile, console Platform Owner, editor).

Obiettivo: aiuto pertinente **nella pagina in cui l'admin lavora**, senza lasciarla: guide brevi, ricerca, link condivisibili. Modulo autonomo (`helpCenter`), incluso oggi nel piano Base, vendibile in futuro come livello separato senza riscrivere architettura, permessi, navigazione o contenuti. Funziona senza IA e senza Assistance.

## 1. Architettura

```text
Admin tenant (ogni pagina)                         Console Lepefy (/admin/platform/knowledge)
  Header « Aide » ──┐                                lista (URL state) · KPI per stato · tab Retours / Plus consultés / Recherches sans résultat
  Menu « Centre d'aide » ┼─> HelpProvider ─> HelpDrawer   editor a blocchi · anteprima desktop/mobile · pagine associate
  /admin/aide, /admin/aide/[slug]                    workflow draft → review → published → archived · revisioni · import libreria
        │                                                    │
  /api/admin/help/** (help.view + livello)        /api/admin/platform/knowledge/** (requirePlatformOwner)
        │                                                    │
        └──── RPC di proiezione 174 (solo pubblicato) ───────┴── tabelle help_* (RLS forzata, solo service role)
```

Moduli (`apps/storefront/src/lib/helpCenter/`):

| File | Ruolo |
|---|---|
| `domain.ts` | costanti, tipi, blocchi, limiti, moduli |
| `rules.ts` | **resolver di livello** `resolveHelpLevel`, workflow (specchio SQL), slug, normalizzazione ricerca, `minimiseSearchTerm`, `parseInline` |
| `blocks.ts` | schema zod dei blocchi, allow-list di immagini e video |
| `contextResolver.ts` | **context engine** puro: `normalizeHelpRoute`, `matchRoutePattern`, `isArticleVisible`, `resolveHelpContext` |
| `server/access.ts` | `getHelpLevel`, guardie `helpTenantApi` / `helpPlatformApi`, `requireHelpTenantPage` |
| `server/service.ts` | letture tenant (contesto, catalogo, articolo, ricerca) e metriche |
| `server/platformService.ts` | CRUD, workflow, revisioni, metriche per la console |
| `library/initialLibrary.ts` | 17 guide iniziali in francese (importate come **bozze**) |

UI: `app/admin/_components/help/` (`HelpProvider`, `HelpDrawer`, `HelpHeaderButton`, `HelpArticleBody`, `HelpArticleFeedback`, `helpClient`), pagine `app/admin/(protected)/aide/**` e `platform/knowledge/**`.

## 2. Modello commerciale e accesso

Tre livelli, **distinti** dal flag tecnico e dalle capability RBAC:

| Livello | Come si ottiene |
|---|---|
| `disabled` | nessuna feature, tenant/modulo sospeso o interruttore amministrativo |
| `standard` | feature `help_center` (piattaforma `platform_features`, `billable = false`) |
| `advanced` | feature `help_center_advanced` (registrata **inattiva**, non collegata a nessun piano) |

Estende l'infrastruttura esistente (`hasTenantFeature`: piano attivo in `platform_plan_features`, override esplicito in `tenant_feature_overrides` con `starts_at`/`expires_at`, sospensione). **Precedenza** (centralizzata in `rules.resolveHelpLevel`, testata):

1. tenant sospeso → `disabled`
2. interruttore amministrativo (flag platform-only `help_center_disabled`, riga assente = non disattivato) → `disabled`
3. entitlement `advanced` (override esplicito batte il piano, già risolto da `hasTenantFeature`) → `advanced`
4. entitlement `standard` → `standard`
5. altrimenti → `disabled`

Un flag o una capability non alzano mai il livello. Lettura entitlement in cache 60 s (`unstable_cache`, tag `help-center:<tenant>`); ogni errore di lettura **chiude** (`disabled`). Il livello `advanced` filtra anche gli articoli (`min_level`).

Capability `help.view` (migration 174): `platform_owner`, `tenant_admin` (anche nel fallback legacy `adminRbac`); i ruoli personalizzati la ricevono da `/admin/platform/access`; il cassiere no. Route `/admin/aide` → `help.view`; API `/api/admin/help/**` → `help.view` + livello (404 se disabilitato). Console e API console: solo platform owner, assenti da `adminApiPermissions`.

## 3. Modello dati (migration 174)

Additiva, rieseguibile, rollback in fondo al file. Tutte le tabelle: RLS **forzata** senza policy, `revoke all` anche dal service role, poi grant espliciti.

| Tabella | Contenuto |
|---|---|
| `help_articles` | slug, modulo, `min_level`, `required_permission`, `required_flag`, stato, `version` (copia di lavoro), `published_version` (servita ai tenant), `tenant_id` (null = condiviso, valorizzato = solo quel tenant) |
| `help_article_translations` | copia di lavoro per lingua (`fr`/`it`/`en`): titolo, riassunto, `blocks` jsonb, testo di ricerca |
| `help_article_revisions` | snapshot **immutabili** (trigger) per articolo × lingua × versione, con `search_document` tsvector francese |
| `help_article_contexts` | pattern di route (`/admin/orders`, `/admin/orders/[id]`, `/admin/orders/*`), azione facoltativa, priorità |
| `help_article_daily` / `help_search_daily` | contatori giornalieri aggregati (solo `select` dal service role) |

RPC `security definer`, eseguibili solo dal service role: `help_set_status` (workflow + snapshot), `help_restore_revision`, `help_tenant_articles`, `help_tenant_search`, `help_tenant_contexts` (proiezioni: **solo pubblicato**, tenant proprio o condiviso, filtro livello), `help_record_event`, `help_record_search`, `help_purge_metrics`.

Workflow `draft → review → published → archived` (`help_transition_allowed`, specchiato in `rules.HELP_TRANSITIONS`, test di parità): la pubblicazione richiede la revisione e il contenuto francese, crea una revisione per lingua e fa servire quella versione; `published → published` = ripubblicazione (nuova versione, mai riutilizzata, anche dopo un'archiviazione). Modificare un articolo pubblicato cambia solo la copia di lavoro. Le revisioni precedenti sono recuperabili (`help_restore_revision` copia nella bozza, non pubblica).

Nessun contenuto generato dall'IA viene pubblicato automaticamente: la pubblicazione è sempre un'azione esplicita del platform owner.

## 4. Contenuti: blocchi strutturati

Mai HTML. `blocks` è un array validato (`blocks.ts`): `heading`, `paragraph`, `steps`, `callout` (info/warning), `image` (https o `/help/…`, testo alternativo obbligatorio), `video` (solo YouTube nocookie, Vimeo, Loom), `related` (slug di un'altra guida). Il solo markup inline è `**grassetto**`. Il renderer (`HelpArticleBody`) mappa ogni blocco a un elemento React, ricontrolla le sorgenti e non usa `dangerouslySetInnerHTML` (verificato da test).

## 5. Context engine

`resolveHelpContext({ pathname, action, articles, contexts, viewer })`: normalizza la route (id e numeri → `[id]`, mai query/hash/token), calcola la specificità di ogni pattern (esatto > `[id]` > wildcard `/*`), filtra per **livello, capability e flag** (`isArticleVisible`), ordina per specificità/priorità/posizione, propone guide correlate (stesso modulo o linkate con `related`) e un `fallback` (ricerca/guida generale) quando nulla è associato. Il filtro è applicato sul server prima che qualsiasi dato raggiunga il browser. Il platform owner non aggira né livello né flag.

## 6. Ricerca, feedback, metriche

- Ricerca: tsvector francese sulle revisioni pubblicate (`websearch_to_tsquery`), minimo 2 caratteri, 80 al massimo, limite 30/min per admin e per istanza (`createMemoryRateLimiter`). Una ricerca senza risultato registra solo il termine **minimizzato** (`minimiseSearchTerm`: minuscolo, senza e-mail, UUID, numeri/telefoni; 60 caratteri; nulla se non resta niente).
- Eventi: `view`, `helpful`, `not_helpful`, `support_opened` → un contatore per giorno × tenant × guida × evento. Nessun identificativo di visitatore, nessun contenuto di ordini/clienti/pagamenti. `POST /api/admin/help/events` risponde sempre 204 (fire-and-forget con `keepalive`, una sola vista per guida e apertura), limite 60/min. Retention 180 giorni (`help_purge_metrics`, opportunistico dalla console, nessun cron).
- Console: KPI per stato, tab **Retours**, **Plus consultés**, **Recherches sans résultat**; dati assenti = «n.d.», mai 0.

## 7. Integrazione con Assistance (e indipendenza)

Il drawer mostra il percorso «Contacter Lepefy» solo se `SupportProvider` dice `enabled && !readOnly` (flag `support_assistance` + `support.use`). «Besoin de plus d'aide ?» apre il pannello esistente con `helpArticle` (slug), salvato nel `context` jsonb del ticket (`SupportContext.help_article`, validato come slug, ≤ 2 000 byte complessivi) e invia l'evento `support_opened`. Nessun ticket, conversazione o notifica duplicati. Il modulo Help Center **non importa** nulla da `lib/support` né legge il flag (test statico), quindi Assistance può essere spenta senza toccare le guide.

## 8. UX

Pulsante «Aide» nella barra admin (accanto ad «Assistance»), voce «Centre d'aide» nel gruppo Administration (flag di navigazione `help`), palette comandi. **Mai** aperto automaticamente. `HelpDrawer` usa il `Drawer` del kit (dialog nativo, schermo intero su telefono): contenuto caricato solo all'apertura, ricerca con debounce e annullamento, guide per la pagina, correlate, articolo con «Copier le lien», «Utile / Pas utile», lingua di ripiego dichiarata. Pagina condivisibile `/admin/aide/[slug]` (404 identico per ignota/bozza/altro tenant/non autorizzata) e indice `/admin/aide` con ricerca GET (funziona senza JavaScript). Design System V2: solo token `a-*`, kit condiviso, nessuna eccezione al guard.

Nota: il drawer è modale (come tutti i `Drawer` del kit): lo sfondo è inerte mentre è aperto. Micro-aiuto sui singoli campi **non** implementato (non giustificato in questa fase).

## 9. Sicurezza

Tenant sempre da `getTenant()`; capability e livello su ogni chiamata; nessun IDOR (le RPC filtrano `tenant_id`, lo slug non rivela l'esistenza di bozze); RLS forzata + grant espliciti + RPC solo service role (testato anche in SQL con ruoli reali); revisioni immutabili; sanitizzazione per costruzione (blocchi, allow-list sorgenti, niente HTML); rate limit su ricerca ed eventi; nessun aumento di privilegi tramite flag o entitlement.

## 10. Rollout, rollback, runbook

1. **Deploy del codice**: inerte (nessun piano ha `help_center`; la console risponde «indisponibile» finché la 174 non è applicata; `getHelpLevel` chiude su ogni errore).
2. **Applicare la 174** (SQL Editor Supabase o `supabase db push`; prima verificare in locale con PGlite la catena fixture → migration ×2 → test, CI `supabase/tests/174_help_center.*`). Verifica rapida:
   ```sql
   select count(*) from information_schema.tables where table_name like 'help_%';            -- 6
   select key, active, billable from platform_features where key like 'help_center%';       -- standard attiva/non fatturabile, advanced inattiva
   select count(*) from admin_role_permissions where permission_key = 'help.view';          -- ≥ 2
   select count(*) from platform_plan_features where feature_key like 'help_center%';       -- 0
   ```
3. **Console**: `/admin/platform/knowledge` → «Importer la bibliothèque initiale» (bozze) → relettura → «Envoyer en relecture» → «Publier», guida per guida.
4. **Tenant di prova**: concedere l'entitlement con un override esplicito (non al piano):
   ```sql
   insert into tenant_feature_overrides (tenant_id, feature_key, enabled, source) values ('<id lepefy-test>', 'help_center', true, 'manual');
   ```
5. **Piano Base** (subordinato all'**approvazione esplicita**; mai eseguito automaticamente, in particolare per Chloe Food):
   ```sql
   insert into platform_plan_features (plan_id, feature_key, label, position)
   select id, 'help_center', 'Centre d''aide', 210 from platform_plans where code = 'food-platform'
   on conflict (plan_id, feature_key) do nothing;
   ```
6. **Spegnere** per un tenant: flag `help_center_disabled` = true (riga in `tenant_feature_flags`). Per tutti: eliminare la riga di piano. I dati restano.
7. **Rollback schema**: blocco commentato in fondo alla 174.

Futuro commerciale: il passaggio a «standard o advanced acquistabile separatamente» è solo configurazione (`billable`, righe `platform_plan_features` / `tenant_feature_overrides` con `source = 'addon'`); nessuna migration distruttiva né riscrittura dei contenuti. `help_center_advanced` va attivata (`active = true`) solo con una decisione commerciale esplicita. Nessun prodotto Stripe viene creato dal modulo.

## 11. Test

`tests/unit/helpCenter.spec.ts`: precedenza del resolver di livello, normalizzazione e matching delle route (id mascherati, wildcard), filtro per capability / flag / livello, azione, fallback di contesto, lingua di ripiego, parità del workflow con la SQL, blocchi e sorgenti (HTML e URL pericolosi rifiutati), ricerca e minimizzazione, schema (RLS forzata, grant, nessuna policy, nessuna riga di piano, `advanced` inattiva), indipendenza da Assistance, assenza di rendering HTML, guardie delle route, libreria iniziale, navigazione. `adminDesignGuard.spec.ts` e `adminNavigation.spec.ts` coprono la regressione del Design System. SQL: `supabase/tests/174_help_center.{fixture,test}.sql` (workflow, immutabilità, isolamento tenant, livello, metriche, retention, privilegi con ruoli reali).

Non coperti da test automatici: responsività reale e accessibilità a schermo (il design usa target ≥ 40 px, etichette, `aria-live`, focus visibile del kit, ma non c'è un test browser dedicato) — da verificare a mano sul tenant di prova.

## 12. Contratto di manutenzione (proposta da riportare in AGENTS.md)

Quando un task cambia in modo significativo un workflow amministrativo (schermata, etichetta, regola o permesso), l'agente deve:

1. cercare le guide potenzialmente obsolete: ogni voce di `library/initialLibrary.ts` dichiara `watch` (percorsi sorgente); `grep` dei percorsi toccati nel campo `watch` e dei testi di bottone cambiati nel contenuto delle guide;
2. aggiornare il testo della guida nel sorgente della libreria **e** segnalare in risposta quali guide pubblicate richiedono una nuova pubblicazione, oppure segnalarle come «da rivedere»;
3. non ripubblicare mai una guida senza controllo editoriale: la pubblicazione resta un'azione del platform owner (`Publier` / `Republier`);
4. non inventare funzionalità, pulsanti o comportamenti: ogni etichetta citata deve esistere nel codice.

Le guide nel database sono la fonte servita; la libreria nel repository è solo il seme (l'import non sovrascrive mai un articolo esistente).

## 13. Roadmap IA (non implementata)

La v1 non dipende dall'IA. Punti di estensione previsti, nessuno attivo: indicizzazione semantica delle **revisioni pubblicate** (riuso di Supabase/pgvector e del gateway IA esistente, come `match_products`), risposte basate solo su contenuti pubblicati con citazione delle fonti (slug + versione), controllo dei costi per tenant tramite le quote del gateway (`check_ai_rate_limit`) e quote per livello commerciale (`advanced`). Nessuna risposta IA può sostituire i controlli deterministici su ordini, pagamenti, prezzi o permessi.

## 14. Mappa dei file

```text
supabase/migrations/174_help_center.sql
supabase/tests/174_help_center.{fixture,test}.sql
apps/storefront/src/lib/helpCenter/{domain,rules,blocks,contextResolver}.ts
apps/storefront/src/lib/helpCenter/server/{access,service,platformService}.ts
apps/storefront/src/lib/helpCenter/library/initialLibrary.ts
apps/storefront/src/app/admin/_components/help/        HelpProvider, HelpDrawer, HelpHeaderButton, HelpArticleBody, HelpArticleFeedback, helpClient
apps/storefront/src/app/admin/(protected)/aide/        indice e pagina di una guida
apps/storefront/src/app/admin/(protected)/platform/knowledge/   console (lista, nuovo, editor, import)
apps/storefront/src/app/api/admin/help/**               API tenant
apps/storefront/src/app/api/admin/platform/knowledge/** API console
apps/storefront/tests/unit/helpCenter.spec.ts
```
