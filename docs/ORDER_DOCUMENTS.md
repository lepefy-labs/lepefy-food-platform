# Documenti delle commande e portale QR (migrations 145 e 162, applicate in produzione)

Documento di riferimento per la liste de préparation, il bon de colis, il portale cliente `/o/[token]` e le preferenze tenant. Il codice resta la source of truth. Lato Shipping Intelligence (carton suggestion, file map, invarianti): `docs/SHIPPING_INTELLIGENCE.md` §3.1–3.2.

## 1. Due documenti, una base dati

```text
Order
  → loadOrderDocumentData (lotto, tenant-scoped, colonne esplicite)
      ├── buildPickingListViewModel  → InternalOrderDocumentViewModel  → pickingListHtml (A5 | A4)
      └── buildPackingSlipViewModel  → CustomerOrderDocumentViewModel  → packingSlipHtml (A5 | A4)
                                          (formato: order_items.format_snapshot → itemFormat.ts)
                                                                            → htmlToPdf (Gotenberg) → PDF
```

- **Liste de préparation** (interna): confronto spedizione in due colonne accanto a `EMBALLAGE SUGGÉRÉ` (importo storico `orders.shipping_cost` pagato dal cliente, `Non renseigné` se assente, costo cliente e riga manoscritta per costo reale allineati ciascuno alla propria etichetta (due righe totali, senza riga aggiuntiva per il valore); solo consegna, anche se nessun cartone suggerito; A5 compatto, A4 con note conservate), formato acquistato sotto il nome («Format : 1 kg», stessa fonte ed etichetta del récapitulatif: `order_items.format_snapshot` via `pickingLineFormat`/`orderItemFormatLabel`, omesso se già nel nome); solo per le righe senza snapshot (ordini precedenti alla 162, prodotti senza formato) ripiego sul peso unitario indicativo del catalogo attuale `products.weight_grams` (etichetta «Poids catalogue», omesso se il nome contiene già un peso o se il dato manca; caricato in lotto per tenant anche per ritiro) — mai i due insieme. La liste groupée (Session de préparation, PDF `preparation-summary`) segue la stessa regola e separa le righe dello stesso prodotto acquistate in formati diversi, ordinamento fisico di picking per conservazione (secchi/nessuna tipologia, poi freschi, infine surgelati; per ogni gruppo emplacements in ordine naturale), chaîne du froid, riepilogo unità/peso/colli, emballage suggéré (solo consegna), suivi di preparazione cartaceo (PRÉPARATION, EMBALLAGE, EXPÉDITION o REMISE AU CLIENT per ritiro, con caselle, data e ora) e firme (un'unica coppia). Intestazione a due colonne (§1.1): nome cliente sempre, via/complemento/«Destinataire : …» (se diverso dal cliente) solo con `picking_list_show_delivery_address`; CP, città e paese sempre nell'encadré di destinazione per le consegne.
- **Bon de colis** (cliente, nel pacco; titolo stampato «RÉCAPITULATIF DE COMMANDE»): marca, «Merci <prénom> !», réf. courte e data, articoli (con il formato acquistato quando è figé sulla riga, §1.2), QR del portale, ringraziamento, contatti. Il view-model cliente è costruito campo per campo: non riceve mai la riga `orders` né item grezzi. Il loader non legge `notes`, `email`, telefono o pagamento.
- File: `apps/storefront/src/lib/orders/documents/*`.

### 1.1 Intestazione della liste de préparation

```text
┌──────────────────────────────────────┬──────────────────────┐
│ LISTE DE PRÉPARATION                 │ ┌──────────────────┐ │
│ #CC4314FE                            │ │▌LIVRAISON▐    IT │ │
│ 21/10/2026 10:14 · Chloe Food        │ │ 20051            │ │  CP 26 pt (A5) / 32 pt (A4)
│ Jean-Baptiste Mbuyi                  │ │ CASSINA DE'      │ │  città 17→12,5 pt (A5), a capo, mai troncata
│ Destinataire : … / via / complemento │ │ PECCHI           │ │
└──────────────────────────────────────┴─┴──────────────────┴─┘
```

- Griglia `minmax(0, 1fr) auto` (Chromium di Gotenberg), encadré di larghezza fissa: 52 mm in A5, 72 mm in A4. A sinistra: titolo, réf., data · tenant, nome cliente e, solo con l'opzione indirizzo, destinatario se diverso, via e complemento. Nessuna informazione precedente persa; CP e città non sono mai ripetuti a sinistra.
- Encadré (solo `delivery`): bordo nero, badge `LIVRAISON` in negativo, codice paese 9,5–10 pt a destra del badge, CP molto grande in una riga (`white-space: nowrap`; 6 caratteri → 26 pt A5, 7–8 caratteri alfanumerici → 22 pt, oltre → 18 pt), città in grassetto per paliers di lunghezza (A5: ≤ 12 car. 17 pt, ≤ 17 15 pt, ≤ 26 14 pt, oltre 12,5 pt; A4 20/18/16/14 pt) che va a capo tra le parole e non viene mai troncata.
- Valori stampati come salvati (`destinationParts` del view-model): zeri iniziali (`00132`) e CP alfanumerici (`SW1A 2AA`) conservati, accenti e apostrofi escapati (`CASSINA DE&#39; PECCHI`). Un CP salvato come numero JSON resta leggibile ma i suoi zeri persi non vengono inventati.
- Indirizzo incompleto: si stampa solo ciò che esiste; senza CP né città l'encadré mostra «Destination non renseignée».
- `pickup`: nessun encadré né CP; a destra badge `RETRAIT` + «Retrait en boutique», a sinistra la stessa identificazione.
- Altezza: l'intestazione sostituisce il blocco cliente che prima stava sotto la riga titolo (e in A4 la griglia «Client / Résumé»; il riepilogo è ora la riga di sezione comune). Verifica Chromium (oct. 2026, 1–22 articoli, con e senza indirizzo, A5/A4): mai una pagina in più rispetto alla versione precedente.

### 1.2 Formato acquistato sul récapitulatif

- **Flusso**: scheda prodotto (un prodotto = un formato: `sale_unit`, `net_content_value/unit`, `pack_count` della 154, `net_quantity_display` della 018) → carrello (quantità secondo minimo/incremento, non un altro formato) → checkout (`validateCheckoutItems` fissa nome e prezzo nella sessione) → `order_items` → documento. Prima della 162 `order_items` non conservava alcun formato. `products.weight_grams` è il peso logistico (imballo incluso) e non è mai usato come formato; la quantità ordinata e la regola minimo/incremento non sono formati.
- **Fonte unica**: `order_items.format_snapshot` (migration 162), copia v1 dei campi di formato della scheda presa da un trigger BEFORE INSERT nella stessa transazione della riga, quindi per tutti i percorsi di creazione: webhook Stripe storefront, RPC `convert_checkout_session_to_order` (commandes assistées / manuali, «Déjà payé»), paiement en boutique. Nessun codice di checkout o pagamento modificato; prezzi, quantità e stock non letti né scritti.
- **Garanzie**: snapshot solo se la scheda del **medesimo tenant** esiste, ha ancora lo stesso nome della riga (altrimenti il prodotto può essere cambiato tra panier e commande ⇒ nessun formato) e almeno un campo di formato; fail-open (la riga è sempre inserita); immutabile (trigger BEFORE UPDATE: modifica, cancellazione o aggiunta tardiva rifiutate); uno snapshot fornito esplicitamente da chi inserisce è conservato.
- **Etichetta** (`itemFormat.ts`, `orderItemFormatLabel`): contenuto strutturato con l'unità più leggibile (`150 g`, `1 kg`, `500 ml`, `1 L`, `12 × 33 cl`), `Vendu au kilo` per le unità a peso, altrimenti la quantità netta testuale della scheda (≤ 40 caratteri, es. `Sachet de 5 pièces`). Nulla se il nome contiene già lo stesso contenuto (anche in un'altra unità: `Huile 1 L` per 1000 ml) o la stessa descrizione.
- **Rendering**: A5 a seguito del nome, insécable, 10 pt (`Kaolin · 150 g`); A4 sotto il nome, 10,5 pt (`Format : 150 g`). Nessuna colonna aggiunta. In A5 una riga in più per articolo faceva passare su due pagine i récapitulatifs da 6 a 8 articoli (misura Chromium); in linea il numero di pagine resta quello di prima.
- **Ordini precedenti alla 162** (e righe senza scheda o con scheda rinominata): nessun formato, documento identico a prima; nessun backfill dal catalogo attuale. Anche la liste de préparation e la liste groupée mostrano il formato dallo snapshot; senza snapshot ripiegano sul «Poids catalogue» indicativo.
- Senza la 162 applicata il loader rilegge `order_items` senza la colonna (`42703`/`PGRST204`) e il récapitulatif si stampa senza formati.

## 2. Formati

`ORDER_DOCUMENT_FORMATS` (`formats.ts`): `a5` (148×210, default, raccomandato) e `a4` (210×297), portrait. Ogni formato ha il proprio layout (non un A4 scalato). Font informativo minimo 10 pt, quantità 16–17 pt, caselle 6/7 mm. L'A5 usa spaziature verticali ottimizzate (intestazione, righe, carton, suivi e firme) senza ridurre il testo sotto 10 pt o le caselle di picking da 6 mm; nessuna seconda conversione Gotenberg. Se il contenuto è lungo, il documento può continuare su più pagine. Il blocco finale di suivi e firme è mantenuto insieme (`avoid`); la compilazione su carta non aggiorna lo stato digitale dell'ordine. Multipagina: righe non spezzate, `thead` ripetuto con la réf. come intestazione ridotta, piè di pagina «#REF · Page X/Y» (nel lotto la numerazione è quella del PDF intero).

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
| `GET /api/admin/orders/documents/preparation-summary?ids=a,b&format=…` | `orders.view` | **liste groupée** della Session de préparation (una riga per articolo con ripartizione per ordine, secs → frais → surgelés); formato di default = quello della liste de préparation. Documento in più, non sostituisce le liste individuali. Vedi `docs/ORDER_PREPARATION.md` §4 |

- Risposta: `application/pdf`, `inline` (o `attachment` con `download=1`), `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`. Nomi: `commande-CC4314FE-preparation-a5.pdf`, `commande-CC4314FE-bon-de-colis-a5.pdf`, `preparation-2026-10-05-a5.pdf`, `bons-de-colis-2026-10-05-a5.pdf`.
- Errori (francese; pagina HTML se aperta in navigazione): formato sconosciuto 400, ordine assente/altro tenant 404, annullato 409, bon de colis disattivato 409, lotto > 50 413, Gotenberg assente/irraggiungibile/timeout 503, errore di conversione 502. Nel lotto gli ordini assenti, di altro tenant o annullati sono esclusi (`X-Documents-Skipped`).
- Gotenberg: client unico `lib/labels/gotenberg.ts`, `htmlToPdf(html, options)` con carta e margini dal registro, `footer.html`, timeout 25 s. Senza opzioni gli altri consumer (etichette, affiche, biglietti, liste Événementiel) restano invariati. Env: `GOTENBERG_URL`, `GOTENBERG_AUTH`.
- UI: sezione «Documents» del dettaglio ordine (`OrderDocumentsCard`, menu a tendina del formato `FormatSelect` con dimensioni in mm, preselezionato sul default del tenant — A5 se non configurato —, scelta puntuale), azioni rapide nella riga espansa della lista al formato di default (`Liste de préparation · A5`, e per le consegne `Bon de colis · A5` se attivo), azione di gruppo «Documents…» (`BulkDocumentsDialog`, stesso menu). Navigazione HTTP diretta al PDF (funziona anche in PWA); nessun `window.print`.

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

### Migration 162 (formato acquistato sulle righe d'ordine)

**Stato:** da applicare in produzione, con approvazione esplicita (trigger nella transazione di creazione delle righe d'ordine). Il codice può essere deployato prima.

`supabase/migrations/162_order_item_format_snapshot.sql` — additiva, rieseguibile, senza backfill: colonna nullable `order_items.format_snapshot` (jsonb), funzione `order_items_capture_format_snapshot()` (security definer, `search_path` fissato, execute revocato) + trigger BEFORE INSERT, funzione `order_items_keep_format_snapshot()` + trigger BEFORE UPDATE OF `format_snapshot`. Rollback nell'intestazione. Test CI: `supabase/tests/162_order_item_format_snapshot.{fixture,test}.sql` (doppia applicazione, cattura strutturata/testuale/pack, nessuno snapshot senza formato, con nome cambiato o da altro tenant, prezzi invariati, prodotto modificato dopo l'acquisto, immutabilità, nessun backfill).

Verifica dopo l'applicazione: una nuova commande di un prodotto con formato ha `format_snapshot` valorizzato; le righe esistenti restano `null`.

### Migration 146 (opzione indirizzo sulla liste de préparation)

**Stato:** applicata in produzione il 05/10/2026 e verificata.

`supabase/migrations/146_order_documents_picking_address.sql` ridefinisce solo `is_valid_order_documents_config` per accettare `picking_list_show_delivery_address` (booleana). Nessuna tabella o dato toccati; compatibile all'indietro, applicabile prima o dopo il deploy. Senza la 146 il codice non può salvare le preferenze: la PATCH risponde 409 «La migration 146 doit être appliquée…»; la stampa continua senza indirizzo. Test CI: `supabase/tests/146_order_documents_picking_address.test.sql`.

## 8. Test

`apps/storefront/tests/unit/orderDocuments.spec.ts` (formati, settings per tenant, view-model, HTML/escape, lotto, Gotenberg simulato, permessi), `orderDocumentsHeaderFormat.spec.ts` (encadré CP/città, zeri iniziali e CP alfanumerici, città lunghe, escaping, ritiro senza encadré, indirizzo incompleto, A5/A4, stampa singola e in lotto; etichetta del formato g/kg, ml/L, pack, testuale, senza duplicazione, legacy, prodotto modificato dopo l'acquisto, righe manuali senza prodotto, prezzi invariati, isolamento tenant, assenza della 162) e `orderPortal.spec.ts` (token, risoluzione/revoca, portale per stato, supporto, riordino).

Limiti: i test unitari controllano l'HTML, non l'impaginazione. L'impaginazione è stata verificata con Chromium locale (Playwright `page.pdf`, stessi formati e margini di Gotenberg) ma con Arial al posto di Liberation Sans (metricamente compatibile): il primo PDF reale da Gotenberg va comunque guardato.
