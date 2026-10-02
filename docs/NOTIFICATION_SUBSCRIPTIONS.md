# Abbonamenti alle notifiche interne (migration 143)

Destinatari interni del tenant (staff, proprietario: non i clienti) × tipi di notifica.

## Modello

| Elemento | Dove |
|---|---|
| Catalogo dei tipi (chiave, gruppo, label, descrizione, default, modulo richiesto) | `apps/storefront/src/lib/notifications/notificationTypes.ts` (`NOTIFICATION_TYPES`) |
| Profili ("Gérant", "Comptabilité", "Préparation") | stesso file, `NOTIFICATION_PRESETS` |
| Destinatari | `tenant_notification_recipients` (`email`, `label`, `active`, `admin_user_id` opzionale) |
| Abbonamenti | `tenant_notification_subscriptions (tenant_id, recipient_id, type_key, channel)`, PK `(recipient_id, type_key, channel)`, FK composita `(tenant_id, recipient_id)` |
| Lookup per l'invio | RPC `notification_recipient_emails(tenant, type, channel)` ← `getNotificationRecipients(db, tenantId, typeKey)` |

Il DB non conosce l'elenco dei tipi: `type_key` ha solo un controllo di formato. La validazione contro il catalogo è fatta dall'API (`parseSubscriptionChanges` / `parseTypeKeys`).

`channel` oggi accetta solo `email`. Aggiungere un canale (WhatsApp, push) = estendere il CHECK con una migration e passare il canale alla RPC; il modello non cambia.

## Aggiungere un tipo di notifica

1. Aggiungi una voce a `NOTIFICATION_TYPES` (chiave `snake_case`, gruppo esistente o nuovo in `NOTIFICATION_GROUPS`, `module: 'events'` se dipende dal modulo eventi).
2. Nel codice che invia: `getNotificationRecipients(db, tenantId, '<chiave>')` oppure `sendTenantEmail({ recipientFlag: '<chiave>', … })`.
3. Nessuna migration, nessuna modifica a UI, API, pagina salute: appaiono da soli.

I destinatari esistenti non sono abbonati al nuovo tipo, che quindi parte opt-in. `defaultOn` vale solo per i nuovi destinatari.

## Regole di invio

Un destinatario riceve un tipo se:

- è `active`;
- è abbonato al tipo sul canale;
- se è collegato a un membro dell'équipe (`admin_user_id`), quell'`admin_users` è `active` e ha una `admin_memberships` attiva sullo stesso tenant.

Disattivare un admin in `/admin/team` o la sua membership interrompe quindi anche le sue notifiche. Un membro può essere collegato al massimo a un destinatario per tenant.

## UI (Paramètres → Communication → Notifications)

- Desktop: matrice destinatari × **gruppi**. Ogni cella è una checkbox a tre stati con il conteggio `n/m`; in intestazione, "Tous" applica il gruppo a tutti i destinatari. Cliccando sul nome si apre il dettaglio per tipo, con il profilo e il collegamento all'équipe.
- Sotto `xl`: una card per destinatario con lo stesso dettaglio.
- Vengono mostrati solo i tipi dei moduli attivi del tenant (`events_enabled`). Gli abbonamenti ai tipi nascosti restano intatti: profili e "Tous" agiscono solo sui tipi visibili.
- Ogni modifica degli abbonamenti passa da `POST /api/admin/notification-recipients/subscriptions` `{ changes: [{ recipientId, typeKey, subscribed }] }` (max 500), con aggiornamento ottimistico e stato canonico restituito.

## Deploy e colonne legacy

La 143 copia (backfill) i flag `notify_*` in `tenant_notification_subscriptions`, una sola volta: se esiste già almeno un abbonamento non lo ripete. Le colonne legacy restano al loro posto, inutilizzate, così la versione precedente dell'app continua a funzionare tra l'applicazione della migration e il deploy.

Ordine: `supabase db push` (143), poi deploy. Le modifiche fatte nella vecchia UI tra i due passaggi non vengono copiate: tieni la finestra breve.

Quando il nuovo codice è in produzione e stabile, rimuovi le colonne con una migration dedicata:

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

I documenti precedenti (`NOTIFICATION_JOURNEY_V1.md`, `DAILY_ORDER_DIGEST.md`, …) citano i flag `notify_<x>`: il tipo equivalente è `<x>`, senza il prefisso.
