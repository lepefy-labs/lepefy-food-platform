# Shipping system — guida di integrazione
## Configurazione finale ChloeFood (Giugno 2026)

### Decisioni cliente
- Tutti i prodotti trattati allo stesso modo — nessuna logica per tipo conservazione nel calcolo spedizione
- Corriere scelto da Packlink PRO in tempo reale via API
- Surplus imballaggio: configurabile in DB (`surcharge_amount` + `surcharge_mode`)
  - Valore attuale: 3,00 € per pacco (`per_parcel`)
- IVA sul prezzo Packlink: configurabile per paese in DB (`shipping_vat_rates`)
  - IT/FR/BE/DE: 22% precauzionale — verificare se Packlink include già l'IVA
  - CH: 0% (extra-UE)
- Spedizione gratuita: non configurata al lancio

---

## File di destinazione

| File generato | Destinazione nel progetto |
|---|---|
| `003_shipping_packlink.sql` | `supabase/migrations/003_shipping_packlink.sql` |
| `calculateShipping.ts` | `apps/storefront/src/lib/shipping/calculateShipping.ts` |
| `route-shipping-quote.ts` | `apps/storefront/src/app/api/shipping/quote/route.ts` |
| `cartStore.ts` | `apps/storefront/src/stores/cartStore.ts` |

---

## 1. Variabili d'ambiente

Aggiungere in `apps/storefront/.env.local`:

```bash
# Packlink PRO — recuperare da: pro.packlink.it/private/settings/api-key
PACKLINK_API_KEY=your_api_key_here
```

> ⚠️ `PACKLINK_API_KEY` è server-only. Non aggiungere mai il prefisso `NEXT_PUBLIC_`.

---

## 2. Formula di calcolo

```
num_pacchi    = ceil(peso_totale_g / (max_pack_kg × 1000))

packaging     = surcharge_amount × num_pacchi   (se surcharge_mode = 'per_parcel')
              = surcharge_amount                 (se surcharge_mode = 'per_order')

vat           = packlink_price × vat_rate        (aliquota per paese da DB)

shippingTotal = packlink_price + vat + packaging
```

Il cliente vede solo `shippingTotal`. Corriere, IVA e imballaggio sono invisibili.

---

## 3. Schema DB — tabelle create dalla migration 003

### `packaging_surcharges` (1 riga per tenant)

| Colonna | Tipo | Valore ChloeFood |
|---|---|---|
| `surcharge_amount` | `numeric(10,2)` | `3.00` |
| `surcharge_mode` | `text` | `'per_parcel'` |
| `max_pack_kg` | `numeric(6,2)` | `15.00` |
| `active` | `boolean` | `true` |

Per cambiare a costo fisso per ordine, senza toccare il codice:
```sql
update packaging_surcharges
set surcharge_mode = 'per_order', surcharge_amount = 5.00
where tenant_id = (select id from tenants where slug = 'chloefood');
```

### `shipping_vat_rates` (N righe per tenant)

| `countries` | `vat_rate` | Note |
|---|---|---|
| `{IT}` | `0.22` | IVA ordinaria — verificare se Packlink la include già |
| `{FR,BE,DE}` | `0.22` | Precauzionale UE |
| `{CH}` | `0.00` | Extra-UE, esente |
| `{*}` | `0.22` | Fallback per tutti gli altri paesi |

Se Packlink include già l'IVA nel prezzo API, impostare tutto a `0.00`:
```sql
update shipping_vat_rates
set vat_rate = 0.00
where tenant_id = (select id from tenants where slug = 'chloefood');
```

### `products.storage_type`

Colonna aggiunta a `products` — valori: `dry` / `fresh` / `frozen`.
Non entra nel calcolo spedizione. Solo uso admin e report.

---

## 4. Chiamata al quote dal checkout (client-side)

```tsx
async function fetchShipping(zipCode: string, country: string) {
  const payload = useCartStore.getState().shippingPayload();
  // payload = Array<{ weight_grams: number | null; quantity: number }>

  const res = await fetch('/api/shipping/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: payload,
      to: { country, zip_code: zipCode },
    }),
  });

  const data = await res.json();
  // { available: true, shippingTotal: number }
  // { available: false, message: string }

  if (data.available) {
    setShippingCost(data.shippingTotal);
  } else {
    setShippingError(data.message);
  }
}
```

---

## 5. Mostrare il costo nel riepilogo ordine

```tsx
<div className="flex justify-between text-sm">
  <span>Livraison</span>
  <span className="font-semibold">
    {shippingCost !== null
      ? formatPrice(shippingCost, 'EUR')
      : "Calculé à l'étape suivante"}
  </span>
</div>
```

Corriere, IVA e surplus imballaggio non compaiono mai nell'UI.

---

## 6. Ambiente sandbox vs produzione

| | Sandbox | Produzione |
|---|---|---|
| `PACKLINK_API_BASE` in `calculateShipping.ts` | `https://apisandbox.packlink.com/v1` | `https://api.packlink.com/v1` |
| API key | Account sandbox Packlink | Account PRO reale (`pro.packlink.it/private/settings/api-key`) |

Cambiare la costante `PACKLINK_API_BASE` in `calculateShipping.ts` prima del go-live.

---

## 7. Creazione spedizione su Packlink al pagamento (Phase 2)

Al lancio la cliente crea manualmente le spedizioni dalla dashboard Packlink PRO.
In Phase 2 questo può essere automatizzato via API route o Supabase Edge Function:

```ts
// POST https://api.packlink.com/v1/shipments
const res = await fetch('https://api.packlink.com/v1/shipments', {
  method: 'POST',
  headers: { Authorization: process.env.PACKLINK_API_KEY! },
  body: JSON.stringify({
    service_id: serviceId, // dal quote
    packages: parcels,
    from: { /* indirizzo negozio */ },
    to:   { /* indirizzo cliente */ },
    content: { description: 'Produits alimentaires', value: orderTotal },
  }),
});
```

---

## 8. Comportamenti garantiti

| Scenario | Risultato |
|---|---|
| Qualsiasi prodotto, qualsiasi peso → IT | Packlink quota, `shippingTotal` mostrato |
| Qualsiasi prodotto → FR / BE / DE / CH | Packlink quota se servizio disponibile per quel CAP |
| Nessun servizio Packlink disponibile | `available: false`, messaggio chiaro, checkout bloccato |
| Errore API Packlink (timeout, 5xx) | `available: false`, messaggio di retry |
| Corriere mai mostrato al cliente | ✅ solo `shippingTotal` esposto dalla route |
| IVA mai mostrata separatamente | ✅ inclusa nel `shippingTotal` |
| Surplus imballaggio mai mostrato | ✅ incluso nel `shippingTotal` |
| Surplus scala con n. pacchi | ✅ `surcharge_amount × ceil(peso / max_pack_kg)` se `per_parcel` |
| Cambio importo/modalità imballaggio | ✅ update SQL su `packaging_surcharges`, zero deploy |
| Cambio aliquota IVA per paese | ✅ update SQL su `shipping_vat_rates`, zero deploy |

---

## 9. Checklist pre-lancio

- [ ] Recuperare API key Packlink → `pro.packlink.it/private/settings/api-key` → aggiungere in `.env.local` come `PACKLINK_API_KEY`
- [ ] Cambiare `PACKLINK_API_BASE` in `calculateShipping.ts` da sandbox a produzione
- [ ] Verificare con Packlink se il prezzo API è IVA inclusa → aggiornare `vat_rate` in `shipping_vat_rates` se necessario
- [ ] Testare `POST /api/shipping/quote` con ordini reali in ambiente sandbox Packlink
- [ ] Classificare i prodotti del catalogo con `storage_type` corretto (dry / fresh / frozen)
- [ ] Confermare che il surplus 3 € per pacco copre i costi reali di imballaggio
