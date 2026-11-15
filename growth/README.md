# Lepefy Growth — ricerca e qualificazione di nuovi tenant

Strumento indipendente dallo storefront e dall'admin: nessuna dipendenza npm, nessun accesso a
Supabase, nessun dato dei tenant. Non invia messaggi a nessuno.

## Come funziona

Due ruoli separati:

- **l'agente di ricerca** (Claude Code con accesso al web, seguendo `AGENT.md`) cerca le aziende,
  apre le fonti e scrive le schede di un'esecuzione;
- **questa CLI** decide che cosa è sostenuto dalle fonti: controlla i campi obbligatori, ricalcola
  i segnali dalle sole fonti aperte, deduplica l'identità aziendale, qualifica su due dimensioni
  separate (fit commerciale, via d'ingresso), controlla i messaggi, archivia ed esporta.

Le quattro fasi restano distinte: scoperta (`discovery.json`), verifica (le fonti di ogni scheda),
qualificazione (`src/qualify.mjs`), redazione (campo `message`, controllato da `lintMessage`).

## Uso

Dalla radice della repo, con Node 20 o superiore:

```bash
node growth/cli.mjs run:new --area "Veneto" --segment boutique-alimentare-africana --max-searches 40 --max-pages 40
```

Il comando stampa la consegna per l'agente: configurazione, budget e aziende già note. Poi, in
Claude Code: «Esegui la ricerca Lepefy Growth per l'esecuzione `<id>` seguendo growth/AGENT.md».
L'agente scrive `growth/data/runs/<id>/discovery.json` e `dossiers.json`. Quindi:

```bash
node growth/cli.mjs ingest --run <id>
```

```bash
node growth/cli.mjs check-sources --run <id>
```

```bash
node growth/cli.mjs export --run <id>
node growth/cli.mjs export:all            # tutte le schede di tutti i giri → data/exports/tutte/
```

- `ingest` rifiuta il lotto se supera il budget, se manca il registro delle ricerche o se la stessa
  azienda compare due volte; respinge le schede con errori (codice di uscita 1) e archivia le altre.
- `check-sources` riapre da sola le fonti dichiarate «aperte» e annota l'esito accanto a ciascuna.
- `export` scrive `growth/data/exports/<id>/shortlist.md`, `.csv` (separatore `;`, apribile in
  Excel) e `.json`.
- `list` mostra tutto l'archivio; `brief --run <id>` ristampa la consegna.

Una seconda esecuzione aggiorna le schede esistenti (fonti, stato, storico) senza duplicarle.

## Regole applicate dal controllo

- Un risultato di ricerca o una fonte non accessibile non conferma nulla. Una fonte primaria aperta
  (sito ufficiale, profilo social, stampa, evento, associazione) **conferma**; un elenco aziende
  aperto **indica** (metà punti); due fonti aperte in disaccordo rendono il segnale **contestato**.
- Fit (0–100): alimentare specializzato 25, vendita a distanza 25, catalogo senza percorso d'ordine
  25, ordini in chat 15, spedizione 10, ritiro 5, attività aperta 5. Qualificata da 50, con almeno
  un segnale di vendita confermato.
- Un e-commerce esistente limita il fit a 40, salvo un'esigenza specifica (`ecommerceNeed`)
  sostenuta da una fonte aperta.
- Via d'ingresso: presentazione, visita, evento, richiesta in entrata, canale scritto. Un recapito
  pubblico da solo non basta (`invitesBusinessContact`). Fit alto senza via verificata = «da coltivare».
- Messaggio: parte da un fatto con fonte aperta, cita solo funzioni presenti in
  `config/features.json`, chiude con una sola domanda; sono respinti percentuali, prezzi, risultati
  promessi, referenze, problemi attribuiti e integrazioni WhatsApp non disponibili.
- Segmenti diversi da quello dell'esecuzione sono riportati a parte, fuori classifica.

`config/features.json` elenca le sole funzioni Lepefy verificate nella documentazione, con la fonte
e i limiti noti. Va aggiornato quando il prodotto cambia.

## Esiti commerciali

```bash
node growth/cli.mjs outcome biskolak-international--castiglione-delle-stiviere --type demo --note "in negozio"
```

```bash
node growth/cli.mjs outcomes
```

Tipi: `contattato`, `introduzione`, `risposta`, `demo`, `rifiuto` (richiede `--reason`),
`nessuna_risposta`, `tenant_pagante`. Gli esiti finiscono in `data/outcomes.jsonl` (una riga per
evento) e compaiono nell'export. Il riepilogo li conta per tappa, per via d'ingresso e per motivo
di rifiuto: pochi contatti indicano un problema di ricerca, contatti senza risposta un problema di
via d'ingresso, demo senza seguito un problema di pitch o di prodotto.

## Test

```bash
node --test growth/test/growth.test.mjs
```

Coprono: stessa azienda con nomi o link diversi, omonimi non fusi, fonte non accessibile, fonti in
contraddizione, fit alto senza via d'ingresso, e-commerce esistente, messaggio con affermazioni non
sostenute, seconda esecuzione senza duplicati, budget, esiti, flusso CLI completo.

## Limiti

- La ricerca dipende dall'agente e dagli strumenti web disponibili: Instagram e molti registri non
  si aprono senza accesso; le pagine Facebook mostrano solo la sezione «In breve».
- `check-sources` verifica raggiungibilità e presenza del nome, non il contenuto della citazione.
- Il controllo dei messaggi è a regole: ferma gli errori tipici, non sostituisce la rilettura.
