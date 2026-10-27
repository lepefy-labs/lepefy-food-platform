# Ciclo di vita dell'abbonamento tenant (migration 144, pagamenti v2: 169)

Documento operativo: rinnovo, sospensione reale (globale o per modulo), gestione manuale dalla console piattaforma, pagina Abonnement del tenant.

## 1. Modello dati

| Tabella / colonna | Ruolo |
|---|---|
| `tenant_subscriptions.status` | `active` \| `suspended` (sospensione manuale; il vecchio `expired` è convertito in `suspended`) |
| `tenant_subscriptions.paid_until` | fine del periodo pagato (ultimo secondo del mese, UTC) |
| `tenant_subscriptions.suspension_mode` | `manual` (default) \| `automatic` |
| `tenant_subscriptions.grace_days` | sospensione automatica N giorni dopo `paid_until` (default 15) |
| `tenant_subscriptions.suspended_at`, `suspension_reason` | sospensione manuale in vigore |
| `tenant_module_suspensions` | un modulo (`shop`, `events`, `digital_card`, `ai`, `reviews`) sospeso dalla piattaforma, con motivo |
| `tenant_subscription_payments` | registro append-only dei pagamenti (`stripe` \| `bank_transfer` \| `paypal`); `stripe_checkout_session_id` unico; 169: `external_reference` (n° PayPal obbligatorio, riferimento bancario facoltativo; unico per tenant + fonte, senza maiuscole/spazi), `request_key` (unico per tenant: un doppio invio restituisce lo stesso pagamento), `stripe_event_id` (traccia) |
| `tenant_subscription_audit` | ogni azione della piattaforma, valore prima/dopo, motivo obbligatorio, autore |

Le tabelle 144 sono service role only, RLS senza policy, nessun INSERT/UPDATE/DELETE diretto: si scrive solo tramite le RPC `record_tenant_subscription_payment` e `admin_update_tenant_subscription` (security definer, riga bloccata, audit nella stessa transazione). Le colonne legacy `tenants.subscription_status/subscription_paid_until` restano allineate (dalla 169 anche su `suspend` → `expired` e `reactivate` → `active`). Dalla 169 ogni tenant ha la sua riga: trigger `tenants_ensure_subscription` (AFTER INSERT) + backfill, piano attivo predefinito (`default_platform_plan_id()`: `food-platform` se attivo), `paid_until` vuoto, modalità manuale — nessuna sospensione possibile finché la piattaforma non imposta la scadenza.

## 2. Regola di rinnovo

`subscription_next_paid_until(paid_until, paid_at, was_suspended)` (specchio TS: `lib/billing/subscriptionRules.ts` → `nextPaidUntil`):

| Situazione al pagamento | Nuova scadenza |
|---|---|
| Servizio attivo (anche in ritardo) | fine del mese successivo al mese di `paid_until` (gli arretrati sono coperti per primi) |
| Sospeso con arretrati (`paid_until < paid_at`) | fine del mese del pagamento: i mesi senza servizio non sono addebitati |
| Sospeso dentro un periodo già pagato | come il caso attivo |
| Nessuna scadenza registrata | fine del mese del pagamento |

«Sospeso» è valutato alla data del pagamento: sospensione manuale già in vigore, oppure modalità automatica oltre `paid_until + grace_days`. Il pagamento riattiva sempre (`status = 'active'`).

## 3. Sospensione

Motore unico: `lib/billing/tenantServiceState.ts` → `getTenantServiceState(tenantId)` (cache 60 s, tag `service-state:<tenant>`, invalidata da pagamenti e azioni piattaforma). Sospeso = manuale **oppure** automatico, calcolato alla lettura: nessun cron, un pagamento riattiva subito. **Fail-open**: senza migration 144 o con errore di lettura il tenant è attivo.

| Superficie | Effetto |
|---|---|
| Layout `(shop)`, `(evenementiel)`, `card`, pagina `/pay/[token]` | `ServiceSuspendedPage` («Service temporairement indisponible»), senza menzione della fatturazione; il layout shop non legge cookie (ISR preservato) |
| `/api/checkout`, `/api/checkout/external-link`, `/api/checkout-sessions/[id]` (PATCH, create-intent), `/api/pay/[token]/{intent,external}`, `/api/events/[id]/checkout*`, `/api/rental/checkout*`, `/api/services/[slug]/inquiry`, `/api/card/quick-pay` | `guardModule()` → `503 SERVICE_SUSPENDED` prima di creare righe o PaymentIntent |
| `hasTenantFeature` (Nala, Nala Analytics, attribution, avis) | `false` |
| Admin del tenant | solo `/admin` (ordini), `/admin/orders/*`, `/admin/billing`, `/admin/securite`; le API admin rispondono `423 TENANT_SUSPENDED` salvo letture `orders.view`/`billing.view` (`requirePermission`) |
| Webhook Stripe, job interni | **mai bloccati**: un pagamento già avviato viene sempre processato |
| `platform_owner` | mai limitato |

Un modulo sospeso singolarmente applica le stesse regole solo alle sue superfici. Nell'admin un banner (`SubscriptionBanner`) mostra la sospensione, il conto alla rovescia nei 7 giorni prima della sospensione automatica e i moduli sospesi.

## 4. Pagamenti

- **Carta**: Stripe Payment Link del tenant con metadata `type = saas_subscription`, `tenant_slug`. Eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded` e `checkout.session.async_payment_failed`; regole pure in `lib/billing/saasStripeEvent.ts` (`precheckSaasEvent`, `checkSaasPayment`). Rinnova solo se: `payment_status = paid` (un `completed` ancora `unpaid` di un metodo asincrono attende `async_payment_succeeded`); evento live (test mode solo per un tenant `is_test`, mai dal conto Stripe e2e); il tenant ha una riga `tenant_subscriptions`; valuta = valuta del piano e `amount_total ≥` prezzo mensile del piano. Altrimenti nessun rinnovo, risposta 200 (Stripe non ritenta) e avviso a Lepefy (`SUPPORT_NOTIFY_EMAILS`, «Paiement Stripe à vérifier»): il pagamento, se reale, si registra a mano. `paid_at` = istante dell'evento (conferma del pagamento). Poi `recordSaasSubscriptionPayment` → RPC, idempotente sulla sessione: `completed` + `async_payment_succeeded` o un retry non prolungano due volte.
- **Configurazione Stripe richiesta**: l'endpoint `/api/webhooks/stripe` del conto che incassa il Payment Link deve ricevere i tre eventi `checkout.session.*` qui sopra; Payment Link senza codici promozionali.
- **Bonifico e PayPal esterno**: confermati dalla piattaforma solo a pagamento ricevuto (mai su dichiarazione del tenant), stessa regola. API `POST /api/admin/platform/subscriptions/[tenantId]` azione `record_payment` (`method: bank_transfer | paypal`, importo, data, `reference` — obbligatoria per PayPal —, nota, `requestKey` UUID generato all'apertura del modulo); l'azione `record_transfer` del modulo 144 resta come alias (bonifico senza riferimento né chiave). Riferimento duplicato → 409 «Ce paiement est déjà enregistré». Conferma «Paiement reçu» al tenant solo se `out_created`. Riferimento chiesto al tenant: `LEPEFY <SLUG> <AAAA-MM>` (mese coperto). Link PayPal di Lepefy: `platform_billing_settings.paypal_url` (https).

## 5. Console piattaforma

`/admin/platform/abonnements` (solo `platform_owner`; API `GET/POST /api/admin/platform/subscriptions[/tenantId]` con `requirePlatformOwner`, controllo origine, zod `platformSubscriptionActionSchema`): contatori-filtro per stato (`?vue=overdue|due_soon|suspended|active|undefined`, toni da `SUBSCRIPTION_STATE_META` del registry; un secondo clic toglie il filtro), stato effettivo, scadenza, modalità, colonna «Rappels» (ultimo promemoria del ledger `notification_deliveries` con esito, prossima tappa da `nextDueReminder`), ultimo pagamento; azioni: «Enregistrer un paiement» (`RecordPaymentDialog`: Virement/PayPal, importo, data di ricezione, riferimento — obbligatorio per PayPal —, nota, anteprima della nuova scadenza e del mese coperto, avviso se un pagamento è già registrato a meno di 7 giorni (doppio inserimento), `ConfirmDialog` con le conseguenze, `requestKey` di `useAdminMutation` stabile fino al successo), «Lien PayPal Lepefy» (`POST /api/admin/platform/subscriptions/settings`, https o vuoto), sospendere/riattivare, politica automatica (giorni), correzione scadenza, link Stripe, sospensione per modulo; storico pagamenti e journal. `reactivate` è rifiutato se la politica automatica sospenderebbe ancora (`reactivate_still_overdue`): correggere prima la scadenza o passare in manuale.

## 6. Runbook

1. Prima di applicare 144: `select tenant_id, status, paid_until from tenant_subscriptions;` — ogni riga `expired` diventerà `suspended` (sospensione **reale**). Al 4/10/2026: nessuna riga `expired`.
2. Applicare `supabase/migrations/144_tenant_subscription_lifecycle.sql` (idempotente). Tutti i tenant restano in modalità `manual`: nessuno viene sospeso.
3. Verificare Platform → Abonnements (nessun avviso «migration 144 non appliquée»).
4. Attivare la sospensione automatica tenant per tenant solo dopo aver verificato la scadenza: con una scadenza già superata oltre la tolleranza la sospensione è **immediata** (l'anteprima lo indica).
5. Rollback funzionale: `set_suspension_policy` → manuale e `reactivate`; il codice resta fail-open se le tabelle mancano.
6. Migration 169 (additiva, rieseguibile): applicarla **prima** del deploy del codice che passa `p_external_reference` / `p_request_key` / `p_stripe_event_id` (la firma a 8 argomenti è sostituita da una a 11 con default: il codice 144 continua a funzionare). Rollback: ridistribuire il codice precedente; colonne, indici e trigger possono restare (`drop trigger tenants_ensure_subscription on public.tenants` se serve). Applicarla anche al DB demo (workflow `demo-database`, file `169_subscription_payments_v2.sql`).

Test: `supabase/tests/144_*.sql` e `169_*.sql` (CI), `tests/unit/subscriptionLifecycle.spec.ts`, `tests/unit/subscriptionReminders.spec.ts`, `tests/unit/saasStripeEvent.spec.ts`.

## 7. Avvisi e-mail (tipo `subscription_billing`)

- **Scadenza (ogni modalità, manuale compresa)**: `lib/billing/subscriptionReminders.ts` (`dueSubscriptionReminder`, `DUE_REMINDER_STEPS`), giorni di calendario UTC rispetto a `paid_until` (la data mostrata): `due_d7` da D-7 a D-4, `due_d3` da D-3 a D-1, `due_d0` da D0 a D+2, `overdue_d3` da D+3 a D+10; solo tra le 08:00 e le 20:00 ora di Parigi (`isDueReminderHour`), mai se sospeso o senza `paid_until`. Una tappa resta dovuta per tutta la sua finestra: uno scheduler fermo invia solo l'ultima tappa ancora valida; oltre D+10 nessun sollecito automatico per il periodo. Il testo indica il mese coperto dal prossimo pagamento e, solo in modalità automatica, la data di sospensione.
- **Sospensione (solo automatica)**: `d7` quando la sospensione cade entro 7 giorni, `d1` l'ultimo giorno; `suspended` all'inizio di una sospensione (manuale o automatica, solo se recente: ≤ 7 giorni). Un solo invio per tenant e per giro: le tappe di sospensione prevalgono su quelle di scadenza (con 15 giorni di tolleranza da D+8).
- **Idempotenza**: chiavi `subscription-due:<tenant>:<paid_until>:<tappa>`, `subscription-reminder:<tenant>:<data sospensione>:<d7|d1>` e `subscription-suspended:<tenant>:<inizio>` nel ledger `notification_deliveries`: lo scheduler può girare più volte senza doppioni. La chiave di scadenza contiene `paid_until`: un pagamento (che sposta la scadenza) ferma da solo i solleciti del periodo e quelli del periodo successivo ripartono a D-7.
- **Lepefy**: a `due_d0` e `overdue_d3` un avviso a `SUPPORT_NOTIFY_EMAILS` (fuori dal ledger del tenant), inviato solo dal giro che registra per primo il promemoria del tenant (`notifyPlatformOfDueReminder`), con link alla console.
- **Conferma di pagamento**: `notifySubscriptionPayment` (`lib/billing/subscriptionNotifications.ts`) quando la RPC restituisce `out_created = true` (webhook Stripe e bonifico registrato dalla console): e-mail «Paiement reçu» + WhatsApp staff, chiave `subscription-payment:<payment_id>`, mai bloccante (il pagamento è già registrato).
- **Destinatari**: abbonati al tipo `subscription_billing` (gruppo «Compte», attivo di default per i nuovi destinatari, preset Gérant e Comptabilité); se nessuno è abbonato, gli `admin_users` `tenant_admin` attivi del tenant. E-mail con mittente Lepefy (`PLATFORM_EMAIL_CONTEXT`), CTA verso `/admin/billing`; anteprime in Plateforme → Notifications → Modèles.
- **Cache**: una sospensione automatica scatta col solo passare del tempo, senza scritture che invalidino la cache. Lo stesso job, quando vede una sospensione iniziata da meno di 3 ore (`suspensionJustStarted`), chiama `revalidateServiceState` (tag `service-state:<tenant>` + layout): le pagine ISR (120–300 s) passano subito a «Service temporairement indisponible». Sospensione manuale, riattivazione e pagamenti invalidano già nella propria richiesta; checkout e pagamenti sono bloccati entro 60 s in ogni caso.
- **Scheduler**: `POST /api/internal/subscription-reminders` (Bearer `SUBSCRIPTION_REMINDERS_CRON_SECRET`, confronto timing-safe; `503` se un invio fallisce o se 144 manca). Template n8n `ops/n8n/subscription-reminders.json` (ogni ora, credential Header Auth `Authorization: Bearer <secret>`), importato **inattivo**. Senza scheduler attivo nessun promemoria parte (stato al 26/10/2026: nessun invio `subscription_billing` nel ledger).

### Attivazione

1. Migration 144: applicata in produzione (verificato il 26/10/2026).
2. Vercel (progetti `chloefood` e `lepefy-food-test`): variabile `SUBSCRIPTION_REMINDERS_CRON_SECRET` (valore casuale lungo), redeploy. Facoltativo: `SUPPORT_NOTIFY_EMAILS` per gli avvisi a Lepefy.
3. n8n: importare il template, creare la credential Header Auth con lo stesso secret, «Manual test» → `outcomes` senza `failed`, poi attivare il workflow.
