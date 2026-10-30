# Engineering Hub — architettura

Base verificata: `main` @ `1703e3ea` (30/10/2026).

## 1. Confini

```text
GitHub (main)                         Vercel (Next.js)                          Supabase
  │  push / manuale / cron              │
  ▼                                     │
GitHub Actions ── pnpm engineering:index ── snapshot ──(unità D: ingest con token dedicato)──▶ engineering_* (175)
  parsing TS/SQL/MD, esclusioni                         API platform-only ─▶ ricerca / UI / AI (B, C)
```

- **Bounded context** `apps/storefront/src/lib/engineering/`. Il codice dell'indicizzatore (`domain.ts`, `exclusions.ts`, `moduleRegistry.ts`, `indexer/**`) è puro: nessun alias `@/`, nessun `server-only`, così gira sia sotto Next/Playwright sia con Node type stripping nella CLI e nelle Actions. Solo `server/**` importa Next e Supabase.
- **Indipendente dal Help Center**: nessun import reciproco con `lib/helpCenter` o `lib/support` (test statico), tabelle `engineering_*` distinte, nessuna API tenant. Estraibile in futuro (`engineering.lepefy.com`): le dipendenze verso il resto dell'app sono tre (`requirePlatformOwner`, `createServiceClient`, il gateway AI nell'unità C).
- **Le operazioni pesanti non girano su Vercel**: parsing ed embedding (non previsti) stanno nelle Actions; la richiesta web legge solo righe già indicizzate.

## 2. Modello dati (migration 175)

| Tabella | Ruolo |
|---|---|
| `engineering_repositories` | un repository (`lepefy-food-platform`), `active_run_id` = snapshot letto dal Hub |
| `engineering_index_runs` | un run per commit/modalità: `running → staged → active → superseded`, oppure `failed`; contatori, checksum, errore |
| `engineering_blobs` | contenuto dei file per blob-sha git (condiviso fra run: ciò che rende incrementale il caricamento) |
| `engineering_files` / `_symbols` / `_relations` / `_documents` / `_chunks` / `_modules` / `_excluded_files` | snapshot del run (tutte con `run_id`, eliminate a cascata) |
| `engineering_document_reviews` | revisioni umane dei documenti, append-only |
| `engineering_activation_log` | storico di attivazioni e rollback, append-only |

Invarianti applicate dal database (testate in `supabase/tests/175_engineering_hub.test.sql`):

1. **Un run è scrivibile solo mentre è `running`** (trigger `engineering_assert_run_open`): dopo `staged` lo snapshot è immutabile.
2. **Un solo run `running` per repository** (indice parziale); un run bloccato da più di 30 minuti viene dato per `timeout` al tentativo successivo.
3. **`engineering_finalize_run` confronta il manifest dell'indicizzatore** (conteggi e checksum `md5` di `path blob_sha` in ordine di byte) con le righe memorizzate: non coincide → `failed/manifest_mismatch`, mai `staged`.
4. **`engineering_activate_run` cambia puntatore e stati in una transazione** con lock sulla riga del repository; solo un run `staged` del branch predefinito; i run di altri branch (PR) possono essere indicizzati ma non attivati.
5. **Mai un indice incompleto come corrente**: `getActiveRun()` filtra `status = 'active'`.
6. **Rollback** (`engineering_rollback`) riattiva l'ultimo `superseded` ancora trattenuto; **retention** (`engineering_purge`) tiene l'attivo e gli ultimi N (3) superseded, elimina failed/staged vecchi di 7 giorni e i blob non più referenziati da almeno 1 giorno.
7. **Nessun tenant**: nessuna colonna `tenant_id`, RLS forzata senza policy, `revoke all` e grant espliciti al solo `service_role`; le RPC sono `security definer` eseguibili solo dal service role; il service role non può cancellare righe di snapshot né riscrivere revisioni e log.

## 3. Decisioni

| Decisione | Motivo |
|---|---|
| Indicizzatore con la TypeScript Compiler API, solo sintattica | `typescript` è già una dipendenza; nessun `ts-morph`; parsing deterministico di 2 200 file in ~3 s |
| Snapshot per run + blob condivisi invece di patch incrementali | rende l'idempotenza banale (stesso input → stesso output) e il rollback un cambio di puntatore; «incrementale» = i blob già noti non si ricaricano |
| Relazioni solo dimostrate (vedi INDEXING.md) | un grafo con archi ipotizzati è peggio di nessun grafo |
| Il contenuto del repository è dato non fidato | vale per l'AI (unità C): il testo recuperato non può invocare strumenti |
| pgvector rimandato | si decide dopo il benchmark dell'unità D; `pg_trgm` è già abilitato per la ricerca approssimata (B) |
| Ruolo `engineering_member` seminato ma non assegnato; layout non modificato | approvazione D1: fase 1 solo Platform Owner |

## 4. Mappa dei file (unità A)

```text
supabase/migrations/175_engineering_hub.sql
supabase/tests/175_engineering_hub.{fixture,test}.sql
apps/storefront/src/lib/engineering/{domain,exclusions,moduleRegistry,access}.ts
apps/storefront/src/lib/engineering/indexer/{buildSnapshot,classify,typescriptExtractor,sqlExtractor,markdownExtractor}.ts
apps/storefront/src/lib/engineering/server/{guard,activeRun}.ts
apps/storefront/scripts/engineering-index.ts
apps/storefront/tests/unit/engineeringHub.spec.ts
```
