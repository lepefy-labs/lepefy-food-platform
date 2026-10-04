# Ciclo di vita dell'abbonamento tenant (migration 144)

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
| `tenant_subscription_payments` | registro append-only dei pagamenti (`stripe` \| `bank_transfer`); `stripe_checkout_session_id` unico |
| `tenant_subscription_audit` | ogni azione della piattaforma, valore prima/dopo, motivo obbligatorio, autore |

Le tabelle 144 sono service role only, RLS senza policy, nessun INSERT/UPDATE/DELETE diretto: si scrive solo tramite le RPC `record_tenant_subscription_payment` e `admin_update_tenant_subscription` (security definer, riga bloccata, audit nella stessa transazione). Le colonne legacy `tenants.subscription_status/subscription_paid_until` restano allineate.

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

- **Carta**: Stripe Payment Link del tenant con metadata `type = saas_subscription`, `tenant_slug`. Il webhook `checkout.session.completed` chiama `recordSaasSubscriptionPayment` → RPC (idempotente sulla sessione: un retry non prolunga due volte). Senza 144 o senza riga `tenant_subscriptions`: comportamento precedente (+30 giorni sulle colonne legacy).
- **Bonifico**: registrato dalla piattaforma (Platform → Abonnements → «Enregistrer un virement»), stessa regola. Riferimento chiesto al tenant: `LEPEFY <SLUG> <AAAA-MM>` (mese coperto).

## 5. Console piattaforma

`/admin/platform/abonnements` (solo `platform_owner`; API `GET/POST /api/admin/platform/subscriptions[/tenantId]` con `requirePlatformOwner`, controllo origine, zod `platformSubscriptionActionSchema`): stato effettivo, scadenza, modalità, data prevista di sospensione automatica, ultimo pagamento; azioni: virement (con anteprima della nuova scadenza), sospendere/riattivare, politica automatica (giorni), correzione scadenza, link Stripe, sospensione per modulo; storico pagamenti e journal. `reactivate` è rifiutato se la politica automatica sospenderebbe ancora (`reactivate_still_overdue`): correggere prima la scadenza o passare in manuale.

## 6. Runbook

1. Prima di applicare 144: `select tenant_id, status, paid_until from tenant_subscriptions;` — ogni riga `expired` diventerà `suspended` (sospensione **reale**). Al 4/10/2026: nessuna riga `expired`.
2. Applicare `supabase/migrations/144_tenant_subscription_lifecycle.sql` (idempotente). Tutti i tenant restano in modalità `manual`: nessuno viene sospeso.
3. Verificare Platform → Abonnements (nessun avviso «migration 144 non appliquée»).
4. Attivare la sospensione automatica tenant per tenant solo dopo aver verificato la scadenza: con una scadenza già superata oltre la tolleranza la sospensione è **immediata** (l'anteprima lo indica).
5. Rollback funzionale: `set_suspension_policy` → manuale e `reactivate`; il codice resta fail-open se le tabelle mancano.

Test: `supabase/tests/144_*.sql` (CI), `tests/unit/subscriptionLifecycle.spec.ts`.
