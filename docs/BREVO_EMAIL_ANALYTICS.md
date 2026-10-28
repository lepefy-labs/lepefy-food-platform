# Brevo Email Analytics (Platform Owner)

Stato: implementato in locale, **non deployato**, migrazione 170 **non applicata** in produzione.
Base rivista: `dac458d3` (2026-10-28).

## Cosa fa

Riceve gli eventi delle email transazionali Brevo (`POST /api/webhooks/brevo`), li salva e li mostra in
**Admin → Piattaforma → Notifiche → Email Analytics** (`/admin/platform/notifications/email-analytics`).
Solo Platform Owner: il layout `platform/layout.tsx` reindirizza chiunque altro; la pagina legge con service role
solo dopo quel controllo. Nessun WhatsApp, nessun cron, nessuna modifica a pagamenti/ordini.

## Flusso dati

```
Brevo ──webhook (Bearer)──► route.ts ─ parseBrevoEvent ─► brevo_email_events (append-only, dedupe event_key)
                                                              │
notification_deliveries.provider_message_id ◄── join in view ─┘  brevo_email_message_summary
                                                              │
                                              brevoAnalytics.ts (KPI, serie, filtri) ─► pagina
```

- **Nessuna attribuzione in ingestione.** Tenant, tipo di notifica, oggetto, ordine/prenotazione/pagamento
  (`tenant_notification_events.entity_*`) arrivano **in lettura** dal ledger `notification_deliveries`
  (join su `provider_message_id` = `message-id` Brevo). Così un evento arrivato prima che il ledger sia scritto,
  o fuori ordine, viene comunque attribuito.
- **Messaggio = (message-id, destinatario).** Brevo usa lo stesso `message-id` per tutti i destinatari di un invio:
  il destinatario è un HMAC (`TRACKING_SECRET`, fallback `BREVO_WEBHOOK_TOKEN`); l'indirizzo non è mai salvato,
  solo una forma mascherata `m***@dominio`.
- **Dedupe.** `event_key = sha256(message-id, recipient_hash, evento, timestamp Brevo)` con indice unico:
  un retry di Brevo è un no-op, una seconda apertura reale (altro timestamp) è una nuova riga.
- **Fuori ordine.** La view aggrega con `min/bool_or` per messaggio, non con una macchina a stati: l'ordine di arrivo non conta.
- **Non salvati:** oggetto (viene dal ledger), URL completi dei click (solo host), indirizzi nei motivi di bounce (mascherati), IP.
- **Retention:** 180 giorni, `purge_brevo_email_events()` chiamata in modo opportunistico (~1 richiesta su 200) dal webhook.

## Eventi gestiti (payload Brevo → interno)

| Brevo `event` | Interno | Note |
|---|---|---|
| `request` | `sent` | Inviata |
| `delivered` | `delivered` | |
| `unique_opened` | `first_open` | Prima apertura |
| `opened` | `open` | |
| `proxy_open` | `proxy_open` | Apertura via proxy: **non** conta come apertura |
| `click` | `click` | |
| `soft_bounce` / `hard_bounce` / `blocked` / `invalid_email` / `spam` | idem | Non consegnata se non c'è `delivered` |
| `deferred` | `deferred` | |
| `error` | `error` | Errore di consegna |
| `unsubscribed` | `unsubscribed` | Salvato, non usato nei KPI |

Eventi sconosciuti sono ignorati (risposta 200 con `ignored`). **Verificare i nomi esatti sul primo evento reale** (vedi Test).

## Definizioni dei KPI

Per messaggio **e** per destinatari distinti; ogni tasso mostra il denominatore.

- *Email suivies* = messaggi con almeno un evento nel periodo (un evento `delivered` senza `request` conta).
- Tasso di consegna = consegnate / suivies. Prima apertura e click = su **consegnate**.
- Prima apertura = aperture non-proxy. «Probabile robot» = aperta < 3 s dopo la consegna (conta come apertura ma è evidenziata; esclusa dal tempo mediano). Solo-proxy = contata a parte, non è apertura.
- Non consegnate = bounce/blocked/invalid/spam **senza** `delivered` (un soft bounce poi consegnato è un ritardo). Errori = evento `error`.
- **n.d. ≠ 0**: senza dati i tassi sono «n.d.»; il tempo mediano è n.d. senza campioni.
- La pagina avvisa che un'apertura non prova la lettura umana e mostra la **copertura** (email accettate da Brevo secondo il ledger vs email con eventi) per i messaggi inviati prima dell'attivazione del webhook.
- Il filtro «Evento» agisce sulla tabella; periodo, boutique e categoria agiscono su tutto.
- Giorni calcolati in ora di Parigi. Massimo 30 000 messaggi per vista (avviso se troncato).

## Categorie e perimetro

Classificazione da `notification_type` del ledger (che è anche il tag Brevo impostato da `sendViaBrevo`), mai dall'oggetto:
`event_reservation_confirmed`/`rental_reservation_confirmed_customer` → conferme prenotazione; `card_quick_payment_customer` → conferme pagamento;
`order_confirmed` → conferme ordine; `order_shipped`/`order_ready_for_pickup` → spedizione; `order_completed`; `payment_reminder` → promemoria;
`review_invite` → richieste recensione; il resto Food → «Altre comunicazioni Food». Mappa in `lib/notifications/brevoEvents.ts`
(aggiungere un tipo = una riga).

L'account Brevo è condiviso con altri progetti Lepefy: entra nei KPI **solo** un messaggio collegato al ledger di questa piattaforma
oppure con un tag che è un nostro `notification_type`. Gli altri sono salvati (la riga ledger può arrivare dopo) ma mai mostrati.

## Configurazione

Variabili d'ambiente (server, Vercel):

```bash
BREVO_WEBHOOK_TOKEN=   # ≥ 24 caratteri casuali; senza, il webhook risponde sempre 401 (fail closed)
TRACKING_SECRET=       # già esistente: chiave HMAC dei destinatari
```

Brevo → **Plugin e integrazioni → Webhook → Uscita webhook → Aggiungi un nuovo webhook**:

1. Tipo: **Transazionale** (non Marketing).
2. URL: `https://<dominio-pubblico-del-deployment>/api/webhooks/brevo` (es. `https://shop.chloefood.com/api/webhooks/brevo`).
3. Eventi: Inviata (request), Consegnata, Aperta, Prima apertura, Cliccata, Aperta tramite proxy, Soft bounce, Hard bounce, Bloccata, Errore (consigliati anche Differita, Indirizzo non valido, Spam).
4. Autenticazione: se la schermata offre «Authentication / Token», scegliere **Bearer** con il valore di `BREVO_WEBHOOK_TOKEN` → Brevo invia `Authorization: Bearer <token>`.
   Se la UI non lo offre per l'account, **non** mettere il token nell'URL (finirebbe nei log): chiedere a Brevo o restringere per IP a livello di Vercel/WAF e aprire un'attività per aggiungere un'altra modalità.
5. Il webhook è per account, non per tenant: i dati degli altri progetti vengono scartati in lettura (vedi perimetro). Se i progetti non devono condividere l'endpoint, usare un account/sub-account separato.

## Test

Locale (nessun database di produzione):

```bash
cd apps/storefront && pnpm test:unit   # brevoEmailAnalytics.spec.ts
curl -X POST http://localhost:3000/api/webhooks/brevo -H "Authorization: Bearer $BREVO_WEBHOOK_TOKEN" -H "content-type: application/json" \
  -d '{"event":"delivered","email":"test@example.com","message-id":"<test.1@smtp-relay.mailin.fr>","ts_event":1793181600,"tags":["order_confirmed"]}'
```

Attenzione: in locale `createServiceClient()` scrive sul DB configurato in `.env` (storicamente quello di produzione): per il curl usare un DB di prova con la migrazione 170.
Dopo l'attivazione: inviare un'email reale (Admin → Piattaforma → Notifiche → Tests), poi dal pannello Brevo usare «Invia un test» o aprire l'email,
e controllare che la riga compaia nella tabella con boutique e categoria. Se la boutique risulta «Non attribuito», verificare che `provider_message_id` del ledger coincida con `message-id` dell'evento (stesso formato `<…@smtp-relay.mailin.fr>`); i messaggi inviati via n8n (`EMAIL_TRANSPORT=n8n`) non hanno `provider_message_id` e restano non attribuiti.

## Limiti noti

- Le email inviate con `EMAIL_TRANSPORT=n8n` non hanno `provider_message_id` nel ledger: sono riconosciute solo dal tag (se n8n lo imposta) e senza boutique.
- Nessun import dello storico CSV (deliberato).
- Il WhatsApp non è toccato: i dati servono a decidere dopo (aperture reali, ritardi, non consegnate per categoria).
