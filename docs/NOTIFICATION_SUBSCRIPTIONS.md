# Notifiche interne: destinatari, canali e dispatcher (migration 143 + 158)

Destinatari interni del tenant (staff, proprietario: **mai i clienti**) × tipi di notifica × canali **Email** e **WhatsApp**.
Runbook operativo (Green API, diagnosi, ripristino, rattrapage): `docs/STAFF_NOTIFICATIONS_RUNBOOK.md`.

## Modello

| Elemento | Dove |
|---|---|
| Catalogo dei tipi (chiave, gruppo, label, descrizione, default, modulo, **canali**, `flagOf`) | `apps/storefront/src/lib/notifications/notificationTypes.ts` (`NOTIFICATION_TYPES`) |
| Profili ("Gérant", "Comptabilité", "Préparation") e configurazione consigliata | stesso file, `NOTIFICATION_PRESETS`, `RECOMMENDED_SUBSCRIPTIONS` |
| Destinatari | `tenant_notification_recipients` (`email` **facoltativa**, `whatsapp_phone` E.164 facoltativo, almeno uno dei due; `whatsapp_verified_at`; `label`, `active`, `admin_user_id`) |
| Abbonamenti | `tenant_notification_subscriptions (tenant_id, recipient_id, type_key, channel)`, `channel ∈ {email, whatsapp}`, PK `(recipient_id, type_key, channel)` |
| Lookup email storico | RPC `notification_recipient_emails(tenant, type, channel)` ← `getNotificationRecipients` (salta i destinatari senza email) |
| Lookup del dispatcher | RPC `notification_recipient_targets(tenant, type_keys[], channel)` → `(recipient_id, type_key, address)` |
| Eventi di dominio | `tenant_notification_events` — una riga immutabile per transizione `(tenant, event_type, entity_type, entity_id, occurrence_id)` |
| Outbox / storico invii (tutti i canali) | `notification_deliveries` (136/137/158) — una riga per evento × destinatario × canale, chiave `notif:<event>:<recipient>:<channel>` |
| Rattrapage manuale | `notification_backfill_runs` (aperçu → conferma, platform owner) |

Il DB non conosce l'elenco dei tipi: `type_key` ha solo un controllo di formato; la validazione (tipo **e** canale supportato dal tipo) è fatta dall'API (`parseSubscriptionChanges` / `parseTypeKeys` / `typeSupportsChannel`).

Da non confondere: email del destinatario · **numero WhatsApp del destinatario** (`whatsapp_phone`) · numero mittente Green API di Lepefy (env) · numero commerciale del tenant (`tenants.whatsapp_number`, mai usato come destinatario) · numero WhatsApp Cloud API delle conversazioni clienti (`tenant_whatsapp_channels`, `docs/WHATSAPP_BUSINESS_PLATFORM.md`).

## Tipi e canali

| Tipo | Gruppo | Canali | Inviato da |
|---|---|---|---|
| `order_created` Nouvelle commande | Commandes | email, WhatsApp | dispatcher (webhook Stripe storefront, checkout in negozio, `convertCheckoutSessionToOrder` per assistiti / pagamenti esterni confermati / « Déjà payé ») |
| `order_international`, `order_fresh_products` | Commandes | email, WhatsApp | **flag** di `order_created` (`flagOf`): chi è abbonato riceve la stessa notifica (una sola) quando l'attributo vale |
| `card_payment` | Commandes | email | invariato (`/card`) |
| `external_payment_pending` | Commandes | email, WhatsApp | email: claim di sessione storico; WhatsApp: dispatcher (evento `checkout_session:<id>:awaiting_verification`) |
| `order_stock_conflict` | Commandes | email, WhatsApp | email: `orderStockConflictEmail` invariato; WhatsApp: dispatcher |
| `order_attention_required` | Commandes | email, WhatsApp | dispatcher (pagamento catturato ma righe d'ordine non salvate) |
| `shipment_creation_failed` / `shipment_action_required` / `shipment_delayed` | Expéditions | email, WhatsApp | dispatcher: bozza Packlink fallita in modo definitivo / incerta / interrotta / creata ma non registrata; incidente o reso; data stimata del vettore superata di 24 h; colis in transito senza preparazione |
| `event_reservation_created` | Événementiel | email, WhatsApp | dispatcher |
| `service_inquiries`, `rental_reservations`, `subscription_billing` | … | email, WhatsApp | email invariata; WhatsApp: dispatcher |
| `event_booking_closed_reports`, `daily_digest` | … | email | invariati (allegati / digest) |

Gli eventi già esistenti mantengono l'email storica: il dispatcher aggiunge **solo** il canale WhatsApp (`channels: ['whatsapp']`), così la stessa transizione non produce due email.
Mai notificato come nuova commande: carrello, checkout iniziato, preordine non pagato, ordine di test (`is_test`).

## Dispatcher (`lib/notifications/staff/`)

```ts
dispatchTenantNotification({ tenantId, eventType, entityType, entityId, occurrenceId, alert, priority?, audienceTypes?, channels?, only?, sendNow? })
```

1. registra l'evento (upsert sulla chiave di transizione: un webhook rigiocato ritrova la stessa riga);
2. risolve i destinatari per canale (`notification_recipient_targets`: attivo, membro équipe ancora attivo, **numero WhatsApp confermato**; WhatsApp solo se il flag `staff_whatsapp_notifications` è attivo);
3. inserisce le righe in `notification_deliveries` (`ignoreDuplicates` sulla chiave `notif:…`): mai due invii per evento × destinatario × canale, chiunque chiami;
4. tenta subito al massimo 10 righe (claim CAS `pending → processing`), WhatsApp distanziati; il resto parte con lo scheduler.

Non lancia mai eccezioni: ordine, pagamento o spedizione non dipendono da Green API né dal trasporto email. Il contenuto è un `StaffAlert` (`staffMessages.ts`) costruito da dati verificati e reso per canale: testo WhatsApp breve (`renderStaffWhatsapp`) ed email (`staffAlertEmail`, layout operativo). Il link admin è sempre `tenants.storefront_url` + percorso (mai un host ipotetico; senza URL https nessun link). I messaggi d'ordine contengono i **riferimenti Packlink PRO** (riferimento provider, `LEPEFY-<8>` = `shipment_custom_reference`, stato della bozza, tracking del vettore). Mai indirizzo completo, telefono, email del cliente, dettagli di pagamento. Fresco/surgelato = `order_items.storage_type`, mai dal nome; internazionale = paese di consegna ≠ `tenants.country` (null se uno dei due è ignoto).

Priorità: `urgent` (conflitto stock, anomalia, spedizione fallita/incerta), `high` (catena del freddo, internazionale, pagamento da verificare, ritardo), `normal`.

## Stati di consegna (`notification_deliveries.status`)

`pending` (in coda) → `processing` (invio) → `accepted` (preso in carico dal provider) → `delivered` (solo WhatsApp: consegna osservata nel journal Green API `getMessage`; `read` resta in `provider_status`, la lettura non è mai dedotta) · `failed` (nuovo tentativo con backoff 1/5/15/60/240 min) → `dead` · `skipped` (non inviato di proposito: canale disattivato, tenant di test) · `unknown` (la richiesta può aver raggiunto il provider: timeout, 2xx senza id, invio interrotto). `unknown` **non** è mai ritentato automaticamente (Green API non ha chiavi di idempotenza): solo « Réessayer » con conferma esplicita.

Il tick `POST /api/internal/notifications/dispatch` (n8n « Notification retry scheduler », 5 min, bearer `DAILY_DIGEST_CRON_SECRET`) instrada ogni riga (`deliveryRouter.ts`: `/whatsapp/send-message` → Green API, il resto → `sendNotification`), poi `followUpWhatsappDeliveries`: invii WhatsApp `processing` scaduti → `unknown`; messaggi accettati da < 48 h controllati ogni 10 min; il payload WhatsApp (numero + testo) è cancellato alla consegna o dopo 48 h. Nello storico il numero è mascherato (`+39 333 ••• 4567`). Retention 90 giorni per tutti gli stati finali.

## Regole di invio

Un destinatario riceve un tipo su un canale se: è `active`; è abbonato al tipo su quel canale (o a un suo flag applicabile); ha l'indirizzo di quel canale; per WhatsApp il numero è **confermato** (`whatsapp_verified_at`) e il flag del tenant è attivo; se collegato a un membro dell'équipe, quell'`admin_users` è attivo con una `admin_memberships` attiva sul tenant. Cambiare il numero azzera la conferma.

Conferma del numero: « Tester WhatsApp » (`POST /api/admin/notification-recipients/[id]/test`, solo verso il numero del destinatario, « [TEST] », massimo uno al minuto) poi « J'ai reçu le message de test » (`POST …/whatsapp-confirm`, accettato solo se un test verso quel numero è stato accettato da Green API nelle ultime 24 h).

## UI (Paramètres → Communication → Notifications)

Una scheda per destinatario: email, numero WhatsApp con stato (Aucun numéro / À confirmer / Numéro confirmé), attivo, Modifier (dialog: étiquette, email, numero, membro dell'équipe), profilo, « Configuration recommandée » (solo su clic, aggiunge senza togliere), test email/WhatsApp, matrice **Événement × Email × WhatsApp** per gruppo (casella a tre stati per gruppo e canale, « — » se il tipo non esiste su quel canale, canale disattivato senza indirizzo). Banner: WhatsApp attivo / in preparazione (numeri preparabili e testabili prima dell'attivazione). Le nuove sottoscrizioni WhatsApp partono vuote. Ogni modifica passa da `POST /api/admin/notification-recipients/subscriptions` `{ changes: [{ recipientId, typeKey, subscribed, channel? }] }` (canale assente = email).

## Configurazione consigliata (`RECOMMENDED_SUBSCRIPTIONS`)

Email: Nouvelle commande, Paiement externe à vérifier, Conflit de stock. WhatsApp: Nouvelle commande, Paiement externe à vérifier, Commande internationale, Produits frais, Conflit de stock. Rapporto quotidiano: email invariata, mai WhatsApp. Non è un permesso di inviare a numeri non confermati.

## Rattrapage des commandes (platform owner)

`/admin/platform/notifications/rattrapage` (+ `POST /api/admin/platform/notifications/backfill/preview`, `…/[runId]/confirm`, `…/[runId]/process`, tutti `requirePlatformOwner`). Pagina server con stato URL (tenant, periodo, stato commande, pagamento, modo, internazionale, frais, stato notifica, riferimento `#A82F19C4` o nome).

- **Eleggibile** (`backfillPlan.ts` `ineligibilityReason`): statuto `new`/`preparing` (default) o `ready_for_pickup`, pagato (o « en boutique » ancora da incassare), non rimborsato, non di test.
- **Stato notifica** separato dallo stato operativo: Aucune notification Lepefy enregistrée / en échec / en cours / en partie / déjà notifiée / aucun destinataire. Mai « il tenant non è stato informato ».
- **Aperçu obbligatorio**: selezione o tutti i risultati (max 200), canali, « un message par commande » o « un récapitulatif par destinataire ». Mostra selezionate, da notificare, escluse con motivo, destinatari, **messaggi per canale** (consegne reali, non ordini), avvisi di configurazione. Salvato come run `previewed` con fingerprint (id + `updated_at` + stato degli ordini, coppie pianificate), valido 15 min.
- **Conferma** « Envoyer les notifications » (dialog con i conteggi reali): ricalcola il piano, rifiuta se il fingerprint cambia, CAS `previewed → confirmed` (doppio clic = una volta), un solo run `confirmed` per tenant (indice unico), audit `notifications.backfill.confirmed`. Messaggi individuali = stesso evento `order_created` del live (nessun doppione con un invio già fatto); i soli invii falliti dello stesso evento sono rimessi in coda (mai duplicati); i 10 primi partono subito, il resto con lo scheduler. Il récapitulatif è un evento `order_backlog_summary` del run e copre i suoi ordini per i destinatari raggiunti.
- Mai: modifica di ordini, pagamenti, spedizioni, side effect di conversione, avvio automatico al deploy o all'onboarding.

## Console piattaforma

Historique (`/admin/platform/notifications/historique`): Server Component con filtri URL (stato, canale, tenant, periodo, ricerca), paginazione, dettaglio (trasporto, id provider, stato osservato WhatsApp, errore leggibile, risorsa), « Réessayer », export CSV dello stesso filtro (`GET /api/admin/platform/notification-deliveries?format=csv`). Transport & santé: blocco « Service WhatsApp Lepefy » (flag, credenziali presenti — mai i valori —, `getStateInstance`, ultimo controllo, in coda, retry dovuti, incerti, esiti 24 h, errori recenti) e destinatari per tipo con il conteggio WhatsApp confermato.

## Aggiungere un tipo di notifica

1. Voce in `NOTIFICATION_TYPES` con `channels` (e `flagOf` se è un attributo di un'altra notifica).
2. Nel codice: `dispatchTenantNotification({...})` con un `StaffAlert` di `staffMessages.ts` (o, solo email storica, `getNotificationRecipients` / `sendTenantEmail`).
3. Nessuna migration. I destinatari esistenti non sono abbonati (opt-in); `defaultOn` vale per i nuovi destinatari, solo email.

## Deploy e colonne legacy

158 additiva e rieseguibile, **applicata in produzione il 16/10/2026** prima del deploy (verificato: colonne, tabelle, RPC, tipo audit; nuovi stati accettati, canale invalido rifiutato; anon senza accesso; 0 abbonamenti WhatsApp, 0 righe non email). Test SQL in CI: `supabase/tests/158_staff_notifications_whatsapp.test.sql`.

Le colonne `notify_*` (143) restano inutilizzate fino a una migration dedicata:

```sql
alter table public.tenant_notification_recipients
  drop column if exists notify_card_payment,
  drop column if exists notify_external_payment_pending,
  drop column if exists notify_order_stock_conflict,
  drop column if exists notify_event_booking_closed_reports,
  drop column if exists notify_daily_digest,
  drop column if exists notify_service_inquiries,
  drop column if exists notify_rental_reservations;
```
