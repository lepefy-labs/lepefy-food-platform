# Runbook — notifiche interne Email / WhatsApp (Green API)

Riferimento funzionale: `docs/NOTIFICATION_SUBSCRIPTIONS.md`. Questo file è operativo: configurazione, attivazione di un tenant, diagnosi, ripristino, rattrapage.

## 1. Configurazione Green API (server-side, Vercel)

| Variabile | Uso |
|---|---|
| `GREEN_API_NOTIFY_URL`, `GREEN_API_NOTIFY_INSTANCE_ID`, `GREEN_API_NOTIFY_TOKEN` | **Istanza dedicata alle notifiche** (consigliata). Usata se le tre sono presenti. |
| `GREEN_API_URL`, `GREEN_API_INSTANCE_ID`, `GREEN_API_TOKEN` | Ripiego: istanza condivisa con il connettore cataloghi (read-only per contratto; l'adapter di invio è separato: `lib/notifications/providers/greenApiOutbound.ts`). |

- `URL` = apiUrl https dell'istanza (`*.green-api.com` / `*.greenapi.com`, senza percorso). Il token è solo nel path delle richieste: mai loggato, mai restituito, mai in DB.
- **Forfait Developer**: 3 conversazioni al mese per istanza (errore 466 `green_api_quota_exceeded`, registrato come `dead`, nessun retry). Per più di 3 numeri di staff, o se l'istanza dei cataloghi consuma già conversazioni, serve un'istanza dedicata a pagamento.
- L'istanza deve essere **autorizzata** (QR code scansionato dal telefono del numero Lepefy). Stati: `authorized` ok; `notAuthorized`/`starting`/`sleepMode`/`blocked`/`suspended` → nessun invio riuscito (`green_api_instance_not_authorized`, retry con backoff; Green API conserva i messaggi accettati fino a 24 h).
- Un formato solo per i chatId (`<cifre>@c.us` dall'E.164): Green API conta due volte un contatto indirizzato in due formati.

## 2. Attivare un tenant (es. Chloe Food)

1. Transport & santé: « Identifiants » e « Instance » verdi.
2. Il tenant (o Lepefy) in Paramètres → Notifications: numero WhatsApp **personale** di ogni destinatario (mai il numero commerciale del tenant), « Tester WhatsApp », poi « J'ai reçu le message de test » quando il messaggio arriva.
3. Scegliere le notifiche (o « Configuration recommandée »).
4. Platform owner: Paramètres → Fonctionnalités → « Notifications WhatsApp de l'équipe » (`staff_whatsapp_notifications`, platform-only) attivo. Prima di questo passo nessun messaggio WhatsApp automatico parte (i test sì, verso il destinatario configurato).
5. Verificare il primo invio reale in Historique (canale WhatsApp: `accepted` poi `delivered`).

Disattivare: spegnere il flag (le righe in coda diventano `skipped` all'invio) o disattivare il destinatario / togliere il numero (la conferma si azzera). Lo storico resta.

## 3. Diagnosi

| Sintomo | Dove | Azione |
|---|---|---|
| Nessuna notifica WhatsApp | Santé → Service WhatsApp; Paramètres → numero « Numéro confirmé »? flag attivo? abbonamento sul canale WhatsApp? | Completare §2 |
| `green_api_not_configured` | env del progetto Vercel | Impostare le variabili, ridistribuire |
| `green_api_unauthorized_401/403` | credenziali | Correggere token / id istanza |
| `green_api_instance_not_authorized` | console Green API | Riautorizzare (QR), i retry ripartono |
| `green_api_quota_exceeded` (466) | forfait | Istanza a pagamento / dedicata; poi « Relancer les échecs » |
| `unknown` (timeout, interrotto, 2xx senza id) | Historique | Chiedere al destinatario se ha ricevuto; solo in caso negativo « Réessayer » (conferma esplicita) |
| Righe `pending` ferme | Santé → Schedulers | Workflow n8n « Notification retry scheduler » attivo e con il bearer giusto |
| Email nuove (Nouvelle commande…) non arrivano | Historique canale email | Stessa diagnosi dei transport email (`docs/NOTIFICATION_JOURNEY_V1.md`) |

I log applicativi contengono codici e id (`[staff-notify]`, `[whatsapp-notify]`), mai numeri completi, testi o token.

## 4. Ripristino

- Retry automatici: `failed` con backoff fino a 5 tentativi (poi `dead`). « Réessayer » ne concede 3 in più.
- Un rattrapage interrotto (timeout della funzione) resta `confirmed` al massimo 10 minuti, poi viene chiuso alla conferma successiva; le righe già in coda partono comunque con lo scheduler.
- Rollback dello schema: in testa a `supabase/migrations/158_staff_notifications_whatsapp.sql` (solo dopo aver tolto il codice che lo legge).

## 5. Rattrapage delle commande esistenti

Platform → Notifications → Rattrapage. Mai automatico.

1. Scegliere il tenant e i filtri; la vista « Sans notification » mostra le commande aperte senza notifica Lepefy registrata.
2. Selezionare (o « Prévisualiser tous les résultats », max 200), scegliere canali e formato. Controllare esclusioni e **numero di messaggi per canale**.
3. « Envoyer les notifications » → conferma con i conteggi. Se ordini o destinatari cambiano nel frattempo l'invio è rifiutato: rifare l'aperçu.
4. Seguire « Derniers rattrapages » (Traiter maintenant / Relancer les échecs) e l'Historique (badge « Rattrapage »).

Ripetere la scansione non rinvia nulla di già registrato. « Aucune notification Lepefy enregistrée » non significa che l'équipe non sia stata avvisata in altro modo.
