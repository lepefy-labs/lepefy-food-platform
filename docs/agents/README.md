# Team di agenti AI (versione 1)

Agenti Claude Code con competenze specifiche che esaminano il codice, segnalano problemi e preparano il lavoro; **decide sempre il proprietario**. Questo documento descrive ruoli, flusso, formato dei finding e modo di esecuzione. `AGENTS.md` resta il contratto dell'agente interattivo UI/UX e non viene modificato: i ruoli qui descritti lo richiamano dove serve. `CLAUDE.md` viene caricato da ogni sessione, `AGENTS.md` no: i ruoli citano esplicitamente i contratti che li riguardano.

## Flusso

```text
Specialisti (sola lettura)  ->  agent-reports/raw/
        |
Tech Lead (triage)          ->  agent-reports/weekly/ + ledger.md + prompts/
        |
Proprietario approva        ->  prompt Claude Code (il "developer")
        |
Branch + PR (mai main)      ->  QA reviewer  ->  proprietario fa il merge
```

Il **developer** non è un agente a parte: è una normale sessione Claude Code che esegue il prompt approvato su un branch e apre la PR.

## Ruoli

| Agente | File | Compito | Strumenti |
|---|---|---|---|
| ux-ui-auditor | `.claude/agents/ux-ui-auditor.md` | UX, Admin Design System V2, regole cross-device, accessibilità | Read, Grep, Glob |
| db-security-auditor | `.claude/agents/db-security-auditor.md` | RLS e GRANT, migration, isolamento tenant, esposizione segreti, cache Next.js, invarianti pagamenti | Read, Grep, Glob |
| tech-lead | `.claude/agents/tech-lead.md` | Verifica, dedup, priorità, corsia di rischio, report settimanale, prompt | Read, Grep, Glob, Write, Edit (solo `agent-reports/`) |
| qa-reviewer | `.claude/agents/qa-reviewer.md` | Revisione di una PR contro regole e contratti, typecheck e test unit | Read, Grep, Glob, Bash (comandi elencati nel file) |

Gli specialisti non scrivono file: il report lo salva la sessione che li invoca.

## Corsie di rischio

- **A**: UI, copy, accessibilità, documentazione, test. Dopo l'approvazione procede con un prompt Claude Code.
- **B**: pagamenti, checkout, fatturazione, autenticazione e autorizzazione, segreti, RLS, migration e schema, dati dei clienti. **Solo segnalata**: serve l'approvazione esplicita del proprietario e un prompt dedicato (stesse categorie di riapprovazione di `AGENTS.md`). Il Tech Lead scrive un memo di decisione, non un prompt.
- **C**: non toccare (file generati, codice legacy documentato come voluto).

Nel dubbio si sale di corsia.

## Formato di un finding

```text
### F-<agente>-<AAAAMMGG>-<n>: <titolo breve>
- Agente: ux-ui-auditor | db-security-auditor
- Gravità: alta | media | bassa
- Sforzo: S | M | L
- Corsia: A | B | C
- Prova: percorso/file.tsx:123 (riga citata)
- Regola: <documento o regola violata>
- Problema: <1-2 frasi>
- Correzione proposta: <1-3 frasi>
- Candidata a guardia automatica: sì | no (e come)
```

Senza prova verificabile (file e riga letti) un finding non vale.

## Principio: prima le guardie, poi gli agenti

Ciò che si controlla in modo meccanico deve diventare un test (come `tests/unit/adminDesignGuard.spec.ts`). Gli agenti cercano il giudizio che un test non cattura e propongono nuove guardie: la sezione "Candidate a guardia automatica" di ogni report alimenta questo lavoro.

## Come si eseguono (fase 1, manuale, in locale)

Dalla radice del repo, in una sessione `claude`. Nessun segreto su GitHub, nessun costo oltre l'uso normale.

1. **Audit di un modulo**: "Usa il subagente ux-ui-auditor sullo scope `/admin/evenementiel*`. Salva il suo report in `agent-reports/raw/AAAA-MM-GG-ux-evenementiel.md`."
2. **Audit differenziale**: "Elenca con git i file cambiati in `apps/storefront/src` e `supabase/migrations` dall'ultimo SHA rivisto (vedi `agent-reports/ledger.md`) a `main`, passali come scope a db-security-auditor e salva il report in `agent-reports/raw/`."
3. **Triage**: "Usa il subagente tech-lead per il triage dei report in `agent-reports/raw/`."
4. **Revisione di una PR**: "Usa il subagente qa-reviewer sul branch `<nome>` rispetto a `main`."

Il tech-lead tiene nel ledger l'ultimo SHA rivisto. Ogni settimana conviene un audit differenziale più la rotazione di un modulo.

## Cartella `agent-reports/`

Locale, ignorata da Git (`.gitignore`). Contiene `raw/` (report grezzi), `weekly/` (report del Tech Lead), `prompts/` (prompt Claude Code proposti), `ledger.md` (registro: fingerprint, stato `proposto`/`approvato`/`scartato`/`rinviato`/`fatto`, motivo, prompt o PR). Il ledger evita che gli stessi finding vengano riproposti.

## Limiti e prossimi passi

- Gli agenti leggono il repository, non vedono la produzione: ciò che dipende dallo stato reale del database o di Vercel è "non verificabile dal repository".
- Fase 2 (non attiva): esecuzione periodica con GitHub Actions e segnalazioni come Issue. Richiede una chiave API Anthropic come segreto del repository e fatturazione a consumo: da decidere dopo aver valutato la qualità dei finding.
- Un agente può sbagliare: ogni finding si verifica sul file citato prima di agire, e il Tech Lead registra anche gli scarti.
