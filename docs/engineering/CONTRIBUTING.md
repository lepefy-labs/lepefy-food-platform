# Engineering Hub — contribuire

Come mantenere schede, registro moduli, indicizzatore e AI senza rompere le garanzie.

## 1. Le schede dei moduli (`docs/engineering/modules/<modulo>.md`)

Una scheda per ogni modulo del registro (`lib/engineering/moduleRegistry.ts`); il nome del file è la chiave del modulo. Front matter obbligatorio:

```yaml
---
id: eng-module-<modulo>
titolo: Nome leggibile
modulo: <modulo>            # una chiave del registro
categoria: Operazioni
stato: parziale             # inventariato | indicizzato | parziale | verificata | da_revisionare
owner: Platform Owner
file_monitorati: [percorso/del/file.ts, docs/ALTRO.md]
---
```

### Stati

| Stato | Significato | Chi lo imposta |
|---|---|---|
| Inventariato | il modulo esiste ed è assegnato, ma non descritto | chiunque |
| Indicizzato | testo generato/derivato dall'indice, non riletto | chiunque |
| Parziale | descrive alcune parti, non rilette da una persona | chiunque |
| **Verificata** | una persona ha riletto la scheda sul codice a un commit preciso | **solo una revisione umana** |
| Da revisionare | era valida, il codice è cambiato | chi nota la deriva |

Per portare una scheda a **verificata** servono nel front matter `owner`, `data_verifica` (AAAA-MM-GG) e `sha_verificato` (commit riletto, 7–40 caratteri esadecimali). Senza di essi l'indicizzatore la declassa a «Da revisionare» e la CI fallisce. Un assistente AI **non** marca mai una scheda come verificata e non modifica `sha_verificato`.

### Cosa scrivere

- Fatti verificabili nel codice, con il percorso fra backtick (`lib/…`): ogni percorso nel testo diventa una relazione `documents` se esiste nell'indice, e un percorso inesistente fa fallire il test delle schede.
- Invarianti e perché, punti di ingresso, dati, limiti noti. Non riscrivere `CLAUDE.md`: collegarlo.
- Nessun segreto, valore di configurazione di produzione o dato personale (comunque il file verrebbe escluso dall'indice per intero).
- Dichiarare ciò che non si sa («Limiti noti»): il Hub preferisce una lacuna dichiarata a una frase plausibile.

## 2. La CI che controlla le schede

`pnpm engineering:docs-check` (job «Engineering Hub — stale documentation check»):

- **errore**: front matter mancante o non valido, modulo sconosciuto, modulo del registro senza scheda, file monitorato inesistente, «verificata» senza owner/data/sha, e una scheda **verificata** i cui `file_monitorati` sono cambiati dopo `sha_verificato`;
- **avviso** (annotazione sulla PR): una scheda non verificata i cui file monitorati sono modificati da questa PR.

Se la CI dice che una scheda verificata è obsoleta: rileggerla sul codice attuale; se è ancora vera, aggiornare `sha_verificato` e `data_verifica` al commit attuale; altrimenti correggerla o portarla a «Da revisionare». Non aggiornare lo sha senza rileggere.

## 3. Aggiungere un modulo

1. Voce in `ENGINEERING_MODULES` con `pathGlobs` (il primo modulo che combacia assegna il file; l'ordine conta).
2. Scheda `docs/engineering/modules/<chiave>.md` (almeno «Inventariato»).
3. `pnpm test:unit` (test sulle schede e sul registro) e `pnpm engineering:docs-check`.
4. Eventuali domande di benchmark in `docs/engineering/benchmark/questions.json` con le fonti attese (il test verifica che esistano nell'indice).

## 4. Toccare l'indicizzatore

- `lib/engineering/{domain,exclusions,moduleRegistry,indexer/**,ingest/**,docsCheck,benchmark}.ts` e `scripts/engineering*.ts` girano **sotto Node type stripping** (Actions e CLI): niente alias `@/`, `enum`, `namespace`, proprietà-parametro nei costruttori (`constructor(public x)`); test statico lo verifica.
- Le **esclusioni** vanno sempre per file intero; mai oscurare a metà. Un nuovo tipo di segreto = una regola in `exclusions.ts` con test (il valore non deve comparire nell'output).
- Una **nuova relazione** richiede una prova letterale (file + riga). Niente relazioni dedotte dai nomi.
- Cambiare forma o colonne dello snapshot significa una nuova migration **e** `ingest/protocol.ts`; il test `engineeringSync` mappa lo snapshot reale e fallisce se non coincidono.
- Verifica completa locale: `pnpm engineering:index`, `pnpm engineering:sync -- --dry-run`, test unitari, e la catena SQL (fixture → 175 → test) su PGlite o Postgres 16.

## 5. Toccare l'AI

- Aggiungere uno **strumento** = una voce in `AI_TOOLS`, un ramo in `server/tools.ts` con output limitato, sola lettura, e un test che mostri che non apre vie verso scrittura, rete o tenant. Mai uno strumento che esegue SQL libero, shell o fetch.
- Il testo del repository è **dato**: ogni prova passa da `neutralize()`; non allentare `finalizeAnswer` (citazioni verificate dal server).
- Dopo qualunque modifica a prompt, strumenti, modello o indice: `pnpm engineering:benchmark` e confronto con la corsa precedente.
- Nuovi consumer del gateway senza tenant: **no**. `tenantId: null` è ammesso solo per `engineering` con un sink proprio.

## 6. Lista di controllo di una PR sul Hub

- [ ] `pnpm typecheck` e `pnpm test:unit` verdi; **mai** `pnpm lint` (riscrive `tsconfig`; usare `next lint --dir …` e ripristinare `tsconfig.json`).
- [ ] Nessuna API del Hub in `adminApiPermissions.ts` / `adminRoutePermissions.ts`.
- [ ] Nessun `canAdmin()` per `engineering.*`.
- [ ] Schede e `file_monitorati` aggiornati; `engineering:docs-check` verde.
- [ ] Se tocca schema: migration additiva e ripetibile, test SQL nel passo CI dedicato, nessuna applicazione in produzione senza approvazione.
