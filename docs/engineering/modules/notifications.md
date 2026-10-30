---
id: eng-module-notifications
titolo: Notifiche
modulo: notifications
categoria: Comunicazione
stato: parziale
owner: Platform Owner
file_monitorati: [apps/storefront/src/lib/notifications/notificationTypes.ts, apps/storefront/src/lib/notifications/staff/dispatcher.ts]
---

# Notifiche

> Bozza iniziale derivata dalla documentazione di progetto. **Non verificata da una persona**: stato «Parziale».

## Scopo

E-mail ai clienti, destinatari interni, dispatcher per lo staff (WhatsApp), registro delle consegne e analisi delle e-mail Brevo.

## Punti di ingresso

- Catalogo dei tipi: `apps/storefront/src/lib/notifications/notificationTypes.ts`. Aggiungere un tipo = una voce di registro, mai una nuova colonna `notify_*`.
- Dispatcher interno: `apps/storefront/src/lib/notifications/staff/dispatcher.ts` (`dispatchTenantNotification`): un evento immutabile per transizione, una riga `notification_deliveries` per destinatario e canale, non lancia mai.
- Destinatari: `getNotificationRecipients(db, tenantId, '<type_key>')` → RPC `notification_recipient_emails`.

## Invarianti

- WhatsApp staff va solo a numeri confermati (`whatsapp_verified_at`), dietro il flag `staff_whatsapp_notifications`, tramite Green API; le consegne `unknown` non vengono ritentate in automatico.
- Webhook Brevo: `POST /api/webhooks/brevo` (Bearer `BREVO_WEBHOOK_TOKEN`, fail closed); i dati mancanti sono «n.d.», mai 0.
- Sulla distribuzione demo nulla di reale esce: `sendNotification`/`sendViaBrevo` registrano messaggi simulati.
