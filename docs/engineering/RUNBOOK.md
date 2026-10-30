# Engineering Hub — runbook

Per chi opera il Hub. Il Hub è interno e solo Platform Owner (SECURITY.md).

## 1. Messa in servizio (una volta)

1. **Migration**: applicare `175_engineering_hub.sql` e `176_engineering_ai.sql` nel SQL Editor di Supabase (sono additive e ripetibili).
2. **Token di ingest**: generare una stringa casuale ≥ 32 caratteri (es. `openssl rand -base64 48`) e impostarla in **Vercel** come `ENGINEERING_INGEST_TOKEN` (progetto di produzione). Senza di essa l'endpoint risponde 503 e il Hub resta vuoto.
3. **GitHub**: Settings › Secrets and variables › Actions: secret `ENGINEERING_INGEST_TOKEN` (lo stesso valore) e variabile `ENGINEERING_INGEST_URL` (origine HTTPS della produzione, senza slash finale, es. `https://shop.chloefood.com`). Finché mancano, il workflow `Engineering Hub sync` termina verde senza fare nulla.
4. **Primo caricamento**: Actions › *Engineering Hub sync* › *Run workflow* › `full`. A fine run il Hub mostra l'indice (Panoramica).
5. Facoltativo, **assistente AI**: vedi §5. Resta spento finché non lo accendi tu.

Il token di ingest autorizza **solo** `POST /api/internal/engineering/ingest`; non dà accesso al database e non sostituisce la chiave service-role (che non entra mai in GitHub per il Hub).

## 2. Come funziona la sincronizzazione

`engineering-sync.yml`: push su `main` (incrementale) + domenica notte/lunedì 03:17 UTC (completa) + manuale. Una sola esecuzione alla volta (`concurrency`, senza cancellare quella in corso). Passi di `pnpm engineering:sync`:

```text
start (run_key "<sha>:<mode>") → missing → blobs → rows (modules, files, excluded, symbols, relations, documents, chunks) → complete (finalize + activate + purge)
```

- **Idempotente**: stesso commit e modalità = stesso run. Se è già `staged`/`active`/`superseded` lo script esce con «nothing to upload»; se è `failed` il run si riapre ripulito.
- **Retry**: 3 tentativi con attesa 1/3/9 s solo per errori transitori (5xx, 429, rete). Un 4xx non si ritenta.
- **Fallimento**: lo script chiude il run come `failed` e **l'indice attivo resta quello di prima**. Un run rimasto `running` oltre 30 minuti è dato per `timeout` dal tentativo successivo.
- **Attivazione**: solo il ramo predefinito (`main`). Un run di altri rami resta `staged`.
- **Retention**: dopo ogni attivazione `engineering_purge` tiene l'attivo e gli ultimi 3 `superseded`, elimina `failed`/`staged` oltre 7 giorni e i blob non più referenziati.

Provare senza inviare nulla: `pnpm engineering:sync -- --dry-run` (stampa conteggi e numero di lotti).

## 3. Diagnosi

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| UI «Nessun indice attivo» | nessun run attivato | lanciare il workflow `full`; controllare Metriche › Ultime sincronizzazioni |
| UI «Indice non disponibile» | migration 175 mancante o DB non leggibile | applicare la 175; log Vercel `[platform/engineering]` |
| Workflow verde ma «skipped» | secret/variabile mancanti | §1 punto 3 |
| ingest `503 Ingest disabled` | `ENGINEERING_INGEST_TOKEN` assente/corto su Vercel | impostarlo e rifare il deploy |
| ingest `401` | token GitHub ≠ token Vercel | riallinearli |
| run `failed · manifest_mismatch` | i conteggi o il checksum caricati non coincidono | rilanciare; se persiste confrontare la versione di Node dell'indicizzatore (≥ 22.18) e aprire un'issue |
| `engineering_run_in_progress` (409) | un altro run è `running` | attendere o 30 min per il timeout |
| `engineering_branch_not_activatable` | si sta attivando un ramo non predefinito | atteso per le PR; non è un errore |
| `blob_sha_mismatch` | contenuto alterato in transito o line-ending convertiti | non usare `autocrlf` nel checkout della Action |
| `413` | lotto sopra 3,5 MB | non dovrebbe accadere (il piano limita i lotti); segnalare |

Log dell'endpoint: solo il **codice** dell'errore, mai contenuti dei file.

## 4. Rollback e spegnimento

- **Tornare all'indice precedente**: nel SQL Editor `select public.engineering_rollback('lepefy-food-platform', 'owner');` riattiva l'ultimo `superseded` ancora trattenuto (atomico, registrato in `engineering_activation_log`).
- **Fermare le sincronizzazioni**: disabilitare il workflow in GitHub, oppure rimuovere `ENGINEERING_INGEST_TOKEN` da Vercel (l'endpoint risponde 503).
- **Spegnere il Hub senza toccare i dati**: rimuovere la voce di navigazione `engineering` da `platformNavConfig.ts` e le route; i dati restano.
- **Distruggere tutto**: i blocchi di rollback in coda a 175 e 176 (distruggono solo l'indice tecnico, credenziali e metriche).

## 5. Assistente AI, costi, credenziali

- **Accensione** (due interruttori, AI_RETRIEVAL.md §5): Engineering › Accessi › «Assistente attivo» **e** policy `engineering/structured_chat` in Piattaforma › Intelligenza artificiale › Routage. Prima verificare che il modello abbia una tariffa in `ai_pricing`, altrimenti il costo risulta 0 $ (la pagina Metriche lo segnala).
- **Costi**: Engineering › Metriche: costo oggi/7/30 giorni per modello, token, chiamate non riuscite. Il budget giornaliero (default 5 USD) blocca le domande quando è raggiunto; 0 = nessuna spesa.
- **Spegnimento immediato della spesa**: togliere «Assistente attivo» (effetto alla richiesta successiva).
- **Credenziali macchina**: creare in Accessi (token mostrato una volta), revocare con «Revoca» (immediato; la riga resta). Scadenza massima 1 anno: pianificare la rotazione. Un token trapelato si revoca e si ricrea.
- **Benchmark qualità** (a pagamento, a mano): `ENGINEERING_API_URL=… ENGINEERING_API_TOKEN=lpe_eng_… pnpm engineering:benchmark` esegue le 16 domande di `docs/engineering/benchmark/questions.json` e stampa tasso di risposta, di citazione della fonte attesa, domande fuori bersaglio e latenza. Rilanciarlo dopo ogni cambio di prompt, strumenti, modello o indice. Un modello che «non sa» è meglio di uno che cita la fonte sbagliata: guardare `offTarget` prima di `hitRate`.

## 6. Manutenzione periodica

- Mensile: `select public.engineering_purge_metrics(180);` (le metriche più vecchie di 180 giorni; minimo 30).
- A ogni cambio del registro dei moduli (`moduleRegistry.ts`): aggiungere/aggiornare la scheda in `docs/engineering/modules/` (la CI fallisce se manca, CONTRIBUTING.md).
- Dopo un grande refactor: sync `full` manuale e controllo di Metriche.

## 7. Verifiche già fatte (30/10/2026)

L'intero snapshot reale (2 305 file, 14 134 simboli, 12 399 relazioni, 11 752 sezioni) è stato caricato con le stesse funzioni di piano e di mappatura dell'endpoint in uno schema PostgreSQL con la migration 175: manifest e checksum coincidono, il run diventa `staged` e poi `active`, la ricerca full text risponde. **Non è stato provato** il percorso HTTP in produzione né un modello reale.
