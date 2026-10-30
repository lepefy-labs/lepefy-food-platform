---
id: eng-module-shipping-packlink
titolo: Spedizioni e Packlink
modulo: shipping-packlink
categoria: Logistica
stato: parziale
owner: Platform Owner
file_monitorati: [apps/storefront/src/lib/shipping/calculateShipping.ts, apps/storefront/src/lib/shipping/tariff/shippingEstimate.ts, apps/storefront/src/lib/shipping/shipmentDraft/shipmentDraftService.ts, docs/SHIPPING_FLAT_RATE_CHECKOUT.md]
---

# Spedizioni e Packlink

> Bozza iniziale derivata dalla documentazione di progetto. **Non verificata da una persona**: stato «Parziale».

## Scopo

Preventivi di spedizione al checkout, tariffe a forfait per paese, bozze di spedizione Packlink e shipping intelligence.

## Punti di ingresso

- Calcolo con Packlink: `apps/storefront/src/lib/shipping/calculateShipping.ts` — `shippingTotal = prezzo_base_packlink + IVA + (supplemento × numero_colli)`, con `num_parcels = ceil(peso_totale_g / (max_pack_kg × 1000))`; sceglie il servizio idoneo più economico (solo consegna a domicilio).
- Forfait: `tenants.shipping_pricing_mode = 'tariff'` addebita solo la versione `active` di un paese; le versioni (`shipping_tariff_versions`) sono immutabili (trigger 124). Pubblicazione: RPC `publish_shipping_tariff_version` (migration 159).
- Stima per il carrello: `apps/storefront/src/lib/shipping/tariff/shippingEstimate.ts` (stesso motore e stessi pesi del preventivo; non espone mai griglia, costi o limiti di fascia).
- Bozze Packlink: `apps/storefront/src/lib/shipping/shipmentDraft/shipmentDraftService.ts` — `requestShipmentDraft` accoda `pending` e non lancia né chiama il provider.

## Invarianti

- Lepefy crea solo una **bozza** non acquistata; l'acquisto resta in Packlink PRO; non imposta mai `shipped` né invia e-mail.
- Timeout, 5xx diversi da 503 o 2xx senza riferimento → `ambiguous`, mai ritentati in automatico; solo 429/503 ritentano (massimo 3).
- Una versione di tariffa cambiata invalida i preventivi aperti con 409 `SHIPPING_REQUOTE_REQUIRED`.
- Sulla distribuzione demo Packlink è bloccato (`resolvePacklinkApiKey` → null).

## Limiti noti

Il laboratorio forfait (bozze, retrotest) è riservato al Platform Owner e non è descritto qui.
