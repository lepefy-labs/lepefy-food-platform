# Consegna per l'agente di ricerca

Obiettivo: conversazioni con i titolari, demo e tenant paganti. Il numero di schede non conta.
Non contattare nessuno, non compilare moduli, non inviare messaggi. Non usare dati o clienti di
Chloe Food come bacino. Leggi la consegna con `node growth/cli.mjs brief --run <id>`: contiene area,
segmento, lingue, budget, le aziende già note (da riproporre solo con fatti nuovi) e `nonRicontattare`:
le identità che hanno chiesto di non essere ricontattate, da non schedare mai.

## 1. Scoperta

- Query brevi, in più lingue: «tipo di negozio + città», nomi di prodotti, nomi di comunità.
  Le query lunghe con OR e virgolette rendono poco. Cambia fonte se un giro rende poco: guide ed
  elenchi di negozi, stampa di settore, espositori di eventi, distributori, associazioni.
- Registra ogni ricerca in `discovery.json` → `searchLog` (`engine`, `q`, `useful`) e il numero di
  pagine aperte in `pagesOpened`. Rispetta il budget: `ingest` rifiuta il lotto che lo supera.
- Ogni attività incontrata va in `found` con `outcome`: `schedata`, `non verificata` o `esclusa`, e
  il motivo. «Non ho trovato uno shop» non significa «non ha uno shop»: scrivilo così.

## 2. Verifica

Per le candidate migliori apri le fonti. Per ognuna registra `url`, `checkedAt`, `access`
(`opened`, `blocked`, `search_only`), `kind` e una `note` con la citazione breve. Controlla che le
fonti parlino della stessa attività (indirizzo, telefono, dominio). In `supports` / `refutes` metti
solo i segnali che quella pagina mostra davvero: `specialtyFood`, `remoteSelling`, `chatOrders`,
`catalogNoCheckout`, `shipping`, `pickup`, `active`, `ecommerce`. Se una fonte non si apre, registrala
come `blocked` e cambia strada: non dedurre il contenuto.

## 3. Qualificazione

Non assegnare punteggi: li calcola la CLI dalle fonti. Tu indichi `segment` (se diverso da quello
dell'esecuzione finisce a parte), `ecommerceNeed` quando esiste già uno shop, e la via d'ingresso
`entry` (`introduction` con `intermediary`, `visit`, `event` con `date`, `inbound`,
`written_channel` con `invitesBusinessContact` solo se la pagina invita richieste commerciali,
`none`). Un numero pubblico non è una via d'ingresso.

## 4. Redazione

Per ogni scheda: `verifiedFact`, `hypothesis` (`problem` come ipotesi, `question` per confermarla),
`lepefy` (`featureIds` da `config/features.json`, un solo `demoFlow`), `entry.nextAction`,
`message` nella lingua del prospect e nel formato del canale (`visit_opening`, `intro_request`,
`whatsapp`, `instagram_dm`, `email`, `contact_form`), `priority`, `confidence`, `toVerify`.
Ogni affermazione del messaggio va dichiarata in `claims` con la fonte aperta o la funzione che la
sostiene. Una sola domanda, in chiusura. Leggi `limitiNoti` in `features.json` prima di proporre.

Schema di riferimento: `growth/data/runs/2026-11-14-er-boutique/dossiers.json`.
Poi esegui `ingest`, correggi ciò che il controllo respinge (senza indebolire i fatti), quindi
`check-sources` ed `export`. Rileggi a mano le fonti delle prime tre schede.
