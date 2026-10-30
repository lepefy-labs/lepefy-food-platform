# Engineering Hub — ricerca, AI e citazioni

Unità C. Migration `176_engineering_ai.sql` **non applicata**: la esegue il Platform Owner. L'assistente nasce **spento** su due livelli indipendenti (vedi §5).

## 1. Una sola ricerca

`searchEngineering()` (`lib/engineering/server/search.ts`, contratto puro in `search/contract.ts`) è usata dalla UI, dall'API HTTP, dall'API macchina e dagli strumenti dell'AI. Stadi, dal più forte: nome **esatto**, **prefisso**, **full text** (chunk, configurazione `simple`), corrispondenza **parziale** (sottostringa servita dagli indici `pg_trgm`). Il punteggio è dominato dallo stadio: un risultato più debole non supera mai uno più forte (test). Legge solo il run `active`.

## 2. Orchestratore

Il gateway AI esistente è solo JSON strutturato (niente tool calling nativo). Quindi:

```text
domanda ─▶ [modello: UN passo JSON] ─▶ strumento ammesso (eseguito dal server) ─▶ prova E1, E2…
              ▲                                                         │
              └──────────── prove numerate nel prompt ◀─────────────────┘
modello: "answer" + evidence_ids ─▶ il server verifica ogni citazione ─▶ risposta o «nessuna prova»
```

- **Strumenti ammessi** (`AI_TOOLS`): `search`, `read_file` (≤ 120 righe, solo file indicizzati), `list_module`, `find_references` (tabella/RPC/rotta per nome, relazioni dimostrate). Nessuno scrive, nessuno esce in rete, nessuno tocca i tenant. Un'azione fuori elenco è rifiutata dal validatore **prima** di qualsiasi esecuzione.
- **Budget**: al massimo `max_tool_calls` strumenti (default 6, tetto 12); l'ultimo giro accetta solo `answer` o `give_up`.
- **Citazioni verificate dal server** (`finalizeAnswer`): solo gli id che uno strumento ha davvero prodotto sopravvivono; un id inventato è scartato e il suo marcatore `[E7]` rimosso; un percorso scritto fra backtick che nessuna prova contiene è sostituito con «percorso non verificato». Una risposta senza **alcuna** citazione valida non è mostrata come risposta (`no_answer`). Ogni citazione diventa un link GitHub permanente a file e righe **al commit indicizzato**.
- **Limiti noti**: la verifica garantisce che la fonte esista nell'indice e sia stata letta, non che la frase sia semanticamente corretta. L'interfaccia lo dice («verifica sempre il codice citato»).

## 3. Contenuto del repository = dato non fidato

- Ogni prova entra nel prompt dentro `<evidence>` dopo `neutralize()` (rimuove tag `evidence`/`system`/`assistant`/`user` e caratteri di controllo) e con tetto di 1 200 caratteri. Il system prompt dichiara che il suo contenuto è dato.
- Il testo recuperato non può invocare strumenti: gli strumenti sono scelti solo dal passo JSON del modello e validati dal server; il testo di una prova non può fabbricare né un id né una citazione.
- Domande su segreti, chiavi, `.env`, dati di clienti o di produzione sono **rifiutate prima di chiamare il modello** (`isForbiddenQuestion`), e comunque i file con segreti o dati personali non sono nell'indice (INDEXING.md §1).
- Test: `tests/unit/engineeringAi.spec.ts` (modello scriptato: citazioni inventate, percorsi inventati, testo ostile nelle prove, budget, rifiuti, errore del modello).

## 4. Gateway senza tenant (decisione D2)

`runAi({ tenantId: null, consumer: 'engineering', usageSink })`: un tenant assente non è mai un default. `assertTenantScope` ammette `null` solo per il consumer `engineering` **e** con un `usageSink`; altrimenti `tenant_required`. Per `null` il gateway non scrive in `ai_usage_log` (`tenant_id` NOT NULL) ma chiama il sink, che scrive in `engineering_ai_usage` (token, costo da `ai_pricing`, latenza, fallback). Tutti gli altri consumer restano invariati.

## 5. Come si accende (due interruttori, mai uno solo)

| Livello | Dove | Stato iniziale |
|---|---|---|
| Policy di routing `engineering/structured_chat` | Piattaforma › Intelligenza artificiale › Routage | **disabilitata** (creata dalla 176, con il modello Gemini Flash già collegato) |
| Impostazione `engineering_settings.ai_enabled` | Engineering › Accessi | **spenta** |

Prima di ogni chiamata (`askEngineering`): interruttore → limite al minuto (default 10) → budget giornaliero in USD (default 5; 0 significa «nessuna spesa»). Solo allora parte il modello. Ogni esito è registrato in `engineering_query_metrics` con **hash e lunghezza** della domanda, mai il testo, e senza colonne che possano contenerlo. Conservazione 180 giorni (`engineering_purge_metrics`).

## 6. API

| Chi | Percorso | Autorizzazione |
|---|---|---|
| Owner | `POST /api/admin/platform/engineering/ask`, `GET/PATCH …/settings`, `GET/POST …/clients`, `DELETE …/clients/[id]` | `requireEngineeringApi(permesso)` = Platform Owner; assenti dalle mappe RBAC dei tenant |
| Macchina | `GET /api/engineering/v1/search`, `GET /api/engineering/v1/files`, `POST /api/engineering/v1/ask` | `Authorization: Bearer lpe_eng_…`, scope `search` / `read` / `ask` |

Credenziali macchina: 256 bit casuali, **solo lo SHA-256 è salvato**, mostrata una volta, scadenza massima 1 anno, revocabile (la riga resta), `last_used_at`. Ogni errore di autenticazione è lo stesso 401 senza dettagli; nessun cookie e nessun tenant partecipano. Risposte `Cache-Control: no-store`.

## 7. Cosa manca (unità D)

Caricamento dello snapshot (ingest con token dedicato), workflow GitHub Actions, controllo documenti obsoleti in CI, pannello metriche/costi, benchmark di qualità sulle domande reali, e2e. Finché non c'è uno snapshot attivo l'assistente risponde «Nessun indice attivo».
