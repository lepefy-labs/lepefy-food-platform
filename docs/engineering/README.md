# Lepefy Engineering Hub

> Stato: **unità A e B consegnate** (A: architettura, schema 175, sicurezza, indicizzatore, registro moduli; B: ricerca, UI in `/admin/platform/engineering`, schede dei 10 moduli). Migration `175_engineering_hub.sql` applicata dal Platform Owner nel SQL Editor di Supabase. Finché **non viene caricato uno snapshot** (ingest: unità D) la UI mostra «Nessun indice attivo». Nessuna AI, nessun servizio costoso attivo. Base letta: `main` @ `1703e3ea`.

Portale tecnico-funzionale **interno** per l'équipe IT: indice del repository Git (file, simboli, API, tabelle, migration, test, documenti), schede per modulo e, in unità successive, ricerca, interfaccia in `/admin/platform/engineering` e assistente AI con citazioni verificabili. Non fa parte del Help Center dei tenant e non condivide con esso tabelle, API o codice.

## Mappa dei documenti

| Documento | Contenuto | Stato |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | confini, componenti, flusso dati, decisioni | unità A |
| [INDEXING.md](INDEXING.md) | cosa viene indicizzato, relazioni dimostrate, esclusioni, snapshot e attivazione | unità A |
| [SECURITY.md](SECURITY.md) | accesso, RBAC, segreti, dati personali, minacce | unità A |
| AI_RETRIEVAL.md | ricerca ibrida, orchestratore, citazioni, prompt injection | unità C |
| RUNBOOK.md | sync, rollback, diagnosi, costi | unità D |
| CONTRIBUTING.md | come scrivere e mantenere i documenti dei moduli, regole CI | unità D |

## Unità di consegna

| Unità | Contenuto |
|---|---|
| **A** (fatta) | migration 175, contratti TS, esclusioni, estrattori TS/SQL/Markdown, registro moduli, guardia di accesso, CLI `pnpm engineering:index`, test, passo CI |
| **B** (fatta) | ricerca unica (esatta → prefisso → full text → parziale), UI Panoramica/Architettura/Moduli/Codice/Ricerca, `docs/engineering/modules/*.md` (10 schede, mai «Verificata») |
| C | migration 176 (client API, metriche, impostazioni, policy AI `engineering` disabilitata), orchestratore, endpoint, chat |
| D | workflow GitHub Actions (sync incrementale/full, retry, dedupe), controllo documentazione obsoleta su PR, metriche e costi, benchmark, e2e |

## Comandi

```bash
pnpm engineering:index                       # costruisce lo snapshot di HEAD in artifacts/engineering/snapshot.json (git-ignored)
pnpm engineering:index --ref main --mode full
```

Il comando legge solo contenuto committato tramite `git`, non usa rete, ambiente o database e stampa conteggi, esclusioni per regola ed eventuali diagnostiche. Richiede Node ≥ 22.18 (type stripping, come gli script `catalog:whatsapp:*`).

## Cosa non fa (ancora)

- Non scrive nel database: il caricamento di uno snapshot (endpoint di ingest con token dedicato) è nell'unità D.
- Non inventa numeri: `getActiveRun()` (`lib/engineering/server/activeRun.ts`) restituisce solo un run `active`; senza run ogni pagina dice «Nessun indice attivo», con schema mancante «Indice non disponibile».
- La ricerca «parziale» è una sottostringa servita dagli indici `pg_trgm`, non una similarità con punteggio (richiederebbe una RPC, unità C/D). Non c'è ancora la tab «AI» (unità C) né il caricamento dello snapshot (unità D).

## Interfaccia (unità B)

Percorsi sotto `/admin/platform/engineering` (solo Platform Owner, ereditano la guardia di `platform/layout.tsx`): `/` panoramica, `/architettura`, `/moduli` e `/moduli/[key]`, `/codice?dir=|path=&line=`, `/ricerca?q=&module=`. API: `GET /api/admin/platform/engineering/search?q=&module=&kind=` con `requireEngineeringApi`, assente dalle mappe RBAC dei tenant. Pagine e API usano lo stesso `searchEngineering()` (`lib/engineering/server/search.ts`) e il contratto puro `lib/engineering/search/contract.ts`; le derivazioni (statistiche di modulo, dipendenze, elenco cartelle) sono in `lib/engineering/explorer.ts`.
- Non dichiara «documentato» alcun modulo: lo stato «Verificata» di un documento nasce da una revisione umana (`engineering_document_reviews`) legata a uno SHA.
