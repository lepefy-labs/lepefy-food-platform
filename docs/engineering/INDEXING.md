# Engineering Hub — indicizzazione

Base verificata: `main` @ `1703e3ea`. Misura reale su quel commit: 2 237 file indicizzati, 13 616 simboli, 12 039 relazioni, 55 documenti, 11 249 chunk, 50 file esclusi, ~3,5 s.

## 1. Cosa viene letto

Solo contenuto **committato**, tramite `git ls-tree` / `git cat-file` (mai l'albero di lavoro). Un file è indicizzato se supera, in ordine:

1. **Regole di percorso** (`exclusionForPath`): allow-list di estensioni (`ts tsx js jsx mjs cjs sql md mdx yml yaml`, JSON solo per `package.json`, `tsconfig*.json`, `vercel.json`, `components.json`, `ops/n8n/*.json`) e deny-list (`node_modules`, `.next`, `.git`, `dist`, `build`, `coverage`, `.claude/`, `artifacts/`, `confirmation-report/`, `supabase/.temp/`, file `.env*` salvo `.env.example`, chiavi/certificati, lockfile, binari, CSV/dump, file generati, percorsi oltre 500 caratteri).
2. **Regole di contenuto** (`exclusionForContent`): NUL (binario), oltre 512 KB, segreti, dati personali.

Un file escluso lo è **per intero** (mai oscurato a metà) e di esso si registra solo `path + codice regola` in `engineering_excluded_files`. Il valore che ha fatto scattare la regola non esce mai dalla funzione (test: la stringa non compare nello snapshot serializzato né nei blob).

### Segreti

Regole per: blocchi di chiave privata, `sk_live_`/`rk_live_`, `whsec_`, `AKIA…`, JWT, token GitHub/Slack/Google/Resend/Brevo, stringhe di connessione con password reale (placeholder come `[YOUR-PASSWORD]` ammessi) e, nei file non di test, assegnazioni `nome(secret|token|password|api_key…) = 'valore lungo con lettere e cifre'` (un valore `MAIUSCOLO_CON_UNDERSCORE` è il *nome* di una variabile d'ambiente, non un segreto). Nei file di test la regola generica è sospesa (le fixture usano valori finti), le regole specifiche del provider restano attive.

### Dati personali

Tre indirizzi e-mail dall'aspetto reale in un file (dieci nei test) lo escludono: un estratto di dati non è documentazione. Domini segnaposto (`example.*`, `.test`, `lepefy.com`…) e caselle di ruolo (`noreply`, `support`…) non contano.

Sul commit di riferimento: 2 file esclusi per contenuto (entrambi `personal_data`: un pannello admin e uno scenario demo con indirizzi reali o verosimili), 0 per segreti.

## 2. Cosa si estrae

| Sorgente | Fatti estratti | Come |
|---|---|---|
| TS/TSX/JS | funzioni, classi, interfacce, tipi, enum, `const` di primo livello, componenti (`.tsx`, nome maiuscolo), hook (`use…`), handler di route (`GET`/`POST`… in `route.ts`), titoli di test (`test`, `it`, `describe`, `test.describe`) con riga iniziale/finale, firma, hash del testo, commento JSDoc | TypeScript Compiler API, solo sintassi |
| SQL | `create table / view / function / trigger / index / policy` con nome letterale, riga iniziale/finale, firma delle funzioni; `alter table x` come relazione | divisione in istruzioni consapevole di stringhe e dollar-quote; i commenti (inclusi i blocchi di rollback commentati) sono ignorati |
| Markdown | front matter (metadati del documento), sezioni per intestazione (spezzate sotto i 3 500 caratteri), riferimenti a percorsi fra backtick | intestazioni nei blocchi di codice ignorate |
| Percorso | tipo di file, modulo (registro), rotta Next (`/api/…`, `/admin/…`, gruppi di rotte rimossi) | convenzioni App Router |

### Relazioni: solo se dimostrate

Ogni relazione ha file di origine e **riga di prova**. Mai dedotte dai nomi.

| Tipo | Prova |
|---|---|
| `imports` | specificatore letterale (statico, `export … from`, `import()`, `require()`) risolto su un file indicizzato (alias `@/`, `@lepefy/types`, relativi, `index`, `.js`→`.ts`); pacchetto esterno con `targetRef` = nome del pacchetto |
| `tests` | un file di test che importa un file non di test; un test SQL `supabase/tests/NNN_*` verso `supabase/migrations/NNN_*` (convenzione dichiarata) |
| `uses_table` / `calls_rpc` | `.from('nome')` / `.rpc('nome')` con **argomento stringa letterale** |
| `calls_api` | `fetch('/api/…')` con stringa letterale |
| `handles_route` | il file è una `route.ts`/`page.tsx` dell'App Router |
| `defines_object` | `create`/`alter table` letterale in SQL |
| `documents` | un riferimento a percorso fra backtick (o un `file_monitorati` del front matter) che coincide con un file indicizzato |

Argomenti dinamici (`.from(name)`, template con variabili) non producono nulla. Un import che non si risolve (file rinominato o eliminato) sparisce al run successivo invece di restare appeso.

Limiti noti: `.from()` copre letture *e* scritture (il tipo si chiama `uses_table`); le colonne e i corpi delle funzioni SQL non sono analizzati; i test Playwright non collegati a un file per import non hanno relazione `tests`.

## 3. Moduli e documenti

`ENGINEERING_MODULES` (`lib/engineering/moduleRegistry.ts`) elenca i 10 moduli iniziali con glob di percorso; il primo che combacia assegna il modulo al file (sul commit di riferimento 1 446 file su 2 237 non appartengono a nessun modulo: è atteso). L'appartenenza a un modulo non rende il modulo «documentato».

Front matter dei documenti tecnici (`docs/engineering/modules/*.md`, unità B): `id`, `titolo`, `modulo`, `categoria`, `stato`, `owner`, `sha_verificato`, `data_verifica`, `file_monitorati`. Stati: **Inventariato / Indicizzato / Parziale / Verificata / Da revisionare**. Un documento che dichiara `verificata` senza `sha_verificato` valido è declassato a **Da revisionare** dall'indicizzatore.

## 4. Snapshot, idempotenza, attivazione

`buildSnapshot()` è pura e ordinata per byte: stessi file → stesso JSON, qualunque sia l'ordine di ingresso (test). Il manifest (`files, symbols, relations, documents, chunks, excluded, checksum`) viaggia con lo snapshot e viene verificato dal database prima che il run diventi `staged`.

Sequenza prevista dall'unità D: `engineering_start_run(run_key = "<sha>:<mode>")` → `engineering_missing_blobs` → caricamento dei soli blob mancanti (tutti in modalità `full`) → inserimento a lotti → `engineering_finalize_run(manifest)` → `engineering_activate_run`. Ogni passo è ripetibile: lo stesso `run_key` restituisce lo stesso run; un run `failed` si riapre ripulendo le righe; un run `staged`/`active` non si riscrive. Se qualunque passo fallisce l'indice attivo resta quello precedente e il Hub lo segnala come obsoleto rispetto allo SHA di `main`.

## 5. Eseguire e verificare in locale

```bash
pnpm engineering:index
cd apps/storefront && npx playwright test --config=tests/unit/playwright.unit.config.ts engineeringHub
```

Schema: catena PGlite `fixture → 175 → 175 → test` (vedi la memoria `local-sql-tests-pglite`); in CI il passo «Engineering Hub … (175)» usa psql su Postgres 16.
