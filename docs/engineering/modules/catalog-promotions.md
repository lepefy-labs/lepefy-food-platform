---
id: eng-module-catalog-promotions
titolo: Catalogo e promozioni
modulo: catalog-promotions
categoria: Catalogo
stato: parziale
owner: Platform Owner
file_monitorati: [apps/storefront/src/lib/catalog/promotions.ts, apps/storefront/src/lib/catalog/promotionSchedule.ts, apps/storefront/src/lib/purchaseQuantityRules.ts, docs/CART_SYNC.md]
---

# Catalogo e promozioni

> Bozza iniziale derivata dalla documentazione di progetto. **Non verificata da una persona**: stato «Parziale».

## Scopo

Prodotti e categorie, regole di quantità minima e passo, promozioni programmate, novità, «petits plus», duplicazione prodotto e carrello.

## Punti di ingresso

- Regole di quantità: `apps/storefront/src/lib/purchaseQuantityRules.ts` — la quantità `q` è valida se `q >= minimo` e `(q - minimo) % passo == 0`; un solo motore usato da server e client, mai reimplementato.
- Promozioni: `apps/storefront/src/lib/catalog/promotions.ts` (`hasValidPromotion`, `isActivePromotion`).
- Programmazione: `apps/storefront/src/lib/catalog/promotionSchedule.ts` (`resolvePricingColumns`, stessa regola dell'SQL `apply_product_promotion_schedule()`, chiamata ogni 5 minuti da n8n tramite `POST /api/internal/catalog-schedule`).
- Proiezione unica delle card prodotto: `PRODUCT_CARD_SELECT` in `src/lib/catalog/productCardSelect.ts`.

## Invarianti

- `products.price` è sempre il prezzo pagato: nessun lettore calcola un prezzo.
- Il checkout non può mai avere un carrello non valido (validazione autoritativa lato server); i controlli lato client sono solo UX.
- La migration 156 deve essere applicata prima del deploy del codice che legge le nuove colonne di `PRODUCT_CARD_SELECT`.
- Il carrello degli utenti autenticati è sincronizzato con controllo ottimistico di versione (`apply_cart_mutations`, migration 070); i carrelli ospite restano in `localStorage`.
