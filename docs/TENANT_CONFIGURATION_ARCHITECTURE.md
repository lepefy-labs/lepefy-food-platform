# Architettura delle configurazioni tenant

> **Repository:** `lepefy-labs/lepefy-food-platform`
> **Base codice verificata:** `main@264bbd151b1ba41f9fb13a42e99a1b7fd0795886` (26 settembre 2026)
> **Stato:** il rapporto delle 08:00 è il primo modulo sulla struttura di destinazione. Gli altri domini sono solo inventariati: nessuno è stato migrato.

## 1. Problema

`public.tenants` contiene circa 90 colonne. Ogni funzionalità ne ha aggiunte (loyalty, referral, ambassador, AI, shipping, moduli, billing, Android…), mescolando identità, branding, impostazioni operative, dati commerciali e segreti in una sola riga. Le conseguenze verificate nel codice sono:

- **Esposizione indiscriminata.**
  - `getTenant()` legge `select('*')` con service role.
  - `app/layout.tsx` serializza `{...tenant}` verso il client e azzera solo `packlink_api_key` e `chatbox_extra_context`. Arrivano quindi al browser di ogni visitatore anche `bank_iban`, `bank_bic`, `bank_beneficiary`, `stripe_account_id`, `stripe_payment_link`, `subscription_*`, `ai_rate_limit_admin_per_day`, `barcode_*` e le sequenze.
  - Ogni nuova colonna aggiunta a `tenants` finisce automaticamente nel browser.
- **Grant a livello di colonna da mantenere a mano** (076): ogni colonna nuova richiede una decisione esplicita di grant o revoke.
- **Gating duplicato.** `events_enabled` convive con la feature commerciale `events`, e `subscription_*` convive con `tenant_subscriptions` (084).
- **Validazione dispersa.** `PATCH /api/admin/tenant` è un unico endpoint con liste di campi e parsing ad hoc per tutti i domini.

## 2. Struttura di destinazione

| Tipo di dato | Dove | Regola |
|---|---|---|
| Identità tenant | `tenants` | slug, name, active, locale, currency, country. Restano colonne. |
| Branding e contenuti pubblici | `tenants` (colonne con grant pubblico esplicito) | Logo, colori, story, contatti pubblici. Letti dal client solo tramite una proiezione esplicita. |
| Permesso commerciale (cosa il tenant ha acquistato) | `platform_features` (billable) + `platform_plan_features` + `tenant_feature_overrides` | Risolto da `hasTenantFeature()`. |
| Attivazione e configurazione operativa di un modulo | `tenant_feature_settings (tenant_id, feature_key, enabled, config jsonb)` | Una riga per modulo. Riga assente = modulo disattivato. `config` versionato e validato da schema zod e, se utile, da un CHECK SQL limitato a quella `feature_key`. |
| Liste e relazioni (destinatari, zone, regole) | Tabelle dedicate con FK e vincoli propri | Mai dentro il JSONB. |
| Segreti e credenziali di integrazione | Archivio dedicato riservato al server (da introdurre) | Mai in `config`, mai in colonne pubbliche. |
| Dati transazionali, sequenze e registri | Tabelle proprie (`orders`, `*_runs`, sequenze) | Mai nel JSONB. |

**Permesso commerciale e attivazione operativa restano separati.** Una feature con `billable = false` (per esempio `daily_order_digest`) è registrata in `platform_features` solo perché la FK di `tenant_feature_settings` la richiede. Non è acquistabile, non compare in nessun piano e non passa da `hasTenantFeature()`. Per una feature `billable = true` servono invece **sia** il permesso commerciale (`hasTenantFeature`) **sia** `tenant_feature_settings.enabled`, come fanno `canUseNala()` e `canUseReviews()`.

### Accesso applicativo

`apps/storefront/src/lib/tenantConfig/moduleConfig.ts` è volutamente minimo, non un framework:

- `ModuleConfigDefinition<T>` = `{ featureKey, schema, defaults }`;
- `resolveModuleConfig(def, row)`: funzione pura. Restituisce lo stato `missing` (disattivato, valori predefiniti), `ok`, oppure `invalid` (mai attivo; valori predefiniti mostrati solo per la correzione);
- `mergeModuleConfig` / `updateModuleConfig`: aggiornamento parziale (lettura, unione, validazione dell'intero risultato, upsert della sola riga del modulo). Non riscrive mai le righe di altri moduli;
- `readModuleConfig`, `isModuleRegistered`: letture filtrate per `tenant_id`, sempre con client service role lato server.

Un nuovo modulo definisce solo schema e valori predefiniti (esempio: `lib/notifications/dailyDigestConfig.ts`). Route, componenti e worker non leggono mai il JSONB direttamente.

Limite noto: l'aggiornamento è un read-modify-write senza lock. Due salvataggi admin concorrenti sullo stesso modulo vengono risolti con "vince l'ultimo". È accettabile per le impostazioni admin; per dati concorrenti serve invece una tabella dedicata.

## 3. Inventario delle configurazioni attuali

Legenda esposizione: **P** = colonna nel grant pubblico 076 (anon/authenticated); **L** = serializzata al client dal root layout (`{...tenant}`); **S** = solo server.

### 3.1 Identità tenant
- **Colonne:** `id`, `slug`, `name`, `active`, `country`, `currency`, `locale`, `locales`, `city`, `created_at`, `updated_at`.
- **Responsabilità:** risoluzione del tenant, locale, valuta.
- **Letture:** `getTenant()` (in tutta l'app), `getTenantNotificationContext`, RLS "active tenant".
- **Scritture:** solo operazioni manuali della piattaforma.
- **Esposizione:** P, L.
- **Destinazione:** restano su `tenants`.
- **Migrazione:** nessuna.
- **Rischio:** —

### 3.2 Branding e contenuti pubblici
- **Colonne:** `logo_url`, `hero_image_url`, `label_logo_url`, `app_icon_url`, `primary_color`, `secondary_color`, `accent_light`, `tagline`, `story_heading`, `story_text`, `story_image_url`, `countries_served`, `show_powered_by`, `legal_name`, `legal_address`, `legal_email`, `legal_website`, `whatsapp_number`, `google_maps_url`, `google_review_url`, `storefront_url`.
- **Responsabilità:** identità visiva e informazioni pubbliche.
- **Letture:** layout, storefront, email, etichette.
- **Scritture:** `PATCH /api/admin/tenant` (Paramètres: sezioni Boutique, Origine e Legale) e `/api/admin/app-icon`.
- **Esposizione:** P (`app_icon_url` concessa da 105, `storefront_url` da 079; `google_review_url` non concessa: S) e L.
- **Destinazione:** restano su `tenants`, ma il client deve ricevere una **proiezione esplicita** dei campi.
- **Migrazione:** Fase 0.
- **Rischio:** basso.

### 3.3 Impostazioni operative del negozio
- **Colonne:** `click_collect_enabled`, `click_collect_address`, `click_collect_hours`, `click_collect_hours_it`, `storefront_ready`.
- **Responsabilità:** ritiro in negozio e disponibilità dello storefront.
- **Letture:** checkout, carrello, `/livraison`, conferma ordine, layout (shop).
- **Scritture:** `PATCH /api/admin/tenant`.
- **Esposizione:** P, L.
- **Destinazione:** `feature_settings('click_collect')`, oppure restano colonne (sono pubbliche e poche).
- **Migrazione:** bassa priorità.
- **Rischio:** medio (checkout).

### 3.4 Loyalty
- **Colonne:** `loyalty_enabled`, `purchase_points_rate`, `points_to_currency_rate`, `referral_signup_bonus_points`, `loyalty_card_sequence` (sequenza, vedi 3.11).
- **Responsabilità:** punti fedeltà e carta.
- **Letture:** `lib/loyalty/processOrderPointsOnDelivery.ts`, `registerWithReferral.ts`, `/compte`, `/compte/carte-fidelite`, wallet, scan admin.
- **Scritture:** `LoyaltyConfigSection` → `PATCH /api/admin/tenant`.
- **Esposizione:** P, L.
- **Vincoli:** tassi numerici che incidono sul valore economico dei punti.
- **Destinazione:** `tenant_feature_settings('loyalty')`, con config `{version, purchase_points_rate, points_to_currency_rate, signup_bonus_points}` ed `enabled` al posto di `loyalty_enabled`.
- **Migrazione:** vedi §4.
- **Rischio:** medio.

### 3.5 Referral
- **Colonne:** `referral_max_depth`, `referral_availability_mode`, `referral_unlock_spending_threshold`, `referral_fraud_max_conversions`, `referral_fraud_period_days`, `referral_fraud_action`.
- **Letture:** `lib/loyalty/checkFraudSignals.ts`, `checkReferralAccessUnlock.ts`, `registerWithReferral.ts`, `processOrderPointsOnDelivery.ts`, API `/api/loyalty/referrals/*`, `/compte/parrainage`.
- **Scritture:** `LoyaltyConfigSection` → `PATCH /api/admin/tenant`.
- **Esposizione:** P, L. Le soglie anti-frode sono leggibili pubblicamente: **da rendere private**.
- **Vincoli:** enum `availability_mode` e `fraud_action`.
- **Destinazione:** `feature_settings('referral')`.
- **Rischio:** medio-alto (anti-frode).

### 3.6 Ambassador
- **Colonne:** `ambassador_min_purchase_amount`, `ambassador_min_commission_amount`, `ambassador_max_commission_amount`, `ambassador_loyalty_from_second_order`, `ambassador_first_order_discount_type`, `ambassador_first_order_discount_value`, `ambassador_payout_threshold_amount`, `ambassador_commission_mode`, `ambassador_split_pool_amount`, `ambassador_split_pool_ambassador_percent`.
- **Letture:** checkout (`/api/checkout`, `/api/checkout/external-link`, `/api/checkout/ambassador-discount`, `checkout-sessions/[id]`), `lib/ambassador/*`, `processOrderPointsOnDelivery.ts`, `/compte/ambassadeur`.
- **Scritture:** `AmbassadorConfigSection` → `PATCH /api/admin/tenant`.
- **Esposizione:** P, L.
- **Vincoli:** importi e percentuali che determinano sconti al checkout e commissioni pagate.
- **Destinazione:** `feature_settings('ambassador')`, con validazione zod e CHECK SQL.
- **Rischio:** **alto** (denaro e checkout): va migrato per ultimo, con doppia lettura e confronto.

### 3.7 Notifiche interne
- **Tabelle:** `tenant_notification_recipients` (071, 080), con un flag `notify_*` per tipo: `card_payment`, `external_payment_pending`, `order_stock_conflict`, `event_booking_closed_reports`, `daily_digest`.
- **Letture:** `getNotificationRecipients()` (webhook Stripe, pagamenti esterni, conflitti di stock, report eventi, digest).
- **Scritture:** `/api/admin/notification-recipients[/id]`.
- **Esposizione:** S (RLS senza policy, solo service role).
- **Destinazione:** struttura già corretta (relazionale). Se i tipi continuano a crescere, valutare una tabella `tenant_notification_subscriptions (recipient_id, notification_type)` al posto delle colonne booleane.
- **Rischio:** basso.

### 3.8 Rapporto delle 08:00 — **migrato**
- **Struttura:** `tenant_feature_settings('daily_order_digest')`, più `tenant_notification_recipients.notify_daily_digest` e `tenant_daily_digest_runs` con la RPC `claim_tenant_daily_digest`.
- **Letture:** `lib/notifications/dailyDigestRunner.ts`, `/api/admin/daily-digest`, Paramètres.
- **Scritture:** `/api/admin/daily-digest` (permesso `tenant_settings.manage`).
- **Esposizione:** S.
- **Dettagli:** `docs/DAILY_ORDER_DIGEST.md`.

### 3.9 AI e Nala
- **Colonne:** `ai_image_generation`, `ai_description_generation`, `ai_semantic_search`, `catalogue_search_threshold`, `ai_rate_limit_public_per_minute`, `ai_rate_limit_public_per_day`, `ai_rate_limit_admin_per_day`, `chatbox_extra_context`.
- **Tabelle:** l'attivazione di Nala è già in `tenant_feature_settings('nala')` (096).
- **Letture:** `/api/chat`, `/api/search/semantic`, `lib/ai/nalaFastResolver.ts`, `lib/ai/usageTracking.ts`, generazione descrizioni e immagini, pagine prodotto e home.
- **Scritture:** manuali (piattaforma).
- **Esposizione:** P per flag e limiti pubblici; S per `ai_rate_limit_admin_per_day` e `chatbox_extra_context` (azzerato nel layout).
- **Destinazione:**
  - flag e limiti → `feature_settings('ai')` / `('nala').config`;
  - `chatbox_extra_context` → tabella di contesto privata o `tenant_knowledge_base`.
- **Rischio:** medio.

### 3.10 Moduli attivi (Événementiel e servizi)
- **Colonne:** `events_enabled`, `services_enabled`, `rental_delivery_enabled`, `rental_delivery_countries`.
- **Letture:** layout e pagine `(evenementiel)`, `/accueil`, scan admin, `livraison-materiel`.
- **Scritture:** `/api/admin/evenementiel/settings` (`ModuleSettingsToggle`) e l'admin delle zone di consegna noleggio.
- **Esposizione:** P per `events_enabled`/`services_enabled`, L per tutte.
- **Vincoli:** `events_enabled` duplica il permesso commerciale `events`.
- **Destinazione:** permesso `events` + `feature_settings('events', {services_enabled, rental_delivery…})`. Le zone e i paesi di consegna sono liste: vanno in tabelle proprie, non nel JSONB.
- **Rischio:** medio.

### 3.11 Shipping
- **Colonne:** `shipping_provider`, `packlink_api_key` (**segreto**), `flat_rate_amount`, `shipping_pricing_mode`, `shipping_tariff_fallback`, `shipping_public_grid_enabled`.
- **Letture:** `/api/shipping/quote`, `lib/shipping/providers/packlink.ts`, `lib/shipping/tariff/*`, `lib/shipping/syncOrderShipment.ts` (`select('*')`), simulatore e inspector admin.
- **Scritture:** `/api/admin/shipping-pricing-mode`; il resto manualmente.
- **Esposizione:** P per `shipping_provider`/`flat_rate_amount`; S per la chiave (esclusa da 076 e azzerata nel layout).
- **Vincoli:** checkout e costi di spedizione.
- **Destinazione:**
  - `packlink_api_key` → archivio segreti dedicato (priorità di sicurezza);
  - modalità e fallback → tabelle Shipping Intelligence (`docs/SHIPPING_INTELLIGENCE.md`).
- **Rischio:** **alto**.

### 3.12 Configurazione commerciale e billing SaaS
- **Colonne:** `subscription_status`, `subscription_paid_until`, `stripe_payment_link`, `bank_iban`, `bank_beneficiary`, `bank_bic`, `stripe_account_id`.
- **Tabelle:** `tenant_subscriptions`, `platform_plans`, `platform_plan_features`, `platform_billing_settings` (084), `tenant_feature_overrides` (094).
- **Letture:** `/admin/billing`, `lib/admin/platformBilling.ts`, webhook Stripe.
- **Scritture:** manuali o dal webhook.
- **Esposizione:** S secondo 076, ma **L** tramite il root layout.
- **Destinazione:** solo il dominio billing (084). Le colonne su `tenants` sono legacy.
- **Rischio:** medio (riguarda il fatturato della piattaforma, non i pagamenti dei clienti).

### 3.13 Integrazioni app
- **Colonne:** `android_package_name`, `android_sha256_fingerprint`, `android_public`.
- **Letture:** `/.well-known/assetlinks.json`, `/go`.
- **Esposizione:** P, L. Dati pubblici per natura.
- **Destinazione:** `feature_settings('android_app')` o nessuna modifica.
- **Rischio:** basso.

### 3.14 Metodi di pagamento cliente
- **Tabelle:** `tenant_payment_methods` (030/062/066/126).
- **Esposizione:** pubblica per le righe attive (IBAN e link destinati ai clienti).
- **Destinazione:** già relazionale. **Nessun intervento**: le regole di pagamento restano fuori da questo piano.

### 3.15 Dati transazionali e sequenze su `tenants`
- **Colonne:** `barcode_prefix`, `barcode_sequence`, `loyalty_card_sequence`.
- **Scritture:** funzioni SQL di 031 e 047.
- **Esposizione:** L.
- **Destinazione:** restano colonne, oppure tabelle o sequence dedicate. **Mai nel JSONB.**
- **Rischio:** medio (concorrenza).

## 4. Strategia di migrazione per dominio

Per ogni dominio si procede in cinque fasi, ciascuna in una consegna separata:

1. **Additiva:** registrare la feature (billable secondo la semantica commerciale), creare il modulo zod e il CHECK SQL, fare il backfill da `tenants` con un controllo di conteggio (sul modello di 096 e 129).
2. **Doppia lettura:** il codice legge `tenant_feature_settings`. In staging si confrontano, anche via log, i valori di entrambe le sorgenti.
3. **Scrittura sul nuovo:** l'admin scrive solo sul modulo e `PATCH /api/admin/tenant` perde quei campi.
4. **Revoca:** si revocano i grant pubblici delle colonne legacy.
5. **Rimozione:** `drop column` in una migrazione separata, solo dopo aver verificato in produzione che non restano lettori (grep e controlli sul `select('*')`).

## 5. Ordine proposto

| # | Intervento | Motivo | Rischio |
|---|---|---|---|
| 0 | **Proiezione client esplicita** nel root layout (lista di campi pubblici al posto di `{...tenant}`), e `PATCH /api/admin/tenant` che restituisce solo i campi modificabili (già fatto con 129) | Chiude subito l'esposizione di billing e anti-frode senza migrazioni | Medio (molti consumer di `useTenant()`) |
| 1 | Rapporto delle 08:00 | Fatto (129) | — |
| 2 | Loyalty | Pochi campi, schema semplice, un solo writer | Medio |
| 3 | Referral | Dipende dalla loyalty; soglie anti-frode da rendere private | Medio-alto |
| 4 | AI/Nala (flag, limiti, contesto privato) | Nala già attiva in `feature_settings` | Medio |
| 5 | Moduli Événementiel | Riconciliare il permesso `events` con `events_enabled` | Medio |
| 6 | Notifiche | Solo se i tipi continuano a crescere | Basso |
| 7 | Shipping: segreto Packlink in un archivio dedicato; modalità e fallback in Shipping Intelligence | Segreto | Alto |
| 8 | Ambassador | Denaro e checkout: ultimo, con doppia lettura estesa | Alto |
| 9 | Pulizia di billing legacy e sequenze | Dopo la conferma che 084 è l'unica fonte | Medio |

## 6. Regole per le nuove funzionalità

- **Non aggiungere colonne a `tenants`** per configurazioni di modulo. Usare `tenant_feature_settings` + `lib/tenantConfig/moduleConfig.ts`.
- **Riga assente = modulo disattivato.** Le migrazioni non creano righe `enabled = true`.
- **`config` è versionato**, ha valori predefiniti centralizzati, viene validato con zod nell'app e, se utile, con un CHECK SQL limitato alla sua `feature_key`.
- **Mai nel JSONB:** segreti, dati transazionali, liste di destinatari o dati che richiedono vincoli relazionali.
- **Semantica commerciale:** una feature non vendibile va registrata con `billable = false` e senza piani. Una feature vendibile richiede sia il permesso commerciale sia l'attivazione operativa.
