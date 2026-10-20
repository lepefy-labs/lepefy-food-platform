# Clôture des commandes — annulation motivée et commandes traitées hors plateforme

> Stato: implementato su `main` (base analizzata `c8354c1f`, 20/10/2026). Migration `161_order_closure.sql` additiva, senza backfill, applicata in produzione il 20/10/2026 dopo il deploy di `0b406741` (verificata: 7 colonne su `orders`, tipo audit `orders.order.closed`, viste con `external_closure_count`, nessun ordine modificato). In un ambiente senza la 161 la route risponde 503 e le liste ignorano le colonne nuove.
> Proposta approvata (DISCOVER, mockup PRE/POST, decisioni D1–D4): artifact «Clôture des commandes».

## 1. Modello
- Lo stato resta **`cancelled`** per ogni chiusura: nessuna nuova transizione nella state machine (`adminOrderWorkflow`). Chiudibili: `new`, `preparing`, `ready_for_pickup` (ritiro).
- `orders.closure_type`: `cancelled` (annullamento commerciale, vendita persa) | `handled_externally` (finalizzata direttamente con la boutique: né vendita persa, né pagamento confermato, né consegna). Null su un ordine annullato = annullamento storico (contato come commerciale).
- `closure_reason` ∈ `handled_externally | duplicate | customer_request | product_unavailable | other` (`other` richiede una nota), `closure_note` (interna, ≤ 500), `closure_notification` ∈ `none | standard | custom`, `closure_message` (20–1 000, solo `custom`), `closed_at`, `closed_by` (`admin_users`). CHECK `orders_closure_check` impone la coerenza (stato `cancelled`, tipo ↔ motivo, niente `standard` per `handled_externally`).

## 2. Un solo percorso
`POST /api/admin/orders/[id]/close` (`orders.manage`) → `lib/orders/closure/orderClosureService.ts` `closeOrder`:
1. ordine letto per tenant; già chiuso con la stessa decisione ⇒ risposta idempotente (`alreadyClosed`), decisione diversa ⇒ 409;
2. regole pure `lib/orders/closure/closureRules.ts` `closureIssues` (stesse del dialog): stato chiudibile, motivo, comunicazione ammessa, messaggio, nota, guardia spedizione;
3. **una sola scrittura CAS** (`updateWorkflowOrder`) con stato + intera decisione: transizione e comunicazione non possono divergere; CAS perso ⇒ si rilegge e, se il vincitore ha registrato la stessa chiusura, esito idempotente;
4. comunicazione scelta: `standard` = e-mail storica «Commande annulée» (effetto di transizione, chiave ledger `order-cancelled:<id>`); `custom` = `orderClosureMessageEmail` via `send-email` (ledger retry, chiave `order-closure-message:<id>`, testo con escape, mai formulato per forza come annullamento); `none` = nulla. `runOrderTransitionSideEffects({ customerEmail: false })` sopprime l'e-mail standard per `none`/`custom`; loyalty/avis non cambiano.
`PATCH /api/admin/orders/[id] { status: 'cancelled' }` risponde 400: nessun secondo percorso di annullamento. Notifiche interne: nessuna (come prima); le notifiche cliente passano solo da qui.

## 3. Sicurezza operativa
- Mai modifiche a `payment_status`, mai rimborsi, mai ripristino stock (come prima), mai azioni Packlink.
- Ordine pagato ⇒ avviso nel passo «Vérifier».
- Spedizione: bozza Packlink `draft_created`, riferimento associato o tracking manuale ⇒ casella di presa in carico obbligatoria (`shipmentAcknowledged`); creazione bozza `creating`/`ambiguous`, collo in carico al corriere (`in_transit`, `out_for_delivery`, `ready_for_collection`, `delivered`), `shipped`/`delivered` ⇒ chiusura bloccata. Le bozze ancora in coda (`pending`) sono già liberate dal servizio bozze per un ordine non attivo.
- Ordine senza e-mail: solo «Ne pas notifier»; il messaggio si copia per WhatsApp/SMS.
- Audit: trigger `audit_order_closure_update` → `orders.order.closed` (tipo, motivo, modalità, `has_note`, stato precedente, stato pagamento; **mai il testo del messaggio**); la transizione resta `orders.order.status_changed`. Stato d'invio leggibile nel ledger `notification_deliveries` (mostrato nel dettaglio).

## 4. UI
- Dettaglio: azione secondaria «Clôturer ou annuler…» sotto i documenti → `OrderClosureDialog` (kit V2, bottom sheet su telefono): passo 1 motivo, nota, comunicazione, editor del messaggio pre-compilato per motivo (`defaultClosureMessage`) finché non modificato; passo 2 avvisi pagamento/spedizione, presa in carico, riepilogo (risultato, statistiche) e conferma «Clôturer la commande» (hors plateforme) o «Annuler la commande» (danger). Dialog non chiudibile durante l'invio, errori in linea, esito con toast.
- Badge `StatusBadge closureType` «Traitée hors plateforme» (info) al posto di «Annulé» in lista, dettaglio, dashboard (attività recente), CSV.
- Blocco «Clôture» nel dettaglio: motivo, autore e data, comunicazione e stato d'invio, nota, messaggio inviato.
- Filtri Commandes: «Clôture» (`?closure=cancelled|external`, conteggi) e «Motif de clôture» (`?reason=`), chip attivi.

## 5. Statistiche
- `admin_order_dashboard_stats.cancelled_count` = annullamenti commerciali (storici inclusi); nuovo `external_closure_count`; `this_month_revenue` ora esclude gli ordini annullati (non era usato da nessuna pagina).
- CRM cliente, ranking prodotti, Nala Analytics continuano a escludere tutti gli ordini `cancelled`: una chiusura esterna non diventa fatturato in linea.
- Funnel checkout invariato (sessioni, non ordini).

## 6. Limiti noti
- Le pagine cliente (`/orders/[id]`, portale QR) mostrano ancora «Annulée» anche per una chiusura hors plateforme: il messaggio personalizzato è il canale previsto per spiegarlo.

## 7. Test
- `tests/unit/orderClosure.spec.ts`: regole, silenzioso senza e-mail, standard con chiave storica, messaggio personalizzato con escape, hors plateforme, senza e-mail, pagato, Packlink (presa in carico / blocco), doppio clic e CAS concorrente, isolamento tenant, permesso, percorso unico.
- `supabase/tests/161_order_closure.{fixture,test}.sql` (CI, migration due volte): CHECK di coerenza, annullamenti storici intatti, un evento audit per chiusura senza messaggio, statistiche separate.
