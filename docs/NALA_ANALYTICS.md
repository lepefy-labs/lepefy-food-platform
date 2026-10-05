# Nala Analytics (migrations 095, 097, 098)

Documento di riferimento della pagina `/admin/nala-analytics`: da dove arrivano i numeri, cosa misurano, privacy e ritenzione.

## 1. Accesso
- Permesso RBAC `ai_usage.view` (`adminRoutePermissions.ts`).
- La pagina compare solo con l'entitlement `nala_analytics` (`hasTenantFeature`). Senza, mostra « n'est pas inclus dans votre offre » e nessuna metrica.
- Se il modulo IA è sospeso (abbonamento, `tenantServiceState`), la pagina mostra « Module IA suspendu ». Non dice « non incluso ».

## 2. Fonti dati
| Tabella | Scritta da | Uso |
|---|---|---|
| `nala_sessions` | `resolve_nala_session` a ogni conversazione | conteggio « Conversations » (`started_at` nel periodo) |
| `nala_interactions` | ogni messaggio a Nala (`message_text` ≤ 300 caratteri) | messaggi, intenti, segnali di qualità |
| colonne 097 (`intent`, `demand_status`, `knowledge_status`, `retrieval_quality`, `requested_product_text`) | arricchimento semantico (GitHub Action `nala-semantic-enrichment.yml`, job `enrich-pending-interactions`) | domande senza risposta, prodotti introvabili, risposte deboli |
| `nala_conversion_events` | `api/nala/attribution` (add_to_cart, checkout_started) e `record_nala_purchase_attribution` (ordine pagato) | funnel e vendite assistite |

Il loader è `lib/admin/nalaAnalyticsDashboard.ts`; le regole pure stanno in `lib/admin/nalaAnalyticsRules.ts` (test: `tests/unit/nalaAnalytics.spec.ts`).

## 3. Blocchi della pagina
- **Parcours d'achat**: Conversations → Ajout au panier → Paiement commencé → Commande payée.
  - Ogni passo conta le conversazioni distinte (`nala_session_id`, altrimenti l'interazione).
  - La percentuale è calcolata sulle conversazioni del periodo.
- **Ventes assistées**: valore degli articoli proposti da Nala e poi acquistati, esclusi spedizione e sconti.
  - Contano solo gli ordini con `payment_status = 'paid'`, `status ≠ 'cancelled'` e `is_test = false`, letti con una query su `orders` ogni 200 ordini (nessun N+1).
  - Il numero di ordini esclusi viene mostrato.
  - È un'attribuzione: misura un contributo, non una causa.
- **Activité**: copre tutto il periodo, con barre giornaliere a 7 e 30 giorni e settimanali a 90. I giorni sono nel fuso orario **Europe/Rome**.
- **Questions sans réponse** (`knowledge_status = 'missing'`): gli ultimi 5 messaggi e il link all'AI Lab per completare la base di conoscenza.
- **Produits demandés introuvables** (`demand_status = 'unmet'`): raggruppati per `requested_product_text`, con un esempio di messaggio e il link a `/admin/catalogue?q=<termine>`.
- **Réponses produit peu sûres** (`retrieval_quality` `weak`/`empty`): esempi di ricerche prodotto con risultati scarsi o assenti.
- **Ce que les clients demandent**: i primi 6 intenti.
- **Paniers recettes**: interazioni `recipe` con prodotti proposti, contro quelle seguite da un add_to_cart.
- **Produits proposés**: prodotto diretto, simile, alternativa o complementare.
- **Avviso « Analyse en cours »**: compare se meno del 90 % dei messaggi del periodo è arricchito. In quel caso le liste di qualità sono parziali.

## 4. Privacy
- Gli estratti di messaggio sono troncati a 120 caratteri. E-mail e numeri di telefono (7 o più cifre) vengono sostituiti con `[e-mail]` e `[téléphone]` (`redactMessage`).
- Non vengono mai mostrati cliente, sessione, città o dispositivo.
- I messaggi completi non lasciano mai il server: la pagina è un Server Component.

## 5. Ritenzione (90 giorni)
- `purge_expired_nala_analytics()` (095) cancella le sessioni più vecchie di 90 giorni per tutti i tenant. Le interazioni vengono cancellate a cascata; gli eventi di conversione restano anonimi, con riferimenti `null`.
- Viene invocata da `POST /api/internal/nala-analytics-purge`:
  - autenticazione `Authorization: Bearer $NALA_ANALYTICS_PURGE_CRON_SECRET`, confronto timing-safe;
  - risposta `{ ok, deletedSessions }`;
  - idempotente.
- Template n8n: `ops/n8n/nala-analytics-purge.json`. Gira ogni giorno alle 03:30 (Europe/Rome), con un trigger manuale; viene importato disattivo.

**Attivazione:**
1. Generare un secret e impostare `NALA_ANALYTICS_PURGE_CRON_SECRET` sui progetti Vercel `chloefood` e `lepefy-food-test`.
2. In n8n importare il workflow e creare una credenziale « Header Auth » con `Authorization: Bearer <secret>`. Associare la credenziale al nodo HTTP e l'Error Workflow standard.
3. Lanciare « Manual test » (risposta attesa `ok: true`), poi attivare il workflow.

Prima di questa attivazione la ritenzione dichiarata **non era applicata**: le conversazioni restavano indefinitamente.

## 6. Limiti noti
- Il loader legge in memoria tutte le righe del periodo (paginazione da 1000). Va bene con i volumi attuali; oltre qualche decina di migliaia di messaggi su 90 giorni servirà un RPC di aggregazione SQL, che richiede una migrazione.
- Le conversioni sono filtrate per `occurred_at` e le conversazioni per `started_at`: un ordine di inizio periodo può provenire da una conversazione precedente.
- Un ordine rimborsato dopo il pagamento viene escluso dal fatturato solo se `payment_status` diventa `refunded` o lo stato diventa `cancelled`.
