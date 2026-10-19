# Admin Operations V3 — Aujourd'hui, Commandes, préparation groupée et mode papier

> Stato: implementato su `main` (base analizzata `13124c67`, 20/10/2026). Migration `160_order_preparation_modes.sql` **da applicare** (additiva, nessun backfill). Il codice funziona anche prima della 160: tutti gli ordini seguono allora le regole digitali storiche.
> Proposta approvata (audit, mockup PRE/POST, decisioni D1–D4): artifact «Admin Operations V3».

## 1. Mappa

| Percorso | Ruolo |
|---|---|
| `/admin` | **Aujourd'hui** (workspace shop): saluto, «À régler en priorité», «Dernières mises à jour», «Que voulez-vous faire ?», «Commandes à préparer». Sul dominio événementiel `/admin` resta riscritto su `/admin/evenementiel`. |
| `/admin/orders` | **Commandes**: il cockpit storico invariato (KPI, Contrôles, FilterBar, DataTable a gruppi, BulkBar, export, documenti, précommandes, pagamenti per link). |
| `/admin/orders/preparation` | **Session de préparation** (stateless, `?ids=`): senza id elenca gli ordini da preparare; con id mostra la lista per articolo, gli ordini esclusi e i documenti. |
| `/admin/orders/[id]` | Dettaglio: checklist digitale **oppure** pannello «Préparation sur papier» secondo la modalità dell'ordine. |
| `/admin/parametres/preparation` | Paramètres → Commandes → **Préparation et emballage**. |

Compatibilità: `/admin?<chiave di ORDER_LIST>` (view, status, q, payment, fulfillment, dateFrom, dateTo, sort, page, size) → redirect verso `/admin/orders` con la stessa query (notifiche staff, digest, segnalibri). I back-link e i `router.push` che portavano agli ordini puntano a `/admin/orders`; `revalidatePath('/admin/orders')` affianca `revalidatePath('/admin')`.

## 2. Classificatore unico

`classifyOrderOperation` (`lib/orders/adminOrderOperations.ts`) resta l'unica fonte di KPI, viste, priorità e prossima azione per dashboard, lista, dettaglio ed export. Nuove chiavi `QueueKey` (una conta per ordine e vista, tutte viste URL valide):

- lavoro: `to_prepare` (nuovo/in preparazione, pagato, non pronto), `to_print` (modalità papier, lista non stampata), `late_preparation`, `late_pickup`, `tracking_issues`, `payment_unverified`, `stock_conflict`;
- Contrôles, consapevoli della modalità: `picking_incomplete` (solo checklist digitale), `packing_pending`, `tracking_missing`, `cold_chain` (solo controlli che la modalità prevede in Lepefy), `paper_in_progress` (informativo, mai anomalia).

I chip «Contrôles» di `/admin/orders` vengono ora dal classificatore (non più da `admin_order_dashboard_stats`, che resta per i conteggi di stato e `pending_payment_count`). `OrderOperation.step` porta l'étape: À imprimer · À préparer · Liste imprimée · Préparation en cours · Préparation terminée · Prêt à expédier / Prête au retrait (`PREPARATION_STEP_META` in `statusRegistry`).

«À régler en priorité» (`lib/admin/todayDashboard.ts`): conflitti di stock, incidenti, pagamenti da verificare (ordini + pagamenti per link + précommandes), preparazioni e ritiri in ritardo, suivis da verificare. Mai la contabilità del flusso papier.

## 3. Modalità di preparazione (migration 160)

### 3.1 Impostazione per tenant
`tenant_feature_settings('order_preparation')` = `{ version: 1, picking_mode, cold_chain_packing_mode }`, valori `digital | paper | none`, indipendenti (`lib/orders/preparation/settings.ts`, CHECK `is_valid_order_preparation_config`). Riga assente, invalida o migration assente ⇒ `digital/digital` (mai un controllo allentato per default). API `GET/PATCH /api/admin/order-preparation/settings` (`tenant_settings.view/manage`); modifica auditata dal trigger esistente `admin.module_settings.changed`.

| UI | Valore | Effetto |
|---|---|---|
| Validation article par article / Contrôle dans Lepefy | `digital` | regole storiche |
| Préparation sur papier / Contrôle sur papier | `paper` | serve una dichiarazione esplicita e nominativa |
| Sans confirmation | `none` | nessun controllo registrato; la transizione finale timbra `preparation_unverified_at` |

### 3.2 Snapshot per ordine
`orders.preparation_mode` è fissato all'avvio della preparazione (`new → preparing` in `updateWorkflowOrder`, o «Imprimer et démarrer»). Snapshot assente = digitale (tutti gli ordini esistenti). Cambiare l'impostazione non riscrive mai un ordine avviato. Eccezione deterministica (`modeOnStart`): un ordine in preparazione **senza snapshot e senza alcun lavoro digitale** (nessuna riga prelevata, nessun imballaggio) adotta il modo corrente alla prima «Imprimer et démarrer».

### 3.3 Regole (`lib/orders/preparation/preparationPolicy.ts`)
Funzioni pure `preparationState`, `preparationBlockers`, `preparationStep`, lette da `assertPreparationComplete` (quindi PATCH di stato, sync/associazione Packlink), `bulk-status`, route `packing`, classificatore, dettaglio, sessione e dashboard. Nessun bypass nel frontend.

- **Colonne digitali intoccabili**: `order_items.picked_at`, `cold_chain_checked_at`, `picking_completed_at`, `cold_chain_packing_checked_at`, `packing_completed_at` sono scritte solo da azioni digitali. Il flusso papier scrive `picking_list_printed_at`, `paper_preparation_started_at/_by`, `paper_preparation_completed_at/_by`, `cold_chain_packing_declared_at`; «sans confirmation» solo `preparation_unverified_at`.
- **Sempre richiesti**: pagamento `paid` per avviare/confermare, nessun conflitto di stock, transizioni valide, numero di colli ≥ 1 inserito da un utente per le spedizioni (suggerimento del piano cartoni solo come aiuto), tracking per `shipped` (o spedizione gestita), regole del suivi géré. Nessuna spedizione creata, nessun `shipped`/`delivered` automatico.
- **Freschi e surgelati**: restano in fondo a ogni lista; con `cold_chain_packing_mode = paper` la dichiarazione froid è obbligatoria per spedire; con `digital` il controllo digitale resta obbligatorio anche se il picking è papier.
- **Legacy digital/digital**: identico a prima (liste: `packing_completed_at`; transizione: colli + controllo froid).

### 3.4 Flusso papier
1. «Imprimer et démarrer la préparation» → `POST /api/admin/orders/preparation/start { orderIds }` (`orders.manage`, max 50): per ogni ordine pagato `new → preparing` via `updateWorkflowOrder` (CAS, effetti collaterali solo al vincitore), snapshot, prima stampa registrata; già avviato = nessuna transizione; CAS perso = ordine «ready» senza doppio avvio; non pagati / conflitto stock / chiusi saltati con motivo. Poi il browser apre il PDF (GET puro, nessuna mutazione).
2. Preparazione sul foglio (la stampa da sola non rende l'ordine pronto).
3. «Préparation terminée» → `POST /api/admin/orders/[id]/preparation { allPrepared, parcelCount, coldDeclared }` (`orders.manage`): CAS su `paper_preparation_completed_at is null`, idempotente (un retry non riscrive autore né colli); `DELETE` annulla la dichiarazione finché l'ordine è in preparazione.
4. Expédier / Prête au retrait con le protezioni abituali.

### 3.5 Audit
Tipi `orders.preparation.paper_started`, `orders.preparation.paper_completed` (anche ritiro, `metadata.withdrawn`), `orders.preparation.unverified_advance`, emessi dal trigger `audit_order_preparation_update` (fail-open come gli altri eventi ordini, attore dagli header `x-lepefy-audit-*`). La transizione resta `orders.order.status_changed`.

## 4. Session de préparation e lista groupée
`lib/orders/preparation/preparationSummary.ts` (puro): una riga per prodotto + libellé venduto (+ conservazione), totale e ripartizione per ordine sempre visibili; ordine `sortPickingItems` (secco → fresco → surgelato, poi emplacement, senza emplacement in fondo al gruppo); «À vérifier» solo per fatti del catalogo attuale (prodotto rimosso/disattivato, stock negativo). Ordini annullati esclusi; nella pagina anche non pagati / conflitto / chiusi con motivo. Per gli ordini digitali in preparazione mostra cosa resta da prelevare.

PDF: nuovo kind `preparation-summary` su `GET /api/admin/orders/documents/[kind]?ids=&format=` (`orders.view`, stesso Gotenberg, formato di default = quello della liste de préparation del tenant, A5/A4). Le liste individuali restano invariate e si stampano insieme («Listes individuelles»).

## 5. Navigazione
Registry `lib/admin/navigation.ts`: gruppo **Essentiel** sempre aperto e senza titolo visibile — Aujourd'hui (`/admin`, exact), Commandes (`/admin/orders`), Produits (catalogue), Livraisons, Clients — poi gruppi pieghevoli Ventes, Croissance, Canaux, Gestion, Contenu & outils, Administration (aperti sulla voce attiva, stato ricordato nel browser, tutte le icone visibili nel rail compresso). Événementiel e Service sur place restano aperti nel loro workspace. Barra mobile: Aujourd'hui · Commandes · Produits · Plus (un cassiere conserva Scan fidélité). Azione palette «Préparer les commandes». RBAC, flag e workspace invariati.

## 6. Prestazioni
La dashboard riusa la lettura leggera degli ordini attivi di `loadOrderWorkQueue` (vista `to_prepare`, 8 righe complete), due `count head` (pagamenti per link, précommandes), un `count head` del giorno e 8 righe recenti; nessun provider, nessuno storico. La sessione legge al massimo 50 ordini, i loro articoli e i fatti catalogo dei prodotti coinvolti. Polling invariato.

## 7. Prima della migration
`lib/orders/preparation/compat.ts`: le letture che selezionano le colonne 160 riprovano senza di esse su errore `42703` (work queue, bulk-status, packing, sessione). Le scritture delle colonne 160 avvengono solo se il modulo `order_preparation` è registrato (stessa migration). Le impostazioni rispondono 409 «La migration 160 doit être appliquée…».

## 8. Attivazione Chloe Food (D4 — da eseguire dal tenant o su richiesta esplicita)
Dopo aver applicato la 160: Paramètres → Commandes → Préparation et emballage → «Préparation sur papier» + «Contrôle sur papier» → Enregistrer. Equivalente SQL (Supabase SQL editor):

```sql
insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
select id, 'order_preparation', true, '{"version":1,"picking_mode":"paper","cold_chain_packing_mode":"paper"}'::jsonb
from public.tenants where slug = 'chloefood'
on conflict (tenant_id, feature_key) do update set config = excluded.config, enabled = true, updated_at = now();
```

Gli ordini già «En préparation» senza lavoro digitale passano al papier alla prima «Imprimer et démarrer»; quelli con righe già spuntate restano digitali.

## 9. Test
- `tests/unit/orderPreparation.spec.ts`: impostazioni, policy (digital/papier/none, froid, colli), state machine (snapshot, blocchi, `preparation_unverified_at`), flusso papier (idempotenza, CAS concorrente, non pagato, altro tenant), classificatore, sessione, dashboard, URL legacy, compat pre-160.
- `adminOrderOperations`, `adminNavigation`, `settingsHub`, `activityAudit` (parità catalogo audit con la 160), `orderDocuments` aggiornati.
- SQL: `supabase/tests/160_order_preparation_modes.{fixture,test}.sql` (CI, migration applicata due volte).
