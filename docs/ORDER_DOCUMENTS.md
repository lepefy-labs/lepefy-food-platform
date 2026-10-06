# Documenti delle commande e portale QR (migration 145, applicata in produzione)

Documento di riferimento per la liste de préparation, il bon de colis, il portale cliente `/o/[token]` e le preferenze tenant. Il codice resta la source of truth. Lato Shipping Intelligence (carton suggestion, file map, invarianti): `docs/SHIPPING_INTELLIGENCE.md` §3.1–3.2.

## 1. Due documenti, una base dati

```text
Order
  → loadOrderDocumentData (lotto, tenant-scoped, colonne esplicite)
      ├── buildPickingListViewModel  → InternalOrderDocumentViewModel  → pickingListHtml (A5 | A4)
      └── buildPackingSlipViewModel  → CustomerOrderDocumentViewModel  → packingSlipHtml (A5 | A4)
                                                                            → htmlToPdf (Gotenberg) → PDF
```

- **Liste de préparation** (interna): emplacements, chaîne du froid, riepilogo unità/peso/colli, emballage suggéré (solo consegna), firme. Di default solo nome + CAP/città; indirizzo completo (via, complemento, «CAP città, paese», «Destinataire : …» se diverso dal cliente) solo con `picking_list_show_delivery_address`.
- **Bon de colis** (cliente, nel pacco; titolo stampato «RÉCAPITULATIF DE COMMANDE»): marca, «Merci <prénom> !», réf. courte e data, articoli, QR del portale, ringraziamento, contatti. Il view-model cliente è costruito campo per campo: non riceve mai la riga `orders` né item grezzi. Il loader non legge `notes`, `email`, telefono o pagamento.
- File: `apps/storefront/src/lib/orders/documents/*`.

## 2. Formati

`ORDER_DOCUMENT_FORMATS` (`formats.ts`): `a5` (148×210, default, raccomandato) e `a4` (210×297), portrait. Ogni formato ha il proprio layout (non un A4 scalato). Font informativo minimo 10 pt, quantità 16–17 pt, caselle 6/7 mm. Multipagina: righe non spezzate, `thead` ripetuto con la réf. come intestazione ridotta, piè di pagina «#REF · Page X/Y» (nel lotto la numerazione è quella del PDF intero).

Aggiungere un formato (letter, a6, thermal_80): voce del registro, layout nei due renderer, valore nel CHECK `is_valid_order_documents_config`.

## 3. Preferenze tenant

`tenant_feature_settings (tenant_id, 'order_documents')`, config piatta v1:

| Chiave | Default |
|---|---|
| `picking_list_format` | `a5` |
| `picking_list_show_delivery_address` | `false` (solo consegne; chiave aggiunta dalla 146) |
| `packing_slip_enabled` | `true` |
| `packing_slip_format` | `a5` |
| `packing_slip_show_logo` / `_show_qr` / `_show_thank_you` / `_show_contact` | `true` |
| `packing_slip_show_prices` | `false` (un colis può essere un regalo) |
| `packing_slip_show_delivery_address` | `false` |

- Riga assente, invalida o migration assente ⇒ default (mai prezzi o indirizzo per errore). `enabled` della riga non è usato (scritto `true`).
- UI: `/admin/parametres/documents` (registro del Settings Hub, gruppo Commerce). API: `GET/PATCH /api/admin/order-documents/settings` (`tenant_settings.view` / `tenant_settings.manage`).
- Il formato si può cambiare per la singola stampa senza toccare il default.

## 4. Generazione PDF

| Route | Permesso | Note |
|---|---|---|
| `GET /api/admin/orders/[id]/documents/picking-list?format=a5\|a4&download=1` | `orders.view` | |
| `GET /api/admin/orders/[id]/documents/packing-slip?format=…` | `orders.view` | crea il token del portale al primo bon |
| `GET /api/admin/orders/documents/{picking-list\|packing-slip}?ids=a,b&format=…` | `orders.view` | un solo PDF, ordine degli `ids`, max 50 |

- Risposta: `application/pdf`, `inline` (o `attachment` con `download=1`), `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`. Nomi: `commande-CC4314FE-preparation-a5.pdf`, `commande-CC4314FE-bon-de-colis-a5.pdf`, `preparation-2026-10-05-a5.pdf`, `bons-de-colis-2026-10-05-a5.pdf`.
- Errori (francese; pagina HTML se aperta in navigazione): formato sconosciuto 400, ordine assente/altro tenant 404, annullato 409, bon de colis disattivato 409, lotto > 50 413, Gotenberg assente/irraggiungibile/timeout 503, errore di conversione 502. Nel lotto gli ordini assenti, di altro tenant o annullati sono esclusi (`X-Documents-Skipped`).
- Gotenberg: client unico `lib/labels/gotenberg.ts`, `htmlToPdf(html, options)` con carta e margini dal registro, `footer.html`, timeout 25 s. Senza opzioni gli altri consumer (etichette, affiche, biglietti, liste Événementiel) restano invariati. Env: `GOTENBERG_URL`, `GOTENBERG_AUTH`.
- UI: sezione «Documents» del dettaglio ordine (`OrderDocumentsCard`, scelta A5/A4 puntuale), azioni rapide nella riga espansa della lista al formato di default (`Liste de préparation · A5`, e per le consegne `Bon de colis · A5` se attivo), azione di gruppo «Documents…» (`BulkDocumentsDialog`). Navigazione HTTP diretta al PDF (funziona anche in PWA); nessun `window.print`.

## 5. QR e token

- URL: `<storefront_url del tenant>/o/<token>` (`getAdminWorkspaceUrls`, fallback `NEXT_PUBLIC_APP_URL`; mai l'header Host). Stampato anche in chiaro sotto il QR, con eventuale ritorno a capo solo dopo `/o/` e mai dentro il token (SVG locale, libreria `qrcode`, correzione M, 32 mm in A5 / 38 mm in A4).
- Token: `base64url(HMAC-SHA256(TRACKING_SECRET, "order-portal:<rowId>:<nonce>"))` troncato a 128 bit (22 caratteri). Nessun UUID, PII, payment intent o URL provider.
- Tabella `order_public_access_tokens`: `tenant_id`, `order_id`, `purpose = 'order_portal'`, `token_nonce`, `token_hash` (SHA-256), `created_at`, `revoked_at`; unique `(tenant_id, token_hash)`; indice unico parziale «un token attivo per ordine». RLS forzata senza policy, nessun grant `anon`/`authenticated`.
- Ciclo di vita: creazione pigra al primo bon de colis (in lotto per i lotti); ristampa = stesso token; nessuna scadenza breve (il foglio può essere usato mesi dopo); revoca = `revoked_at` (`revokeOrderPublicTokens`, senza UI per ora), il bon successivo riceve un nuovo token. Un token emesso con un `TRACKING_SECRET` precedente viene revocato e riemesso alla stampa successiva.
- Il token non viene mai loggato, salvato in chiaro o inviato agli analytics (il widget Nala è nascosto su `/o/*`).

## 6. Portale `/o/[token]`

Pagina storefront (shell `(shop)`), senza login, `force-dynamic` (no-store), `robots: noindex, nofollow`, `referrer: no-referrer`, titolo «Votre commande — <tenant>». Token mal formato, sconosciuto, revocato o di altro tenant ⇒ stessa pagina 404 «Lien indisponible».

- **Mostra:** réf. courte, data, stage cliente (`getCustomerOrderPresentation`), modalità, articoli (nome + quantità, max 6 + «autres»); consegna: transporteur, stato normalizzato, ETA (`shipping_estimated_delivery_at`), ultimo aggiornamento, n° di suivi, dallo snapshot persistito (nessuna chiamata provider); ritiro: indirizzo e orari pubblici del punto di ritiro.
- **Non mostra:** nome, e-mail, telefono, indirizzo di consegna, prezzi, pagamento, note, UUID.
- **CTA per ciclo di vita:** spedito → «Suivre ma livraison» (solo URL `safeShipmentTrackingUrl`); pronto al ritiro → «Itinéraire» (Google Maps del tenant, https); consegnato → «Commander à nouveau», «Donner mon avis» (solo se l'invito d'avis della commande è utilizzabile: recensioni attive, ordine `delivered` + `paid`, invito idoneo, non scaduto, nessun avis), poi «Besoin d'aide ?». Blocco app discreto solo con app Android pubblica (`/go`).
- **Aiuto:** canali configurati del tenant (WhatsApp `whatsapp_number`, e-mail `legal_email`, boutique); più canali ⇒ piccolo elenco di azioni. Messaggio prerempilato con la sola réf. courte.

### Commander à nouveau

`GET /api/order-portal/[token]/reorder` (sola lettura) restituisce una proposta: righe originali dell'ordine del token, prodotti del tenant ancora attivi, **prezzo, minimo/passo e stock attuali** (quantità arrotondata al passo superiore e limitata allo stock), più elenchi `unavailable` e `adjusted`. Il client la aggiunge con `cartStore.addItem` (che riapplica minimo/passo/stock; carrello guest locale o sync autenticata revalidata da `apply_cart_mutations`). Le regole di gruppo combinabili restano verificate dal carrello (`QuantityGroupProgress`) e dal checkout. Il token non autorizza nessuna scrittura.

### Donner mon avis

`POST /o/[token]/avis` (form, mai link GET) emette un token d'avis monouso (`review_invite_tokens.purpose = 'qr_portal'`, scadenza dell'invito) solo per un invito utilizzabile, poi 303 verso il form esistente `/avis/donner?token=`. Senza invito utilizzabile il form mostra «Avis indisponible».

## 7. Applicazione della migration

`supabase/migrations/145_order_documents.sql` — additiva, rieseguibile, senza backfill:

1. `platform_features('order_documents')` non fatturabile + CHECK `is_valid_order_documents_config` limitato a quella chiave;
2. tabella `order_public_access_tokens` (RLS, grant solo `service_role`);
3. CHECK `review_invite_tokens.purpose` esteso a `qr_portal`.

```bash
supabase db push
```

**Stato:** applicata in produzione il 05/10/2026 e verificata (feature registrata non fatturabile, tabella token presente e negata ad `anon`, nessuna riga di preferenze). Test CI: `supabase/tests/145_order_documents.{fixture,test}.sql`.

In un ambiente senza la 145: preferenze = default (non salvabili, avviso in Paramètres), bon de colis generato senza QR (avviso nel dettaglio ordine), portale 404. Rollback: vedi l'intestazione della migration.

### Migration 146 (opzione indirizzo sulla liste de préparation)

**Stato:** applicata in produzione il 05/10/2026 e verificata.

`supabase/migrations/146_order_documents_picking_address.sql` ridefinisce solo `is_valid_order_documents_config` per accettare `picking_list_show_delivery_address` (booleana). Nessuna tabella o dato toccati; compatibile all'indietro, applicabile prima o dopo il deploy. Senza la 146 il codice non può salvare le preferenze: la PATCH risponde 409 «La migration 146 doit être appliquée…»; la stampa continua senza indirizzo. Test CI: `supabase/tests/146_order_documents_picking_address.test.sql`.

## 8. Test

`apps/storefront/tests/unit/orderDocuments.spec.ts` (formati, settings per tenant, view-model, HTML/escape, lotto, Gotenberg simulato, permessi) e `orderPortal.spec.ts` (token, risoluzione/revoca, portale per stato, supporto, riordino).
