# Lepefy Engineering Hub

> Stato: **unità A, B, C e D consegnate** (A: schema, sicurezza, indicizzatore; B: ricerca, UI, schede dei 10 moduli; C: assistente AI con citazioni verificate e API macchina; D: ingest, sincronizzazione Actions, controllo schede obsolete, metriche e costi, benchmark, runbook). Migration `175` applicata dal Platform Owner; la **176 non è applicata**. Il Hub mostra «Nessun indice attivo» finché `ENGINEERING_INGEST_TOKEN` non è configurato e la prima sincronizzazione non è stata eseguita (RUNBOOK.md §1). L'assistente AI è **spento** (due interruttori, AI_RETRIEVAL.md §5): nessun servizio costoso è attivo.

Portale tecnico-funzionale **interno** per l'équipe IT: indice del repository Git (file, simboli, API, tabelle, migration, test, documenti), schede per modulo, ricerca, interfaccia in `/admin/platform/engineering` e assistente AI con citazioni verificabili. Non fa parte del Help Center dei tenant e non condivide con esso tabelle, API o codice.

## Mappa dei documenti

| Documento | Contenuto | Stato |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | confini, componenti, flusso dati, decisioni | unità A |
| [INDEXING.md](INDEXING.md) | cosa viene indicizzato, relazioni dimostrate, esclusioni, snapshot e attivazione | unità A |
| [SECURITY.md](SECURITY.md) | accesso, RBAC, segreti, dati personali, minacce | unità A |
| [AI_RETRIEVAL.md](AI_RETRIEVAL.md) | ricerca, orchestratore, citazioni, prompt injection, gateway senza tenant, API | unità C |
| [RUNBOOK.md](RUNBOOK.md) | messa in servizio, sync, rollback, diagnosi, costi, benchmark | unità D |
| [CONTRIBUTING.md](CONTRIBUTING.md) | come scrivere e mantenere le schede dei moduli, regole CI, toccare indicizzatore e AI | unità D |
| [benchmark/questions.json](benchmark/questions.json) | domande d'oro con le fonti attese | unità D |

## Unità di consegna

| Unità | Contenuto |
|---|---|
| **A** (fatta) | migration 175, contratti TS, esclusioni, estrattori TS/SQL/Markdown, registro moduli, guardia di accesso, CLI `pnpm engineering:index`, test, passo CI |
| **B** (fatta) | ricerca unica (esatta → prefisso → full text → parziale), UI Panoramica/Architettura/Moduli/Codice/Ricerca, `docs/engineering/modules/*.md` (10 schede, mai «Verificata») |
| **C** (fatta) | migration 176 (client API, metriche, impostazioni, policy AI `engineering` disabilitata), gateway con `tenantId: null`, orchestratore con citazioni, chat, API macchina |
| **D** (fatta) | `POST /api/internal/engineering/ingest` (token dedicato), `pnpm engineering:sync` + workflow `engineering-sync.yml` (push incrementale, settimanale completo, manuale), job CI `engineering:docs-check`, pagina Metriche (richieste, qualità, costi, sincronizzazioni), benchmark (spec sull'indice reale + `pnpm engineering:benchmark` a pagamento) |

## Comandi

```bash
pnpm engineering:index                       # costruisce lo snapshot di HEAD in artifacts/engineering/snapshot.json (git-ignored)
pnpm engineering:index --ref main --mode full
```

Il comando legge solo contenuto committato tramite `git`, non usa rete, ambiente o database e stampa conteggi, esclusioni per regola ed eventuali diagnostiche. Richiede Node ≥ 22.18 (type stripping, come gli script `catalog:whatsapp:*`).

## Cosa non fa (ancora)

- `pnpm engineering:index` non scrive nel database; il caricamento passa da `pnpm engineering:sync` e dall'endpoint di ingest.
- Non ha un test e2e del percorso HTTP in produzione né una corsa con un modello reale (il benchmark è manuale): vedi RUNBOOK.md §7.
- Non inventa numeri: `getActiveRun()` (`lib/engineering/server/activeRun.ts`) restituisce solo un run `active`; senza run ogni pagina dice «Nessun indice attivo», con schema mancante «Indice non disponibile».
- La ricerca «parziale» è una sottostringa servita dagli indici `pg_trgm`, non una similarità con punteggio (richiederebbe una RPC, unità C/D).
## Interfaccia (unità B e C)

Percorsi sotto `/admin/platform/engineering` (solo Platform Owner, ereditano la guardia di `platform/layout.tsx`): `/` panoramica, `/architettura`, `/moduli` e `/moduli/[key]`, `/codice?dir=|path=&line=`, `/ricerca?q=&module=`, `/ai` (chat), `/accessi` (impostazioni AI e credenziali macchina). API: `GET /api/admin/platform/engineering/search?q=&module=&kind=` con `requireEngineeringApi`, assente dalle mappe RBAC dei tenant. Pagine e API usano lo stesso `searchEngineering()` (`lib/engineering/server/search.ts`) e il contratto puro `lib/engineering/search/contract.ts`; le derivazioni (statistiche di modulo, dipendenze, elenco cartelle) sono in `lib/engineering/explorer.ts`.
- Non dichiara «documentato» alcun modulo: lo stato «Verificata» di un documento nasce da una revisione umana (`engineering_document_reviews`) legata a uno SHA.
