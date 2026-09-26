# Architettura delle configurazioni tenant

> **Repository:** `lepefy-labs/lepefy-food-platform`
> **Base codice verificata:** `main@8bf7b61b5277b12b460eed49e4a874a227c7811c` (26 settembre 2026)
> **Stato:** Fase 0 completata (proiezione pubblica esplicita del tenant). Sulla struttura di destinazione: rapporto delle 08:00 (129) e loyalty (130; la pulizia delle colonne legacy è la 131), referral (132, fasi 1–4). Gli altri domini sono solo inventariati. **129, 130, 131 e 132 sono applicate in produzione (26/09/2026, verificate).**

## 1. Problema

`public.tenants` contiene circa 90 colonne. Ogni funzionalità ne ha aggiunte (loyalty, referral, ambassador, AI, shipping, moduli, billing, Android…), mescolando identità, branding, impostazioni operative, dati commerciali e segreti in una sola riga. Le conseguenze verificate nel codice sono:

- **Esposizione indiscriminata (situazione prima della Fase 0, corretta).**
  - `getTenant()` legge `select('*')` con service role.
  - `app/layout.tsx` serializzava `{...tenant}` verso il client azzerando solo `packlink_api_key` e `chatbox_extra_context`: `bank_iban`, `subscription_*`, `referral_fraud_*`, limiti AI interni e sequenze arrivavano al browser di ogni visitatore.
  - Le pagine `/cart`, `/checkout`, `/checkout/en-attente`, `/checkout/reprendre/[id]` e il layout Événementiel passavano **la riga intera** a Client Components, **compresi `packlink_api_key` e `chatbox_extra_context` valorizzati** (verificato nel payload RSC di produzione il 26/09/2026).
  - **Correzione (Fase 0):** `PUBLIC_TENANT_FIELDS` / `PublicTenant` (`packages/types/tenant.ts`) e `toPublicTenant()` (`lib/tenant/publicTenant.ts`) copiano solo i campi ammessi. Una nuova colonna di `tenants` è quindi privata per default. `TenantProvider` e tutti i Client Components sono tipizzati `PublicTenant`, e il test `tests/unit/publicTenant.spec.ts` impedisce la reintroduzione del tipo `Tenant` completo lato client.
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

Legenda esposizione: **P** = colonna nel grant pubblico 076 (anon/authenticated); **L** = inclusa in `PUBLIC_TENANT_FIELDS`, quindi inviata al client (prima della Fase 0 lo erano tutte le colonne); **S** = solo server.

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
- **Esposizione:** P (`app_icon_url` concessa da 105, `storefront_url` da 079; `google_review_url` non concessa). L solo per i campi di `PUBLIC_TENANT_FIELDS` (esclusi `google_review_url`, `label_logo_url`, `story_*`, `countries_served`, letti lato server).
- **Destinazione:** restano su `tenants`, ma il client deve ricevere una **proiezione esplicita** dei campi.
- **Migrazione:** Fase 0.
- **Rischio:** basso.

### 3.3 Impostazioni operative del negozio
- **Colonne:** `click_collect_enabled`, `click_collect_address`, `click_collect_hours`, `click_collect_hours_it`, `storefront_ready`.
- **Responsabilità:** ritiro in negozio e disponibilità dello storefront.
- **Letture:** checkout, carrello, `/livraison`, conferma ordine, layout (shop).
- **Scritture:** `PATCH /api/admin/tenant`.
- **Esposizione:** P; L tranne `storefront_ready`.
- **Destinazione:** `feature_settings('click_collect')`, oppure restano colonne (sono pubbliche e poche).
- **Migrazione:** bassa priorità.
- **Rischio:** medio (checkout).

### 3.4 Loyalty — **migrazione completata (130 e 131 applicate)**
- **Struttura:** `tenant_feature_settings('loyalty')`, con `enabled` e config `{version: 1, purchase_points_rate, points_to_currency_rate}` (numeric(10,4): 0–999999.9999, al più 4 decimali; CHECK `is_valid_loyalty_config`). Feature `billable = false`, senza piani. **Unica fonte di verità.**
- **Colonne legacy:** la 130 le teneva allineate con due trigger. La **131** (distruttiva, rollback nei commenti) le rimuove insieme ai trigger. Prima verifica che ogni tenant abbia una riga identica alle colonne, altrimenti si ferma senza eliminare nulla. Dopo la 131 un nuovo tenant non riceve alcuna riga: riga assente = programma disattivato.
- **Fuori dal modulo:** `referral_signup_bonus_points` appartiene al referral (3.5); `loyalty_card_sequence` è una sequenza (3.15).
- **Letture:** `getLoyaltySettings(db, tenantId)` in `lib/loyalty/loyaltyConfig.ts`. Riga valida → valori salvati. Riga assente, invalida o illeggibile → programma disattivato: nessun punto a un tasso incerto. Punti di lettura: `processOrderPointsOnDelivery`, `/compte`, `/compte/carte-fidelite`, wallet, scan admin (pagina e conferma), `/admin/loyalty`. Con la 131 anche la RPC `process_manual_purchase_points_atomic` legge la riga settings, con stessa firma e stesso calcolo.
- **Scritture:** `LoyaltyConfigSection` → `PATCH /api/admin/loyalty/settings` (permesso `tenant_settings.manage`, invariato rispetto a `/api/admin/tenant`). `/api/admin/tenant` non accetta i campi loyalty.
- **Esposizione:** S.
- **Ordine di rilascio della 131:** prima il deploy del codice che non seleziona più le colonne, poi la migrazione.
- **Rischio:** medio (valore economico dei punti). Mitigato dai controlli preliminari della 131 e dai test SQL: storico `points_ledger` invariato e RPC con lo stesso risultato.

### 3.5 Referral — **migrata (132 applicata; fase 5 aperta)**
- **Struttura:** `tenant_feature_settings('referral')` con config `{version: 1, max_depth, signup_bonus_points, availability_mode, unlock_spending_threshold, fraud_max_conversions, fraud_period_days, fraud_action}`. Tipi e intervalli ricalcano la 040 (profondità 1–5, enum invariati, soglia di sblocco `null` oppure 0–99 999 999,99 con 2 decimali, periodo anti-frode 1–3650 giorni); CHECK `is_valid_referral_config`, scritto in plpgsql in modo che un tipo sbagliato venga rifiutato e non provochi un errore di cast. Feature `billable = false`, senza piani.
- **Attivazione:** il programma non ha un interruttore proprio e continua a seguire `loyalty.enabled`. Il backfill imposta `enabled = true` per tutti. `enabled = false` (riservato, non esposto in UI) oppure una riga invalida rendono il referral **non disponibile**: nessun codice, nessuna idoneità automatica, nessun bonus, nessun punto referral.
- **Colonne legacy:** i sette `tenants.referral_*` restano, allineati da due trigger con guardia (`sync_referral_settings_to_tenant`, `sync_tenant_referral_to_settings`). Un nuovo tenant riceve la riga con i valori predefiniti.
- **Letture:** `getReferralSettings(db, tenantId)` in `lib/loyalty/referralConfig.ts`. Restituisce un oggetto con le **stesse chiavi delle colonne**, così la logica esistente non cambia. Precedenza: riga valida e attiva → riga; riga assente (132 non applicata) o illeggibile → colonne legacy dello stesso tenant; disattivata o invalida → `null`. Lettori: `processOrderPointsOnDelivery` (catena e anti-frode), `registerWithReferral`, `checkReferralAccessUnlock`, API `/api/loyalty/referrals/{eligibility,generate-code,tree}`, `/compte`, `/compte/parrainage`, `/admin/loyalty`. Le superfici cliente usano `REFERRAL_UNAVAILABLE_VIEW` (`ADMIN_GRANTED_ONLY`, nessun bonus) quando il programma non è disponibile.
- **Scritture:** `LoyaltyConfigSection` → `PATCH /api/admin/loyalty/referral` (`tenant_settings.manage`, invariato). La route rifiuta `SPENDING_THRESHOLD` con soglia ≤ 0, regola documentata dalla 040 ma prima non applicata. Prima della 132 scrive le colonne legacy con la stessa validazione. `/api/admin/tenant` non accetta più campi referral. Il bonus d'iscrizione non è esposto in UI.
- **Esposizione:** S. La 132 revoca il grant pubblico 076 sui sette campi, soglie anti-frode incluse.
- **Prossimo passo (fase 5):** rimuovere trigger e colonne, come la 131 per la loyalty.
- **Rischio:** medio-alto (anti-frode, punti). Mitigato da backfill con verifica, mirror transazionale e fail closed.

### 3.6 Ambassador
- **Colonne:** `ambassador_min_purchase_amount`, `ambassador_min_commission_amount`, `ambassador_max_commission_amount`, `ambassador_loyalty_from_second_order`, `ambassador_first_order_discount_type`, `ambassador_first_order_discount_value`, `ambassador_payout_threshold_amount`, `ambassador_commission_mode`, `ambassador_split_pool_amount`, `ambassador_split_pool_ambassador_percent`.
- **Letture:** checkout (`/api/checkout`, `/api/checkout/external-link`, `/api/checkout/ambassador-discount`, `checkout-sessions/[id]`), `lib/ambassador/*`, `processOrderPointsOnDelivery.ts`, `/compte/ambassadeur`.
- **Scritture:** `AmbassadorConfigSection` → `PATCH /api/admin/tenant`.
- **Esposizione:** P (grant 076); non più L.
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
- **Esposizione:** P per flag e limiti pubblici; S per `ai_rate_limit_admin_per_day` e `chatbox_extra_context` (esclusi dalla proiezione pubblica).
- **Destinazione:**
  - flag e limiti → `feature_settings('ai')` / `('nala').config`;
  - `chatbox_extra_context` → tabella di contesto privata o `tenant_knowledge_base`.
- **Rischio:** medio.

### 3.10 Moduli attivi (Événementiel e servizi)
- **Colonne:** `events_enabled`, `services_enabled`, `rental_delivery_enabled`, `rental_delivery_countries`.
- **Letture:** layout e pagine `(evenementiel)`, `/accueil`, scan admin, `livraison-materiel`.
- **Scritture:** `/api/admin/evenementiel/settings` (`ModuleSettingsToggle`) e l'admin delle zone di consegna noleggio.
- **Esposizione:** P e L per `events_enabled`/`services_enabled`; `rental_delivery_*` esclusi dalla proiezione pubblica.
- **Vincoli:** `events_enabled` duplica il permesso commerciale `events`.
- **Destinazione:** permesso `events` + `feature_settings('events', {services_enabled, rental_delivery…})`. Le zone e i paesi di consegna sono liste: vanno in tabelle proprie, non nel JSONB.
- **Rischio:** medio.

### 3.11 Shipping
- **Colonne:** `shipping_provider`, `packlink_api_key` (**segreto**), `flat_rate_amount`, `shipping_pricing_mode`, `shipping_tariff_fallback`, `shipping_public_grid_enabled`.
- **Letture:** `/api/shipping/quote`, `lib/shipping/providers/packlink.ts`, `lib/shipping/tariff/*`, `lib/shipping/syncOrderShipment.ts` (`select('*')`), simulatore e inspector admin.
- **Scritture:** `/api/admin/shipping-pricing-mode`; il resto manualmente.
- **Esposizione:** P per `shipping_provider`/`flat_rate_amount`; S per la chiave (esclusa da 076 e dalla proiezione pubblica). **Fino alla Fase 0 la chiave era inviata ai visitatori da `/cart` e `/checkout`: va ruotata.**
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
- **Esposizione:** S (fino alla Fase 0 inviata al browser tramite il root layout).
- **Destinazione:** solo il dominio billing (084). Le colonne su `tenants` sono legacy.
- **Rischio:** medio (riguarda il fatturato della piattaforma, non i pagamenti dei clienti).

### 3.13 Integrazioni app
- **Colonne:** `android_package_name`, `android_sha256_fingerprint`, `android_public`.
- **Letture:** `/.well-known/assetlinks.json`, `/go`.
- **Esposizione:** P (grant 076); non più L. Dati pubblici per natura (serviti da `/.well-known/assetlinks.json`).
- **Destinazione:** `feature_settings('android_app')` o nessuna modifica.
- **Rischio:** basso.

### 3.14 Metodi di pagamento cliente
- **Tabelle:** `tenant_payment_methods` (030/062/066/126).
- **Esposizione:** pubblica per le righe attive (IBAN e link destinati ai clienti).
- **Destinazione:** già relazionale. **Nessun intervento**: le regole di pagamento restano fuori da questo piano.

### 3.15 Dati transazionali e sequenze su `tenants`
- **Colonne:** `barcode_prefix`, `barcode_sequence`, `loyalty_card_sequence`.
- **Scritture:** funzioni SQL di 031 e 047.
- **Esposizione:** S (fino alla Fase 0 L).
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
| 0 | **Fatto.** Proiezione client esplicita (`toPublicTenant`) nel root layout e in ogni pagina che passa il tenant a Client Components; `PATCH /api/admin/tenant` restituisce solo i campi modificabili (con 129) | Chiude l'esposizione di segreti, billing e anti-frode senza migrazioni | — |
| 1 | Rapporto delle 08:00 | Fatto (129) | — |
| 2 | Loyalty — **completato (130 e 131 applicate; colonne legacy rimosse)** | Pochi campi, schema semplice, un solo writer | Medio |
| 3 | Referral — **fasi 1–4 fatte (132 applicata)**; resta la fase 5 | Dipende dalla loyalty; soglie anti-frode rese private dalla 132 | Medio-alto |
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
