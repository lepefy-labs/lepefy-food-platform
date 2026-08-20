# Cross-device cart sync

Documentazione della sincronizzazione del carrello tra dispositivi per i
clienti autenticati. Il carrello guest resta esclusivamente in `localStorage`,
senza alcuna chiamata di rete.

---

## 1. Architettura

```text
              USER
                │
    ┌───────────┴───────────┐
 DEVICE A                DEVICE B
    │                       │
 cartStore (zustand)     cartStore
 items + pendingMutations   │
    │                       │
 cartSyncEngine          cartSyncEngine
    │  POST {expectedVersion, mutations[]}
    └───────────┬───────────┘
                ▼
   /api/customers/me/cart   (identità derivata dalla sessione)
                ▼
   apply_cart_mutations()   (atomica, optimistic concurrency)
                ▼
        carts (items, version, applied_mutation_ids)
```

| Livello | File | Responsabilità |
| --- | --- | --- |
| Stato | `src/stores/cartStore.ts` | items, stato di sync, coda persistita |
| Motore | `src/lib/cart/cartSyncEngine.ts` | flush, retry, offline, conflitti, merge |
| Rete | `src/lib/cart/cartApi.ts` | unico punto di contatto con l'endpoint |
| Puro | `mergeCarts.ts`, `reconcile.ts`, `cartQueue.ts` | logica deterministica e testabile |
| Errori | `cartErrors.ts` | `CartSyncError` + codici strutturati |
| Lifecycle | `src/components/cart/CartSyncProvider.tsx` | auth, online/offline, visibility |
| Server | `src/app/api/customers/me/cart/route.ts` | GET / POST / PUT (legacy) |
| DB | `supabase/migrations/070_cart_versioning.sql` | `version`, idempotenza, RPC |

---

## 2. Perché operation-based e non full-state versioning

Il full-state versioning (PUT dell'intero carrello + controllo di versione)
risolve la sovrascrittura ma **non** i due requisiti centrali:

* due device che aggiungono prodotti diversi partendo dalla stessa versione: con
  il full-state uno dei due stati vince comunque, e la riconciliazione lato
  client dovrebbe indovinare quale differenza era un'aggiunta e quale una
  rimozione;
* la distinzione fra `+1` (relativa) e `quantità = 5` (assoluta), invisibile
  guardando solo lo stato finale.

Con le mutation la semantica è esplicita: `add` è commutativa lato server, e
`set_quantity` esprime un'intenzione che può essere riapplicata sopra uno stato
più recente. Il costo è contenuto — la coda vive nello stesso store già
persistito, non è stata introdotta alcuna libreria e le API pubbliche dello
store non sono cambiate.

---

## 3. API

### `GET /api/customers/me/cart`

```jsonc
// 200
{ "items": [ { "product": { … }, "quantity": 2 } ], "version": 17 }
```

`items` conserva esattamente la forma precedente; `version` è additivo.

### `POST /api/customers/me/cart`

```jsonc
// richiesta
{
  "expectedVersion": 17,          // null al primo invio della sessione
  "mutations": [
    { "id": "uuid", "type": "add",          "productId": "…", "quantity": 2 },
    { "id": "uuid", "type": "set_quantity", "productId": "…", "quantity": 5 },
    { "id": "uuid", "type": "remove",       "productId": "…" },
    { "id": "uuid", "type": "clear" }
  ]
}
```

```jsonc
// 200
{
  "items": [ … ],                    // stato canonical rihydratato dal DB
  "version": 18,
  "appliedMutationIds": ["uuid", …],
  "unavailableProductIds": ["…"]     // prodotti inattivi/di un altro tenant
}
```

```jsonc
// 409 — nessuna scrittura effettuata
{
  "error": "Panier modifié depuis un autre appareil.",
  "code": "CART_CONFLICT",
  "items": [ … ],                    // stato canonical, evita una GET extra
  "version": 21
}
```

Altri errori: `401 CART_UNAUTHORIZED`, `400 INVALID_PAYLOAD`,
`400 INVALID_QUANTITY`, `500 SERVER_ERROR`.

### `PUT /api/customers/me/cart` *(legacy, deprecato)*

Sostituzione full-state, mantenuta per retrocompatibilità. Passa dalla stessa
funzione atomica (mutation `replace`), quindi incrementa la versione e valida i
prodotti. `expectedVersion` è opzionale. Il client Lepefy non lo usa più.

---

## 4. Concorrenza lato server

`apply_cart_mutations(tenant, customer, expectedVersion, mutations)` è una
funzione PL/pgSQL, quindi transazionale. Blocca la riga con `SELECT … FOR
UPDATE` **prima** di leggere la versione: non esiste finestra fra il controllo e
la scrittura. L'`UPDATE` finale porta comunque `AND version = <letta>` e
verifica che esattamente una riga sia stata aggiornata.

Idempotenza: ogni mutation ha un `id`; gli ultimi 100 id applicati sono
conservati in `carts.applied_mutation_ids` (ring buffer). Un retry dopo un
timeout non riapplica lo stesso `+1`.

---

## 5. Strategia di risoluzione

| Situazione | Risoluzione |
| --- | --- |
| **Add concorrenti, prodotti diversi** | Entrambi preservati: `add` è relativa, il secondo device riceve 409, riconcilia e ritenta. |
| **Add concorrenti, stesso prodotto** | Gli incrementi si sommano (`+1` e `+1` → 2). Nessuno dei due si perde. |
| **Quantity conflict** (`set 2` vs `set 5`) | Mai una somma. Il primo arrivo scrive; il secondo riceve 409, riparte dallo stato canonical e riapplica la **propria intenzione esplicita**, che diventa lo stato finale. L'altro device la apprende al ritorno sulla tab. Deterministico e senza perdita silenziosa: entrambi gli utenti finiscono sullo stesso valore, che è l'ultima quantità realmente digitata. |
| **Remove** | Assoluta, riapplicata sopra lo stato canonical. Senza mutation pendenti l'articolo rimosso altrove **non** riappare. |
| **Conflitto (409)** | Né "server wins" né "local wins": `reconcileCart(serverItems, localItems, pending)` — lo stato server è la base, le mutation ancora pendenti si riapplicano sopra, poi si ritenta. |
| **Offline** | Il carrello resta pienamente utilizzabile; le mutation si accumulano nella coda persistita. All'evento `online` si riconcilia e si svuota la coda. |
| **Login merge** | `mergeGuestCartWithServerCart()` — puro, deterministico, idempotente: unione dei prodotti, quantità = **max(locale, server)**, mai la somma (vedi §6). |
| **Errori transitori** | Backoff 1s → 2s → 4s → 8s, poi stato `error`. Le mutation non vengono mai scartate; ripartono al prossimo evento di lifecycle. |
| **Prodotto non disponibile** | Segnalato in `unavailableProductIds` e conservato in `cartStore.unavailableProductIds`, mai eliminato in silenzio. |

---

## 6. Login / guest merge

```text
locale vuoto  + server pieno  → si adotta il carrello server, zero scritture
locale pieno  + server vuoto  → si carica il carrello locale
entrambi pieni                → unione, quantità = max(locale, server)
```

Il **massimo** e non la somma: le due quantità non sono due intenzioni distinte
da cumulare, sono la stessa intenzione espressa due volte dallo stesso utente su
due dispositivi. Sommare "3 sul telefono" e "3 sul desktop" per ottenere 6 dà un
risultato che l'utente non ha mai chiesto. Inoltre `max` è idempotente
(`max(max(a,b), b) = max(a,b)`), proprietà indispensabile perché il merge può
ripartire dopo un refresh o un errore di rete a metà, mentre la somma
raddoppierebbe ad ogni ripetizione.

Il merge si applica **solo** quando il carrello locale non è mai stato
sincronizzato (guest, o proprietario diverso). Se il proprietario è lo stesso si
usa la riconciliazione, ed è questo che evita la "resurrezione" di un articolo
rimosso da un altro dispositivo.

---

## 7. Logout e isolamento

1. Ultimo flush best-effort (`keepalive`).
2. Il carrello locale viene **svuotato**: su un dispositivo condiviso il
   carrello del cliente A non deve restare visibile al visitatore successivo.
   Nessuna perdita — la copia server è intatta e viene ripristinata al login.
3. Se la coda non è stata svuotata (offline), resta associata al **suo**
   proprietario (`ownerCustomerId`). Se A si riautentica su questo dispositivo
   le mutation ripartono; se si autentica un cliente diverso vengono scartate.
   Mai inviate sulla sessione di un altro.

Un `401` produce lo stesso abbandono immediato della coda.

Lato server, tenant e customer sono derivati **solo** dalla sessione
(`getTenant` + `getSessionCustomer`); `parseSyncRequest` ignora qualsiasi
`tenantId`/`customerId` presente nel corpo, e la funzione SQL valida che ogni
prodotto appartenga al tenant corrente.

---

## 8. Performance

* Debounce di 700 ms sul flush.
* Coalescing in coda: cinque `+` sullo stesso prodotto → **una** mutation
  `add +5` → **una** richiesta HTTP.
* Batch massimo di 50 mutation per richiesta.
* Al ritorno sulla tab si riconcilia solo se l'ultimo sync ha più di 30 s
  (nessun polling).
* Le mutation sono persistite in `localStorage` **prima** dell'invio: refresh,
  navigazione o chiusura del tab non ne perdono nessuna, senza dipendere da
  `beforeunload`.

---

## 9. Test

```bash
# Test unitari (runner Playwright, nessun browser, nessuna nuova dipendenza)
pnpm --filter @lepefy/storefront test:unit

# Test SQL della migration, su un postgres locale
createdb lepefy_cart_test
psql -d lepefy_cart_test -v ON_ERROR_STOP=1 \
  -f supabase/tests/070_cart_versioning.fixture.sql \
  -f supabase/migrations/070_cart_versioning.sql \
  -f supabase/tests/070_cart_versioning.test.sql
```

---

## 10. Verifica manuale

Prerequisiti: due dispositivi (o due browser diversi) autenticati con lo stesso
account cliente.

| # | Azione | Risultato atteso |
| --- | --- | --- |
| 1 | Device A: aggiungi un prodotto da guest, poi accedi | Il carrello guest si fonde con quello server, nessun articolo perso, nessuna quantità raddoppiata |
| 2 | Device B: accedi | Il carrello contiene gli articoli di A |
| 3 | Device B: aggiungi un altro prodotto | Compare subito nella UI |
| 4 | Device A: torna sulla tab (dopo > 30 s) | Il carrello contiene i prodotti di A **e** di B |
| 5 | Device A e B: aggiungete un prodotto diverso quasi contemporaneamente | Entrambi presenti su tutti e due i dispositivi |
| 6 | Device A: quantità = 2, Device B: quantità = 5 | Nessun 7. Entrambi convergono sull'ultimo valore realmente impostato |
| 7 | Device A: rimuovi un prodotto; Device B: ricarica | Il prodotto non riappare |
| 8 | Device A: modalità aereo, premi `+` cinque volte | La UI risponde subito, nessun errore |
| 9 | Device A: riattiva la rete | Sincronizzazione automatica, quantità finale corretta, **una sola** richiesta |
| 10 | Device A: premi `+`, poi ricarica la pagina entro un secondo | La modifica non è persa (coda persistita) |
| 11 | Device A: esci dall'account | Il carrello locale è vuoto, nessun articolo visibile per il visitatore successivo |
| 12 | Device A: riaccedi | Il carrello server è ripristinato integralmente |
| 13 | Device A: esci, poi accedi con un ALTRO account | Nessun articolo del primo cliente compare nel carrello del secondo |
