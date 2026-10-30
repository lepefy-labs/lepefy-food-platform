---
id: eng-module-gestion
titolo: Gestion du commerce
modulo: gestion
categoria: Operazioni
stato: parziale
owner: Platform Owner
file_monitorati: [apps/storefront/src/lib/gestion/featureGate.ts, apps/storefront/src/lib/gestion/quantity.ts, docs/BUSINESS_MANAGEMENT.md]
---

# Gestion du commerce

> Bozza iniziale derivata dalla documentazione di progetto. **Non verificata da una persona**: stato «Parziale».

## Scopo

Fornitori, acquisti, giacenze, registro dei movimenti di magazzino e tesoreria, sotto `/admin/gestion/**` e `/api/admin/gestion/**`.

## Punti di ingresso

- Accesso: `apps/storefront/src/lib/gestion/featureGate.ts` — ogni pagina chiama `requireBusinessManagementPage()` e ogni handler `requireBusinessManagementApi()`; flag `business_management` spento o illeggibile = 404. Nascondere la voce di menu non è il controllo di sicurezza.
- Quantità: `apps/storefront/src/lib/gestion/quantity.ts` (BigInt, mai float JavaScript).

## Invarianti

- Ogni riferimento fra entità è una chiave esterna composta `(tenant_id, id)`; RLS senza policy, solo service role; nessun DELETE su tabelle finanziarie o di audit (si storna o si annulla).
- I saldi non sono memorizzati: si leggono da `supplier_purchase_financials` / `supplier_balances`; solo le allocazioni di pagamenti **verificati** riducono il debito verso il fornitore.
- `products.stock` resta la giacenza canonica dello storefront; una ricezione la incrementa e scrive `inventory_movements` nella stessa transazione RPC.
- Le quantità di acquisto sono `numeric(14,3)`; una ricezione deve convertirsi in unità intere di stock (rifiutata altrimenti, mai arrotondata).
- I costi di acquisto vivono solo in `product_costs` / `product_cost_history` (solo server), mai su `products` né nei payload client.
