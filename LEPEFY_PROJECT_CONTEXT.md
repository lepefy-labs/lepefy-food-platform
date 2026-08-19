# Lepefy Food Platform — Project Context

> Documento di riferimento per Claude Code, onboarding sviluppatori, e continuità tra sessioni.
> Aggiornato: 18 Agosto 2026 (v3.44) — **fix `return_url` mancante su `/card` + Payment Funnel Logs**: bug corretto su `CardQuickPay.tsx` (nessun `return_url` verso il retour 3D Secure, rischio aggravato dal fatto che `/card` è tipicamente aperto da QR scansionato in negozio, spesso in WebView) con retrieve del PaymentIntent al mount per non perdere lo stato dopo un redirect completo; nuova tabella condivisa `payment_funnel_logs` (migration `065`, 7 `event_type`, RLS insert pubblico + grant `service_role`) strumentata sui 4 moduli di pagamento (card/event/rental/shop), ciascuno con un `reference_id` coerente per l'intero funnel di un tentativo (`quickPaymentId`/`event.id`/`service.id`/`sessionId` — quest'ultimi due, `quickPaymentId` e `sessionId`, non tornavano al client prima di questo ciclo, ora propagati dalle rispettive route). Nessuna modifica alla logica `confirmPayment`/`return_url` già corretta di shop/event/rental, solo aggiunta dei log attorno. `pnpm typecheck` pulito. Dettaglio completo in §62 (nuova sezione). Revisione precedente (v3.43) sotto.
> Aggiornato: 17 Agosto 2026 (v3.34) — **due cicli ulteriori sullo stesso branch di lavoro** (`claude/stripe-webhook-event-reservations-iba64o`), sempre sul percorso di prenotazione evento, in continuità coi quattro cicli di v3.33: (5) **chiarimento del canale email sulla pagina `/en-attente`** (pagamento evento via link esterno PayPal/Revolut) — l'utente ora vede l'email inserita e viene informato onestamente che per questo mezzo di pagamento l'email è l'unico canale di recupero del biglietto (nessuna pagina QR di fallback, a differenza di Stripe), con CTA WhatsApp condizionale per correggere l'indirizzo prima di pagare; contestualmente, **pulizia dei trattini lunghi (`—`) da tutti i testi utente** del percorso Événementiel (nuova regola permanente, dettagliata in §52) — i commenti di codice non sono toccati; (6) **"Changer de moyen de paiement" da `/en-attente`** — il cliente che ha scelto PayPal/Revolut e vuole ripensarci può tornare al checkout con formule/nome/email/telefono già precompilati (draft salvato in sessionStorage) invece di reinserire tutto da zero, e la richiesta `pending` abbandonata viene cancellata (non solo marcata) così sparisce anche dal bandeau admin. **Nessuno dei due cicli è stato pushato** — stessa regola dei precedenti, consegna via zip. `pnpm typecheck` pulito dopo ciascuno, nessuna migration SQL. Dettaglio completo in §52 (nuova sezione). Revisione precedente (v3.33) sotto.
> Aggiornato: 17 Agosto 2026 (v3.33) — **quattro cicli sequenziali sullo stesso branch di lavoro** (`claude/stripe-webhook-event-reservations-iba64o`), tutti sul percorso di prenotazione evento (billetterie Événementiel, §41): (1) **fix critico** — il webhook Stripe non gestiva `payment_intent.succeeded` con `metadata.type === 'event_reservation'`, quindi i pagamenti biglietto evento venivano incassati ma nessuna riga `event_reservations`/QR/email veniva mai generata (varco isolato al percorso Stripe diretto, il flusso Phase 2 `external_link` non era toccato perché passa da `confirm-payment/route.ts`); (2) nuova funzionalità admin di **correzione email + reinvio biglietto** per prenotazioni già confermate; (3) **messaggistica evidente sull'email** in tre punti del percorso di checkout/conferma (rilettura email, non correzione automatica del dominio — quella è stata scartata come non pertinente al problema reale, errori nella mailbox non nel dominio); (4) **validazione di formato email** (client + server) per chiudere il varco residuo su chiamate dirette all'API. **Nessuno dei quattro cicli è stato pushato** — consegna via zip ad ogni ciclo su richiesta esplicita di Robertin, modifiche presenti solo su disco in questa sessione (`git status` mostra 6 file modificati + 2 nuovi non committati al momento di questa revisione). `pnpm typecheck` pulito dopo ciascun ciclo. Nessuna migration SQL in nessuno dei quattro cicli. Dettaglio completo in §51 (nuova sezione). Revisione precedente (v3.32) sotto.
> Aggiornato: 14 Agosto 2026 (v3.23) — **verifica di coerenza contro filesystem/git reale** (branch `claude/lepefy-project-context-update-a8zju7`, `pnpm install` + `pnpm typecheck` eseguiti in questa sessione, esito pulito), stesso tipo di passata di v3.7/v3.16/v3.18/v3.20/v3.22. **Scoperta principale, che ribalta lo stato riportato da v3.7 in poi:** il gap `main` vs branch di lavoro **è chiuso** — `git merge-base main HEAD` coincide con la punta di `main`, questo branch è `main` + **un solo commit ulteriore** (refactor cosmetico digital card, punto 4 sotto); tutto il lavoro dei cicli precedenti (redesign storefront/admin, loyalty/referral, Ambassadeur, Événementiel) risulta ora mergiato su `main`. Dieci migration nuove non ancora documentate (`053`–`062`, 10–13/08), tre filoni: (1) **Événementiel Fase 2** — redemption granulare per formula (`053`, con due bugfix "colonna ambigua" immediati `054`/`055`), palette/tema per evento (`056`+`058`), hero highlights + badge formule (`058`), indice galleria dedicato (`057`); (2) **pagamenti via lien externe (PayPal/Revolut/autre)** estesi in tre fasi sequenziali allo stesso pattern (nessun ordine/prenotazione creato al click, solo richiesta in attesa di conferma manuale admin via bandeau "Paiements en attente"): boutique (`059`, corregge anche una deriva del CHECK `orders.payment_method` che non includeva `in_store` benché già usato dal codice), billetterie événementiel (`060`, nuova tabella `event_reservation_requests`), **location matériel** (`061`, nuova tabella `rental_reservation_requests` — terzo modulo scoperto sotto `(evenementiel)`, non documentato prima d'ora, distinto da "Services/devis"); (3) **paiement carte à montant libre su `/card`** (`062`, tabella `tenant_card_payments`, PaymentIntent Stripe sul conto piattaforma) via nuovo componente `CardQuickPay.tsx` (13/08), seguito il giorno dopo (14/08, commit non ancora pushato di questa sessione) da un refactor puramente cosmetico di `DigitalCard.tsx` che estrae la lista metodi di pagamento in un nuovo `PaymentMethodsAccordion.tsx`. Nessuna nuova dipendenza npm; `next`/`eslint-config-next` bump di patch `14.2.3`→`14.2.35`. Non verificabile da qui se le migration `053`–`062` siano state applicate al DB Supabase reale. Dettaglio completo in §41 (nuova sezione). Revisione precedente (v3.22) sotto.
> Aggiornato: 10 Agosto 2026 (v3.22) — **verifica di coerenza contro filesystem/git reale** (branch `claude/scanner-mobile-crash-fix-q6ez8r`), stesso tipo di passata di v3.7/v3.16/v3.18/v3.20. Tre cicli sostanziali emersi tra v3.21 (6/08) e oggi, nessuno documentato finora: (1) **regole di spedizione per paese** (`050_shipping_country_rules.sql`, 6/08) — layer di gratuità/forfait/sconto per paese sopra Packlink, UI admin `/admin/livraison` + simulatore `/admin/livraison/simulateur`; (2) **modalità "pool condiviso" per il programma Ambassadeur** (`051_ambassador_split_pool_mode.sql`, 7/08), alternativa alla commissione proporzionale esistente (`046`); (3) **modulo Événementiel + Services** (`052_events_module.sql`, 9/08) — il ciclo più corposo dei tre: soirées barbecue con biglietteria QR, prestazioni traiteur/location su preventivo, storefront pubblico dedicato (`(evenementiel)` route group), scanner d'ingresso admin (`/admin/evenementiel/scan`, riusa `CameraScanButton.tsx` della loyalty card via `html5-qrcode`). Un quarto cambiamento, oggi stesso: **fix di un crash mobile reale** su quello scanner — `stop()` di `html5-qrcode` lancia un'eccezione **sincrona** (non una promise rejection) quando lo scanner non è in stato SCANNING/PAUSED, quindi i `.catch()` esistenti non la intercettavano; il doppio `stop()` (una volta nel callback di decodifica, una seconda volta nel cleanup dell'effetto allo smontaggio del componente) la faceva scattare sistematicamente. Guardia aggiunta via `getState()` + try/catch, unico file toccato `CameraScanButton.tsx`, `pnpm typecheck` pulito — commit locale, **non pushato su richiesta esplicita di Robertin** (consegna via zip). Confermato anche: `main` resta fermo a `049_tenant_android_public_release.sql` (54 migration), questo branch ne conta **57** — gap invariato rispetto a v3.20, allargato di 3 file (`050`–`052`). Dettaglio completo in §40 (nuova sezione). Revisione precedente (v3.21) sotto.
> Aggiornato: 6 Agosto 2026 (v3.21) — **due cicli 5–6 agosto, integrati solo da ricerca chat (nessuna verifica contro filesystem/git in questa sessione — stesso tipo di passata di v3.19)**: (1) **pubblicazione Google Play Store via TWA** (5/08) — infrastruttura completa (migration `048`: `android_package_name`/`android_sha256_fingerprint`), packaging via PWABuilder (non Bubblewrap), Package ID `com.lepefy.chloefood.twa`, scoperta del signing "hybrid quantum-ready" a 3 certificati, hardening PWA e pagina privacy policy propedeutici, TWA installata e funzionante su Internal Testing (2 tester) — **resta bloccante il gate Closed Testing 12 tester/14gg consecutivi, non ancora avviato**; (2) **smart-link QR negozio `/go`** (6/08) — secondo QR distinto dal QR carta/loyalty, migration `049`: `tenants.android_public` per non reindirizzare a una scheda Play Store non ancora pubblica, due bug di produzione scoperti e corretti (dominio canonico, rendering testo SVG via satori/resvg per evitare tofu box su Vercel serverless). Regola permanente stabilita: mai `pnpm lint` su questo repo. Nessuno dei due cicli è stato riverificato contro `git`/filesystem da questa sessione — **da confermare alla prossima passata di coerenza**, come già accaduto per v3.19→v3.20. Dettaglio completo in §39 (nuova sezione) e §14ter (nuova sezione). Revisione precedente (v3.20) sotto.
> Aggiornato: 3 Agosto 2026 (v3.20) — **verifica di coerenza contro filesystem/git reale** (branch di lavoro `claude/update-lepefy-project-context-lxyoyq`), stesso tipo di passata di v3.7/v3.16/v3.18. Risultato principale, che ribalta lo stato riportato in v3.19: **tutti e cinque i cicli segnati "non confermato in chat"/"non eseguito" risultano in realtà eseguiti** — 17 commit "Add files via upload" (30/07–3/08) sul branch di lavoro, non ancora su `main`, portano `supabase/migrations/` da 44 a **47 file** (`045_tenant_hero_slides.sql`, `046_ambassador_commission_system.sql`, `047_loyalty_card_system.sql`) e implementano per intero: (1) pagina **Mon compte** (`/compte`, `AccountDashboard.tsx`/`AddressFormModal.tsx`/`ProfileEditModal.tsx` + CRUD indirizzi); (2) **redesign home page** completo e mergiato nel flusso `(shop)/page.tsx` (`HeroCarousel`, `CategoryBlocksRow`/`CategoryBlocksGrid`, `SuggestionsRow` ×2, CRUD admin `/admin/accueil-slides`); (3) **digital card** con link di pagamento diretto (`pm.extra.link`, IBAN confermato non mascherato) + **PDP** con `ProductSpecs` riposizionato dopo il prezzo; (4) **programma Ambassadeur** completo (tabella `ambassador_commissions`, sconto primo ordine in checkout, commissione atomica alla consegna, UI cliente `/compte/ambassadeur` + admin `/admin/ambassadeurs`) e **carta fedeltà EAN-13** (namespace `21`, ruolo `admin_users.tenant_cashier` scoped esclusivamente a `/admin/loyalty/scan`, camera scan via nuova dipendenza `html5-qrcode`, widget dashboard in formato tessera fisica). `pnpm typecheck` pulito su tutto il codice attuale del branch (verificato in questa sessione dopo `pnpm install`, non solo riportato). **Resta non eseguito solo il punto (5)**: nessun codice TWA/Play Store (`assetlinks`, `android_package_name`) trovato in alcun punto del repo — quella parte di v3.19 è confermata corretta. Nota strutturale: `main` risulta fermo a **prima** di `044_customer_default_address.sql` (contiene solo fino a `043`, doc a v3.16) — il gap tra branch e `main` documentato da v3.7 in poi non si è chiuso, anzi si è allargato. Dettaglio completo, incluso l'elenco commit-per-commit, in §38. Revisione precedente (v3.19) sotto.
> Aggiornato: 3 Agosto 2026 (v3.19) — **cinque cicli distinti dall'ultima revisione (1–3 agosto), nessuno riverificato contro filesystem/git da questa sessione — stato basato solo su quanto riportato/generato in chat**: (1) **integrazione design "Mon compte"** — prompt Claude Code generato per la pagina account (header brand, identità, loyalty card con dati reali, indirizzi, CTA), esecuzione non confermata in chat; (2) **integrazione redesign home page** da pacchetto design esterno — hero carousel, category blocks a scroll orizzontale, riga "Suggestions pour vous", restyling FAB chat, form admin CRUD per hero slides; **eseguito da Robertin**, con un ciclo di fix successivo (autoscroll mobile via `scrollLeft`+`requestAnimationFrame`, layout differenziato mobile/desktop) — nessun `pnpm typecheck` esplicitamente riportato in chat per questo ciclo; (3) **digital card**: nuovo campo link di pagamento diretto (riuso colonna `extra jsonb` di `tenant_payment_methods`, nessuna migration) + PDP: `ProductSpecs` spostato subito dopo il prezzo con trattamento colore vivace via `color-mix()` — prompt generato e approvato su mockup, esecuzione non confermata in chat; (4) **due nuovi sistemi progettati ma non ancora eseguiti**: programma **Ambassadeur** (commissioni in euro al primo ordine di referral, sconto opzionale, ruolo `tenant_cashier` dedicato) e **carta fedeltà fisica/virtuale** con barcode EAN-13 proprio (namespace `21`, distinto da `20` dei prodotti) per accumulo punti in negozio — entrambi con prompt Claude Code pronti in output ma **non ancora inviati/eseguiti**, vedi §37 per il dettaglio completo incluse le decisioni di prodotto prese; (5) **pianificazione pubblicazione su Google Play Store** (TWA) — solo fase di analisi/pianificazione, nessun codice scritto; account Play Console **personale** scelto (non Organization), quindi il gate "12 tester attivi per 14 giorni consecutivi" è nel percorso critico verso il lancio. Nessuna di queste cinque voci è stata verificata da questa sessione contro `main`/Supabase — vedi §37. Revisione precedente (v3.18) sotto.
> Aggiornato: 31 Luglio 2026 (v3.18) — **verifica di coerenza contro filesystem/git reale** (stesso branch di lavoro `claude/verify-lepefy-context-v3-17-2t4lxu`), stesso tipo di passata già fatta in v3.7/v3.16 — v3.17 era basata solo su stato riportato in chat, mai verificata contro il codice. Correzioni principali: (1) **numerazione migration sbagliata in v3.17** — `039_loyalty_referral_system.sql` non esiste: il sistema loyalty è realmente `040_loyalty_referral_system.sql`, e `039` è invece `039_admin_users.sql` (migration distinta, mai comparsa nella tabella §4). Il ciclo ha prodotto **4 migration ulteriori mai documentate**: `041_fix_points_balance_view.sql` (corrisponde al bug già in tabella §9bis, nessuna sorpresa), `042_customers_service_role_grant.sql` (bug **nuovo**, non in tabella: GRANT su `customers` mancante per `service_role`, distinto dal bug "permission denied" già documentato — ora ottavo bug in tabella), `043_drop_redundant_customer_referral_code.sql` (chiarisce che `customers.referral_code` non era una colonna legacy: **aggiunta da `040` e rimossa di nuovo da `043` nello stesso ciclo**, non un residuo storico) e `044_customer_default_address.sql`. (2) **Scoperta più rilevante:** a differenza di ogni verifica precedente (v3.7/v3.16, sempre "nulla mergiato su `main`"), `git merge-base main HEAD` mostra che **la maggior parte di questo ciclo è già su `main`** — auth cliente, `admin_users`, l'intero sistema Loyalty/Referral **incluse le UI** `/admin/loyalty` e `/compte/parrainage` (mai citate in v3.17) sono tutte confermate su `main`. **Ma non tutto**: la pagina storico ordini `/orders` (§9bis punto 3) e la pre-compilazione/salvataggio profilo checkout (§9bis punto 4, migration `044`) esistono **solo su questo branch**, contrariamente al "✅ FATTO" indistinto di v3.17 in §9bis/§18/§19. (3) Corretto: il componente "corda dei cartellini" (`RopeTag.tsx`) **non estende** `ShopTag.tsx` come scritto in v3.17 — è un componente separato con la stessa geometria (clip-path), scelta esplicita in codice per non toccare `ShopTag.tsx`. Dettaglio completo in §36 (nuova sezione changelog). Revisione precedente (v3.17) sotto.
> Aggiornato: 31 Luglio 2026 (v3.17) — **nuovo ciclo consistente: autenticazione cliente + `admin_users` + storico ordini `/orders` + sistema Loyalty/Referral multi-tier**, il lavoro più corposo del progetto finora in termini di superficie DB (3 nuove migration: `037_checkout_sessions_customer_id.sql`, `038_customers_grants.sql`, `039_loyalty_referral_system.sql`, quest'ultima da sola con 7 tabelle nuove + funzioni Postgres). Riassunto: (1) autenticazione cliente via Supabase Auth con **OTP a codice a 6 cifre** (non magic link — scelta deliberata perché i magic link su iOS/Android aprono il browser di sistema invece della PWA installata, rompendo il contesto app, stesso tipo di limite già noto per l'installazione PWA); checkout guest resta possibile ma senza punti/referral; (2) tabella `admin_users` sostituisce la whitelist flat `ADMIN_EMAILS`, introduce ruoli `platform_owner`/`tenant_admin` con scoping per tenant, `requireAdmin()` cambia firma in `requireAdmin(tenantId)`; (3) pagina storico ordini cliente `/orders` (riusa il pattern token HMAC di `/orders/[id]?token=xxx`), voce "Compte" aggiunta al BottomNav mobile (punto d'ingresso mancante, corretto in sessione); (4) checkout con pre-compilazione profilo per clienti autenticati; (5) **sistema Loyalty/Referral multi-tier** completo: albero referral a profondità configurabile per tenant (default 2, tetto hard indipendente dalla config — modificabile solo via migration esplicita), percentuali per livello versionate per tenant (mai sovrascritte — ogni riga del ledger salva `pct_applied`/`referral_level` per restare storicamente accurata anche se le percentuali cambiano in futuro), ledger punti append-only (pattern Ledger, righe `REVERSED` invece di update), controlli anti-frode graduati (`FLAG_FOR_REVIEW`/`CAP_AT_THRESHOLD`/`AUTO_BLOCK`), gating eleggibilità codice referral (`ALL_CUSTOMERS`/`SPENDING_THRESHOLD`/`ADMIN_GRANTED_ONLY`), link referral in formato path `/invite/[code]` (non query param `?ref=` — scelta tecnica: il middleware Next.js non gira per via del Root Directory Vercel, e le pagine ISR non possono leggere in sicurezza cookie per-utente), visualizzazione albero referral lato utente. Eseguito e verificato da Claude Code con diversi bug intercettati e corretti in sessione (dettaglio in §9bis). Vedi §9bis (nuova sezione) e §35 per il changelog completo. Revisione precedente (v3.16) sotto.
> Aggiornato: 26 Luglio 2026 (v3.16) — **verifica di coerenza contro filesystem/repo reale** (branch `claude/lepefy-project-context-check-rl2zy3`, staccato dallo stesso `main` di v3.15). Trovata e corretta una lacuna concreta in §4: `ls supabase/migrations/` mostra **41 file**, non i ~39 impliciti dalla tabella precedente — mancava `031_storefront_ready.sql` (collisione di numero con `031_barcode_system.sql`, mai segnalata) e `034_click_collect_hours_it.sql` era ancora segnato "contenuto non identificato" nonostante il campo sia cablato end-to-end nel codice (`packages/types/tenant.ts`, `/card`, `/admin/parametres`). Entrambe le feature (flag `tenants.storefront_ready` per il link "Voir nos produits" su `/card`, campo `click_collect_hours_it` per gli orari in italiano) sono ora documentate in §4/§14/§14bis. Confermato anche, senza sorprese: `git merge-base main HEAD` coincide ancora con la punta di `main` (questo branch resta non mergiato, coerente con lo stato riportato da v3.7 in poi); i componenti nuovi elencati in §33 (`ProductDetail.tsx`, `ProductGallery.tsx`, `ProductSpecs.tsx`, `ProductTabs.tsx`, `TrustBadges.tsx`, `StorySection.tsx`, `upload-story-photo`) esistono tutti sul filesystem; `packages/types/product.ts`/`tenant.ts` contengono i campi attesi (`is_homemade`, `storefront_ready`, `click_collect_hours_it`); BottomNav conferma icone Tabler (coerente col revert §12/§33). Dettaglio completo in §34. Revisione precedente (v3.15) sotto.
> Aggiornato: 26 Luglio 2026 (v3.15) — **tre cicli consolidati in questo aggiornamento** (mai documentati individualmente finora, gap riconosciuto — vedi §33 per il dettaglio): (1) redesign completo Product Detail Page (galleria dinamica, spec row Poids/Origine/Conservation con mapping esplicito, tab Ingrédients&Allergènes/Conservation da campi etichetta già esistenti, trust badge in stile "card" con contrasto rifinito su feedback iterativo, `products.is_homemade` nuovo campo esplicito mai dedotto — migration `035`); (2) home page: "Nos produits vedettes" da scroll orizzontale a grid con quick-add, nuova sezione condizionale "Notre origine" (migration `036`, invisibile finché `story_text` non è compilato, statistiche reali mai hardcoded), footer esteso a 4 colonne **solo in home** (altrove resta la versione minimale, per non competere con la bottom nav fissa su mobile — nessun link a pagine inesistenti, colonne "Boutique"/"Aide" omesse per mancanza di pagine reali), card prodotto hero rese cliccabili, colore ticker rifinito (`color-mix` 55% invece di 25%, per restare riconoscibile come tinta brand); (3) form admin `/admin/parametres` per i campi "Notre origine" (riuso del pattern `EDITABLE_TENANT_FIELDS`/`BoutiqueInfoSection` esistente, upload foto indipendente dal Save principale via endpoint già esistente) — report dettagliato ricevuto, `pnpm typecheck` pulito; migration `035`+`036` confermate eseguite su Supabase in chat (non riverificate contro il DB reale da questa sessione). Revisione precedente (v3.14) sotto.
> Aggiornato: 26 Luglio 2026 (v3.14) — **decisione di piattaforma invertita esplicitamente**: la bottom navigation bar dello storefront cliente (§12) passa da icone Tabler a emoji (🏠 🛍️ 🛒 📦), insieme a hero trust-row (🚚 livraison, ❄️ frais/surgelés — "Sélection artisanale" resta un SVG a blason, branding grafico non icona funzionale) e ticker notification bar (🚚 ❄️ 🌍 🌿 su tutte e 4 le frasi, sfondo scurito via `color-mix(in oklch, var(--color-primary) 25%, black)` invece di ereditare `--color-primary` puro). Perimetro volutamente limitato a questi 3 punti esplicitamente mappati — un audit più ampio ha trovato icone Tabler anche in ChatWidget, CartClient, CheckoutForm, pagine Orders/OrderConfirmation e nella Digital Card pubblica (`/card`), lasciate invariate in questo giro (nessun mapping emoji deciso per quelle, decisione rimandata). `apps/admin/**` non toccato: lì le icone Tabler restano, coerenza con densità/leggibilità per uso interno. Revisione precedente (v3.13) sotto.
> Aggiornato: 24 Luglio 2026 (v3.13) — confermato da Robertin in chat (nessuna verifica indipendente contro git/filesystem in questa sessione): migration 032+033 chatbox eseguite su Supabase, checklist go-live aggiornata di conseguenza. Integrata la "roadmap" discussa in chat per la chatbox: bozza `chatbox_extra_context` ChloeFood preparata ma non eseguita (dati email/paesi consegna da confermare), questionario di raccolta contenuto per Dalice preparato, regola "una voce = un concetto" formalizzata (con eccezione per `greeting`), due idee salvate in roadmap P3 (unificazione `chatbox_extra_context`/`click_collect_hours`, import batch multi-voce se il volume cresce). `ai_chatbox_enabled` e popolamento knowledge base restano da fare. Dettaglio in §13ter (sezioni aggiornate) e §32. Revisione precedente (v3.12) sotto.
> Aggiornato: 23 Luglio 2026 (v3.12) — **verifica indipendente contro git/filesystem reale** (branch `claude/storefront-lang-toggle-related-11741t`, stesso branch su cui sono stati scritti sia il ciclo v3.11 sia il chatbox sotto). Nuova feature **Chatbox IA pubblica** (fasi 1+2): widget storefront con ricerca semantica su prodotti + knowledge base culturale curata a mano, filtro small-talk a costo zero, gated dietro `tenants.ai_chatbox_enabled` (default `false`, nessun tenant abilitato automaticamente). Scritta e verificata (typecheck) in questa sessione — non solo riportata in chat. **Scoperta operativa rilevante:** `git fetch origin main` mostra che Robertin ha già applicato entrambi gli zip di consegna direttamente su `main` (4 commit "Add files via upload", 24/07), quindi il codice chatbox **è già su `main`**, non solo su questo branch — confermato con `git diff HEAD origin/main` (zero differenze di codice, solo questo documento). Non verificabile da qui se le migration SQL 032/033 siano state eseguite su Supabase (nessuna riga chatbox esisterebbe finché non lo sono) — vedi §13ter e §18. Dettaglio completo in §13ter (nuova sezione). Revisione precedente (v3.11) sotto.
> Aggiornato: 21 Luglio 2026 (v3.10) — chiusura ciclo barcode/full-bleed: migration 031 applicata al DB, PDF reale Gotenberg testato, prompt split tabella nutrizionale eseguito e testato. Rimossa la voce GS1 ufficiale dalla roadmap (curiosità di Robertin, non un'esigenza reale — non perseguita). Dettaglio in §29. Revisione precedente (v3.9) sotto.
> Aggiornato: 21 Luglio 2026 (v3.9) — ciclo "Sistema barcode + fix layout etichetta full-bleed": barcode EAN-13 interno multi-tenant (migration 031, **non ancora applicata al DB**), QR mancante aggiunto al template full-bleed, barcode+QR impilati in basso a destra, shrink-to-fit contro il taglio silenzioso di contenuto, split tabella nutrizionale a due colonne (**prompt scritto, esecuzione non ancora confermata**). Dettaglio in §28. Revisione basata sullo stato riportato in chat in questa sessione — nessuna verifica indipendente contro git/filesystem (a differenza di v3.7). Revisione precedente (v3.8) sotto.
> Aggiornato: 21 Luglio 2026 (v3.8) — ciclo "Digital card evolution": metodi di pagamento, self-service settings tenant, poster stampabile A5, loghi social a colori, shortcut home screen dedicato a `/card`, fix resize icona PWA. Dettaglio in §27bis. Revisione precedente (v3.7) sotto.
> Aggiornato: 18 Luglio 2026 (v3.7) — **verifica indipendente contro git/filesystem reale** (branch `claude/update-lepefy-project-context-fke5jo`), non solo stato riportato in chat. Due correzioni rilevanti rispetto a v3.6: (1) la **KPI "Aujourd'hui"**, segnalata come "prompt scritto ma non eseguito", **risulta invece già eseguita** nel codice (`admin/(protected)/page.tsx`) — il commit che l'ha implementata precede cronologicamente quello che ha scritto v3.6, semplicemente lo stato in chat non era stato aggiornato di conseguenza; (2) **`main` non contiene né il redesign admin (Fase 0–4, §8bis) né il redesign storefront (§12bis)** — `git merge-base main HEAD` coincide con la punta di `main` stessa (ultimo commit 16/07 alle 11:47): **tutto** il lavoro di entrambi gli audit (storefront 16–17/07, admin 17–18/07) esiste solo su questo branch, mai mergiato. La precedente affermazione "branch pushato e mergiato su `main`" (§12bis/§25, v3.4–v3.6) **non è supportata dallo stato reale del repository** — verificato anche puntualmente: `ShopTag.tsx` non esiste su `main`, e `BottomNav.tsx` su `main` contiene ancora l'hex hardcoded `#1D9E75`. Non è verificabile da qui se Vercel effettivamente deploya da `main` o da questo branch (nessun `vercel.json` nel repo) — **da confermare con Robertin prima di dare per assodato lo stato di produzione**. Scoperta anche una funzionalità non documentata: `AdminMobileNav.tsx`, un drawer di navigazione mobile per l'admin (vedi §8bis). Base di questa revisione: v3.6, con le correzioni sopra.

---

## 1. Identità del progetto

**Lepefy Labs** (founder: Robertin Boukeng) costruisce una piattaforma SaaS multi-tenant di e-commerce per boutique alimentari africane in Europa. Il modello di business: Lepefy Labs mantiene la proprietà intellettuale del codice; ogni boutique paga un abbonamento mensile (89 €/mese, minimo 6 mesi). I costi di transazione Stripe/Satispay sono a carico del cliente.

**Tenant pilota:** ChloeFood ETS — negozio di specialità alimentari camerunesi/africane, Reggio Emilia, Italia (gestito dalla cliente **Dalice**). Tagline: *"Les saveurs de chez nous"*. Bilinguismo IT/FR (landing page anche in EN).

| | |
|---|---|
| **Repo GitHub** | `github.com/Lepefy-labs/lepefy-food-platform` (pubblico — vincolo Vercel free plan) |
| **Deploy storefront** | `chloefood.vercel.app` → dominio custom **`chloefood.com`** (attivo) |
| **Landing page pre-lancio** | pagina statica trilingue FR/IT/EN, WhatsApp CTA (393296958822), pubblicata su `chloefood.com` prima del rilascio dell'e-commerce completo |
| **Landing SaaS Lepefy** | `food.lepefy.com` — pagina di vendita per prospect boutique |
| **Supabase project** | `lepefy-food-platform` — `https://lefihestoozeptzonhkt.supabase.co` |
| **n8n** | `https://n8n.lepefy.com` (self-hosted su Hetzner CX23, IP `46.224.127.99`, Caddy SSL) |
| **Contratto** | SaaS in italiano (16 articoli) redatto — mancano dati fiscali Lepefy Labs, foro competente, email contrattuale, DPA sub-processori |

---

## 2. Stack tecnologico

| Layer | Tecnologia | Dettaglio |
|---|---|---|
| **Frontend** | Next.js 14.2.35 (App Router) | Storefront + API routes, SSR — versione confermata in `apps/storefront/package.json` (bump di patch da 14.2.3, tra 10 e 13/08, insieme a `eslint-config-next`; nessun'altra dipendenza cambiata — vedi §41) |
| **Stile** | Tailwind CSS 3.4.3 | Token system via CSS vars (`--color-primary`, `--color-secondary`, `--radius-*`, `--shadow-card`, `--font-body`/`--font-display`), iniettate per tenant da `layout.tsx` — vedi §12bis |
| **State** | Zustand 4.5.2 | Cart store con persist + `shippingPayload()` |
| **Database** | Supabase (PostgreSQL) | `lepefy-food-platform`, RLS attivo su tutte le tabelle |
| **Auth** | Supabase Auth | **Admin: ✅ implementata** (pagine via route group `(protected)` **+ API routes via `requireAdmin()`**, vedi §2.1) · Clienti: Phase 2 |
| **Storage** | Supabase Storage | Bucket `assets` pubblico (logo, PWA icon, etichette, PDF etichette) |
| **Hosting** | Vercel (free plan) | Root Directory: `apps/storefront` — ⚠️ Root Directory impedisce l'esecuzione dell'Edge middleware (`middleware.ts` è di proposito un `export {}` vuoto) |
| **Pagamenti** | Stripe Elements + Satispay | Satispay via Stripe nativo, nessun codice extra. ⚠️ Nessuno Stripe Connect: gli incassi arrivano sull'account piattaforma Lepefy, il giroconto al tenant è manuale |
| **Spedizione** | Packlink PRO API | Quote real-time, importo certificato da token HMAC (§6/§7) — ⚠️ ancora in sandbox, da passare a `api.packlink.com` |
| **Email/Automation** | n8n self-hosted | Hetzner CX23, Ubuntu 24.04, Docker + Caddy, SMTP Brevo |
| **PWA** | `manifest.ts` dinamico + SW + `/api/pwa-icon` | Icona dinamica per tenant via API route (sharp) |
| **Rendering etichette** | Gotenberg (Docker, Hetzner) | **✅ Deploy completo e verificato end-to-end** (`lib/labels/gotenberg.ts`) — container attivo su Hetzner, `gotenberg.lepefy.com` con Caddy basic auth + SSL Let's Encrypt, header Authorization aggiunto, PDF reale generato e verificato da un job vero, vedi §16 |
| **AI immagini prodotto** | Gemini 2.5 Flash + `gemini-2.5-flash-image` | SDK `@google/genai`, pipeline a due step |
| **AI descrizioni prodotto** | Gemini 2.5 Flash (testo) | ✅ Completo, batch eseguito su tutto il catalogo — vedi §13bis |
| **AI rate limiting + cost tracking** | Tabelle `ai_pricing`/`ai_usage_log` (Supabase) | ✅ Completo su tutte le route AI (admin + pubbliche) — vedi §13bis |
| **AI ricerca semantica** | pgvector + `gemini-embedding-001` | ✅ Completo, batch embeddings eseguito su tutto il catalogo — vedi §13bis |
| **Monorepo** | pnpm workspaces (`pnpm@8.15.0`) | `apps/storefront` + `packages/types` |
| **TypeScript** | Strict | Types condivisi in `packages/types` |

**Colori brand ChloeFood (valore DB attuale — aggiornato 17/07):**
- Primary: **`#1267C7` (blu)** — live in `tenants.primary_color`, query eseguita manualmente da Robertin (era `#1D9E75` fino a questa revisione)
- Secondary: `#F2C811` (giallo/moutarde)
- Accent light: `#E1F5EE` — ⚠️ non toccato dalla migrazione colore, nota di coerenza visiva ancora aperta (vedi §12bis)

**✅ Codice storefront ora interamente token-based su questo branch di lavoro (Fase 1–3 — vedi §12bis per il dettaglio completo). ⚠️ Correzione v3.7: non risulta invece mergiato su `main`** (verificato via `git merge-base`, contrariamente a quanto affermato nelle revisioni precedenti — vedi §12bis per l'evidenza). Prima di questo lavoro, il verde `#1D9E75` era hardcoded in punti multipli (BottomNav, PWABanner, AddToCartButton, HeroBanner, pagina tracking ordine) invece di derivare da `tenant.primary_color` — bug di multi-tenancy reale, non solo teorico: un cambio colore via DB non si sarebbe propagato ovunque. **Tutti questi punti sono stati corretti**: l'intero storefront pubblico deriva ora da variabili CSS iniettate da `layout.tsx` (`--color-primary`, `--color-primary-light`, `--color-primary-dark`, `--color-primary-hover`, `--color-secondary`, più `--radius-*`/`--shadow-card`/`--font-body`/`--font-display`, vedi §12bis) — il cambio di `tenant.primary_color` in DB (eseguito il 17/07) si è propagato correttamente ovunque, incluso ai nuovi elementi introdotti (cartellino signature `ShopTag`, pattern decorativo hero).

**⚠️ Nota di coerenza aperta:** `tenant.accent_light` (`#E1F5EE`, verde menta) non è stato aggiornato insieme al primary e resta visivamente scollegato dal nuovo blu nei punti che lo usano ancora come sfondo chiaro (es. contenitore icona prodotto in `ProductCard`). Non bloccante, ma da valutare — vedi §19.

**✅ Brand charter v2 — le 3 decisioni derivate sono implementate nel codice di questo branch. ⚠️ "Deployate" corretto in v3.7: non risulta mergiato su `main`, vedi §12bis.** Dalice ha ricevuto una nuova charter grafica (20 pagine) con logo, palette e materiali completamente diversi — colore primario proposto **blu `#1267C7`**. Charter incompleta all'origine (mancano varianti icona/monocromatiche, riferimenti Pantone, dati placeholder errati come dominio e nome fittizio "TSANA"), ma le tre decisioni di design derivate ne sono state validate su mockup interattivo (`Mockup_Fase3_Validazione_UIUX.html`, allegato non versionato nel repo) e implementate in codice su questo branch:
1. **Font titoli/segnaletica: Bricolage Grotesque** (corpo testo resta Inter) — caricato via `next/font/google`, decisione di piattaforma applicata a tutti i tenant, non tenant-specifica.
2. **Colore primario → blu `#1267C7`** — era una decisione di **dato**, non di codice: nessuna occorrenza di questo hex è mai stata scritta nel codice, il codice legge sempre `tenant.primary_color`. **Query SQL eseguita il 17/07.**
3. **Elemento signature "cartellino da bottega"** (`ShopTag.tsx`) — nel mockup era descritto come oro fisso "dal logo"; **deliberatamente non implementato così**, perché quel ragionamento è specifico a ChloeFood. In produzione usa `var(--color-secondary)` (già `#F2C811`, visivamente equivalente per ChloeFood), quindi resta corretto per qualunque tenant futuro.

Il nuovo logo (JPEG, versione completa + versione icona) resta integrato solo sulla landing page `chloefood.com` (hero, favicon, PWA icon, colore hero blu) — quella parte non fa parte di questo audit (`apps/storefront`) ed è rimasta invariata.

### 2.1 Revisione di sicurezza — ✅ 4 criticità risolte (deployate 2026-07-02)

Una code review tecnica (`docs/PROJECT_REVIEW.md`) ha identificato e la piattaforma ha **corretto e deployato in produzione** 4 falle critiche/alte:

1. **API admin senza autenticazione (CRITICO).** Le route `POST /api/admin/catalogue`, `PATCH/DELETE /api/admin/catalogue/[id]`, `PATCH /api/admin/orders/[id]`, `POST /api/admin/generate-product-image`, `POST /api/admin/upload-product-image` usavano `createServiceClient()` (bypassa RLS) senza mai verificare sessione o whitelist `ADMIN_EMAILS` — chiunque conoscesse l'URL poteva scrivere. **Fix:** nuovo helper `src/lib/auth/requireAdmin.ts`, chiamato in testa a ogni route admin (incluse ora anche le route etichette `/api/admin/labels/*` e upload asset), risponde 401/403 senza sessione valida.
2. **Checkout fidato del client (CRITICO).** Prezzo e costo di spedizione arrivavano dal browser — un payload modificato poteva far pagare 0,01 € l'intero carrello. **Fix:** `api/checkout/route.ts` rilegge prezzo/nome/`storage_type` dal DB per `productId` (filtrato per tenant + prodotti attivi); il costo di spedizione è certificato da un token HMAC-SHA256 (`src/lib/shipping/quoteToken.ts`) emesso da `/api/shipping/quote` che lega importo/paese/CAP/scadenza (1h) — il checkout lo verifica e confronta con l'indirizzo; il pickup è forzato a spedizione 0 lato server.
3. **Policy RLS troppo permissive (ALTO).** `orders_insert_any`/`order_items_insert_any` con `with check (true)` permettevano insert arbitrari con la anon key pubblica. **Fix:** `016_security_hardening.sql` rimuove le due policy — tutti gli insert reali passano dal service role.
4. **Idempotenza webhook fragile (ALTO).** Il check "ordine già esistente?" era check-then-insert, vulnerabile a doppio retry Stripe concorrente. **Fix:** stessa migration 016, indice unico parziale su `orders.stripe_payment_intent_id`; il webhook tratta la unique violation (23505) come ordine già creato da un retry concorrente.

**Debito residuo noto (non ancora corretto):** nessuna gestione stock reale al checkout (stock default 999, mai decrementato); `FROM_ADDRESS` ancora hardcoded `IT 42122` in `api/shipping/quote/route.ts` nonostante esista `warehouse_location`; il breakdown spedizione (`_internal`: corriere, IVA, surcharge 3€/pacco) è visibile nei devtools nonostante la doc affermi sia nascosto; file morti `src/app/admin/orders/[id]/` e `src/app/admin/orders/id/` (vedi §8); `xlsx@0.18.5` ha vulnerabilità note senza fix; `@supabase/ssr@0.3` datato; zero test automatizzati. Dettaglio completo in `docs/PROJECT_REVIEW.md`.

---

## 3. Struttura repository

```
lepefy-food-platform/
├── apps/
│   └── storefront/                    # Next.js 14 App Router
│       ├── middleware.ts              # export {} vuoto — NON usato (Root Directory Vercel lo impedisce)
│       ├── src/
│       │   ├── app/
│       │   │   ├── (shop)/            # Layout storefront pubblico
│       │   │   │   ├── page.tsx       # Homepage (bottom nav, hero compatto, scroll orizzontale per categoria)
│       │   │   │   ├── products/      # Catalogo con ricerca real-time debounced (URL params)
│       │   │   │   ├── products/[slug]/  # Scheda prodotto — dal 23/07 include anche i "Produits similaires" (§12bis Fase 4)
│       │   │   │   ├── cart/          # Carrello
│       │   │   │   ├── checkout/      # Checkout Stripe Elements
│       │   │   │   └── orders/[id]/   # Tracking ordine (token HMAC)
│       │   │   ├── card/               # Biglietto da visita digitale (chloefood.com/card)
│       │   │   ├── admin/
│       │   │   │   ├── login/         # Fuori dal route group protetto (evita redirect loop)
│       │   │   │   ├── orders/[id]/   # ⚠️ NON è una route (nessun page.tsx) — cartella di componenti condivisi
│       │   │   │   │                  #    (OrderDetail.tsx, PickingList.tsx) importati dalla pagina protetta sottostante
│       │   │   │   ├── orders/id/     # ⚠️ CODICE MORTO — copia precedente di PickingList.tsx, nessun import nel repo
│       │   │   │   └── (protected)/   # ✅ Protetto via Supabase Auth + ADMIN_EMAILS whitelist
│       │   │   │       ├── page.tsx              # Lista ordini + KPI (totale/mese + delta)
│       │   │   │       ├── orders/[id]/           # Dettaglio ordine — importa OrderDetail.tsx + PickingList.tsx da ../../../orders/[id]/
│       │   │   │       │                          #   ⚠️ NON esiste una route/picking-list separata: la stessa pagina
│       │   │   │       │                          #   renderizza sia il dettaglio (div.no-print) sia la PickingList,
│       │   │   │       │                          #   e `@media print` nasconde .no-print al momento della stampa
│       │   │   │       ├── catalogue/             # Lista prodotti (drag&drop img, AI gen, stock inline)
│       │   │   │       ├── catalogue/[id]/        # Modifica prodotto esistente
│       │   │   │       ├── catalogue/nouveau/      # Creazione nuovo prodotto (riusa ProductEditClient)
│       │   │   │       ├── products/[id]/etichetta/         # Lista job etichetta per prodotto
│       │   │   │       ├── products/[id]/etichetta/[jobId]/ # Editor draft etichetta (template/palette/origin-style/preview live/autosave)
│       │   │   │       ├── billing/              # Pannello abbonamento (Stripe Payment Link + bonifico)
│       │   │   │       ├── parametres/           # Impostazioni boutique, QR biglietto digitale
│       │   │   │       └── ai-lab/               # Nuovo (23/07) — CRUD tenant_knowledge_base per il chatbox, vedi §13ter
│       │   │   ├── admin/_components/AdminSidebar.tsx   # Sidebar navigazione admin (fuori dal route group, condivisa) — voce "IA — Base de connaissance" aggiunta il 23/07
│       │   │   ├── admin/(protected)/AdminNav.tsx, AdminFilters.tsx, OrdersTable.tsx  # Componenti dashboard ordini
│       │   │   └── api/
│       │   │       ├── checkout/                    # Ricalcola prezzi/spedizione server-side, crea PaymentIntent
│       │   │       ├── shipping/quote/               # Calcolo spedizione + emissione token HMAC
│       │   │       ├── webhooks/stripe/              # Crea ordine dopo payment_intent.succeeded (idempotente)
│       │   │       ├── health/                       # Health check ({ ok, tenant, ts })
│       │   │       ├── pwa-icon/                     # Icona PWA dinamica per tenant (sharp resize)
│       │   │       ├── card/qr-code/                 # QR code biglietto digitale con logo overlay
│       │   │       ├── card/vcard/                   # Download vCard biglietto digitale
│       │   │       ├── chat/                         # Nuovo (23/07) — POST pubblica del chatbox, gated su ai_chatbox_enabled, vedi §13ter
│       │   │       └── admin/                        # Tutte protette da requireAdmin()
│       │   │           ├── login/                    # Login admin, imposta cookie sessione
│       │   │           ├── catalogue/, catalogue/[id]/  # CRUD prodotti
│       │   │           ├── orders/[id]/              # Aggiorna stato/tracking
│       │   │           ├── generate-product-image/   # AI Gemini (maxDuration 60s)
│       │   │           ├── upload-product-image/     # Upload immagine prodotto storefront
│       │   │           ├── upload-label-asset/       # Upload sfondo/logo per etichette
│       │   │           ├── upload-story-photo/       # Nuovo (26/07) — upload immagine sezione "Notre origine", vedi §33
│       │   │           └── tenant/                    # PATCH whitelist EDITABLE_TENANT_FIELDS, esteso con story_heading/story_text/countries_served (26/07), vedi §14bis e §33
│       │   │           ├── knowledge-base/, knowledge-base/[id]/  # Nuovo (23/07) — CRUD tenant_knowledge_base, embedding calcolato server-side, vedi §13ter
│       │   │           └── labels/
│       │   │               ├── preview/              # Solo HTML (no Gotenberg), per iframe live
│       │   │               ├── generate/             # Chiama Gotenberg + upload PDF + aggiorna job → 'generated'
│       │   │               ├── jobs/                 # GET lista / POST crea draft (con duplicateFromId per ristampa)
│       │   │               └── jobs/[id]/             # PATCH autosave draft / DELETE draft
│       │   ├── components/                  # ⚠️ Albero non enumerato integralmente qui, solo le aggiunte recenti rilevanti
│       │   │   ├── catalog/ProductCard.tsx   # Card prodotto unificata (variant grid/shelf) — vedi §12bis Fase 2.1
│       │   │   ├── ui/ShopTag.tsx            # Cartellino signature — vedi §12bis Fase 3
│       │   │   ├── product/
│       │   │   │   ├── ProductTitle.tsx      # Nuovo (23/07) — titolo localizzato via name_alt, vedi §12bis Fase 4
│       │   │   │   ├── RelatedProducts.tsx   # Nuovo (23/07) — sezione "Produits similaires", riusa ProductCard variant shelf
│       │   │   │   ├── ProductDetail.tsx     # Nuovo (26/07) — orchestratore scheda prodotto, vedi §33
│       │   │   │   ├── ProductGallery.tsx    # Nuovo (26/07) — hero + thumbnail solo se images.length > 1, vedi §33
│       │   │   │   ├── ProductSpecs.tsx      # Nuovo (26/07) — spec row Poids/Origine/Conservation, vedi §33
│       │   │   │   ├── ProductTabs.tsx       # Nuovo (26/07) — 2 tab (Ingrédients&Allergènes/Conservation), niente tab Avis, vedi §33
│       │   │   │   └── TrustBadges.tsx       # Nuovo (26/07) — badge stile card, riusato anche in home, vedi §33
│       │   │   ├── home/
│       │   │   │   └── StorySection.tsx      # Nuovo (26/07) — sezione "Notre origine", condizionale su story_text, vedi §33
│       │   │   └── chat/
│       │   │       └── ChatWidget.tsx        # Nuovo (23/07) — widget flottante chatbox, montato in (shop)/layout.tsx, vedi §13ter
│       │   ├── lib/
│       │   │   ├── auth/
│       │   │   │   └── requireAdmin.ts   # Guard riusato da tutte le API admin (sessione + whitelist) — unica eccezione: admin/login/route.ts
│       │   │   ├── ai/
│       │   │   │   ├── embeddings.ts     # Genera embedding gemini-embedding-001 (ricerca semantica)
│       │   │   │   ├── usageTracking.ts  # checkRateLimit()/logAiUsage() — vedi §13bis
│       │   │   │   ├── chatbox.ts        # Nuovo (23/07) — buildSystemPrompt() (prodotti + knowledge base + info negozio), vedi §13ter
│       │   │   │   └── smallTalk.ts      # Nuovo (23/07) — matchSmallTalk(), intercetta saluti prima di ogni chiamata AI, vedi §13ter
│       │   │   ├── images/
│       │   │   │   └── removeBackground.ts  # Rimozione sfondo immagine prodotto (pipeline AI)
│       │   │   ├── shipping/
│       │   │   │   ├── calculateShipping.ts  # Engine spedizione principale
│       │   │   │   └── quoteToken.ts         # Firma/verifica HMAC del preventivo spedizione
│       │   │   ├── labels/                   # Sistema etichette — vedi §16 (maturo, non più "in sviluppo")
│       │   │   │   ├── calculateLayout.ts    # Grid N-up (cols/rows/perSheet) da dimensioni foglio/etichetta
│       │   │   │   ├── resolveBackground.ts  # Sfondo pannello: prodotto → categoria → palette ambient → fallback
│       │   │   │   ├── buildSheetHtml.tsx    # Sceglie template, renderToStaticMarkup, CSS foglio/crop marks
│       │   │   │   ├── gotenberg.ts          # htmlToPdf() — chiamata reale a GOTENBERG_URL
│       │   │   │   ├── palettes.ts           # 3 palette colore (verde_palma / blu_epices / terra_piccante)
│       │   │   │   ├── originFlags.tsx       # Bandiere SVG disegnate a mano (9 paesi, no emoji — compat Gotenberg)
│       │   │   │   ├── formatDate.ts         # Formattazione data IT
│       │   │   │   └── templates/            # ⚠️ TRE template, non due
│       │   │   │       ├── default.tsx       # "Classico" — due colonne, origin-style implementato
│       │   │   │       ├── fullbleed.tsx     # Sfondo a piena pagina — origin-style NON implementato (solo testo semplice)
│       │   │   │       └── banner.tsx        # "Fascia Dorata" — fascia logo a tutta larghezza, nutrizione a sx/nome al centro/foto a dx, origin-style implementato
│       │   │   ├── store/
│       │   │   │   └── localeStore.ts # Zustand store toggle lingua FR/IT storefront (persist)
│       │   │   ├── tenant/
│       │   │   │   ├── getTenant.ts             # Fetch tenant da slug (Next.js cache())
│       │   │   │   └── getTenantSocialLinks.ts  # Fetch link social per biglietto digitale
│       │   │   ├── utils/
│       │   │   │   ├── cn.ts          # Helper classnames
│       │   │   │   └── format.ts      # formatPrice/formatDate
│       │   │   └── supabase/
│       │   │       ├── client.ts      # Browser client
│       │   │       ├── server.ts      # createClient()/createServiceClient() — richiede API cookie get/set/remove E getAll/setAll
│       │   │       └── types.ts       # Database types generati
│       │   └── stores/
│       │       └── cartStore.ts       # Zustand cart store
│       └── public/
│           ├── sw.js                  # Service worker PWA
│           └── favicon.ico, icons/apple-touch-icon.png  # ⚠️ eccezione statica mono-tenant, da rimediare al 2° tenant
├── packages/
│   └── types/                         # Shared TypeScript interfaces (@lepefy/types)
│       ├── index.ts                   # Ri-esporta tutti i moduli sottostanti
│       ├── tenant.ts, product.ts, order.ts, customer.ts, socialLinks.ts
│       ├── ai.ts                      # Tipi AiPricing/AiUsageLogEntry — vedi §13bis
│       ├── labels.ts                  # ⚠️ NON legacy — file più aggiornato del package, allineato a migration 018–025
│       └── shipping.ts                # Legacy (zone/rate) — superato dal modello Packlink/shipping_provider, ma ancora esportato
└── supabase/
    └── migrations/                    # 001–028, numerazione non lineare (vedi §4)
```

**Aggiunte v3.20 (verificate sul filesystem, non enumerate nell'albero sopra per non riscriverlo integralmente):**
```
apps/storefront/src/app/(shop)/
  compte/
    AccountDashboard.tsx, AddressFormModal.tsx, Modal.tsx, ProfileEditModal.tsx, LoyaltyCardWidget.tsx
    ambassadeur/                       # Spazio ambassador cliente — AmbassadorClient.tsx
    carte-fidelite/                    # Carta fedeltà EAN-13 — LoyaltyCardClient.tsx
apps/storefront/src/app/admin/(protected)/
  accueil-slides/                      # CRUD hero carousel — HeroSlidesSection.tsx
  ambassadeurs/                        # 4 sezioni: config/lista/commissioni/promozione
apps/storefront/src/app/admin/loyalty/scan/     # Fuori da (protected) — propria auth via requireAdmin(tenantId, ['tenant_cashier',...])
  ScanClient.tsx, CameraScanButton.tsx
apps/storefront/src/app/api/admin/{ambassador,loyalty/scan}/   # Route API dedicate
apps/storefront/src/app/api/checkout/ambassador-discount/
apps/storefront/src/app/api/customers/me/{addresses,ambassador-profile}/
apps/storefront/src/components/home/
  HeroCarousel.tsx, CategoryBlock.tsx, CategoryBlocksRow.tsx, CategoryBlocksGrid.tsx, SuggestionsRow.tsx
apps/storefront/src/lib/ambassador/    # calculateAmbassadorDiscount.ts, getAmbassadorSponsor.ts, processAmbassadorCommissionOnDelivery.ts, resolveCheckoutAmbassadorDiscount.ts
packages/types/{ambassador,heroSlides}.ts
supabase/migrations/045–047           # vedi §4, §9ter
```

**Aggiunte v3.23 (verificate sul filesystem, `git diff` contro il commit di base di v3.22):**
```
apps/storefront/src/app/admin/(protected)/evenementiel/
  reservations-materiel/            # Nuovo — admin location matériel, RentalReservationsClient.tsx
apps/storefront/src/app/(evenementiel)/evenementiel/services/[slug]/
  RentalCheckoutClient.tsx, confirmation/RentalConfirmationClient.tsx, en-attente/PendingRentalPaymentClient.tsx
apps/storefront/src/app/(evenementiel)/evenementiel/evenements/[slug]/
  en-attente/PendingEventPaymentClient.tsx   # Fase pagamento lien externe, événementiel
apps/storefront/src/app/api/checkout/external-link/
apps/storefront/src/app/api/events/[id]/checkout-external-link/
apps/storefront/src/app/api/rental/checkout-external-link/
apps/storefront/src/app/api/admin/checkout-sessions/[id]/confirm-payment/
apps/storefront/src/app/api/admin/evenementiel/{reservation-requests,rental-reservation-requests}/[id]/confirm-payment/
apps/storefront/src/app/api/card/quick-pay/           # Nuovo — paiement carte montant libre /card, vedi §41
apps/storefront/src/components/card/
  CardQuickPay.tsx                  # Nuovo (13/08) — form + Stripe Elements montant libre
  PaymentMethodsAccordion.tsx       # Nuovo (14/08) — sostituisce la lista flat in DigitalCard.tsx
apps/storefront/src/components/payment/ExternalPaymentMethodPicker.tsx   # Condiviso shop/événements/rental
apps/storefront/src/components/evenementiel/EventImageFader.tsx
apps/storefront/src/lib/events/{qrToken,createEventReservationFromRequest,highlightIcons,notifyN8n,ticketUrl,buildTicketHtml}.ts
apps/storefront/src/lib/rental/createRentalReservationFromRequest.ts
apps/storefront/src/lib/orders/{formatShippingAddress,orderStatus,createOrderFromCheckoutSession}.ts
apps/storefront/src/lib/card/methodColor.ts
packages/types/{events,paymentMethods}.ts, order.ts esteso
supabase/migrations/053–062           # vedi §4, §41
```

---

## 4. Schema database (Supabase)

### Tabelle principali

| Tabella | Descrizione |
|---|---|
| `tenants` | Un record per boutique. Colori, slug, Stripe account, `shipping_provider`, `show_powered_by`, `ai_image_generation`, `whatsapp_number`, `catalogue_search_threshold`, campi billing, **`locales`** (lingue attive, prima = default), **`ai_description_generation`**, **`ai_semantic_search`**, **`ai_rate_limit_public_per_minute`/`ai_rate_limit_public_per_day`/`ai_rate_limit_admin_per_day`**, **`barcode_prefix`** (3 cifre, assegnate automaticamente da trigger alla creazione tenant, mai a mano — vedi §16bis), **`barcode_sequence`** (contatore atomico), **`ai_chatbox_enabled`** (default `false`, nessun tenant abilitato automaticamente dalla migration), **`chatbox_extra_context`** (testo libero scritto a mano in admin, iniettato nel system prompt — mai generato dall'IA) — vedi §13ter, **`story_heading`/`story_text`/`story_image_url`/`countries_served`** (sezione "Notre origine" in home; se `story_text` è NULL la sezione non viene renderizzata — mai un placeholder al posto del contenuto mancante; `countries_served` resta NULL finché non confermato, mai un valore stimato) — vedi §33; **v3.20**: `loyalty_card_sequence` (`047`, contatore tessere fedeltà, indipendente da `barcode_sequence`), 7 colonne configurazione programma Ambassadeur (`ambassador_min_purchase_amount` e affini, `046`) — vedi §9ter; **nuove in v3.21 (riportato in chat, non riverificato contro filesystem/git in questa sessione)**: `android_package_name`/`android_sha256_fingerprint` (`048_tenant_android_app.sql` — il secondo campo è una stringa con 3 fingerprint separati da virgola, non un solo valore, per via del signing "hybrid quantum-ready" di Google Play che genera 3 certificati distinti), `android_public` (`049`, boolean default `false` — distingue "app esiste in closed testing" da "app pubblicamente installabile", usato dalla smart-link `/go` per non mandare i clienti su una scheda Play Store non ancora accessibile) — vedi §14ter; **nuove in v3.22 (`051`/`052`), mai integrate in questa riga prima di v3.23**: `events_enabled`/`services_enabled` (flag indipendenti, nessun dato seedato per tenant specifico, attivazione solo da `/admin`), `ambassador_commission_mode` (`PROPORTIONAL` default / `SPLIT_POOL`) + `ambassador_split_pool_amount`/`ambassador_split_pool_ambassador_percent` (seconda modalità di commissione Ambassadeur, alternativa alla proporzionale di `046`) — vedi §41 |
| `categories` | Categorie prodotti per tenant (con supporto background per etichette) |
| `products` | Prodotti — `storage_type` (dry/fresh/frozen), `weight_grams`, `position`, `warehouse_location`, `name_alt` (⚠️ dal 23/07 letto anche dal titolo prodotto storefront, non più solo dall'editor etichette — vedi §12bis Fase 4), `producer_id`/`importer_id`, campi etichetta (ingredienti, allergeni, nutrizione, paese origine), **`descriptions`** jsonb multilingue (`{"fr":"...","it":"..."}`), **`description_source`** (`ai`/`human`), **`embedding`** vector(768) per ricerca semantica (dal 23/07 riusato anche per i prodotti correlati, vedi §12bis Fase 4), **`barcode_value`** (EAN-13 a 13 cifre, generato internamente, unique a livello piattaforma), **`barcode_generated_at`** — vedi §16bis; **`is_homemade`** (nuovo 26/07, boolean, default `false`, mai dedotto — vedi §33); i campi etichetta già esistenti dalla migration 018 (`ingredients_text`, `allergens_text`, `gluten_free_certified`, `usage_instructions`, `conservation_instructions`, `conservation_after_opening`, `country_of_origin`, `net_quantity_display`) sono dal 26/07 esposti anche nel tipo `Product` di `packages/types` e letti dalla scheda prodotto storefront, non più solo dall'editor etichette admin — stessa fonte dati, mai duplicata (vedi §33) |
| `ai_pricing` | Listino prezzi AI configurabile — `provider` (`gemini`, futuro `anthropic`), `model`, prezzi input/output/immagine per milione token, `currency`. Aggiornato via SQL quando i provider cambiano prezzo, mai hardcoded nel codice |
| `ai_usage_log` | Log per-chiamata di ogni richiesta AI (tutte le route, admin e pubbliche) — token input/output, immagini generate, `estimated_cost_usd` calcolato dai prezzi correnti in `ai_pricing`, `status` (`success`/`error`/`rate_limited`). Base sia per il rate limiting (query su finestra temporale) sia per il cruscotto costi (vista `ai_usage_monthly_by_tenant`) |
| `orders` | Ordini creati SOLO dopo `payment_intent.succeeded` webhook (o, dal v3.23, dopo conferma manuale admin per il flusso `external_link` — vedi §41); indice unico su `stripe_payment_intent_id` (idempotenza). **Corretto in v3.23 (`059`)**: il CHECK `payment_method` non includeva `in_store` benché già scritto dal codice da tempo — riscritto per includere `in_store` + il nuovo `external_link`; aggiunte `external_payment_type`/`external_payment_label` |
| `order_items` | Righe ordine con `storage_type`, `warehouse_location`, `name_alt` copiati dal prodotto |
| `customers` | Linked a `auth.users(id)` — la FK esisteva già dallo schema iniziale ma **restava inutilizzata fino al 31/07**: il checkout creava solo ordini guest con `customer_id null`. Dal 31/07 il login cliente via Supabase Auth (OTP email, vedi §9bis) popola effettivamente questa relazione. Colonna `referral_code` — **correzione v3.18**: non era un residuo legacy come implicava la formulazione precedente; è stata **aggiunta da `040_loyalty_referral_system.sql`** e **rimossa di nuovo da `043_drop_redundant_customer_referral_code.sql`** nello stesso ciclo (ridondante, mai scritta — la fonte di verità è la tabella dedicata `referral_codes`, vedi §9bis). **Nuove in v3.20**: 8 colonne profilo Ambassadeur (`is_ambassador`, `ambassador_iban`/`ambassador_paypal_email`, ecc., `046`) + `loyalty_card_number` (EAN-13 namespace `21`, assegnato da trigger a ogni riga, `047`) — vedi §9ter |
| `addresses` | Indirizzi clienti |
| `admin_users` | **Nuova (31/07, `039_admin_users.sql`** — correzione v3.18: file distinto da quello del sistema loyalty, non citato prima in questa tabella), sostituisce la whitelist flat `ADMIN_EMAILS` in env var. Ruoli `platform_owner` (accesso a tutti i tenant, Robertin), `tenant_admin` (scoped a un tenant specifico, es. Dalice per ChloeFood quando verrà attivata) e — **nuovo in `047_loyalty_card_system.sql` (v3.20)** — `tenant_cashier` (stesso scoping tenant di `tenant_admin`, ma `requireAdmin(tenantId, [...])` lo ammette solo sulla route di scan fedeltà; il layout `(protected)` lo reindirizza forzatamente a `/admin/loyalty/scan`, non vede mai dashboard/ordini/catalogo). `requireAdmin()` cambia firma in `requireAdmin(tenantId, allowedRoles?)` — ogni route sotto `/api/admin/*` deve passare esplicitamente il tenant, non solo verificare l'email — vedi §8, §9bis, §9ter |
| `checkout_sessions` | Sessioni temporanee checkout (eliminate dal webhook dopo creazione ordine) — contengono anche email/telefono carrelli incompleti, mai sfruttate per recupero carrello abbandonato (vedi §19). **Nuova in v3.23 (`059`)**: `payment_method` (`stripe` default / `external_link`) + snapshot `external_payment_type`/`external_payment_label`/`external_payment_link` per il flusso "paiement via lien externe" — vedi §41 |
| `packaging_surcharges` | Configurazione surplus imballaggio per tenant (1 riga, incluse dimensioni box L×W×H) |
| `shipping_vat_rates` | IVA spedizione per paese (N righe per tenant) |
| `carriers` | Corrieri configurabili per tenant (dropdown admin) |
| `tenant_social_links` | Link social per biglietto da visita digitale |
| `producers` | Anagrafica produttori (sistema etichette) |
| `importers` | Anagrafica importatori (sistema etichette) — es. AFRICOOP Società Cooperativa |
| `label_print_jobs` | Job di stampa etichette — `status` (`draft`/`generated`), `duplicated_from_id` (ristampa), `palette`, `natural_badge`, `origin_style`, `pdf_url` |
| `tenant_knowledge_base` | Contenuto culturale curato **sempre a mano** (ricette, espressioni, contesto, FAQ) per il chatbox — `category` (`recipe`/`expression`/`greeting`/`cultural_context`/`faq`), `content`, `embedding` vector(768), `source`/`reviewed_by`/`reviewed_at`, `active`. RLS attiva senza policy anon/authenticated: solo `service_role` (route admin per scrivere, route chatbox per leggere via `match_knowledge_base`) — vedi §13ter |
| **Loyalty/Referral** (`040_loyalty_referral_system.sql`, 31/07 — **correzione v3.18: numero file era errato, era scritto `039_...` che in realtà è `admin_users`**) | Sistema completo albero referral multi-livello + ledger punti. **Correzione v3.18 sul conteggio "7 tabelle":** letta la migration per intero — sono realmente **4 tabelle nuove** (`referral_codes`, `tenant_referral_tiers`, `points_ledger`, `referral_fraud_signals`) + **1 vista** (`customer_points_balance`) + **alterazioni** a 3 tabelle esistenti (`tenants`, `customers`, `orders`); "7" contava anche le tabelle alterate, non solo quelle nuove — copre: configurazione profondità/percentuali per tenant (versionata, mai sovrascritta), codici referral per cliente con regola di eleggibilità, ledger punti append-only (righe `PENDING`/`CONFIRMED`/`SPENT`/`EXPIRED`/`REVERSED`, mai update in-place), stato anti-frode per cliente/ordine. **4 funzioni Postgres**, non solo `resolve_referral_chain`: anche `resolve_referral_downline` (l'inverso — discendenti, non ascendenti; usata da `GET /api/loyalty/referrals/tree` per l'UI, non menzionata in v3.17), `apply_referral_on_signup`, `process_order_points_atomic`. Dettaglio completo in §9bis |
| **Ambassadeur** (`ambassador_commissions`, `046_ambassador_commission_system.sql`, nuova v3.20) | Programma separato dal Loyalty/Referral sopra — commissione in **euro reali** (non punti), pagata manualmente fuori piattaforma. Riusa `referred_by_id`/`referral_codes`/`/invite/[code]` per l'attribuzione senza duplicarla. `status` `CONFIRMED`/`PAID`/`CANCELLED` (mai `PENDING`: la riga si scrive solo alla consegna ordine). `rate_applied`/`max_commission_applied` storicizzati per riga, stesso pattern di `pct_applied` in `points_ledger`. Vedi §9ter |
| **Loyalty card** (`loyalty_manual_purchases`, `047_loyalty_card_system.sql`, nuova v3.20) | Accumulo punti per acquisti registrati in cassa (scan barcode fisico/virtuale), senza creare un ordine reale — genera righe `IN_STORE_PURCHASE_EARNED` nel `points_ledger` esistente (riusato, non duplicato). Numero tessera `customers.loyalty_card_number` (EAN-13, namespace `21`) assegnato automaticamente da trigger a ogni riga `customers`. Vedi §9ter |
| `shipping_country_rules` (`050_shipping_country_rules.sql`, nuova v3.22) | Layer di regole commerciali per paese sopra Packlink/flat_rate/pickup_only — gratuità sopra soglia carrello, forfait fisso, sconto (percentuale o importo fisso), le tre leve possono coesistere sulla stessa riga; `countries = '{*}'` = fallback globale. Zero righe = comportamento identico a prima. Vedi §6, §40 |
| **Événementiel** (`events`, `event_ticket_types`, `event_reservations`, `event_reservation_items`, `event_reservation_redemptions`, `event_reservation_item_redemptions`, `event_gallery_photos`; `052`+`053`+`056`+`057`+`058`, nuova v3.22/v3.23) | Soirées BBQ datate con formule/ticket types multipli e biglietteria QR (`redeem_event_reservation`/`redeem_event_reservation_items`, redemption sia a livello prenotazione sia a livello singola formula dal v3.23). `theme_primary_color`/`theme_secondary_color` per evento (fallback ai default fissi del modulo `#E65C00`/`#FFB347`, non più al colore tenant, dal v3.23), `subtitle`/`highlights` per l'hero. Vedi §41 |
| **Services/location** (`service_offerings`, `service_inquiries`, `rental_items`, `rental_reservations`, `rental_reservation_items`; `052`, nuova v3.22) | Prestazioni traiteur su preventivo (richiesta → `service_inquiries` → gestione admin `/admin/evenementiel/devis`) + sottocaso location materiale con proprie tabelle e checkout dedicato. Vedi §41 |
| `event_reservation_requests` / `rental_reservation_requests` (`060`/`061`, nuove v3.23) | Richieste di prenotazione in attesa di conferma manuale admin per il flusso "paiement via lien externe" (PayPal/Revolut/autre) — una tabella per modulo, deliberatamente non condivisa con `checkout_sessions` né tra loro. Vedi §41 |
| `tenant_card_payments` (`062_tenant_card_payments.sql`, nuova v3.23) | Pagamenti carta a importo libero iniziati da `/card` (scan QR in negozio) — dominio indipendente da `orders`/`checkout_sessions`, nessuno Stripe Connect (PaymentIntent sul conto piattaforma). RLS senza policy pubbliche, solo `service_role`. Vedi §41 |

**121 prodotti reali importati e poi riseminati** (`020_reseed_products_catalogue_v2.sql`, idempotente `ON CONFLICT (tenant_id, slug) DO UPDATE`) dal catalogo `ChloeFood_Template_Catalogue_v2`, 8 categorie: Épices, Légumes, Farines, Poissons, Sauces & Huiles, Snacks, Viandes séchées, Boissons. Ulteriori prodotti aggiunti da `022_new_products_from_labels.sql` (scoperti nei dati etichette ma assenti dal catalogo v2, seminati inattivi/prezzo 0 in attesa di attivazione admin).

### Migrations — stato reale confermato su filesystem (13/07)

⚠️ La numerazione **non è lineare** — diverse migration hanno commenti che spiegano esplicitamente il motivo (numero già occupato al momento della scrittura). Non mancano file: la sequenza sotto è quella realmente presente in `supabase/migrations/`.

| File | Contenuto |
|---|---|
| `001_initial_schema.sql` | Schema base: tenants (default colori `#1D9E75`/`#F2C811`), categories, products, orders, order_items, customers, addresses |
| `002_rls_policies.sql` | RLS su tutte le tabelle core + policy pubbliche di lettura |
| `003_shipping_packlink.sql` | `products.storage_type`; decisioni Packlink PRO (real-time, surcharge 3€) |
| `003b_packaging_dimensions.sql` | Dimensioni box L×W×H su `packaging_surcharges` (peso volumetrico) |
| `003c_shipping_provider.sql` | `tenants.shipping_provider` + `packlink_api_key` |
| `004_shipping_details.sql` | `orders.shipping_details` jsonb |
| `006_checkout_sessions.sql` | Tabella `checkout_sessions` |
| `006_fix_tracking_carrier.sql` | Rimuove default hardcoded `'poste_italiane'` su `orders.tracking_carrier` |
| `007_order_items_storage_type.sql` | `order_items.storage_type` |
| `008_carriers.sql` | Tabella `carriers` per tenant |
| `009_click_collect_hours.sql` | `tenants.click_collect_hours` |
| `010_products_picking_fields.sql` | `warehouse_location`, `name_alt` su `products` |
| `010_warehouse_location.sql` | Stessi campi denormalizzati anche su `order_items` (versione alternativa/duplicata della 010 precedente) |
| `011_tenant_billing.sql` | Colonne billing SaaS su `tenants` (subscription_status, subscription_paid_until, stripe_payment_link, IBAN/BIC) |
| `011_tenants_powered_by.sql` | `tenants.show_powered_by` |
| `013_catalogue_admin.sql` | `tenants.ai_image_generation` + grants |
| `014_sidebar_features.sql` | No-op — placeholder dichiarato per mantenere la sequenza numerica |
| `015_catalogue_ux.sql` | `tenants.catalogue_search_threshold` (default 500) |
| `016_security_hardening.sql` | ✅ Rimuove policy RLS insert-any su orders/order_items; indice unico su `stripe_payment_intent_id` (vedi §2.1) |
| `017_tenant_digital_card.sql` | `tenants.whatsapp_number` + tabella `tenant_social_links` |
| `018_label_system.sql` | Fondamenta sistema etichette: tabelle `producers`, `importers` (numerata 018 perché 017 già occupata) |
| `019_link_default_producer.sql` | Data fix una tantum: collega prodotti ChloeFood senza `producer_id`/`importer_id` al produttore/importatore di default |
| `020_reseed_products_catalogue_v2.sql` | Reseed completo `products` (121 prodotti) da catalogo v2, idempotente |
| `021_update_label_data_batch1.sql` | Bulk update dati etichetta (ingredienti/allergeni/nutrizione/origine) per 22 prodotti, da fonte Excel |
| `022_new_products_from_labels.sql` | Nuovi prodotti scoperti nei dati etichette, assenti dal catalogo v2 — seminati inattivi |
| `023_label_job_drafts.sql` | `label_print_jobs`: `status`, `duplicated_from_id`, `updated_at` |
| `023_label_print_jobs_drafts_reprint.sql` | Variante quasi duplicata della precedente — aggiunge anche GRANT UPDATE a `service_role`, trigger `updated_at`, indice `(tenant_id, product_id, status, updated_at)` |
| `024_label_palette_and_natural_badge.sql` | `label_print_jobs.palette` (verde_palma/blu_epices/terra_piccante, default blu_epices) + `natural_badge` boolean |
| `025_label_origin_style.sql` | `label_print_jobs.origin_style` (pill/block/medallion, default pill) |
| `026_ai_descriptions.sql` | `products.descriptions` jsonb + `products.description_source` (`ai`/`human`) + configurazione lingue tenant |
| `027_ai_rate_limiting_cost_tracking.sql` | Tabelle `ai_pricing` (listino prezzi per provider/model) e `ai_usage_log` (log per-chiamata) + funzione `check_ai_rate_limit` + vista `ai_usage_monthly_by_tenant` |
| `028_semantic_search.sql` | Estensione `vector`; `products.embedding` vector(768); indice HNSW cosine; funzione `match_products` |
| `029_atomic_stock_decrement.sql` | Decremento stock atomico con rollback transazionale post-pagamento (fix urgente overselling) — *riga aggiunta per coerenza numerica in questa revisione, contenuto da lavoro precedente non riverificato in questa sessione* |
| `030_tenant_payment_methods.sql` | `tenant_payment_methods` — vedi §27bis — *riga aggiunta per coerenza numerica in questa revisione, contenuto da lavoro precedente non riverificato in questa sessione* (correzione v3.12: nome file corretto, la revisione precedente riportava `030_payment_methods.sql`) |
| `031_barcode_system.sql` | Sistema barcode EAN-13 interno: `tenants.barcode_prefix`/`barcode_sequence`, trigger `assign_tenant_barcode_prefix` (assegna il prefisso alla creazione tenant), funzione `next_product_barcode()` (generazione atomica + checksum), `products.barcode_value`/`barcode_generated_at`, backfill dei 121 prodotti chloefood esistenti — **✅ applicata al DB, PDF reale testato**, vedi §16bis |
| `031_storefront_ready.sql` | ⚠️ **Collisione di numerazione con `031_barcode_system.sql` — due file distinti condividono il numero 031, non un refuso di questo documento** (verificato via `ls` sul filesystem reale il 26/07). `tenants.storefront_ready` boolean, default `true` (non rompe i tenant già live). Se `false`, il link "Voir nos produits" su `/card` (`DigitalCard.tsx`) viene sostituito da un messaggio "boutique bientôt disponible" invece del link verso `/` — flag pensato per pubblicare il biglietto digitale/landing prima che il catalogo e-commerce sia pronto. Nessuna UI admin per questo campo trovata in questa sessione (non in `EDITABLE_TENANT_FIELDS`/`BoutiqueInfoSection.tsx`) — presumibilmente ancora SQL-only |
| `032_ai_chatbox.sql` | `tenants.ai_chatbox_enabled` (default `false`) + `tenants.chatbox_extra_context` (testo libero admin, mai IA) — **numerata 032 perché 029/030/031 già occupate** al momento della scrittura (il prompt originale la chiamava `029_ai_chatbox.sql`, rinumerata prima della consegna); vedi §13ter |
| `033_ai_chatbox_knowledge_base.sql` | Tabella `tenant_knowledge_base` (contenuto curato a mano) + indice HNSW + funzione `match_knowledge_base(query_embedding, p_tenant_id, match_count, min_similarity)`, stesso pattern di `match_products` — **numerata 033 per lo stesso motivo di collisione** (il prompt originale la chiamava `030_...`); vedi §13ter |
| `034_click_collect_hours_it.sql` | **Correzione 26/07: contenuto ora identificato** (la revisione precedente di questo documento lo segnalava come "non identificato", nessuna verifica indipendente era stata fatta contro il filesystem). `tenants.click_collect_hours_it` — versione italiana degli orari click & collect, editabile separatamente dal francese (`click_collect_hours`, migration 009) perché testo libero non traducibile automaticamente in modo affidabile. Mostrato su `/card` e checkout quando `lang=it`; se `null`, fallback sul campo francese. Editabile da `/admin/parametres` (`BoutiqueInfoSection.tsx`, whitelist `EDITABLE_TENANT_FIELDS` in `api/admin/tenant/route.ts`) |
| `035_product_is_homemade.sql` | `products.is_homemade` boolean default `false` — nessun prodotto attivato in questa migration, attivazione manuale per prodotto è scelta editoriale successiva; **numerata 035 perché 030–034 già occupate** (il prompt originale la chiamava `030_...`) — vedi §33 |
| `036_tenant_story.sql` | `tenants.story_heading`/`story_text`/`story_image_url`/`countries_served` — solo colonne, nessun contenuto ChloeFood popolato in questa migration (contenuto editoriale, non generato) — vedi §33 |
| `037_checkout_sessions_customer_id.sql` | Emersa durante il debug del prerequisito auth cliente (31/07) — collega `checkout_sessions`/ordini a `customer_id` quando l'utente è autenticato. Numero occupato prima che il prompt loyalty potesse usarlo, causando la rinumerazione a cascata sotto — vedi §9bis |
| `038_customers_grants.sql` | Anch'essa emersa durante il debug auth (31/07) — GRANT mancanti su `customers` causavano `permission denied for table customers` (client service usato per il check `isNewCustomer` invece del client legato alla sessione) — solo per il ruolo `authenticated`, vedi `042` sotto — vedi §9bis |
| `039_admin_users.sql` | **Riga mancante in v3.17 — corretta in v3.18.** Tabella `admin_users` (ruoli `platform_owner`/`tenant_admin`, scoping per tenant), sostituisce `ADMIN_EMAILS`. Non collegata al debug auth cliente di 037/038: è il deliverable pianificato del punto 2 del ciclo (vedi §9bis), semplicemente il numero successivo libero. `requireAdmin()` cambia firma in `requireAdmin(tenantId)` — vedi §8, §9bis |
| `040_loyalty_referral_system.sql` | Sistema Loyalty/Referral multi-tier completo — **correzione v3.18: numerata `040`, non `039`** come scritto in v3.17 (039 è `admin_users`, sopra) — la cascata di collisioni è tripla (037+038+039), non doppia. 4 tabelle nuove + 1 vista + alterazioni a `tenants`/`customers`/`orders` + 4 funzioni Postgres (`resolve_referral_chain`, `resolve_referral_downline`, `apply_referral_on_signup`, `process_order_points_atomic`) — vedi §4 sopra e §9bis. Eseguita e verificata (report positivo su typecheck + flusso end-to-end registrazione→ordine→consegna→punti `PENDING`) — vedi §9bis |
| `041_fix_points_balance_view.sql` | **Non in v3.17 — aggiunta in v3.18.** Fix mirato: la vista `customer_points_balance` non nettava le righe `REVERSED` contro `confirmed_balance` (un cliente rimborsato manteneva i punti). Corrisponde esattamente al bug già documentato nella tabella bug di §9bis ("Righe REVERSED non nettate...") — nessuna informazione nuova, solo la migration che lo implementa, verificato con test concreto contro Postgres reale (100pt CONFIRMED + storno −100 REVERSED → 0) |
| `042_customers_service_role_grant.sql` | **Non in v3.17 — aggiunta in v3.18.** Bug di produzione distinto da quello di `038`: `038` aveva concesso GRANT su `customers` solo al ruolo `authenticated`, mai a `service_role` — il ruolo usato da `createServiceClient()` in tutto il sistema loyalty (almeno 17 punti). Manifestato in produzione come `permission denied for table customers` su `GET /api/admin/loyalty/customers-search`. Ottavo bug del ciclo, non ancora nella tabella bug di §9bis prima di questa revisione — vedi §9bis |
| `043_drop_redundant_customer_referral_code.sql` | **Non in v3.17 — aggiunta in v3.18.** Rimuove `customers.referral_code` (colonna aggiunta da `040`, mai scritta/letta da alcun endpoint — verificato via grep, il codice reale usa sempre `referral_codes.code`) — vedi riga `customers` in §4 sopra |
| `044_customer_default_address.sql` | **Non in v3.17 — aggiunta in v3.18. ⚠️ Non ancora su `main`** (verificato via `git cat-file -e main:supabase/migrations/044_...` → assente; le altre 037–043 sono invece confermate su `main`, vedi §9bis/§36). GRANT su `addresses` (mai concessi da `001`/`002`, tabella orfana fino ad ora) + funzione `upsert_default_address()` (upsert atomico dell'indirizzo di default, promuove un indirizzo identico invece di duplicarlo) — supporta la pre-compilazione checkout del punto 4 in §9bis |
| `045_tenant_hero_slides.sql` | **Nuova in v3.20 — verificata sul filesystem, non solo su chat.** Tabella `tenant_hero_slides` (RLS attiva) — contenuto dell'hero carousel della home page, gestito da `/admin/accueil-slides`. Vedi §12bis Fase 5 |
| `046_ambassador_commission_system.sql` | **Nuova in v3.20.** Numerata `046` (non `041` come nella spec originale del prompt): al momento della scrittura la sequenza reale era già arrivata a `045`, deviazione segnalata nel commento di intestazione della migration stessa. Aggiunge 7 colonne di configurazione programma a `tenants` (`ambassador_min_purchase_amount`/`ambassador_min_commission_amount`/`ambassador_max_commission_amount`/`ambassador_loyalty_from_second_order`/`ambassador_first_order_discount_type`/`ambassador_first_order_discount_value`/`ambassador_payout_threshold_amount`), 8 colonne a `customers` (`is_ambassador`, profilo pagamento IBAN/PayPal, timestamp promozione), nuova tabella `ambassador_commissions` (vincolo `unique(tenant_id, referred_customer_id)` — una sola commissione per cliente invitato, mai in stato `PENDING` perché la funzione gira solo alla consegna ordine), 3 colonne su `orders` (sconto applicato + idempotenza), 1 colonna su `checkout_sessions` (porta lo sconto dal checkout al webhook Stripe che crea l'ordine reale), funzione `process_ambassador_commission_atomic()`. Programma indipendente da `040_loyalty_referral_system.sql` — nessuna tabella/funzione di quella migration viene alterata, solo referenziata. Vedi §9ter |
| `047_loyalty_card_system.sql` | **Nuova in v3.20.** Nuovo ruolo `admin_users.tenant_cashier` (constraint di ruolo esteso, richiede comunque `tenant_id` come `tenant_admin`). Sequenza dedicata `tenants.loyalty_card_sequence` (**indipendente** da `barcode_sequence` dei prodotti, namespace `20`, per non far collidere/saltare numeri tra i due). Colonna `customers.loyalty_card_number` (EAN-13, namespace `21` — verificato via grep sull'intero storico migration + codice applicativo: nessun uso preesistente). Funzione condivisa `ean13_check_digit()` estratta (non spostata: `next_product_barcode()` di `031` resta byte-per-byte invariata) dall'algoritmo di checksum già in uso, riusata da `next_loyalty_card_number()`; trigger `assign_customer_loyalty_card_number()` assegna il numero automaticamente a ogni riga `customers` creata, qualunque sia il percorso (copre anche l'upsert OTP signup di `verifyOtp.ts`). Nuova tabella `loyalty_manual_purchases` (acquisti registrati in cassa, non ordini finti) + vincolo XOR su `points_ledger` (una riga ha `reference_order_id` **o** riferimento ad acquisto manuale, mai entrambi) + nuovo `transaction_type` `IN_STORE_PURCHASE_EARNED` + funzione `process_manual_purchase_points_atomic()`. Vedi §9ter |
| `048_tenant_android_app.sql` | **Nuova in v3.21 — riportato in chat, non riverificato contro filesystem/git in questa sessione.** Aggiunge `tenants.android_package_name` e `tenants.android_sha256_fingerprint` (stringa comma-separated: 3 fingerprint distinti per via del signing hybrid quantum-ready di Google Play — `deployment_cert`/`hybrid_classical_cert`/`hybrid_pqc_cert`). Consumata da `/.well-known/assetlinks.json` (route Next.js App Router `force-dynamic`, legge dati tenant a runtime invece di servire un file statico — scelta multi-tenant deliberata). Vedi §14ter |
| `049_tenant_android_public_release.sql` | **Corretto in v3.22: il nome file reale è `049_tenant_android_public_release.sql`**, non `049_tenant_android_public.sql` come riportato in v3.21 (quel changelog era basato solo su ricerca chat, mai verificato contro il filesystem). Aggiunge `tenants.android_public` (boolean, default `false`). Distingue "app esiste in closed testing" da "app pubblicamente installabile su Play Store", usato dalla smart-link `/go` per decidere se reindirizzare al Play Store o mostrare un fallback. Vedi §14ter |
| `050_shipping_country_rules.sql` | **Nuova in v3.22 — verificata sul filesystem (6/08).** Tabella `shipping_country_rules`: layer di regole commerciali per paese sopra Packlink/flat_rate/pickup_only — gratuità sopra soglia carrello, forfait fisso per paese (bypassa Packlink), sconto spedizione (percentuale o importo fisso), le tre leve possono coesistere sulla stessa riga; `countries = '{*}'` = fallback globale (stesso pattern di `shipping_vat_rates`, `003`). Zero righe = comportamento identico a prima, nessuna regola applicata. Vedi §6, §40 |
| `051_ambassador_split_pool_mode.sql` | **Nuova in v3.22 — verificata sul filesystem (7/08).** Seconda modalità di commissione per il programma Ambassadeur (`046`), alternativa alla proporzionale: pool condiviso a importo fisso, diviso in percentuale configurabile tra ambassador e cliente invitato invece che una % sul valore ordine. Numerata `051` non perché collisione risolta ma perché, come segnalato nel commento di intestazione della migration stessa, la sequenza reale era già arrivata a `050` quando la spec proponeva "presumibilmente 048". Vedi §9ter, §40 |
| `052_events_module.sql` | **Nuova in v3.22 — verificata sul filesystem (9/08).** Il ciclo più corposo dei tre di questa revisione: modulo Événementiel (soirées BBQ datate, formule multiple, biglietteria con QR redemption) + modulo Services (traiteur/location su preventivo). Due flag indipendenti su `tenants` (`events_enabled`, `services_enabled`), nessun dato seedato per un tenant specifico — attivazione/configurazione solo da `/admin`. 11 tabelle nuove (`events`, `event_ticket_types`, `event_reservations`, `event_reservation_items`, `event_reservation_redemptions`, `service_offerings`, `service_inquiries`, `rental_items`, `rental_reservations`, `rental_reservation_items`, `event_gallery_photos`) + funzione `redeem_event_reservation(p_qr_token, p_quantity, p_admin_id)`. Scelta di sicurezza esplicita in intestazione: nessuna tabella admin concede INSERT/UPDATE diretto ad `authenticated` (a differenza dello scheletro RLS/GRANT proposto nella spec originale) — tutte le scritture, incluse le prenotazioni create dal webhook Stripe o i preventivi creati dall'API pubblica, passano dal client di servizio server-side, mai dal client browser con RLS; stesso pattern già in uso per `050`/`045`. Vedi §40 (nuova sezione) |
| `053_event_reservation_item_redemptions.sql` | **Nuova in v3.23 — verificata sul filesystem (10/08).** Tabella `event_reservation_item_redemptions`: redemption granulare a livello di riga formula (`event_reservation_items`), in aggiunta alla redemption globale già esistente (`event_reservation_redemptions`, `052`) — permette allo scanner `/admin/evenementiel/scan` di validare parzialmente una formula precisa invece di decrementare solo il totale prenotazione. Il campo aggregato `event_reservations.quantity_remaining` resta la fonte di verità per il badge cliente (`/evenementiel/billet/[qr_token]`), aggiornato in modo simmetrico ad ogni redemption/void granulare. Vedi §41 |
| `054_fix_redeem_ambiguous_column.sql` | **Nuova in v3.23.** Fix immediato (stesso giorno, `053` alle 15:58 → `054` alle 16:09): `column reference reservation_item_id is ambiguous` nella funzione `redeem_event_reservation_items` — la colonna di output in `RETURNS TABLE(...)` diventa variabile implicita visibile in tutto il corpo PL/pgSQL, ambigua con la colonna reale nella query di validazione. Fix: alias esplicito, stessa firma, idempotente (`create or replace`) |
| `055_fix_quantity_remaining_ambiguous.sql` | **Nuova in v3.23.** Stesso identikit di bug della `054`, questa volta su `quantity_remaining` (colonna di output in **entrambe** le funzioni `redeem_event_reservation_items` e `void_event_reservation_item_redemption`) — fix con alias esplicito sulla tabella aggiornata |
| `056_events_theme_colors.sql` | **Nuova in v3.23 — verificata sul filesystem (11/08).** `events.theme_primary_color`/`theme_secondary_color` — palette opzionale per singolo evento, fallback a `tenant.primary_color`/`secondary_color` se null |
| `057_event_gallery_photos_event_index.sql` | **Nuova in v3.23.** Indice dedicato `(tenant_id, event_id, sort_order)` parziale su `event_gallery_photos` per le query filtrate per evento (carousel multi-immagine, hub `/evenementiel` + dettaglio evento) — l'indice esistente da `052` copre solo la galleria generale, non filtrata |
| `058_events_highlights_badge.sql` | **Nuova in v3.23 — verificata sul filesystem (11/08), Événementiel Fase 2.** Cambia il fallback palette da "colore tenant" a due default fissi del modulo (`#E65C00`/`#FFB347`, non più legati al tenant — la colonna override per-evento di `056` resta invariata, cambia solo il fallback); aggiunge `events.subtitle` (text) e `events.highlights` (jsonb, badge/punti salienti in hero) |
| `059_external_payment_links.sql` | **Nuova in v3.23 — verificata sul filesystem (12/08). Fase 1 — solo boutique.** `checkout_sessions.payment_method` (`stripe` default / `external_link`) + snapshot `external_payment_type`/`external_payment_label`/`external_payment_link` (link già costruito con importo appeso, per non ridipendere da `tenant_payment_methods` alla conferma admin). Stessa regola assoluta dello Stripe flow: nessun ordine creato prima della conferma pagamento — qui manuale (nessun webhook possibile per un semplice link), dal bandeau "Paiements en attente" in `/admin`. **Corregge anche una deriva pregressa**: il CHECK `orders.payment_method` (dallo schema iniziale `001`) non includeva `in_store`, benché il codice (`api/checkout/route.ts`) lo scrivesse da tempo — il CHECK viene riscritto includendo sia `in_store` sia il nuovo `external_link`; aggiunte anche `orders.external_payment_type`/`external_payment_label` |
| `060_event_reservation_requests.sql` | **Nuova in v3.23 — verificata sul filesystem (12/08). Fase 2 — billetterie événementiel.** Stessa regola di `059`, ma il modulo événementiel non ha una tabella sessione equivalente (il PaymentIntent Stripe porta tutti i dati prenotazione nei metadata) — `external_link` non ha PaymentIntent, quindi nuova tabella dedicata `event_reservation_requests` invece di una richiesta in attesa generica. Decisione esplicita con Robertin: **non** introdurre una tabella generica condivisa shop/événementiel/location, ogni modulo resta gestito separatamente |
| `061_rental_reservation_requests.sql` | **Nuova in v3.23 — verificata sul filesystem (12/08). Fase 3 — location matériel, ultimo dei tre moduli.** Stessa logica di `060`, tabella dedicata `rental_reservation_requests` (referenzia `service_offerings`, `052`) invece di condividerla con gli altri due moduli, stessa decisione di design |
| `062_tenant_card_payments.sql` | **Nuova in v3.23 — verificata sul filesystem (13/08).** Nuovo metodo `card` per `tenant_payment_methods` (estende il CHECK di `030`): apre un checkout Stripe Elements integrato in `/card`, importo inserito liberamente dal cliente (nessun carrello/prodotto dietro — pagamento "importo libero" via QR esposto in negozio). Nuova tabella `tenant_card_payments` (dominio indipendente da `orders`/`checkout_sessions`/`event_reservation_requests`, stesso principio di separazione per modulo già in uso), RLS attiva senza policy pubbliche (solo `service_role`, via `api/card/quick-pay` + branch dedicato del webhook Stripe). Nessuno Stripe Connect (come per lo shop): PaymentIntent sul conto piattaforma Lepefy, giroconto al tenant manuale. Vedi §41 |

**⚠️ Verificato in questa sessione (26/07, seconda passata):** `ls supabase/migrations/` conta **41 file**, non i ~38 impliciti dalla tabella sopra nelle revisioni precedenti — mancavano `031_storefront_ready.sql` (collisione di numero mai segnalata) e l'identificazione di `034_click_collect_hours_it.sql`. Entrambi i campi (`storefront_ready`, `click_collect_hours_it`) sono confermati letti/scritti nel codice reale (`packages/types/tenant.ts`, `card/page.tsx`, `DigitalCard.tsx`, `api/admin/tenant/route.ts`, `BoutiqueInfoSection.tsx`) — non sono migration orfane, la feature è cablata end-to-end, solo mai documentata qui prima d'ora.

**⚠️ Verificato in questa sessione (31/07, v3.18):** `ls supabase/migrations/` conta **49 file** su questo branch, non i 41 della revisione precedente (+8: `037`–`044`, vedi sopra). Su `main` invece sono **48**: `044_customer_default_address.sql` esiste solo su questo branch di lavoro, non ancora mergiata (verificato con `git cat-file -e main:supabase/migrations/044_customer_default_address.sql`, fallisce) — le altre 7 (`037`–`043`) sono invece confermate identiche su `main` (`diff` byte-per-byte contro `git show main:...`), a differenza del pattern "nulla mergiato" di tutte le verifiche precedenti (v3.7/v3.16). Dettaglio in §9bis e §36.

**⚠️ Verificato in questa sessione (3/08, v3.20):** `ls supabase/migrations/` conta **52 file** su questo branch (+3: `045`–`047`, vedi sopra — non le +8 implicite dal solo confronto coi numeri, dato che `037`–`044` erano già presenti da v3.18). `git ls-tree -r main -- supabase/migrations/` conferma che **`main` è invece fermo a `043`** — non solo `044` manca ancora (come già noto da v3.18), ma il gap si è allargato a 9 file (`044`–`047` + le altre 4 che restavano già solo-branch). `git merge-base main HEAD` coincide esattamente con la punta di `main`: questo branch di lavoro contiene tutta la storia di `main` più **17 commit ulteriori**, tutti "Add files via upload" datati 30/07–3/08, zero commit su `main` che non siano già su questo branch. Dettaglio completo in §38.

**⚠️ Verificato in questa sessione (10/08, v3.22):** `ls supabase/migrations/` conta **57 file** su questo branch (+5 rispetto ai 52 di v3.20: `048`–`049` già presenti da v3.21 ma mai verificate qui, +`050`–`052` nuove di questo ciclo). `git ls-tree -r main -- supabase/migrations/` conferma che **`main` è fermo a `049_tenant_android_public_release.sql`, 54 file** — il gap segnalato da v3.7 in poi non si è chiuso, si è allargato di 3 file (`050`–`052`). `git rev-list --count main..HEAD` = 19 commit; `main` resta un ancestor diretto di questo branch (nessuna divergenza, solo lavoro non ancora mergiato).

**⚠️ Verificato in questa sessione (14/08, v3.23) — il gap segnalato da v3.7 in poi è chiuso:** `ls supabase/migrations/` conta **67 file** su questo branch (+10 rispetto ai 57 di v3.22: `053`–`062`). `git merge-base main HEAD` coincide con la punta di `main` (commit `1a2a1e3`) — a differenza di ogni verifica precedente, **`main` non è più indietro**: contiene già tutti i cicli fino a `062` incluso, redesign storefront/admin, loyalty/referral, Ambassadeur, Événementiel compresi. Questo branch di lavoro è `main` + **1 solo commit** (`766604a`, refactor cosmetico `DigitalCard.tsx`/`PaymentMethodsAccordion.tsx`, nessuna migration). `pnpm install` + `pnpm typecheck` eseguiti in questa sessione (non solo riportati): esito pulito. Dettaglio completo in §41.

**Non esistono file 005 e 012** — non sono stati saltati per errore, la numerazione riflette semplicemente collisioni risolte con suffissi (003b/003c) o rinomina all'atto della scrittura, come documentato nei commenti di intestazione di `018` e `023`.

**✅ Migration IA — numerazione confermata su filesystem reale (revisione 15/07).** Le tre feature sono finite su `026_ai_descriptions.sql` → `027_ai_rate_limiting_cost_tracking.sql` → `028_semantic_search.sql`, cioè i tre numeri immediatamente successivi a `025_label_origin_style.sql` (non collisioni con 023/024/025 come si temeva in una nota precedente di questo documento, ormai superata).

### Pattern permessi Supabase (critico)

```sql
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.[tabella] TO anon, authenticated;
GRANT UPDATE ON public.[tabella] TO service_role;  -- richiesto per ogni tabella scrivibile da API route admin
-- Testare sempre con: SET role anon; SELECT * FROM [tabella];
```

---

## 5. Multi-tenancy — regole fondamentali

- Ogni query DB **deve** usare `tenant.id` caricato da `NEXT_PUBLIC_TENANT_SLUG` + `getTenant()`
- Mai hardcodare slug (`'chloefood'`), colori, nomi, label corrieri, o valori tenant-specifici nel codice
- **✅ Audit dedicato eseguito su questa regola per lo storefront pubblico (Fase 1–3, §12bis), ⚠️ ma solo su questo branch di lavoro, non su `main`.** Prima dell'audit la regola era violata in più punti concreti (colori hardcoded in BottomNav/PWABanner/AddToCartButton/HeroBanner/tracking ordine, nome tenant hardcoded `"Chloé Food"` in PWABanner). Tutti corretti su questo branch; il pattern qui è: solo `var(--color-*)` o classi Tailwind mappate nei componenti storefront, mai hex literal — ma `main` risulta ancora con gli hex hardcoded originali (verificato v3.7, vedi §12bis). Vedi §12bis per il dettaglio e per il lavoro analogo ancora da fare fuori da `apps/storefront` se in futuro si aggiungerà un secondo tenant con branding diverso
- La logica del corriere è **switch-based** su `tenants.shipping_provider` (`packlink` / `flat_rate` / `pickup_only`)
- RLS attivo su tutte le tabelle — il `service_role` bypassa RLS nelle API routes admin (ora tutte protette anche a livello applicativo da `requireAdmin()`, vedi §2.1)
- **Eccezioni statiche note (da rimediare prima del 2° tenant):** `favicon.ico` e `apple-touch-icon.png` in `public/` sono file statici mono-tenant, accettabili temporaneamente con un solo tenant attivo
- **Regola per asset dinamici:** trasformazioni immagine (icone, QR) sempre via API route (es. `/api/pwa-icon?size=192`, `/api/card/qr-code`) che legge `tenant.logo_url` / `tenant.primary_color` a runtime — mai file statici pre-generati
- **Limite architetturale noto (§18/§19):** il tenant è risolto da `NEXT_PUBLIC_TENANT_SLUG` a build time → ogni nuovo negozio richiede un deployment Vercel dedicato. Regge fino a ~5 tenant; evoluzione naturale è risolvere il tenant dal dominio (header `Host`) prima di onboardare il terzo cliente.

---

## 6. Sistema spedizione (Packlink PRO)

### Formula calcolo

```
num_pacchi    = ceil(peso_totale_g / (max_pack_kg × 1000))
packaging     = surcharge_amount × num_pacchi   (se per_parcel)
              = surcharge_amount                 (se per_order)
vat           = tax_price Packlink se > 0, altrimenti packlink_price × vat_rate (DB)
shippingTotal = packlink_price + vat + packaging
```

### Configurazione ChloeFood

- Surcharge imballaggio: **3,00 € per pacco** (`per_parcel`)
- Peso massimo per pacco: **15 kg**
- IVA: IT/FR/BE/DE → 22% precauzionale · CH → 0%
- Filtri Packlink: `dropoff: false` (solo consegna a domicilio) + esclusione servizi B2B
- Tutti i prodotti (dry/fresh/frozen) trattati **identicamente** per la spedizione
- `vatSource` tracciato in `orders.shipping_details` (`'packlink'` vs `'db'`)

### Sicurezza preventivo (aggiunto nella revisione 2026-07-02)

`/api/shipping/quote` emette un token HMAC-SHA256 (`src/lib/shipping/quoteToken.ts`) che lega importo, paese, CAP e scadenza (1h). Il checkout verifica il token e lo confronta con l'indirizzo di consegna prima di accettare l'importo — il cliente non può più forzare un costo di spedizione arbitrario dal browser.

### File chiave

- `apps/storefront/src/lib/shipping/calculateShipping.ts` — engine principale
- `apps/storefront/src/lib/shipping/quoteToken.ts` — firma/verifica HMAC del preventivo
- `apps/storefront/src/app/api/shipping/quote/route.ts` — API endpoint
- `supabase/migrations/003_shipping_packlink.sql` — schema DB

### ⚠️ Da fare prima del go-live

- Cambiare `PACKLINK_API_BASE` da `apisandbox.packlink.com` a `api.packlink.com`
- `FROM_ADDRESS` è ancora hardcoded `IT 42122` in `api/shipping/quote/route.ts` nonostante esista `warehouse_location` — il secondo tenant spedirebbe erroneamente "da Reggio Emilia"
- Il breakdown `_internal` (corriere, IVA, surcharge) è restituito al client come `shippingDetails` ed è visibile nei devtools, incluso il markup di 3€/pacco — la documentazione lo descrive come nascosto ma non lo è a livello di rete
- **TODO segnalato ma non implementato:** aggiungere `carrierName` e `serviceName` all'oggetto `_internal` e a `shipping_details` in DB (Packlink li restituisce già come `"name"` e `"carrier_name"` nella risposta API) — aggiornare interfaccia `PacklinkService`

---

## 7. Checkout e pagamenti

### Flusso ordine (webhook-first, prezzi ricalcolati server-side)

```
Cliente → /checkout
  → POST /api/checkout          → rilegge prezzo/nome/storage_type dal DB per productId (tenant + attivi)
                                → verifica token HMAC spedizione, forza 0 su pickup
                                → crea checkout_session in DB
                                → crea PaymentIntent Stripe (metadata: session_id, tenant_id)
  → Stripe Elements             → cliente paga
  → POST /api/webhooks/stripe   → evento payment_intent.succeeded
                                → legge checkout_session
                                → crea order + order_items in DB (unique index idempotente su stripe_payment_intent_id)
                                → elimina checkout_session
                                → chiama n8n webhook (conferma ordine)
```

**Regola assoluta:** Gli ordini vengono creati **solo** dopo `payment_intent.succeeded`. Mai prima. Prezzo e spedizione **non** sono mai fidati dal client (fix 2026-07-02, vedi §2.1).

### Metodi di pagamento

| Metodo | Implementazione |
|---|---|
| Stripe (carte) | Stripe Elements, PaymentIntent |
| Satispay | Via Stripe nativo (nessun codice extra) |
| In-store (Click & Collect) | `payment_method = 'in_store'`, bottone "Marquer comme payé" in admin |

⚠️ Nessuno Stripe Connect: il PaymentIntent è creato sull'account piattaforma Lepefy nonostante esista `tenants.stripe_account_id` — il giroconto al tenant è presumibilmente manuale.

### Variabili d'ambiente Stripe (Vercel)

```
STRIPE_SECRET_KEY=sk_live_...          # ⚠️ DA SOSTITUIRE con chiavi ChloeFood
STRIPE_WEBHOOK_SECRET=whsec_...        # ⚠️ DA REGISTRARE su account ChloeFood
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

### Billing SaaS (abbonamento Lepefy → tenant)

Pannello `/admin/billing`: mostra stato abbonamento con due opzioni di pagamento — **Stripe Payment Link** (~1,59 € commissione/transazione) e **bonifico bancario** (0 commissioni, opzione raccomandata, causale bonifico auto-generata). Automazione billing completa (Customer Portal / webhook ricorrenti) valutata e **scartata volontariamente** per lo stage attuale: 1 solo tenant attivo, relazione diretta preferita a soluzione tecnica complessa. PayPal personale esplicitamente sconsigliato per raccolta pagamenti business.

⚠️ **Gap noto:** lo storefront non controlla mai `tenants.subscription_status` — un tenant con abbonamento scaduto continuerebbe a vendere indefinitamente. Nessun enforcement automatico implementato.

---

## 8. Admin dashboard

### Autenticazione — ✅ RISOLTA (pagine + API)

`/admin` era **pubblica** fino a metà giugno — problema critico ora risolto, ed esteso anche alle API dopo la revisione di sicurezza del 2026-07-02:

- **Causa del fallimento iniziale:** Root Directory Vercel = `apps/storefront` impedisce l'esecuzione dell'Edge middleware Next.js in monorepo
- **Soluzione pagine:** route group `(protected)` con `admin/layout.tsx` Server Component che chiama `supabase.auth.getUser()` e reindirizza se non autenticato; `admin/login/` fuori dal gruppo protetto per evitare redirect loop
- **Soluzione API:** helper `src/lib/auth/requireAdmin.ts` chiamato in testa a ogni route sotto `/api/admin/*` — prima della revisione le API scrivevano senza alcun controllo (vedi §2.1)
- **Whitelist:** variabile d'ambiente `ADMIN_EMAILS` — solo email designate accedono, non ogni utente registrato sullo storefront. **⚠️ Superato dal 31/07**: sostituito dalla tabella `admin_users` (ruoli `platform_owner`/`tenant_admin`, scoping per tenant) — `requireAdmin()` ha ora firma `requireAdmin(tenantId)`, ogni route admin deve passare esplicitamente il tenant invece di limitarsi a verificare l'email. Vedi §4, §9bis. **Correzione v3.18:** `grep -rn "ADMIN_EMAILS"` su tutto `apps/storefront/**/*.{ts,tsx}` restituisce **zero risultati** — il codice non la referenzia più in alcun punto, nemmeno come fallback (`requireAdmin.ts` letto per intero: usa solo `admin_users`). Non è quindi "non ancora rimossa come fallback attivo" — è semplicemente inerte lato codice. Resta **non verificabile da qui** se la variabile sia ancora impostata nelle env Vercel (nessun accesso alla dashboard Vercel da questo ambiente): se lo è, è solo un env var inutilizzato, non un fallback funzionante
- **Bug critico risolto:** `@supabase/ssr` 0.3.x richiede l'implementazione simultanea delle API cookie vecchie (`get/set/remove`) E nuove (`getAll/setAll`) — fornirne solo una rompe la sessione tra client e server
- **Recovery password:** flusso testato via Supabase Dashboard → Authentication → Users; Site URL in Auth settings deve puntare a `https://chloefood.com` (non `localhost`) per redirect corretto del link di recupero

### ⚠️ File morti — ✅ rimossi (Fase 0 redesign admin, §8bis)

`AdminNav.tsx` (soppiantato da `AdminSidebar.tsx`), `AdminOrdersClient.tsx` (dashboard client-side parallela, mai più montata) e `src/app/admin/orders/id/PickingList.tsx` (cartella letterale `id`, bozza abbandonata) sono stati eliminati, verificato via grep globale sugli import prima della cancellazione. Resta com'era, e non è un problema: `src/app/admin/orders/[id]/` **non è una route** (nessun `page.tsx`), è una cartella di componenti (`OrderDetail.tsx`, `PickingList.tsx`) importati via percorso relativo dalla vera pagina protetta `admin/(protected)/orders/[id]/page.tsx` — pattern confermato corretto, non toccato dal redesign.

⚠️ **Bug pre-esistente trovato e corretto durante il redesign**: l'icona di stampa "Liste de préparation" nella tabella ordini puntava a `/admin/orders/[id]/picking-list`, una route mai esistita — 404 silenzioso presente da prima di questo lavoro. Corretto in Fase 3 creando la route mancante (vedi §8bis).

### Funzionalità implementate

- Lista ordini con **KPI cards** — dettaglio aggiornamenti in §8bis, in sintesi: fatturato totale + mese corrente con delta, "À expédier" cliccabile con filtro; prima card **"Aujourd'hui"** (conteggio ordini di oggi, "X au total" come sotto-riga) — ✅ eseguita, verificato nel codice (`admin/(protected)/page.tsx`), correzione rispetto a v3.6 che la segnalava ancora pendente
- Filtri: **6** (Statut con conteggi per stato, date range nativo `<input type="date">` ×2 al posto del preset fisso, Livraison, Paiement) — aggiornati in Fase 0 e nell'addendum filtri, vedi §8bis
- Tabella ordini: **responsive tablet-first** con colonne raggruppate, righe espandibili mantenute, ordinamento data/montant, **dark mode** scoped al solo layout admin, **selezione multipla + bulk bar** (export CSV, stampa massiva liste di preparazione, cambio stato con guardrail) — dettaglio completo in §8bis
- Colonna badge metodo di pagamento nella tabella ordini (ora componente condiviso `StatusBadge.tsx`, non più duplicato inline)
- Badge visivo per ordini di oggi
- Badge bandiere SVG per ordini internazionali
- Indicatori storage: ❄ surgelé / 🌿 frais
- Dettaglio ordine: aggiornamento stato + codice tracking — **ora con blocco**: non si può salvare stato "Expédié" senza `tracking_code` valorizzato, vedi §8bis
- Select corriere configurabile con modale conferma cambio
- Toggle lingua FR/IT
- **Navigazione mobile** (`AdminMobileNav.tsx`, non documentata nelle revisioni precedenti): la sidebar admin è `hidden md:block`, quindi sotto `md` non esisteva alcun modo di navigare tra le sezioni admin — colmato con un drawer a comparsa da sinistra (bottone hamburger in header, overlay, chiusura su `Escape`/click fuori/cambio route), riusa lo stesso `AdminSidebar.tsx` del desktop
- **Picking list stampabile** — ora raggiungibile anche come route dedicata `admin/(protected)/orders/[id]/picking-list/page.tsx` (bug fix Fase 3, vedi sopra) oltre che dalla pagina dettaglio esistente; nuova route gemella `admin/(protected)/orders/picking-list?ids=...` per la stampa massiva da selezione multipla
- Aggiornamento **live via polling** (18s, sospeso a tab nascosta) + toast + avviso in-tab (Notification API) su nuovo ordine — **non** vera push PWA, vedi §8bis e §19
- **Gestione catalogo prodotti** (`/admin/catalogue`): sidebar con accordion per categoria, ricerca client-side (soglia `catalogue_search_threshold`), colonne ordinabili via URL params, toggle inline Actif, editing inline stock con indicatori colore, drag&drop upload immagine, generazione immagine AI (Gemini); **`/admin/catalogue/nouveau`** per creazione nuovo prodotto (riusa `ProductEditClient` con uno stub `emptyProduct`) — ⚠️ fuori dal perimetro del redesign Fase 0–4, non toccato
- **Sistema etichette** (`/admin/products/[id]/etichetta`) — vedi §16, ora maturo: multi-template, multi-palette, draft/ristampa, preview live, autosave — ⚠️ fuori dal perimetro del redesign Fase 0–4, non toccato
- **Pannello billing** (`/admin/billing`) — non toccato
- **Impostazioni boutique** (`/admin/parametres`) — include download QR code biglietto da visita digitale — non toccato
- **Nuovo in v3.20 — verificato su filesystem, `AdminSidebar.tsx` letto per intero:** tre voci aggiunte in sequenza, nessuna duplicazione tra i commit che le hanno introdotte separatamente — `/admin/accueil-slides` (gestione hero carousel home, icona `IconPhoto`), `/admin/loyalty/scan` (scan fedeltà in cassa, icona `IconScan`, distinta dalla voce `/admin/loyalty` "Fidélité & parrainage" già esistente), `/admin/ambassadeurs` (icona `IconStar`, 4 sezioni: config/lista/commissioni/promozione). Il ruolo `tenant_cashier` (`047`, vedi §4/§9ter) è forzatamente reindirizzato a `/admin/loyalty/scan` dal layout `(protected)` — non vede mai il resto della sidebar, verificato leggendo `admin/(protected)/layout.tsx`

---

## 8bis. Audit e redesign UI/UX pannello admin (Fase 0–4 + 2 addenda) — ⚠️ implementato, non su `main`

**Stato:** tutte le fasi implementate con build/typecheck verdi ad ogni passaggio. **Verificato ora (v3.7) direttamente su git/filesystem, non solo su checklist riportate in chat**: `git merge-base main HEAD` coincide con la punta di `main`, cioè **nessun commit di questo lavoro è mai stato mergiato su `main`** — esiste solo su questo branch. Questo vale anche per il redesign storefront (§12bis), nonostante affermazioni precedenti del contrario — vedi intestazione documento. Diverse verifiche manuali "da fare sulla preview Vercel autenticata" (il container di build non ha le env Supabase) restano non confermate — dettaglio in "Cosa resta aperto" sotto. **Da verificare con Robertin quale branch sia effettivamente collegato al deploy Vercel prima di considerare questo lavoro live.**

Origine: `AUDIT_ADMIN_UIUX.md` (17/07), scope dichiarato: dashboard commandes (`(protected)/page.tsx`), `OrdersTable.tsx`, `AdminFilters.tsx`, `AdminSidebar.tsx`, design token (`globals.css`, `tailwind.config.ts`) — **`/admin/catalogue`, sistema etichette, billing, paramètres esplicitamente fuori scope**. Mockup di validazione: `admincommandesredesign.html` (allegato di sessione, non versionato nel repo, come il suo equivalente storefront in §12bis).

### Fase 0 — fondamenta

Token semantici di stato (`--status-info/warn/success/danger-{bg,fg,dot}`) in `globals.css`, indipendenti dal tenant per design (lo stato di un ordine ha lo stesso significato in ogni negozio). Componente condiviso `StatusBadge.tsx` (`admin/_components/ui/`), sostituisce due implementazioni duplicate identiche (`OrdersTable.tsx` e il poi-eliminato `AdminOrdersClient.tsx`). Fix del filtro Statut (mancavano `new` e `ready_for_pickup` come opzioni filtrabili, pur esistendo come stati reali). Rimozione dei 3 file morti (vedi §8).

### Fase 1 — accessibilità (WCAG 2.2 AA)

- Nessun testo informativo sotto 12px (`text-[10px]` → `text-xs` su badge "Aujourd'hui", tag quantità, contatori — le emoji di conservazione ❄/🌿 restano piccole per design, ora con `aria-label`+`role="img"`)
- `text-gray-400` → `text-gray-500` su testo informativo (2.5:1 → 4.8:1); `gray-400` resta solo per icone/placeholder
- `var(--color-primary)` **come colore di testo** (non solo sfondo) su bianco/chiaro sostituito con `--color-primary-dark` in 3 punti (`KpiCard` "Voir →", filtro attivo, voce attiva sidebar) — stesso problema di contrasto misurato dall'audit sui pulsanti pieni (~3.4:1 col verde ChloeFood), esteso per coerenza al testo
- Target size ≥24×24px su freccia espansione riga e bottone "Effacer" ricerca; `aria-expanded` sulla freccia; `aria-label` sul link picking-list
- `scope="col"` su tutti i `<th>`, testo `sr-only` sulle colonne senza etichetta visibile
- ⚠️ **Lighthouse/axe non eseguibile in sessione** (container senza env Supabase) — baseline da raccogliere su preview autenticata, mai confermata fatta
- Stesso pattern di contrasto esiste ancora in `OrderDetail.tsx`, `ProductEditClient.tsx`, `admin/login/page.tsx` — deliberatamente fuori scope, segnalato come mini-fase futura

### Fase 2 — tabella responsive tablet-first + dark mode

- Colonne da 10 a 7: Commande+Client fuse (email spostata nel pannello espanso), Transporteur confluito come sotto-riga di Montant, Paiement secondaria (`hidden lg:table-cell`)
- **Righe espandibili mantenute** — decisione esplicita di Robertin (17/07): il pattern "riga troncata → link a pagina dettaglio" mostrato nel mockup di validazione **non è stato implementato**, resta il pannello inline già esistente, arricchito con email + paiement quando nascosto
- Ordinamento client-side data/montant (`aria-sort` sul `<th>`)
- Card list `md:hidden` con tap-through al dettaglio (pattern diverso dalle righe espandibili solo perché sotto `md` non c'è spazio per un pannello leggibile, non una contraddizione della decisione sopra)
- **Dark mode**: decisione tecnica esplicita di **non** migrare tutto a CSS custom properties come nel mockup (troppo invasivo sul codice reale, quasi interamente classi Tailwind letterali) — usato invece `darkMode: 'class'` di Tailwind, wrapper `.dark` scoped al solo `(protected)/layout.tsx` (mai su `<html>`, storefront non toccato), `AdminThemeProvider`+`ThemeToggleButton`, persistenza `localStorage`. Token `.dark` in `globals.css` per i componenti già CSS-var-based (`StatusBadge`); **`--color-primary-light` ricalcolato via `color-mix()` dal primario del tenant, non hardcoded** (stesso principio multi-tenant di §5); `--color-primary-dark` risistemato in `.dark` (schiarito verso il bianco, direzione invertita rispetto al chiaro) perché altrimenti illeggibile su fondo scuro. `PaymentBadge`/`FlagBadge`/badge "C&C" convertiti da `style` inline con hex fissi a `className` con varianti `dark:` (gli stili inline non rispondono mai alle classi Tailwind)
- ⚠️ `OrderDetail.tsx` eredita il wrapper `.dark` (sta dentro `(protected)`) ma non ha classi `dark:` — resta visivamente chiaro col tema scuro attivo, atteso non un bug, da comunicare prima di mostrarlo a Dalice
- ⚠️ Verifica visuale 768/1023px e Lighthouse in dark mode segnalate "da fare su preview", mai confermate esplicitamente chiuse

### Fase 3 — selezione multipla e azioni bulk

- Checkbox riga + "seleziona tutto" (stato `indeterminate`), selezione azzerata al cambio ricerca/filtri
- Bulk bar sticky (`role="toolbar"`): **Export CSV** (client-side puro, Blob + BOM UTF-8 per gli accenti francesi in Excel — **non XLSX**: `xlsx@0.18.5` ha vulnerabilità note senza fix, coerente con la voce roadmap §19 che ne raccomandava già la sostituzione; **deviazione dalla decisione presa con Dalice il 17/07** che indicava XLSX come formato unico — accettata da Robertin il 18/07, non risulta ricomunicata a Dalice), **stampa massiva liste di preparazione** (route `orders/picking-list?ids=...`, un solo tab, `page-break-before` tra ordini), **cambio stato bulk** con guardrail multipli
- **Guardrail bulk status** (aggiunti dopo revisione, non nella prima versione): solo da stato `preparing`; ordini `pickup` (Click & Collect) vanno sempre a `ready_for_pickup`, **mai** a `shipped`; ordini `delivery` senza `tracking_code` **non vengono più saltati silenziosamente** — si apre un pannello (`BulkTrackingModal.tsx`) per inserire trasportatore+codice riga per riga prima di procedere. Nessuna cancellazione/rimborso bulk (tocca Stripe, va gestito singolarmente)
- API `bulk-status`: `requireAdmin()` + rilettura server-side dello stato reale (mai fidarsi della selezione del client) + `tenant_id` esplicito nella query (il service client bypassa RLS)
- **Dettaglio ordine singolo**: salvataggio bloccato se si imposta "Expédié" senza `tracking_code` valorizzato (stesso vincolo di business della bulk, applicato anche al percorso singolo)

### Fase 4 — aggiornamenti live (polling, non Realtime) + KPI

- **Decisione presa dopo aver verificato i volumi reali di ChloeFood** (1, raramente 2 admin in parallelo; <10 ordini/giorno il 18/07): **polling leggero** (18s, sospeso a tab nascosta, giro extra su `visibilitychange`) invece di Supabase Realtime vero. Un primo prompt con Realtime + nuova tabella `tenant_admins` + policy RLS `SELECT` su `orders` è stato scritto e **scartato prima dell'esecuzione** — resta come riferimento se il volume o il numero di admin concorrenti crescerà
- Endpoint `/api/admin/orders/poll` riusa `requireAdmin()`, nessuna nuova superficie di accesso
- **Guardia anti-interruzione**: se l'operatore ha il pannello tracking bulk aperto (`isEditing`), il poll continua a girare ma il `router.refresh()` viene rimandato finché il pannello non si chiude, per non perdere lavoro in corso
- `NotificationBell.tsx`: avviso di sistema **solo mentre la scheda è aperta** (Notification API, non service worker) — esplicitamente **non** le notifiche push vere promesse a Dalice il 17/07, vedi sotto e §19
- ✅ **KPI "Aujourd'hui"**: prevista dal piano originale dell'audit, persa nella riscrittura della fase attorno alla decisione Realtime→polling, poi **eseguita** — sostituisce "Commandes totales" come prima card, con il totale mantenuto come sotto-riga (`${totalCount} au total`). Correzione v3.7: la revisione precedente (v3.6) la segnalava ancora pendente, ma il commit che l'ha implementata (18/07, 23:03) precede quello che ha scritto v3.6 (18/07, 23:42) — la chat non era stata aggiornata di conseguenza, non un errore del codice

### Addendum 1 — filtri: date range nativo + conteggi

Completa l'audit §3.5 (solo il punto 1, filtro Statut, era stato coperto in Fase 0): filtro "Période" sostituito da due `<input type="date">` nativi (`dateFrom`/`dateTo`, zero librerie), filtro Statut con conteggio per stato (es. "En préparation (3)", nessun `(0)` per stati vuoti). Dati derivati da query già esistenti, nessuna nuova query pesante.

### Addendum 2 — navigazione mobile (`AdminMobileNav.tsx`)

Non presente nel piano originale dell'audit né nelle revisioni precedenti di questo documento — scoperta durante la verifica v3.7 contro il codice reale (commit 18/07, 23:20). Prima di questa aggiunta, `AdminSidebar` era `hidden md:block`: sotto la soglia `md`, l'admin non aveva alcun modo di raggiungere catalogue/etichette/billing/paramètres se non digitando l'URL a mano. `AdminMobileNav.tsx` apre un drawer da sinistra (bottone hamburger nell'header, overlay cliccabile, chiusura su `Escape` e al cambio route) che riusa lo stesso `AdminSidebar.tsx` del desktop — nessuna duplicazione di markup di navigazione.

### Decisioni prese in sessione (18/07) — divergono dal piano originale dell'audit

| Tema | Decisione audit/17-07 | Decisione effettiva 18/07 | Note |
|---|---|---|---|
| Export bulk | XLSX (decisione col committente) | **CSV** | Vulnerabilità nota `xlsx@0.18.5`; accettato da Robertin, **non risulta comunicato a Dalice** |
| Notifiche | Push vera (Web Push/service worker, decisione col committente) | **Rimandata in roadmap** | Solo avviso in-tab implementato; vedi §19 |
| Aggiornamenti live | Supabase Realtime | **Polling 18s** | Basato sui volumi reali verificati in sessione, non sulla raccomandazione originale dell'audit |
| Righe tabella | Mockup: troncate + link dettaglio | **Espandibili, mantenute** | Decisione esplicita di Robertin, 17/07 |

### Cosa resta aperto

- **Merge su `main`** del lavoro Fase 0–4 — verificato in v3.7 che **non è mai avvenuto** (`git merge-base main HEAD` = punta di `main`), non solo "non confermato in sessione" come detto in v3.6. Stesso discorso per il redesign storefront (§12bis). Da chiarire con Robertin quale branch Vercel deploya realmente
- Diverse verifiche manuali su preview Vercel autenticata segnalate ma non esplicitamente richiuse: Lighthouse/axe baseline (Fase 1), verifica visuale 768/1023px + Lighthouse dark mode (Fase 2), fix 404 picking-list + 3 azioni bulk + page-break multi-ordine + accenti CSV in Excel (Fase 3), comportamento guardia anti-interruzione poller su tre scenari (Fase 4)
- **Comunicare a Dalice** la deviazione CSV (invece di XLSX) e il rinvio delle notifiche push vere, essendo entrambe decisioni prese con lei il 17/07 e cambiate il giorno dopo senza il suo coinvolgimento diretto in sessione
- Estrazione componenti condivisi rimasta parziale: solo `StatusBadge.tsx` estratto; `Badge.tsx` (generico), `KpiCard.tsx`, `Toast.tsx`, `BulkBar.tsx` restano inline nei rispettivi file (§4 dell'audit li raccomandava come componenti condivisi) — debito di organizzazione, zero impatto utente
- Test manuali WCAG mai eseguiti: zoom 200% (1.4.4), screen reader reale (VoiceOver/NVDA) — solo Lighthouse/axe automatici pianificati
- Stesso pattern di contrasto/target-size delle Fasi 1-2 esiste ancora in `OrderDetail.tsx`, `ProductEditClient.tsx`, `admin/login/page.tsx` — fuori scope per scelta, non per svista
- Se in futuro serve davvero il Realtime (più admin concorrenti, volume cresciuto): il prompt scartato in Fase 4 (RLS `tenant_admins` + `postgres_changes`) resta un punto di partenza valido, non va ripreso "perché più elegante"

---

## 9. Customer order tracking

- Route: `/orders/[id]?token=xxx`
- Protezione: token HMAC-SHA256 (`orderId + email`)
- Timeline stati: `confirmé → en préparation → expédié → livré`
- Link tracking corriere incluso quando disponibile
- Link inviato dal workflow n8n nella email di conferma ordine
- **✅ Phase 2 implementata (31/07)** — vedi §9bis per il dettaglio completo: Supabase Auth clienti (OTP email) + pagina storico ordini `/orders` che riusa il pattern token HMAC esistente, voce "Compte" ora presente nel BottomNav mobile. Sostituisce lo stato precedente ("Phase 1 = form inserimento numero ordine + redirect tracking, guest-only")

---

## 9bis. Autenticazione cliente + `admin_users` + Sistema Loyalty/Referral multi-tier (31/07/2026)

**Contesto:** ciclo unico e più corposo del progetto ad oggi, tre workstream costruiti in sequenza perché il sistema loyalty dipende da una sessione cliente persistente per identificare gli acquirenti (prima di questo ciclo, `customers.id` era già `references auth.users(id)` con RLS pronte su `auth.uid()`, ma nessun flusso di login era mai stato costruito sopra — il checkout produceva solo ordini guest).

### 1. Autenticazione cliente (prerequisito)

- **Supabase Auth, email OTP a codice a 6 cifre — non magic link.** Scelta deliberata: i magic link aperti dal client Mail su iOS (e in certi flussi anche Android) si aprono nel browser di sistema invece che nella PWA standalone installata, rompendo il contesto app — stesso tipo di limite già documentato nel progetto per l'asimmetria di installazione PWA su Android (§11/§14). L'OTP a codice elimina il problema alla radice: l'utente digita 6 cifre senza mai lasciare la PWA.
- **Login opzionale, non obbligatorio al checkout** — il guest checkout resta possibile, ma senza punti/referral collegati (decisione esplicita di Robertin).
- **Bug noto Supabase incontrato in sessione**: il progetto generava di default codici a **8 cifre**, non 6 — impostazione in **Supabase Dashboard → Authentication → Providers → Email → OTP Length** (range 6–10), corretta manualmente. Punto di attenzione lasciato a Claude Code: la lunghezza non deve essere hardcoded in un solo punto isolato lato client (regex/input a celle fisse), altrimenti un cambio futuro di questa impostazione rompe silenziosamente la validazione senza errori in log.
- **Bug `verifyOtp` type**: il parametro `type` passato a `supabase.auth.verifyOtp()` differisce tra primo login (`'signup'`) e login successivi (`'email'`) — se non gestito correttamente il codice arriva ma la verifica fallisce con errore tipo "token invalido"/"OTP expired" nonostante il codice sia corretto.
- Migration `037_checkout_sessions_customer_id.sql` e `038_customers_grants.sql` emerse durante questo debug (non previste, numerazione a cascata — vedi §4).
- Colonna `customers.referral_code` — **correzione v3.18**: non un residuo pre-esistente come implicava la formulazione precedente. È stata aggiunta dalla migration loyalty stessa (`040_loyalty_referral_system.sql`) e rimossa di nuovo nello stesso ciclo da `043_drop_redundant_customer_referral_code.sql`, perché mai scritta/letta da alcun endpoint (vedi §4).

### 2. `admin_users` — sostituisce `ADMIN_EMAILS`

Tabella con ruoli `platform_owner` (Robertin, accesso multi-tenant) e `tenant_admin` (scoped a un tenant, es. Dalice per ChloeFood in futuro). `requireAdmin()` cambia firma in `requireAdmin(tenantId)` — ogni route sotto `/api/admin/*`, incluse tutte le nuove `/api/admin/loyalty/*`, deve passare esplicitamente il tenant. Vedi §4, §8.

### 3. Storico ordini cliente `/orders`

Nuova pagina che riusa il pattern token HMAC già esistente in `/orders/[id]?token=xxx` (§9), ora aggregato per cliente autenticato. Voce "Compte" aggiunta al BottomNav mobile — punto d'ingresso mancante identificato e corretto in sessione (senza questo, la maggioranza degli utenti reali non avrebbe trovato `/compte/connexion`).

**⚠️ Correzione v3.18 — funziona, ma non è ancora su `main`.** Confermato che la pagina esiste e corrisponde esattamente alla descrizione (`(shop)/orders/page.tsx` legge `getSessionCustomer()` + interroga `orders`/`order_items`, delega a `OrdersListClient.tsx`/`OrdersLoginPrompt.tsx`/`OrdersEmptyState.tsx`/`OrderLookupForm.tsx`, tutti presenti sul filesystem). Ma `git diff main..HEAD` mostra questi file come non mergiati: esistono solo su questo branch di lavoro, a differenza di auth/`admin_users`/loyalty (punti 1, 2, 5 sotto) che sono invece confermati su `main`. La voce "Compte" nel BottomNav **è** su `main` (punta comunque a `/compte/connexion`, che esiste indipendentemente da `/orders`) — un utente su produzione oggi la trova, ma non troverebbe ancora lo storico ordini dietro di essa.

### 4. Pre-compilazione checkout per clienti autenticati

Scoping per risolvere il fastidio di dover re-inserire i propri dati a ogni ordine — profilo salvato e riusato al checkout successivo.

**⚠️ Correzione v3.18 — stessa situazione del punto 3, e migration non citata in v3.17.** Il lavoro reale include `044_customer_default_address.sql` (assente dal filesystem quando v3.17 fu scritta, a giudicare dai timestamp commit — non un'omissione, il file non esisteva ancora): GRANT su `addresses` (mai concessi da `001`/`002`, tabella rimasta orfana fino ad ora) + funzione `upsert_default_address()` (upsert atomico, promuove un indirizzo identico invece di duplicarlo), consumata da `CheckoutForm.tsx`/`api/customers/me/route.ts`/`lib/customers/{getCustomerProfile,saveCheckoutProfile}.ts`. Come il punto 3: esiste e funziona, ma solo su questo branch — **non ancora su `main`**.

### 5. Sistema Loyalty/Referral multi-tier — `040_loyalty_referral_system.sql`

**Correzione v3.18:** il nome file in v3.17 era sbagliato (`039_...` — quel numero è occupato da `admin_users`, punto 2 sopra). ✅ Confermato su `main` (a differenza dei punti 3/4).

**Architettura (4 tabelle nuove + 1 vista + alterazioni a 3 tabelle esistenti + 4 funzioni Postgres — correzione v3.18: "7 tabelle" in v3.17 contava anche le alterazioni a `tenants`/`customers`/`orders`, non solo le tabelle davvero nuove `referral_codes`/`tenant_referral_tiers`/`points_ledger`/`referral_fraud_signals` + la vista `customer_points_balance`):**

- **Albero referral a profondità configurabile per tenant** — default 2 livelli, estendibile fino a 5 dal pannello tenant, ma con un **tetto hard indipendente dalla configurazione tenant**: se in futuro serve alzarlo oltre 5, è una migration esplicita, mai un valore che un tenant admin può impostare da solo.
- **Risoluzione dinamica dell'albero** (`resolve_referral_chain`, sostituisce un calcolo fisso L1/L2 pensato inizialmente) — risale la catena `referred_by_id` fino a `max_depth` livelli (verso l'alto, verso gli sponsor — usata per il calcolo commissioni in `processOrderPointsOnDelivery`), si ferma se la catena finisce prima. **Correzione v3.18 — funzioni non citate in v3.17:** esiste anche `resolve_referral_downline`, l'inverso (verso il basso, verso gli invitati) — non prevista nella spec originale (commento esplicito nella migration) ma necessaria per `GET /api/loyalty/referrals/tree`: è questa, non `resolve_referral_chain`, che alimenta la UI del punto sotto. Altre due funzioni Postgres non citate in v3.17: `apply_referral_on_signup` (collega un nuovo cliente al suo sponsor, atomica) e `process_order_points_atomic` (inserisce le righe ledger di un ordine e marca `orders.points_processed`, tutto-o-niente).
- **Percentuali per livello, versionate per tenant, mai sovrascritte** — ogni riga confermata nel ledger salva `pct_applied` + `referral_level` al momento del calcolo. Motivazione esplicita: se ChloeFood cambia la percentuale L2 dal 3% al 5% il mese prossimo, le righe già confermate devono restare storicamente accurate — senza questi campi un audit futuro non saprebbe più con quale percentuale è stato calcolato un accredito passato.
- **Ledger punti append-only** (pattern Ledger) — stati `PENDING`/`CONFIRMED`/`REVERSED`, mai update in-place su una riga già scritta.
- **Anti-frode graduato**: `FLAG_FOR_REVIEW`, `CAP_AT_THRESHOLD`, `AUTO_BLOCK`.
- **Eleggibilità codice referral**: `ALL_CUSTOMERS`, `SPENDING_THRESHOLD`, `ADMIN_GRANTED_ONLY`.
- **Link referral in formato `/invite/[code]`, non `?ref=` query param** — scelta tecnica, non estetica: il middleware Next.js non gira (Root Directory Vercel = `apps/storefront`, stesso limite noto da §5/§8), e le pagine ISR non possono leggere in sicurezza cookie per-utente.
- **Concept UI "la corda dei cartellini"** — **correzione v3.18: non "estende" `ShopTag.tsx`** come scritto in v3.17. Verificato nel codice: `RopeTag.tsx` (`components/loyalty/`) è un componente **separato**, con la stessa geometria di `ShopTag.tsx` (`clip-path` a punta + perforazione) ma costruito apposta per non toccarlo, essendo già usato altrove sulla piattaforma — commento esplicito nel file: *"Composant séparé plutôt que d'étendre ShopTag.tsx pour ne pas toucher un composant déjà utilisé ailleurs"*. Colore derivato da `--color-primary` (non `--color-secondary`, riservato al cartellino hero) via `color-mix` in oklch, scurito progressivamente per livello (`55 − 10×level`, minimo 20%) — su questo il comportamento descritto in v3.17 è confermato corretto. Dimensione del tag proporzionale ai punti generati dal nodo (32–56px). Renderizzato da `ReferralRope.tsx`, montato in `/compte/parrainage` (`ParrainageClient.tsx`) — **confermato realmente wired**, non solo costruito e mai collegato. **Sfumatura non in v3.17**: il commento in `ReferralRope.tsx` chiarisce che non è un vero albero con rami verso uno sponsor specifico — l'API sottostante (`resolveReferralDownline`) restituisce solo `{customerId, level, points}`, senza `parentId`, quindi la UI raggruppa per livello (un "rango" orizzontale per livello, che si scurisce e si allontana dal centro) invece di disegnare connessioni genitore→figlio; semplificazione dichiarata esplicitamente nel codice, non un difetto scoperto ora. Componente correlato non citato in v3.17: `LockedTagProgress.tsx`, un cartellino che si riempie verticalmente (stesso `clip-path`, via `mask-image` proporzionale) per mostrare quanto manca allo sblocco referral quando `referral_availability_mode = SPENDING_THRESHOLD`. **Anche l'intera UI admin loyalty non era citata in v3.17**: pagina `/admin/loyalty` (voce sidebar "Fidélité & parrainage" aggiunta in `AdminSidebar.tsx`) con 4 sezioni — `LoyaltyConfigSection.tsx`, `PendingReviewSection.tsx`, `ReferralAccessSection.tsx`, `StuckSignupBonusSection.tsx` — confermata su `main`.

### 6. Pagina "Mon compte" (`/compte`) — nuovo in v3.20, ✅ eseguito

**Correzione v3.20:** in v3.19 questo ciclo (integrazione di un design handoff esterno, `account-page-1a.html`) era segnalato "prompt generato, esecuzione non confermata in chat". Verificato ora nel codice (commit `fd09629`, 31/07 22:35 — la sera stessa in cui il prompt fu generato): `AccountDashboard.tsx` (nuovo, 288 righe), `AddressFormModal.tsx`, `Modal.tsx`, `ProfileEditModal.tsx` esistono e sono montati da `compte/page.tsx`; CRUD indirizzi via `POST/PATCH/DELETE /api/customers/me/addresses[/id]`. Le violazioni multi-tenant segnalate nel prompt (colori `oklch()` hardcoded, brand "Chloe Food" cablato, emoji al posto di Tabler, dati loyalty statici) risultano corrette: `grep` mirato su `oklch(`/nomi brand nella directory `(shop)/compte` restituisce zero risultati. La pagina è stata poi estesa in due commit successivi (1/08, 3/08) per montare `LoyaltyCardWidget.tsx` (§9ter) e la sezione "Espace Ambassadeur" (§9ter) — nessuna delle due era ancora prevista quando il prompt originale "Mon compte" fu scritto.

**Bug intercettati e corretti durante l'esecuzione:**

| Bug | Causa | Fix |
|---|---|---|
| `permission denied for table customers` | Client service usato per il check `isNewCustomer` invece del client legato alla sessione | Uso del client corretto lato sessione |
| Cookie referral cancellato su qualunque fallimento OTP | Cancellazione non condizionata al successo | Cancellato solo su login riuscito |
| Link referral con `?ref=` invece di `/invite/[code]` | Formato iniziale incompatibile con middleware/ISR (vedi sopra) | Riformattato a path dedicato |
| Righe `REVERSED` non nettate contro il saldo `CONFIRMED` in una vista di calcolo | `SUM` filtrato solo su `CONFIRMED` | `REVERSED` incluso nello stesso filtro `SUM` |
| Entry `SIGNUP_BONUS` mai confermate | Nessun trigger di conferma collegato | Confermate alla prima consegna (`delivered`), race condition chiusa eseguendo l'UPDATE prima della RPC atomica |
| Endpoint admin ricerca cliente → 500 su email con `@` | Routing path-vs-querystring mismatch | Corretto il routing |
| `GRANT SELECT` mancante | Emerso nel debug prerequisito auth (migration `038`, ruolo `authenticated`) | Aggiunto — stesso pattern di bug ricorrente già noto nel progetto (RLS ≠ GRANT, vedi §5/§20) |
| **(8, non in v3.17)** `permission denied for table customers` in produzione su `GET /api/admin/loyalty/customers-search` | `038` aveva concesso GRANT su `customers` solo al ruolo `authenticated`, mai a `service_role` — il ruolo di `createServiceClient()`, usato in almeno 17 punti del sistema loyalty | `042_customers_service_role_grant.sql`: `GRANT SELECT, INSERT, UPDATE ON customers TO service_role` — bug distinto dalla riga 1 sopra (stesso messaggio d'errore, causa diversa: lì era il client sbagliato, qui è il GRANT mancante sul client giusto) |

**Stato — correzione v3.18, va letto per sotto-parte, non come blocco unico "✅ FATTO":** migration + funzioni + route `/api/admin/loyalty/*` (con `requireAdmin(tenantId)`) + `lib/loyalty/*.ts` + l'intera UI (`/compte/parrainage`, `/admin/loyalty`) sono scritte, tipecheck confermato, flusso end-to-end verificato (registrazione con codice referral → ordine → consegna → punti visibili `PENDING` nel ledger) — **e confermato su `main`** in questa sessione (`diff` byte-per-byte main/HEAD su `040`–`043`, `requireAdmin.ts`, `ReferralRope.tsx`, `admin/(protected)/loyalty/page.tsx`: identici). Il sistema loyalty vero e proprio (punti 2 e 5 di questa sezione) è quindi live tanto quanto lo storefront pubblico. **Ma i punti 3 e 4** (storico ordini `/orders`, pre-compilazione checkout + indirizzo default, migration `044`) **non sono su `main`** — restano solo su questo branch di lavoro, vedi le note correttive sopra. Non ancora comunicato a Dalice come nuova feature (vedi §18/§19). **Punto 6 (Mon compte, nuovo in v3.20)**: eseguito e verificato in questo stesso branch (31/07, stessa sera del prompt) — anch'esso non ancora su `main`, stessa situazione dei punti 3/4.

---

## 9ter. Programma Ambassadeur + Carta fedeltà EAN-13 (2–3/08/2026) — ✅ eseguiti, verificati in questa sessione (v3.20)

**Contesto:** in v3.19 questi due sistemi erano documentati come "progettati, non eseguiti" (basato solo su ricerca chat). Verifica diretta in questa sessione (`git log main..HEAD --stat`, lettura delle migration per intero, lettura del codice applicativo, `pnpm typecheck`) mostra che **entrambi sono stati eseguiti** il 2–3/08, sullo stesso branch di lavoro di questo documento — non ancora su `main`. Dettaglio completo del confronto in §38.

### 1. Programma Ambassadeur — `046_ambassador_commission_system.sql`

Sistema separato e indipendente dal Loyalty/Referral di §9bis (nessuna tabella/funzione di `040` alterata, solo referenziata via FK/lettura applicativa) — le decisioni di prodotto chiuse in chat (vedi la cronologia in §37, punto 4a) risultano implementate senza deviazioni sostanziali:

- **Commissione in euro reali**, tasso derivato `rate = ambassador_min_commission_amount / ambassador_min_purchase_amount` (mai salvato come colonna propria — storicizzato per riga in `ambassador_commissions.rate_applied`, stesso pattern di `pct_applied` in `points_ledger`), applicata all'importo **pagato** dal referenziato (post-sconto), tetto per riga `max_commission_applied`
- **Sconto primo ordine opzionale** (`ambassador_first_order_discount_type` nullable = feature disattivata) — `resolveCheckoutAmbassadorDiscount.ts`/`calculateAmbassadorDiscount.ts` calcolano lo sconto al checkout; `checkout_sessions.ambassador_discount_amount` porta il valore fino al webhook Stripe che crea l'ordine reale (deviazione segnalata nel commento della migration: non prevista esplicitamente dalla spec, necessaria perché l'ordine nasce nel webhook, non in `POST /api/checkout`)
- **Esclusività sconto/punti sul primo ordine**: verificato in `processOrderPointsOnDelivery.ts` — se lo sconto primo ordine è stato applicato, il buyer non guadagna punti propri su quell'ordine; dal secondo ordine in poi, punti normali solo se `ambassador_loyalty_from_second_order = true`. Un ambassador non guadagna mai punti fedeltà propri (esclusione categorica dalla catena punti a qualunque livello, `sponsor?.is_ambassador → continue`)
- **Idempotenza allo stesso pattern di `process_order_points_atomic`**: `orders.ambassador_commission_processed` marcato sempre, qualunque sia l'esito — non solo sul path "commissione creata" come nella bozza iniziale del prompt (deviazione corretta in esecuzione, commentata nella migration)
- **Ruolo `tenant_cashier`** — non collegato al programma Ambassadeur in sé (serve alla carta fedeltà sotto), ma introdotto nello stesso periodo per lo stesso motivo di principio: personale di cassa part-time non deve avere accesso `tenant_admin` pieno ora che la piattaforma conserva anche IBAN/PayPal degli ambassador
- **UI cliente** `/compte/ambassadeur` (`AmbassadorClient.tsx`) — profilo pagamento (nome/cognome/IBAN o PayPal), stato commissioni; **UI admin** `/admin/ambassadeurs` — 4 sezioni: `AmbassadorConfigSection.tsx` (tassi/soglie), `AmbassadorsListSection.tsx`, `CommissionsSection.tsx` (marcare pagato), `PromoteAmbassadorSection.tsx` (promozione manuale, unico modo — nessun self-upgrade lato storefront)
- **Route API**: `POST /api/admin/ambassador/promote`/`demote`, `GET /api/admin/ambassador/commissions`, `POST /api/admin/ambassador/commissions/[id]/pay`, `POST /api/checkout/ambassador-discount`, `GET/PATCH /api/customers/me/ambassador-profile` — tutte le route admin passano da `requireAdmin(tenantId)`

### 2. Carta fedeltà EAN-13 (accumulo punti in negozio) — `047_loyalty_card_system.sql`

- **Formato**: EAN-13, namespace `21` + `tenants.barcode_prefix` (3 cifre, riusato dal sistema barcode prodotto §16bis) + sequenza tenant-scoped (7 cifre, **contatore dedicato** `loyalty_card_sequence`, indipendente da `barcode_sequence` prodotti) + check digit. Namespace verificato libero via grep sull'intero storico migration + codice applicativo prima di sceglierlo
- **Checksum condiviso ma non invasivo**: l'algoritmo di checksum EAN-13 non esisteva come funzione riusabile (era inline in `next_product_barcode()`, `031`) — estratto in una nuova funzione `ean13_check_digit()`, usata solo dal nuovo `next_loyalty_card_number()`; `next_product_barcode()` resta **byte-per-byte invariata**, non refactorizzata per chiamarla (deviazione esplicita commentata nella migration, per non toccare un sistema già in produzione)
- **Assegnazione automatica**: trigger `assign_customer_loyalty_card_number()` su ogni riga `customers` creata — copre uniformemente ogni percorso (incluso l'upsert OTP signup di `verifyOtp.ts`), a differenza del barcode prodotto che è assegnato da una chiamata esplicita lato applicazione
- **Acquisti in negozio**: nuova tabella `loyalty_manual_purchases` (non ordini finti) → nuovo `transaction_type` `IN_STORE_PURCHASE_EARNED` nel `points_ledger` esistente (riusato, non duplicato) — vincolo XOR aggiunto (`points_ledger_order_xor_manual_purchase`): una riga referenzia un ordine **o** un acquisto manuale, mai entrambi; entrambi-null resta legittimo per `SIGNUP_BONUS`/`REDEEMED`. Funzione atomica `process_manual_purchase_points_atomic()`, stesso pattern di `process_order_points_atomic`
- **Scan in cassa**: `/admin/loyalty/scan` (`ScanClient.tsx`) — scanner USB/Bluetooth (campo di ricerca, si comporta come tastiera, stesso pattern già in uso per il barcode prodotto in `/admin/catalogue`) **più** scan via fotocamera (`CameraScanButton.tsx`, nuova dipendenza `html5-qrcode` in `package.json`). Route `GET /api/admin/loyalty/scan/lookup` (risolve cliente da numero tessera) e `POST /api/admin/loyalty/scan/confirm` (registra l'acquisto, accredita punti)
- **Ruolo `tenant_cashier`**: `admin_users.role` esteso (`admin_users_role_check`), stesso scoping tenant di `tenant_admin` (`tenant_admin_requires_tenant` esteso a includerlo) ma **confinato** a `/admin/loyalty/scan` — verificato in `admin/(protected)/layout.tsx`: se `admin.role === 'tenant_cashier'` → redirect forzato, non renderizza mai il layout condiviso (sidebar/header/dashboard). Nessuna UI di gestione `admin_users` esiste nel codebase (creazione admin resta manuale via Supabase Dashboard, invariato) — verificato non necessario alcun ulteriore restringimento
- **UI cliente** `/compte/carte-fidelite` (`LoyaltyCardClient.tsx`) — QR + barcode lineare a piena scala. **Widget dashboard** `LoyaltyCardWidget.tsx` in `/compte` (sostituisce il banner punti verde precedente): `aspectRatio: '1.586'` (proporzioni tessera fisica reale, verificato nel codice), riusa `renderBarcodeSVG` esistente (nessuna duplicazione), card interamente tappabile verso la pagina completa

### Verifica multi-tenant (v3.20)

`grep` mirato su `oklch(`/nomi brand hardcoded nelle nuove directory (`(shop)/compte`, `components/home`, `admin/(protected)/accueil-slides`, `admin/(protected)/ambassadeurs`, `admin/loyalty`) → **zero risultati**. `pnpm typecheck` pulito sull'intero branch dopo `pnpm install` in questa sessione.

---

## 10. n8n automazioni (self-hosted)

**Infrastruttura:** Hetzner **CX23** (Ubuntu 24.04) · Docker + Docker Compose · Caddy reverse proxy · SSL automatico · URL: `https://n8n.lepefy.com` · IP `46.224.127.99`

### Workflow attivi

| Workflow | Trigger | Azioni |
|---|---|---|
| **Conferma ordine** | POST `n8n.lepefy.com/webhook/order-confirmed` (da webhook Stripe) | Email conferma cliente (Brevo SMTP), Reply-To `chloefood.ets@gmail.com` |
| **Notifica spedizione** | POST `n8n.lepefy.com/webhook/order-shipped` (da admin quando stato → shipped) | Email spedizione con tracking code + link pagina tracking |

**Nota SMTP:** il campo User Brevo corretto è la stringa assegnata `smtp-brevo.com`, non l'email personale di login; porta 587 con SSL disabilitato (non 465).

⚠️ **Fragilità nota:** la conferma ordine dipende da una chiamata n8n fire-and-forget dentro il webhook Stripe — se n8n è irraggiungibile, il cliente non riceve nulla e non esiste retry. Pattern consigliato: tabella outbox (`pending_notifications`) o provider email diretto come fallback.

### Variabili Vercel correlate

```
N8N_WEBHOOK_URL=https://n8n.lepefy.com
N8N_WEBHOOK_SECRET=...
TRACKING_SECRET=...    # Per HMAC token ordini — ora obbligatoria anche per la firma del preventivo spedizione
```

---

## 11. PWA

- `manifest.ts` dinamico per tenant (genera `/manifest.json` al runtime)
- Service worker (`public/sw.js`) con cache strategy
- Banner installazione Android animato — colore `var(--color-secondary)` e nome `tenant.name` (corretti in Fase 1/2.2 dell'audit UI/UX, §12bis: prima erano hardcoded `#F2C811` e `"Chloé Food"` rispettivamente, con un `TODO multi-tenant` esplicito nel codice mai risolto fino ad allora)
- Visibile solo su mobile, scompare dopo installazione
- **Icona PWA dinamica:** route `/api/pwa-icon?size=192` con `sharp` per resize server-side, legge `tenant.logo_url` a runtime (nessun file statico per tenant)
- ✅ **Distinzione maskable/any risolta (v3.21, riportato in chat — 5/08):** `/api/pwa-icon` ha ora un parametro `?purpose=maskable|any`. `maskable` compone il logo al 62% della canvas su sfondo pieno `tenant.primary_color` (nessuna trasparenza — requisito Android per l'icona adattiva); `any` mantiene il comportamento precedente a sfondo trasparente. Pattern preso in prestito dalla route gemella `card/pwa-icon`. Chiude la nota tecnica precedente ("nessuna vera distinzione a runtime").
- ✅ Bug dimensioni icona risolto: la route `/api/pwa-icon` ignorava il parametro `?size=` e serviva sempre lo stesso asset byte-per-byte indipendentemente dalla dimensione richiesta. Causava un fallimento silenzioso dell'installazione PWA su Android (il servizio di minting WebAPK di Google rifiuta il pacchetto se le dimensioni reali dell'icona non combaciano con quelle dichiarate nel manifest) — scoperto durante il debug dello shortcut home screen dedicato a `/card` (vedi §14). Fix: resize reale via `sharp` (`fit: 'contain'`, padding trasparente, output PNG forzato) per qualunque `size` richiesto, verificato con uno smoke test locale (`sharp` produce effettivamente un PNG 192×192 a partire da una sorgente di dimensioni diverse).
- **`PWARegister.tsx` riscritto (v3.21):** da registrazione via `useEffect` a `next/script` inline con `strategy="afterInteractive"`, per correggere un problema di timing con i crawler/tool di audit PWA. `manifest.ts` arricchito con `id`, `categories`, `display_override`, `shortcuts`.
- **Google Play via TWA — ✅ eseguito (v3.21, riportato in chat, 5/08), non tramite Bubblewrap CLI ma PWABuilder** (Robertin non ha ambiente locale): dettaglio completo, incluso lo stato reale del closed testing gate, in §14ter.

---

## 12. Layout app mobile

- **Hero compatto:** logo 44px + testo, sostituisce il vecchio hero centrato a blocco largo
- **Notification bar** (36px) sotto l'header con animazione ticker CSS
- **Banner emozionale (ridisegnato in Fase 3, vedi §12bis):** sfondo a gradiente `var(--color-primary-dark)` → `var(--color-primary)`, pattern decorativo a triangoli ripetuti (SVG, bassa opacità, non più i cerchi piatti verde scuro `#085041` della versione precedente), layout a due colonne su desktop (testo + doppio CTA + trust-row a sinistra, mini-preview di prodotti reali in evidenza a destra) impilato su mobile; eyebrow ora il cartellino signature `ShopTag`; supporta `tenant.hero_image_url` opzionale (quando presente sostituisce pattern+gradiente con l'immagine + overlay scuro)
- **Bottom navigation bar** (4 tab, **icone Tabler**, decisione di piattaforma confermata — un ciclo successivo aveva invertito temporaneamente a emoji, poi ripristinato): Accueil `IconSmartHome` · Catalogue `IconCategory` · Panier `IconShoppingBag` (con badge) · Commandes `IconTruckDelivery`. Hero trust-row e ticker notification bar restano invece a emoji (🚚 ❄️ 🌍 🌿), perimetro invariato rispetto alla nota precedente
- Visibile solo su mobile (`md:hidden`), nascosta nel layout admin
- Homepage: sezioni per categoria restano a scroll orizzontale (stile Netflix/App Store) su decisione di piattaforma confermata; **"Nos produits vedettes" invece dal 26/07 è una vera grid** (`ProductCard variant="grid"`, bottone quick-add rotondo 44px), non più scroll orizzontale — unica sezione toccata, vedi §33
- Card prodotto in evidenza nell'hero (dal 26/07 cliccabili, `Link` verso `/products/[slug]`, prima erano solo preview statiche) — vedi §33
- Ticker/notification bar: sfondo `color-mix(in oklch, var(--color-primary) 55%, black)` (dal 26/07, prima 25% — al 25% leggeva come nero puro, perdendo il legame col brand)
- **Ricerca real-time:** debounce 300ms + `router.replace` (URL params) + `useTransition`, mantenuta nel catalogo completo
- Footer: versione minimale (copyright + "Powered by Lepefy" via `tenants.show_powered_by`) su tutte le pagine tranne la home; **dal 26/07 in home diventa una versione estesa a colonne** (Marque, À propos con "Notre histoire" solo se la sezione origine è visibile, link social da `tenant_social_links`) — deliberatamente non su tutte le pagine, per non competere con la bottom nav fissa su mobile; colonne "Boutique"/"Aide" del mockup originale omesse per mancanza di pagine reali dietro (nessun link a `#` o a pagine vuote), vedi §33; padding `env(safe-area-inset-bottom)` per non sovrapporsi alla bottom nav fissa su mobile

---

## 12bis. Audit e redesign UI/UX storefront (Fase 1–3) — ⚠️ non su `main`, contrariamente a quanto documentato finora

**Stato:** lavoro completo (typecheck verde su tutte le fasi). **Correzione v3.7:** le revisioni precedenti (v3.4–v3.6) affermavano "mergiato su `main` e deployato" tramite un branch dedicato `claude/lepefy-storefront-audit-69xss0`. Verifica diretta contro il repository reale in questa sessione mostra che **quel branch non esiste** (né in locale né su `origin`) e che **`main` non contiene queste modifiche**: `git merge-base main HEAD` coincide con la punta di `main` (ultimo commit 16/07 11:47, precedente a tutto questo lavoro), `ShopTag.tsx` non esiste su `main`, e `BottomNav.tsx` su `main` ha ancora l'hex hardcoded `#1D9E75`. Tutti i commit del redesign risultano invece su questo stesso branch di lavoro condiviso (`claude/update-lepefy-project-context-fke5jo`), insieme al lavoro successivo sull'admin (§8bis) — coerente con il workflow reale di Robertin (upload diretto via GitHub web UI su un unico branch aperto, non PR separate per feature). **Non verificabile da qui se `chloefood.com` deploya effettivamente da `main` o da questo branch** (nessun `vercel.json` nel repo) — da confermare con Robertin prima di considerare questo lavoro live in produzione. Perimetro: solo `apps/storefront`, `apps/admin` (route `src/app/admin/**`) esplicitamente escluso in ogni fase.

Origine: audit strategico dello storefront pubblico (home, catalogo, scheda prodotto, carrello, checkout, tracking ordine), poi implementato in 3 fasi + una passata di allineamento a un mockup di validazione approvato (`Mockup_Fase3_Validazione_UIUX.html`, allegato di sessione, non versionato nel repo).

### Fase 1 — de-hardcoding colori, font reale, accessibilità

- Rimossi gli hex hardcoded (`#1D9E75`/`#F2C811`) in `BottomNav.tsx`, `AddToCartButton.tsx` (poi eliminato in Fase 2.1), `HeroBanner` (`page.tsx`), pagina tracking ordine (`orders/[id]/page.tsx`) — sostituiti con `var(--color-primary)`/`var(--color-secondary)`
- Font **Inter** dichiarato in `tailwind.config.ts` ma mai davvero caricato prima di questa fase — ora caricato via `next/font/google` in `layout.tsx`
- Nuovo token `--color-primary-dark` (`color-mix(in srgb, var(--color-primary) 75%, black)`) — varianti scure derivate senza bisogno di nuove colonne DB
- `:focus-visible` globale coerente (era assente su bottoni/link, solo gli input l'avevano)
- Touch target dei pulsanti quantità/aggiungi portati a 44×44px (WCAG)

### Fase 2.1 — unificazione ProductCard + estensione token

- **Le 3 implementazioni parallele della card prodotto** (`components/catalog/ProductCard.tsx`, più due copie inline in `page.tsx` e `FeaturedProducts.tsx` con `<img>` raw e colori hardcoded) **unificate in una sola**, con prop `variant: 'grid' | 'shelf'`
- `AddToCartButton.tsx` eliminato (era usato solo dalle due copie ora rimosse, zero altri riferimenti)
- Nuovi token: `--color-primary-hover`, `--radius-sm/md/lg/full`, `--shadow-card`, mappati su classi Tailwind (`rounded-sm/md/lg/full`, `shadow-card`) — applicati per allora solo alla ProductCard

### Fase 2.2 — immagini, icone, skeleton, tipografia, pulizia duplicati

- `<img>` raw residue migrate a `next/image` (thumbnail carrello, sfondo hero)
- Emoji di stato (🛒🚚📦✅🏪🔒⏳📍🕐💳📋) sostituite con icone `@tabler/icons-react` (già dipendenza esistente) in tracking ordine, conferma ordine, carrello, checkout
- Skeleton loading (`ProductCardSkeleton` in `ProductGrid.tsx`) al posto del semplice `opacity-60` durante la ricerca catalogo
- Scala tipografica: un solo step aggiuntivo `2xs` (10px) sopra la scala Tailwind di default — i `text-[Npx]` arbitrari sparsi nel codice migrati al riuso di `2xs/xs/sm/xl/2xl`
- **`CategoryFilter.tsx` eliminato** — duplicato mai importato (verificato via grep sugli import); il filtro categorie realmente reso è quello inline in `CatalogClient.tsx`. `src/lib/utils/cn.ts` è rimasto come dipendenza orfana di quel componente eliminato (nessun altro import nel repo) — non rimosso, essendo un helper generico

### Fase 3 — font display, elemento signature, hero editoriale (validati su mockup)

- **Font Bricolage Grotesque** caricato accanto a Inter, nuovi token `--font-body`/`--font-display` in `globals.css`, classe `font-display` applicata a H1 hero, H2 sezioni home, H1 catalogo (rinominato "Catalogue" → "Sélection de la boutique"), wordmark header, testo del cartellino
- **Nuovo componente signature `src/components/ui/ShopTag.tsx`** — il "cartellino da bottega" (clip-path a tag con perforazione dipinta, leggera rotazione), colorato `var(--color-secondary)` — **non** l'oro fisso descritto nel mockup come "dal logo": quel ragionamento è specifico a ChloeFood e non generalizzabile, vedi §2. Applicato su `ProductCard` (etichetta derivata da `storage_type` reale → "Frais"/"Surgelé"/"Épicerie", fallback categoria, mai una stringa fissa uguale per tutti i prodotti) e nell'eyebrow dell'hero (testo rimasto `tenant.tagline`, tenant-driven, non sostituito dal copy fisso del mockup)
- **Hero ridisegnato**: gradiente `primary-dark → primary`, pattern a triangoli via SVG/`<pattern>` (nessuna immagine raster), layout a due colonne su desktop con preview di prodotti reali (featured, non placeholder), impilato su mobile; copy H1/sottotitolo aggiornata, doppio CTA ("Découvrir le catalogue" + "Notre histoire" — quest'ultimo **punta temporaneamente a `/products` per mancanza di una pagina di destinazione reale, marcato `TODO` nel codice**, decisione di prodotto aperta), trust-row a 3 voci
- **Verifica contrasto per il futuro blu `#1267C7`** (calcolata, non stimata): testo bianco su `--color-primary` 5.54:1, su `--color-primary-dark` 8.36:1, testo `--color-primary` su bianco 5.54:1 — tutti ≥ AA. Nota di coerenza dati non bloccante: `tenant.accent_light` (verde menta) non fa parte della migrazione colore e resterebbe visivamente scollegato dal nuovo blu se non aggiornato in parallelo

### Migrazione dati — ✅ eseguita il 17/07

```sql
-- Eseguita manualmente su Supabase il 17/07:
UPDATE tenants SET primary_color = '#1267C7' WHERE slug = 'chloefood';

-- Non ancora eseguita — valutare in roadmap (§19), non bloccante:
-- UPDATE tenants SET accent_light = '#E3EFFB' WHERE slug = 'chloefood';
```

### Fase 4 — localizzazione titolo/descrizione + prodotti correlati semantici (23/07) — ✅ eseguito, confermato da Robertin in chat

Come per gli altri cicli post-audit di questa sezione, lo stato sotto riflette il report di Robertin ("Fatto e tutto ok"), non una verifica indipendente contro git/filesystem come in v3.7.

- **Toggle lingua FR/IT spostato**: non più nell'header globale (`Header.tsx`), ora renderizzato accanto alla descrizione prodotto (`ProductDescription.tsx`). Stesso store Zustand persistito (`localeStore.ts`) di prima — solo il punto di render è cambiato, quindi la preferenza lingua resta condivisa tra titolo e descrizione e sopravvive alla navigazione tra prodotti
- **Titolo prodotto localizzato** (`ProductTitle.tsx`, nuovo componente): usa `products.name_alt` (campo già esistente, finora consumato solo dall'editor etichette admin) quando la lingua attiva ≠ lingua di default del tenant, altrimenti `name`. ⚠️ Limite noto e accettato: `name_alt` è un campo singolo, non jsonb multilingua come `descriptions` — funziona per un tenant a 2 lingue (caso attuale ChloeFood), andrebbe esteso a jsonb per un tenant futuro a 3+ lingue
- **Nuova sezione "Produits similaires"** sotto la scheda prodotto (`RelatedProducts.tsx`, riusa `ProductCard` esistente, variant `shelf`):
  - metodo primario: similarità semantica via la funzione RPC `match_products` (la stessa della ricerca semantica, §13bis), usando l'embedding già calcolato del prodotto corrente come query — **zero chiamate Gemini aggiuntive**
  - repli su categoria (`category_id`) quando il tenant non ha `ai_semantic_search` attivo, il prodotto non ha ancora un embedding, o i risultati semantici non bastano a riempire il limite (8)
  - prodotti esauriti **esclusi del tutto** dal pool dei correlati (non solo deprioritizzati) — su un catalogo di 121 prodotti uno slot sprecato su un prodotto non acquistabile ha un costo reale
  - l'embedding del prodotto (vector(768)) viene recuperato con una query separata e **non transita mai** nel payload React inviato al client, per non appesantire inutilmente l'RSC payload
- File toccati: `Header.tsx` (rimosso toggle), `ProductDescription.tsx` (aggiunto toggle), `ProductTitle.tsx` (nuovo), `RelatedProducts.tsx` (nuovo), `products/[slug]/page.tsx` (query correlati + select `name_alt`/`category_id`), `packages/types/product.ts` (aggiunto `name_alt` all'interfaccia `Product`)
- Punto tecnico che era segnalato come il rischio principale nel prompt di esecuzione: il valore restituito da Supabase per la colonna `embedding` (vector(768)) è stato accettato correttamente come parametro `query_embedding` della RPC `match_products`, nessuna conversione manuale necessaria — confermato su preview
- **Nessuna migrazione DB** — riusa `products.name_alt`, `products.embedding` e `match_products` già esistenti (migration 026 e 028)

### Fase 4bis — PDP: riordino `ProductSpecs` (2/08) — ✅ eseguito, verificato v3.20

Sezione `ProductSpecs` (Poids/Origine/Conservation) spostata da dopo la descrizione a subito dopo il prezzo — confermato in `ProductDetail.tsx` (solo riordino JSX, 2 righe nette). Trattamento colore vivace in `ProductSpecs.tsx` via `color-mix(in srgb, var(--color-primary) ..., white)`, coerente con la convenzione esistente di derivare i colori da `var(--color-primary)` (nessun hex hardcoded, verificato).

### Fase 5 — Redesign home page (hero carousel, category blocks, suggestions) — ✅ eseguito e mergiato nel branch, verificato v3.20

**Correzione v3.20:** in v3.19 questo ciclo era segnalato "eseguito da Robertin, nessun `pnpm typecheck` esplicitamente riportato in chat". Verificato ora direttamente nel codice: `(shop)/page.tsx` importa e monta `HeroCarousel`, `CategoryBlocksRow` (scroll orizzontale, mobile), `CategoryBlocksGrid` (desktop, `hidden md:grid`/`md:hidden` — scelta CSS responsive invece di `matchMedia` in JS, per evitare un flash di layout sbagliato) e due `SuggestionsRow` ("Offre pour vous", "Sélection du moment"), oltre alla `StorySection` già esistente da Fase 3bis (§33). `pnpm typecheck` pulito su tutto il branch in questa sessione (non solo su questo ciclo isolato).

- **Migration `045_tenant_hero_slides.sql`**: tabella `tenant_hero_slides` (RLS attiva), gestita da nuova pagina admin `/admin/accueil-slides` (`HeroSlidesSection.tsx`, CRUD completo) — vedi §4, §8
- **Autoscroll category blocks**: `scrollLeft` + `requestAnimationFrame` (non `transform` CSS, incompatibile con lo scroll nativo simultaneo) — bug reali intercettati e corretti in un ciclo di fix successivo (30/07→2/08): loop JS silenziosamente cancellato, falsi positivi su `prefers-reduced-motion` (ora verificato via `matchMedia` esplicito), `metàLarghezza` letta a `0`/`NaN` prima che le dimensioni DOM fossero disponibili
- Nuovo helper `lib/utils/color.ts` (35 righe) a supporto del carosello — non ulteriormente dettagliato in questa sessione, nessuna violazione multi-tenant trovata al grep
- `ChatWidget.tsx` ha ricevuto un piccolo restyling FAB nello stesso ciclo (4 righe modificate)

### Cosa resta aperto

- **CTA "Notre histoire"** senza destinazione reale (punta a `/products`) — decisione di prodotto spostata in roadmap, §19
- `tenant.accent_light` non aggiornato in coerenza col nuovo blu (non bloccante, vedi §2)
- Copy H1/sottotitolo hero restano stringhe FR fisse uguali per ogni tenant (preesistente, non introdotto né risolto da questo audit)
- Nessun campo prodotto per una vera "origine/provenienza" (usato `storage_type` + `weight_grams` come miglior proxy reale disponibile)
- `name_alt` come campo singolo (non jsonb) limita la localizzazione del titolo a 2 lingue — vedi Fase 4 sopra

---

## 13. Catalogo prodotti (ChloeFood)

**Fonte:** catalogo "ChloeFood_Template_Catalogue_v2" (121 prodotti, 8 categorie: Épices, Légumes, Farines, Poissons, Sauces & Huiles, Snacks, Viandes séchées, Boissons), importato e poi **riseminato idempotentemente** via `020_reseed_products_catalogue_v2.sql`.

Mapping storage: Produits frais → `fresh`, Produits surgelés → `frozen`, tutti gli altri → `dry`.

**Regola stock:** `stock` rappresenta il numero di unità vendibili nell'unità di vendita dichiarata. ⚠️ Nessun controllo/decremento reale al checkout — è solo un cap lato client nel carrello (default 999 se non impostato), problema concreto per fresco/surgelato.

**Generazione immagini AI:** pipeline Gemini a due step — Step 1 `gemini-2.5-flash` genera un prompt fotografico dettagliato; Step 2 `gemini-2.5-flash-image` genera l'immagine. SDK `@google/genai`. Upload su Supabase Storage. Architettura a tre livelli per accuratezza: tabella lookup hardcoded per prodotti critici, generazione Flash-guidata per prodotti semi-noti, template fissi per categoria per prodotti generici.

**Dati etichetta:** `021_update_label_data_batch1.sql` ha popolato in bulk ingredienti/allergeni/nutrizione/paese origine per 22 prodotti da fonte Excel; `022_new_products_from_labels.sql` ha aggiunto prodotti scoperti nei dati etichetta ma assenti dal catalogo v2 (seminati inattivi/prezzo 0).

---

## 13bis. Intelligenza artificiale — Descrizioni, Rate Limiting/Cost Tracking, Ricerca Semantica

Tre feature sviluppate in sequenza (luglio 2026), tutte **✅ completate e in produzione** su ChloeFood, pensate fin dall'inizio come multi-tenant e multi-provider (campo `provider` esplicito su ogni chiamata AI, oggi sempre `'gemini'`, pronto per un futuro secondo provider es. Anthropic).

### Descrizioni prodotto AI multilingue — ✅ completo, batch eseguito su tutto il catalogo

- `products.descriptions` jsonb (`{"fr": "...", "it": "..."}`), chiavi determinate da `tenants.locales` (mai lingue hardcoded nel codice)
- Route `POST /api/admin/generate-product-description`: una chiamata `gemini-2.5-flash` (`responseMimeType: 'application/json'`, `maxOutputTokens: 4096`, `thinkingConfig: { thinkingBudget: 0 }`) genera tutte le lingue del tenant in un colpo solo. Guardrail esplicito nel prompt: mai allergeni, claim nutrizionali/salutistici, origine non fornita — solo descrizione sensoriale/culturale/d'uso. La route non scrive in DB: propone, il salvataggio dal form conferma
- UI in `ProductEditClient.tsx`: due textarea (una per locale), bottone "✨ Générer avec IA", badge `IA` + filtro "Descriptions à revoir" in `CatalogueTable.tsx` quando `description_source = 'ai'`
- Toggle lingua `FR | IT` nello storefront (si nasconde da solo se il tenant è monolingua), store Zustand con persist — **dal 23/07 renderizzato accanto alla descrizione prodotto invece che nell'header globale**, e il titolo prodotto si localizza in coppia con la descrizione via `name_alt`; vedi §12bis Fase 4
- Script batch `scripts/generate-product-descriptions.mjs` + workflow `generate-product-descriptions.yml`: batch completo sui 121 prodotti eseguito con successo

**Bug risolti durante lo sviluppo (lezioni utili per i prossimi script batch AI):**
1. **Risposta Gemini troncata a metà JSON** (`finishReason: MAX_TOKENS`) — causa: `maxOutputTokens` troppo basso (1024) per un modello "thinking" che consuma budget anche per il ragionamento interno prima del testo visibile. Fix: alzato a 4096 + `thinkingBudget: 0` (non serve ragionamento esteso per 2-4 frasi).
2. **Skip filter dei batch non funzionante** — un filtro `SKIP_EXISTING` applicato lato query PostgREST su una colonna jsonb non matchava correttamente (bug reale: query REST su `descriptions='{}'` restituiva 0 prodotti nonostante 107/113 fossero effettivamente vuoti). **Regola ora applicata a tutti gli script batch AI:** filtro skip sempre lato JavaScript dopo il fetch, mai lato query REST su jsonb; logging diagnostico esplicito (totale fetchati vs totale dopo filtro) per diagnosi rapida futura.
3. **Workflow GitHub Actions dimenticato** — lo script `.mjs` era stato creato ma il file `.yml` gemello no. Verificare sempre che entrambi i file esistano dopo un prompt che li prevede entrambi.

### Rate limiting + cost tracking AI — ✅ completo su tutte le route AI

- `ai_pricing`: listino prezzi per `provider`+`model`, configurabile via SQL (seed iniziale: `gemini-2.5-flash` $0.30/$2.50 per milione token, `gemini-2.5-flash-image` stesso + $0.039/immagine, `gemini-embedding-001` $0.15/milione token — verificare aggiornamento se i prezzi Google cambiano)
- `ai_usage_log`: una riga per chiamata AI, con token/immagini/costo stimato/`status`. Vista `ai_usage_monthly_by_tenant` per il riepilogo mensile
- Funzione SQL `check_ai_rate_limit` + helper `apps/storefront/src/lib/ai/usageTracking.ts` (`checkRateLimit`/`logAiUsage`), applicati a: `generate-product-image`, `generate-product-description` (route admin, limite giornaliero come rete di sicurezza contro loop/bug) e `search-semantic` (route pubblica, limite al minuto + giornaliero — è l'endpoint più esposto, nessuna sessione admin di mezzo)
- Limiti configurabili per tenant: `tenants.ai_rate_limit_public_per_minute` (default 20), `ai_rate_limit_public_per_day` (default 500), `ai_rate_limit_admin_per_day` (default 200)
- **Lezione applicata:** in caso di errore/JSON troncato, i token vanno letti da `usageMetadata` PRIMA del tentativo di parsing (la risposta HTTP è comunque arrivata) — altrimenti le righe di log con `status='error'` risultano con token/costo a zero/NULL, perdendo visibilità proprio sui casi che tendono a consumare più output token
- **Gap noto colmato:** il rate limiting/cost tracking era stato applicato inizialmente solo alle route Next.js (`route.ts`); gli script batch `.mjs` (standalone, REST diretto, non possono importare l'helper TS) necessitano di una funzione `logAiUsage` locale duplicata in ciascuno script — applicato retroattivamente a tutti e tre gli script batch AI
- Pannello "Utilisation IA" in `/admin/billing`: tabella provider/endpoint/chiamate/costo mensile

### Ricerca semantica catalogo — ✅ completo, batch eseguito su tutto il catalogo

- `products.embedding` vector(768), modello **`gemini-embedding-001`** (⚠️ non `text-embedding-004`, dismesso dal provider il 14/01/2026)
- Indice HNSW cosine, funzione SQL `match_products(query_embedding, p_tenant_id, match_count, min_similarity)` — filtro `tenant_id` + `active` sempre dentro la funzione, mai delegato al client
- Sync automatico dell'embedding al salvataggio prodotto (best-effort, un fallimento non blocca il salvataggio), testo embeddato = nome + categoria + tutte le `descriptions` disponibili (multilingue, un vettore unico cross-lingua)
- Route pubblica `GET /api/search/semantic`: rate limit applicato PRIMA della chiamata embedding (vedi sopra); se bloccata o fallita, degradazione silenziosa — il cliente non vede mai un errore di rate limit
- **Ricerca ibrida a cascata** in `CatalogClient.tsx`: la ricerca testuale `ilike` esistente resta invariata e parte per prima; solo se restituisce meno di 3 risultati scatta la chiamata semantica, mostrata sotto un'intestazione "Résultats similaires" — risolve casi come "fufu" che non matcha testualmente "Farine de manioc" ma è semanticamente vicino
- Script batch `scripts/generate-product-embeddings.mjs` + workflow `generate-product-embeddings.yml`: batch completo sui 121 prodotti eseguito con successo (stesse fix preventive su skip-filter/logging del punto precedente, applicate fin dall'inizio)
- **Dal 23/07, `match_products` è riusata anche per i "Produits similaires"** nella scheda prodotto (`query_embedding` = embedding del prodotto corrente invece che di una ricerca testuale utente) — zero chiamate Gemini aggiuntive, vedi §12bis Fase 4
- **Stesso giorno, riusata anche dal chatbox pubblico** (`POST /api/chat`) — terzo consumatore della stessa funzione RPC, questa volta con `query_embedding` = embedding del messaggio utente; stesso principio "zero infrastruttura AI nuova, solo nuova composizione" — vedi §13ter

### Costi AI — ordine di grandezza verificato

Batch descrizioni completo (121 prodotti × 2 lingue): sotto $1. Batch embeddings completo: sotto $0.01. Pipeline immagini prodotto (già in produzione prima di queste feature): ~$0.04/prodotto, ~$5 per batch completo — resta la voce di costo AI più alta. Ricerca semantica a runtime: query cliente ~$0.00003 ciascuna, irrilevante anche a volumi alti. Tutto ampiamente dentro il margine dei 89€/mese per tenant.

### Idea futura non implementata — Query embedding cache

Tabella `ai_query_embedding_cache` (query normalizzata lowercase/trim + locale come chiave, vector(768), `hit_count`, `last_used_at`), condivisa a livello **piattaforma** (non per-tenant — l'embedding del testo non dipende dal tenant). Lookup prima di chiamare Gemini in `/api/search/semantic`: hit → riusa il vettore salvato, zero chiamate Gemini; miss → chiama Gemini come oggi e salva in cache. Nessun TTL prospettato (query catalogo food stabili nel tempo). Da valutare dopo aver osservato l'uso reale della ricerca semantica per capire quali query si ripetono davvero — non implementata, salvata per quando ci sarà volume sufficiente da giustificarla.

---

## 13ter. Chatbox IA pubblica (fasi 1+2) — ✅ codice scritto e verificato (typecheck), gating attivo su `ai_chatbox_enabled`

**Stato:** implementata in due prompt consecutivi nella stessa sessione (23/07), **scritta e verificata direttamente in questa sessione** (non solo riportata in chat come alcuni cicli precedenti) — `pnpm typecheck` verde dopo ciascuna fase. **Confermato via `git diff HEAD origin/main` che il codice è già su `main`**: Robertin ha applicato entrambi gli zip di consegna direttamente via GitHub web UI (stesso workflow abituale, coerente con §20). **Migration 032+033 confermate eseguite su Supabase da Robertin in chat (24/07)** — non riverificato indipendentemente contro il DB reale da questa sessione (nessuna credenziale Supabase nell'ambiente di sviluppo), ma `tenants.ai_chatbox_enabled`/`chatbox_extra_context` e la tabella `tenant_knowledge_base` dovrebbero ora esistere nel DB reale. Nessun tenant ha il chatbox abilitato di default (`ai_chatbox_enabled = false`), richiede un `UPDATE` manuale — vedi §18.

Obiettivo dichiarato: rispondere a domande su catalogo, disponibilità, prezzo, descrizione generale e info negozio (orari, zone di consegna, politiche) riusando l'infrastruttura AI già in produzione (ricerca semantica, rate limiting, cost tracking) — **zero nuova infrastruttura AI**, solo nuova composizione di quella esistente.

### Perimetro escluso deliberatamente (decisione di prodotto, non un limite tecnico)

Il bot **non risponde mai** ad allergeni, ingredienti, valori nutrizionali, lotto, origine legale — redirect standard verso WhatsApp. Motivo: `match_products` non espone questi campi e alcuni dati etichetta nel catalogo reale sono noti come incompleti/da verificare (vedi §16, nota Bobolo/Foufou) — nessun canale AI deve poterli citare finché non confermati dal produttore. Stessa filosofia già applicata al sistema etichette (§16): l'IA recupera e fraseggia, non inventa fatti su dati sensibili. Guardrail scritto esplicitamente nel system prompt (`buildSystemPrompt`), non solo nella descrizione del prompt di consegna.

### Fase 1 — widget + ricerca semantica prodotti

- **Migration `032_ai_chatbox.sql`** (rinumerata da `029` per collisione, vedi §4): `tenants.ai_chatbox_enabled` (default `false`) + `tenants.chatbox_extra_context` (testo libero admin — orari, zone di consegna, politiche di reso — **mai generato o modificato dall'IA**, solo scritto a mano)
- `POST /api/chat`: gated su `tenant.ai_chatbox_enabled` (404 se disattivo) → `checkRateLimit`/`logAiUsage` riusati identici a `search-semantic` (stesso endpoint pattern, `isPublic: true`) → `embedText(message)` → `match_products` (stessa funzione RPC della ricerca semantica e dei prodotti correlati, §12bis Fase 4 — terzo riuso dello stesso embedding/funzione) → `gemini-2.5-flash` con system prompt costruito da `buildSystemPrompt()` (`lib/ai/chatbox.ts`)
- `buildSystemPrompt()`: lista prodotti matchati (nome/categoria/prezzo/stock/peso) + `chatbox_extra_context` + istruzione esplicita di redirect WhatsApp fuori perimetro — mai lingua/nome/colore tenant hardcoded, tutto da `getTenant()`
- `ChatWidget.tsx`: bottone flottante rotondo (`fixed bottom-[84px] right-4 md:bottom-6`, sopra `BottomNav` mobile), pannello con header/messaggi/input, stato conversazione **solo React state** (nessuna persistenza, nessuna scrittura DB lato client), cap 6 turni di history inviati ad ogni chiamata. Su 429/502/errore rete: messaggio di fallback + link `wa.me/{numero}` (nascosto se `whatsapp_number` è `null`)
- Montato una sola volta in `(shop)/layout.tsx`, dopo `<BottomNav />` — non tocca `/admin`

### Fase 2 — filtro small-talk, knowledge base culturale, admin insert

- **`lib/ai/smallTalk.ts`** (`matchSmallTalk`): intercetta saluti/ringraziamenti (regex FR/IT/EN generiche, **non tenant-specifiche** — placeholder in attesa di frasi autentiche di Dalice) **prima** di `checkRateLimit`/embedding/Gemini — bypassa completamente la pipeline AI, **zero riga in `ai_usage_log`** per questi messaggi, costo realmente zero non solo "basso"
- **Migration `033_ai_chatbox_knowledge_base.sql`** (rinumerata da `030` per collisione, vedi §4): tabella `tenant_knowledge_base` + funzione `match_knowledge_base` (stesso pattern esatto di `match_products`: filtro `tenant_id`+`active` dentro la funzione, mai delegato al client)
- **Principio non negoziabile:** il contenuto di `tenant_knowledge_base.content` è sempre scritto da un umano (Dalice/Robertin) — l'IA lo recupera via similarità semantica e lo usa come riferimento di stile/fatti, **mai lo genera**. Stessa filosofia del perimetro escluso sopra e delle etichette (§16): dati sensibili/culturali sempre a conferma umana
- Admin: `POST /api/admin/knowledge-base` calcola l'embedding via `embedText()` esistente (stesso helper della ricerca semantica) e salva `reviewed_by` = email admin corrente (letta con una query cookie separata da `requireAdmin()`, che non la espone) + `reviewed_at = now()`; `DELETE .../[id]` filtra sempre per `id` **e** `tenant_id`. Nuova pagina `/admin/ai-lab` (stesso layout/sidebar protetta esistente, form + tabella, nessun editing inline — si elimina e si reinserisce)
- Wiring nel chatbox pubblico: `match_knowledge_base` riusa lo **stesso vector già calcolato** per `match_products` nella stessa richiesta (nessun secondo embedding), risultati iniettati nel system prompt sotto una sezione "esempi autentici di tono" con istruzione esplicita di non recitarli parola per parola salvo corrispondenza esatta; **degradazione silenziosa** se la RPC fallisce (`?? []`), non blocca mai la risposta del chatbox
- Tabella parte vuota di proposito — nessun contenuto reale nel seed SQL, il popolamento arriva dall'admin dopo la raccolta con Dalice

### File toccati/aggiunti (riepilogo)

`lib/ai/chatbox.ts` (nuovo, poi esteso in fase 2 con `KnowledgeSnippet`), `lib/ai/smallTalk.ts` (nuovo), `api/chat/route.ts` (nuovo, poi esteso), `components/chat/ChatWidget.tsx` (nuovo), `(shop)/layout.tsx` (mount widget), `api/admin/knowledge-base/route.ts` + `[id]/route.ts` (nuovi), `admin/(protected)/ai-lab/page.tsx` + `KnowledgeBaseClient.tsx` (nuovi), `admin/_components/AdminSidebar.tsx` (voce nav aggiunta — non richiesta esplicitamente dal prompt, aggiunta per rendere la pagina raggiungibile), `packages/types/tenant.ts` (`ai_chatbox_enabled`/`chatbox_extra_context`), `packages/types/ai.ts` (`KnowledgeBaseEntry`/`KnowledgeBaseCategory`, stesso pattern di `SemanticMatch`)

### Cosa resta aperto

- **Migration 032 e 033 confermate eseguite su Supabase** (24/07, riportato da Robertin in chat) — non riverificato indipendentemente contro il DB reale da questa sessione; se qualcosa non torna (404 su `/api/chat`, errore su `/admin/ai-lab`), primo sospetto è comunque una migration non applicata correttamente
- **`chatbox_extra_context` ChloeFood non ancora popolato** — bozza di testo preparata in chat (orari Click&Collect, indirizzo, paesi consegna, soglia spedizione gratuita), **in attesa di conferma dati reali** (email/telefono professionale erano placeholder nel foglio Excel origine, paesi consegna da riconfermare contro `shipping_vat_rates` attuale) prima di eseguire l'`UPDATE`. Nota di design: questo campo duplica parzialmente `tenants.click_collect_hours` (già esistente, migration 009) — unificazione salvata come idea roadmap P3, vedi §19
- **Nessun tenant ha il chatbox attivo** — richiede `UPDATE tenants SET ai_chatbox_enabled = true WHERE slug = 'chloefood';`, non ancora eseguito
- **Knowledge base vuota** — zero voci finché Dalice non fornisce contenuto reale da inserire via `/admin/ai-lab`; fino ad allora il chatbox risponde solo su prodotti/info negozio, senza gli "esempi autentici di tono". Questionario di raccolta contenuto per Dalice (ricette, modo di salutare, domande frequenti, contesto culturale) già preparato in chat, non ancora girato/raccolto. Regola operativa stabilita: **una voce = un concetto** (una ricetta per voce, non un blocco con più ricette insieme), eccetto la categoria `greeting` dove più esempi di stile in una voce unica sono accettabili perché non devono rispondere a una domanda specifica
- **Filtro small-talk**: intercetta solo pattern rigidi (regex su frasi esatte tipo "salut"/"bonjour") — formulazioni diverse o in altre lingue non intercettate finiscono comunque nella pipeline AI completa senza rompersi (Gemini le gestisce comunque), solo con un costo leggermente più alto; non è un difetto bloccante, il filtro è un'ottimizzazione di costo non un requisito di correttezza
- Placeholder small-talk generici (non le frasi reali di Dalice) — da promuovere eventualmente a voci `tenant_knowledge_base` categoria `greeting` in futuro, come segnalato nel commento del file stesso e in roadmap §19
- Nessun test end-to-end su preview Vercel autenticata in questa sessione (stesso limite ambientale di molti cicli precedenti, vedi §8bis/§12bis) — in particolare il punto segnalato come più a rischio nel prompt originale (formato del valore `embedding` restituito da Supabase, stringa vs array, quando letto per i prodotti correlati) è stato gestito con una normalizzazione difensiva in `products/[slug]/page.tsx` (§12bis Fase 4), non nel chatbox stesso (che chiama sempre `embedText()` fresco, non rilegge mai un embedding già salvato dal DB)

---

## 14. Biglietto da visita digitale

- Route `/card` (`chloefood.com/card`) — landing con link social (Instagram, Facebook, TikTok da `tenant_social_links`), dati boutique
- QR code dinamico via `/api/card/qr-code` con overlay logo nel colore brand del tenant (libreria `qrcode`, errorCorrectionLevel 'H')
- Download vCard via `/api/card/vcard`
- QR scaricabile da `/admin/parametres`
- Architettura rigorosamente multi-tenant: nessun colore/URL/telefono/piattaforma social hardcoded, tutto da `tenants` + `tenant_social_links`
- Pricing concordato con Dalice: 100 € totali per landing page + biglietto digitale + QR (stampa fisica esclusa)
- **`tenants.storefront_ready`** (migration `031_storefront_ready.sql`, scoperta e documentata solo in questa revisione — vedi §4): boolean default `true`. Se `false`, il blocco "Voir nos produits" su `/card` mostra un messaggio "boutique bientôt disponible" invece del link a `/` — pensato per pubblicare biglietto digitale e QR prima che il catalogo e-commerce sia pronto al pubblico. Nessuna UI admin trovata per questo campo, presumibilmente ancora SQL-only

**Metodi di pagamento (nuovo):** tabella `tenant_payment_methods` (migration 030) — `satispay` / `bank_transfer` / `cash` / `paypal` / `other`, con `label`/`value`/`extra` (jsonb, per `beneficiary`/`bic` sul bonifico), CRUD completo in `/admin/parametres` (`PaymentMethodsSection.tsx` + `api/admin/payment-methods/`). Sezione "Comment payer" mostrata su `/card` subito dopo il toggle lingua, prima del bottone WhatsApp — priorità deliberata: è il motivo principale per cui un cliente scansiona il poster in negozio. Solo icona + etichetta, mai i valori sul poster stampato (vedi sotto) — così i dati sensibili restano dietro al QR e un cambio di IBAN non richiede ristampa. ⚠️ ChloeFood ha ancora dati placeholder attivi (IBAN fittizio, `paypal.me/CHANGEME`) — non condividere `/card` né stampare il poster prima della sostituzione con i dati reali di Dalice.

**Link di pagamento diretto (nuovo, 2/08 — ✅ eseguito, verificato v3.20):** nuova chiave `link` nella colonna `extra jsonb` già esistente (nessuna migration). In `DigitalCard.tsx`, `pm.extra.link` viene mostrato come link cliccabile sopra il valore principale del metodo di pagamento (es. PayPal: link + email copiabile insieme). Verificato nel codice: l'IBAN (`bank_transfer`) resta sempre mostrato per intero via `CopyableValue` (`displayValue={pm.value}`, mai troncato/mascherato) — coerente con la correzione fatta in sessione sul mockup originario (che lo mostrava mascherato per errore).

**Réseaux sociaux — ora autogestibili:** `tenant_social_links` (migration 017) esisteva da tempo ma senza alcuna UI/API admin — scoperto durante questo ciclo. Aggiunto CRUD mirror del pattern payment-methods (`SocialLinksSection.tsx` + `api/admin/social-links/`), upsert su `unique(tenant_id, platform)` invece di blocco lato UI (edge case noto: cambiare la piattaforma di un link esistente verso una già in uso sovrascrive silenziosamente, nessuna conferma richiesta — rischio giudicato accettabile, dato recuperabile).

**Loghi social e pagamento a colori:** `SOCIAL_PLATFORM_REGISTRY` (`packages/types/socialLinks.ts`) esteso con `badgeBackground` per piattaforma (Instagram gradiente ufficiale, Facebook `#1877F2`, TikTok nero, YouTube `#FF0000`, LinkedIn `#0A66C2`, X nero) — badge circolari colorati sostituiscono i precedenti cerchi grigi uniformi, sia su `/card` sia sul poster. Stessa logica per i metodi di pagamento (PayPal `#003087`, contanti verde, Satispay coral, bonifico/altro nel colore primario del tenant) — colori a livello piattaforma, mai tenant-specific salvo il caso bonifico/altro.

**Poster stampabile A5 (nuovo):** `/api/admin/card/poster`, riusa `lib/labels/gotenberg.ts` (stesso Gotenberg già in produzione per le etichette, nessuna nuova infrastruttura). Template dedicato (`lib/card/PosterTemplate.tsx` + `buildPosterHtml.ts`), formato 148×210mm, QR a 70mm (sorgente PNG richiesto a `size=900` per qualità di stampa), righe metodi di pagamento e social sotto il QR, indirizzo/orari in fondo. Bottone di download in `/admin/parametres`, sezione "Carte digitale". Bug noto e sistemato durante lo sviluppo: overflow verticale del contenuto oltre i 210mm generava una pagina PDF extra vuota — fix scritto in `buildPosterHtml.ts` (contenimento esplicito `overflow: hidden` su `html`/`body`, non solo su `.poster`, più `page-break-after: avoid`), verifica manuale delle altezze dichiarate conferma ~197mm su 210mm disponibili — **fix scritto, verifica live sul PDF reale in sospeso**, nessuna conferma diretta oltre il calcolo manuale e i vincoli CSS.

**Shortcut home screen dedicato a `/card` (nuovo):** manifest separato da quello del negozio (`/api/card/manifest`, `scope`/`start_url: '/card'`, riusa le icone di `/api/pwa-icon`), collegato via `metadata.manifest` in `card/page.tsx` — override del manifest root per la sola route `/card`, comportamento atteso della Metadata API Next.js per campi stringa semplici ma **mai verificato contro l'HTML renderizzato reale** in questo ambiente di sviluppo (nessuna credenziale Supabase disponibile per completare un build/dev locale) — resta il sospetto più concreto, insieme al fix icone sopra, per un problema di installazione Android segnalato ma non ancora chiuso. Componente `AddToHomeScreen.tsx`, banner animato in stile identico a `PWABanner.tsx` (slide-down + pulse), sospeso automaticamente su `/card` perché `PWABanner` vive solo dentro `(shop)/layout.tsx` e `/card` non ne fa parte — nessun conflitto tra i due banner, verificato leggendo la route structure, non serve guard esplicito. Su iOS nessuna azione programmatica possibile (limite piattaforma, non del progetto): solo istruzione testuale "Partager → Sur l'écran d'accueil".

---

## 14bis. Auto-gestione impostazioni tenant (Paramètres)

Prima di questo ciclo, `tagline`, `whatsapp_number`, `click_collect_address`, `click_collect_hours`, `legal_name`, `legal_address`, `legal_email` erano modificabili solo via SQL diretto su Supabase. **`click_collect_hours_it`** (migration `034_click_collect_hours_it.sql`, versione italiana del campo, indipendente dal francese) si è aggiunto successivamente alla stessa whitelist/UI — non documentato nelle revisioni precedenti di questo paragrafo, corretto in questa revisione (vedi §4). Aggiunta route generica `PATCH /api/admin/tenant` con whitelist esplicita (`EDITABLE_TENANT_FIELDS`, costruita via `reduce` — qualunque chiave fuori whitelist viene scartata in silenzio, mai propagata all'update) per impedire che un payload malformato tocchi campi platform-level (`primary_color`, `stripe_account_id`, `shipping_provider`, flag AI, ecc.). Due sezioni UI in `/admin/parametres` che condividono lo stesso endpoint: Infos boutique (i primi 4 campi) e Données légales (gli ultimi 3, usati dal sistema etichette — nota informativa nel form: le modifiche finiscono sulle etichette stampate). `legal_website` deliberatamente escluso dalla whitelist e dalla UI, resta SQL-only. Ordine finale sezioni in Paramètres: Infos boutique → Réseaux sociaux → Moyens de paiement → Données légales → QR code / poster.

**Debito tecnico aperto da questo ciclo:**

- Logging verboso temporaneo su `POST`/`PATCH` `/api/admin/payment-methods` (introdotto per diagnosticare l'errore 500 dei permessi service_role, include `raw: err` nella risposta) — da rimuovere prima che l'app sia in mano stabile a Dalice, espone dettagli interni dell'errore a chi ha accesso all'endpoint admin.
- Pattern GRANT mancante confermato due volte: sia `tenant_social_links` (migration 017) sia `tenant_payment_methods` (migration 030) sono state scritte con solo `grant select ... to anon, authenticated`, senza `grant insert/update/delete ... to service_role` — verificato nel codice contro il pattern già stabilito altrove nel repo (migrations 018, 026, 027 concedono esplicitamente a `service_role`). La regola "RLS non basta" era già documentata (§4) ma non applicata in modo sistematico su queste due tabelle; è anche un sospetto concreto, mai confermato, per il 500 diagnosticato sopra sul salvataggio dei metodi di pagamento. Ogni nuova migration con tabella scritta da `service_role` deve includere i GRANT espliciti nello stesso file, non come fix successivo.

---

## 14ter. Pubblicazione Google Play Store (TWA) + smart-link QR negozio (5–6/08/2026) — riportato in chat, non riverificato contro filesystem/git in questa sessione

⚠️ A differenza di §9ter/§38 (verifica diretta `git`/filesystem), quanto segue è ricostruito **solo dalle chat** — nessuna sessione ha ancora eseguito `git log`/`pnpm typecheck` su questi due cicli. Da riverificare alla prossima passata di coerenza.

### a) Pubblicazione Play Store via TWA (Trusted Web Activity) — 5/08

Percorso completo pianificazione → infrastruttura → packaging → Play Console, eseguito interamente via PWABuilder (pwabuilder.com) invece di Bubblewrap CLI, per coerenza col workflow di Robertin (nessun ambiente locale, solo GitHub web UI + Vercel).

**Infrastruttura (migration `048`, vedi §4):** `tenants.android_package_name`/`android_sha256_fingerprint` + route dinamica `/.well-known/assetlinks.json` (App Router, `force-dynamic`, legge dati tenant invece di servire un file statico — scelta multi-tenant esplicita, coerente col principio §5). `packages/types/tenant.ts` esteso con i due campi.

**Hardening PWA propedeutico:** vedi §11 (`PWARegister.tsx` → `next/script`, `manifest.ts` arricchito, distinzione icona maskable/any).

**Pagina legale nuova:** `/politique-confidentialite` (FR), dinamica per tenant via `legal_name`/`legal_address`/`legal_email`, copre tutti i sub-processor reali (Supabase, Stripe, Satispay, Packlink, Brevo, Google AI, Lepefy Labs) — requisito Play Console per la scheda store. Link aggiunto in footer.

**Packaging:** Package ID scelto `com.lepefy.chloefood.twa` (namespace di piattaforma, scalabile ai tenant futuri) invece del default auto-generato da PWABuilder (`com.chloefood.shop.twa`) — decisione esplicita per non legare l'identificativo Android al singolo tenant. Un primo zip scartato perché il cambio di Package ID non era stato salvato prima del download. Chiave di firma generata da PWABuilder stesso.

**Scoperta tecnica rilevante:** Google Play usa ora firma "hybrid quantum-ready", che produce **3 certificati distinti** (`deployment_cert.der`, `hybrid_classical_cert.der`, `hybrid_pqc_cert.der`) con 3 SHA-256 fingerprint diversi — **tutti e tre** devono comparire in `assetlinks.json`, non solo uno. La route `/.well-known/assetlinks.json` è stata aggiornata per splittare una stringa comma-separated dalla colonna DB in un array (da cui `android_sha256_fingerprint` come stringa, non colonna singola — vedi §4). Popolati via SQL update tutti e tre i fingerprint. Dopo reinstallazione, la TWA si apre a schermo intero senza barra URL Chrome — **successo end-to-end confermato**.

**Stato reale del closed testing gate (punto critico):** app attualmente su track **Internal Testing con 2 tester**. Il **Closed Testing (12 tester attivi, 14 giorni consecutivi)** — il vincolo già individuato in fase di pianificazione (v3.19/v3.20 §37, confermato: account Play Console personale, non Organization) — **non è ancora stato avviato**. Resta l'unico blocco residuo prima della produzione pubblica.

**Regola permanente stabilita (ribadita 3 volte in sessione):** **mai eseguire `pnpm lint`** nei prompt Claude Code su questo repo. Il primo avvio di `next lint` innesca una configurazione ESLint interattiva che **riscrive silenziosamente `tsconfig.json`** come effetto collaterale (stesso sintomo già osservato e scartato in v3.20 §38, ora capito essere sistematico e non un incidente isolato). Solo `pnpm typecheck` è il passo di verifica standard.

### b) Smart-link QR negozio (`/go`) — 6/08

Secondo QR code, distinto dal QR del biglietto digitale (§14) e dal QR della carta fedeltà (§9ter): pensato per l'evento comunitario del **15 agosto**, indirizza i clienti alla boutique e — quando l'app sarà pubblica — all'app Android.

**Route `/go`:** legge `tenant.android_package_name` e il nuovo flag `tenants.android_public` (migration `049`, boolean, default `false` — vedi §4), per **evitare di mandare i clienti su una scheda Play Store non ancora accessibile** durante il closed testing (a differenza dell'Internal Testing, la scheda pubblica del Play Store per un'app non ancora pubblica reindirizza a un errore, non a una pagina "coming soon").

**QR encoding:** `shop.chloefood.com/go?t={tenant.slug}&src=qr_shop`, costruito con `NEXT_PUBLIC_APP_URL` come dominio canonico — **bug corretto in sessione**: la prima versione usava `req.nextUrl.origin`, che in alcuni contesti serverless risolveva a `chloefood.vercel.app` invece del dominio custom, rompendo lo scan.

**Design (dopo due cicli di iterazione, entrambi scartati prima di arrivare alla versione approvata):** overlay opaco sopra il QR scartato (blocca i moduli, illeggibile); testo trasparente sovrapposto scartato (rumore visivo che rompe il contrasto richiesto dallo scanner). Versione approvata: nome tenant, caption ("Découvrez notre boutique en ligne") e riga di compatibilità ("Compatible Android & iPhone" con icona smartphone generica — **deliberatamente non i badge ufficiali store**, dato che l'app non è ancora pubblica) come testo **sotto** il QR, moduli del QR code lasciati completamente intatti.

**Bug di produzione scoperto e corretto:** i tag SVG `<text>` renderizzano come riquadri vuoti (tofu box, □) sulle funzioni serverless Vercel, che non hanno font di sistema installati. Fix: sostituita la pipeline di rendering testo con **satori** (albero JSX → path vettoriali, usando un font WOFF incluso nel bundle) + **`@resvg/resvg-js`** per la rasterizzazione PNG — stessa infrastruttura usata internamente da `next/og`, **zero dipendenza da font di sistema a runtime**. Verificato con caratteri accentati ("Chloé Food", "Épicerie").

**Debito noto, esplicitamente fuori scope in questo ciclo:** `overlayLogo()` ha un bug preesistente (viewBox espresso in module-units invece che in coordinate pixel, rende il logo invisibile) che affligge **sia** la route QR di `/card` **sia** la nuova route QR shop — identificato ma non corretto, lasciato per un ciclo dedicato.

**Comunicazione a Dalice:** due messaggi WhatsApp bozzati — uno sul nuovo QR shop e i suoi limiti attuali di accesso app, uno sulla possibilità per i clienti di creare un account durante l'evento del 15 agosto (sì, via OTP email, con nota su possibile latenza su connessioni deboli) chiedendo a Dalice di testare lei stessa il flusso di iscrizione prima dell'evento.

**Stato: entrambi i cicli riportati come eseguiti in chat con dettaglio tecnico approfondito (inclusa la scoperta e correzione di bug reali), ma senza `pnpm typecheck` esplicitamente riportato in questa sessione né verifica diretta contro `git`/filesystem — stesso livello di affidabilità di v3.19 prima della verifica v3.20. Da riverificare alla prossima passata di coerenza.**

---

## 15. Landing page pre-lancio (`chloefood.com`)

Pagina statica trilingue (FR/IT/EN) pubblicata mentre l'e-commerce completo attende le foto prodotto dalla cliente. Contenuti: hero con logo, statistiche (120+ prodotti, 7+ paesi, 4 categorie, spedizione 48h), testimonianze placeholder, percorso prodotto narrativo (4 step), griglia categorie (8 voci), sezione USP, info boutique con orari, CTA finale. Pulsante WhatsApp flottante (numero 393296958822) con messaggio pre-compilato per lingua, icona SVG ufficiale WhatsApp. Riferimenti Packlink rimossi su richiesta cliente, sostituiti con Poste Italiane/BRT/FedEx/TNT. "ETS" rimosso da tutte le occorrenze del nome brand → solo "Chloé Food". Testi generalizzati da "camerunese" a "africano" in tutte e tre le lingue.

**Nuovo logo (in valutazione):** versione JPEG completa integrata nell'hero, versione icona usata per favicon/PWA icon; colore hero portato a blu `#1267C7` in linea con la brand charter v2 — nessuna occorrenza di questo blu altrove nel codice, vedi conflitto colore in §2.

---

## 16. Sistema etichette prodotto — ✅ FUNZIONALMENTE MATURO (non più "in sviluppo base")

Sistema per generare e stampare etichette prodotto (formato tipografico, non browser print). **Verificato nel codice (13/07): l'implementazione è molto più avanzata di quanto documentato in precedenza** — multi-template, multi-palette, stile origine configurabile, workflow draft/ristampa completo.

### Architettura reale

- **Modello legale a tre livelli:** produttore → importatore → distributore/tenant (tabelle `producers`, `importers`), dati produttore a livello prodotto
- **Output:** PDF per tipografo, layout N-up su A4 (dimensione etichetta configurabile), generato da `lib/labels/gotenberg.ts` → `htmlToPdf()` chiama realmente `${GOTENBERG_URL}/forms/chromium/convert/html`
- **Tre template** (`templates/`, selezionabili in `LabelJobEditorClient.tsx`): `default.tsx` ("Classico", due colonne, stile origine implementato), `fullbleed.tsx` (sfondo a piena pagina — ⚠️ lo stile bandiera/origine **non** è implementato qui, solo testo semplice "Origine: ..."; vedi §16bis per i fix layout recenti: QR aggiunto, barcode ripristinato in verticale, shrink-to-fit, tabella nutrizionale a due colonne) e `banner.tsx` ("Fascia Dorata" — fascia logo a tutta larghezza, nutrizione a sinistra/nome al centro/foto a destra, stile origine implementato come in `default.tsx`)
- **Tre palette colore** (`lib/labels/palettes.ts`): `verde_palma`, `blu_epices` (default), `terra_piccante` — ciascuna con primary/secondary/accent/ambient + helper per sfondi sfumati e strip decorativo "kente"
- **Bandiere origine disegnate a mano** (`originFlags.tsx`, SVG per 9 paesi: Camerun, Senegal, Ghana, Nigeria, Costa d'Avorio, Mali, Guinea, Ciad, Etiopia) — scelta deliberata al posto delle emoji per evitare problemi di rendering colore-font in Chromium headless (Gotenberg)
- **Stile origine configurabile:** `pill` / `block` / `medallion` (`origin_style`, migration 025)
- **Badge "100% Naturale"** (`natural_badge`) indipendente per singola stampa
- **Sfondo personalizzabile** per categoria con override per singolo prodotto (immagine preferita, colore come fallback via `resolveBackground.ts`)
- **Workflow draft → generato → ristampa:** ogni job nasce `draft` (editabile, autosave via PATCH), diventa `generated` dopo la chiamata Gotenberg riuscita (immutabile), e può essere duplicato (`duplicated_from_id`) per una ristampa che esclude lotto/date di produzione dal clone

### Route reali (correggono versioni precedenti della documentazione)

- Admin: `/admin/products/[id]/etichetta` (lista job) e `/admin/products/[id]/etichetta/[jobId]` (editor draft — template/palette/origin-style/sezioni, lotto/date/quantità, preview live debounced, autosave debounced, bottone "Générer le PDF"; se il job non è più `draft` la pagina redirige alla lista con `?msg=already_generated`)
- API: `/api/admin/labels/preview` (solo HTML, no Gotenberg — per iframe live), `/api/admin/labels/generate` (Gotenberg + upload Storage + job → `generated`), `/api/admin/labels/jobs` (GET lista / POST crea draft, con `duplicateFromId`), `/api/admin/labels/jobs/[id]` (PATCH autosave / DELETE draft)
- Tutte protette da `requireAdmin()`

### Stato attuale / bug aperti

- ✅ Migrations 018, 019, 023, 024, 025 applicate (schema + data fix + feature palette/origin-style)
- ✅ **Errore 400 su `/api/labels/preview`** — RISOLTO. Causa: import "nudo" di `react-dom/server` intercettato dal Next.js App Router. Fix: import cambiato in `react-dom/server.node` + `export const runtime = 'nodejs'` nelle route preview/generate
- **✅ Integrazione Gotenberg completa e verificata end-to-end (14/07, fuori dall'audit repo — deploy live, non verificabile leggendo il codice):** container Docker attivo su Hetzner nella stessa rete di n8n/Caddy, sottodominio `gotenberg.lepefy.com` con certificato SSL Let's Encrypt automatico e Caddy `basic_auth`, header `Authorization: Basic` aggiunto a `gotenberg.ts` (env var `GOTENBERG_URL`/`GOTENBERG_AUTH`, formato `user:password` Base64-encoded), entrambe settate su Vercel. Endpoint `/forms/chromium/convert/html` testato sia via curl diretto sia da un job reale in `/admin/products/[id]/etichetta/[jobId]` → PDF generato correttamente (layout N-up A4, QR code, badge, blocco legale). Nota tecnica risolta durante il deploy: Gotenberg richiede il file HTML nominato esattamente `index.html` nel form-data.
- ⚠️ **Data quality flag:** i valori nutrizionali usati nell'etichetta BOBOLO Sous Vide corrispondevano alla scheda prodotto Foufou, non Bobolo — richiede verifica dal produttore prima di ristampare
- **Dati Excel etichette (~24 prodotti):** confermati dati legali reali — ragione sociale "Chloé Food ETS", indirizzo "Via Angelo Zanti, 1C - 42122 Reggio Emilia", email `chloefood.ets@gmail.com`; importatore ricorrente **AFRICOOP Società Cooperativa** (Modena). Problemi noti: campi lotto/data corrotti (seriali Excel tipo `42026.0`) in ~8 schede, titoli scheda non corrispondenti per errori di copia-incolla, valori nutrizionali espressi in percentuale in 2 schede da chiarire col produttore

### Idea Phase 2 — uso IA nel sistema etichette (non ancora implementata, salvata per dopo)

1. Generazione sfondo etichetta per categoria/prodotto riusando la pipeline Gemini già esistente (stesso flag `tenant.ai_image_generation`)
2. Pass IA che legge documenti fornitore (Excel, foto etichetta) e propone valori nei campi del form etichetta — sempre da confermare/correggere manualmente, mai pubblicati direttamente
3. QA automatico di coerenza (es. nome prodotto contiene "latte" ma allergene lattosio non marcato) — segnala, non decide

**Esclusi sempre dall'IA:** valori nutrizionali, allergeni, dati legali produttore/importatore, lotto/date — mai dedotti o generati, sempre campo esplicito con default sicuro. Nessun output IA su questi campi pubblicato senza conferma umana esplicita.

**Priorità attuale:** con il sistema base ormai maturo (multi-template/palette/origin-style, workflow draft/ristampa) e Gotenberg confermato funzionante end-to-end (deploy live verificato, vedi sopra), il blocco residuo è **non tecnico**: verifica dei dati nutrizionali (in particolare Bobolo, valori sospetti — probabile scambio con la scheda Foufou nell'Excel originale) e del lotto/data prima della stampa fisica reale — competenza di ChloeFood nelle proprie verifiche interne, non un task di sviluppo.

---

## 16bis. Sistema barcode (EAN-13 interno, multi-tenant) — ✅ migration applicata, PDF testato

Richiesta di Dalice: barcode su ogni etichetta prodotto, uso duplice fin da subito (cassa/POS in negozio + gestione magazzino/picking). Decisione presa con Robertin: i prodotti non hanno mai un codice reale del produttore da riusare → **generazione sempre interna**.

### Formato e architettura
- **EAN-13 "GS1 restricted circulation"**: `20` (range riservato GS1 all'uso interno) + 3 cifre prefisso tenant + 7 cifre sequenza prodotto + 1 check digit — 13 cifre totali, checksum standard mod-10, letto correttamente da qualunque scanner ma **non un vero codice GS1 registrato** (non compare in database pubblici tipo Amazon/GS1 Data Source).
- **Non è un codice hardcoded**: il prefisso a 3 cifre è assegnato automaticamente da un trigger DB (`assign_tenant_barcode_prefix`, migration 031) alla creazione di ogni tenant — mai impostato a mano, mai in codice applicativo. Fino a 1000 tenant supportati con 3 cifre.
- **Univocità a livello di piattaforma**, non solo di tenant — `products.barcode_value` con `unique` globale, a prova di futuro anche se due tenant condividessero magazzino/scanner.
- Generazione **automatica alla creazione di ogni prodotto** (`POST /api/admin/catalogue`), non bloccante — se fallisce il prodotto si crea comunque, il barcode si rigenera dal bottone admin.
- Rendering su etichetta: `bwip-js` (pura JS, nessun binario nativo, compatibile Vercel serverless) → SVG iniettato nei template.
- `formatBarcodeDisplay`/`renderBarcodeSVG`/`assignBarcodeToProduct` in `apps/storefront/src/lib/barcode.ts`. **Deviazione emersa in esecuzione:** `formatBarcodeDisplay` vive in un modulo separato `barcodeFormat.ts` (ri-esportato da `barcode.ts`, contratto pubblico invariato) — `bwip-js` con `moduleResolution: "bundler"` risolve solo via subpath `bwip-js/node`, che importa moduli Node (`url`/`zlib`/`stream`); importarlo da un Client Component (`ProductEditClient`) avrebbe rotto il bundle browser.
- UI admin: campo "Code-barres" nel tab Général di `ProductEditClient.tsx` (sola visualizzazione + bottone "Régénérer", con conferma se esiste già un barcode — non su prodotto nuovo senza codice, nulla da disallineare in quel caso). Ricerca per barcode integrata nel filtro esistente di `/admin/catalogue` (uno scanner USB/Bluetooth funziona già cliccando sul campo ricerca, si comporta come tastiera).

### Barcode "ufficiale" (GS1) — valutato, non perseguito
Discusso con Robertin se servisse un codice riconosciuto pubblicamente (marketplace/distribuzione terzi) invece del solo range interno — chiarito che era **curiosità di Robertin, non un'esigenza reale del progetto**. Non perseguito, nessuna azione richiesta. Se dovesse servire in futuro, l'architettura resta comunque pronta al cambio (basta sostituire il prefisso interno generato dal trigger con quello reale assegnato da GS1).

### Fix layout template full-bleed (stesso ciclo, prompt separati)
Partiti da uno screenshot di Robertin: il pannello info a destra (nome/nutrizione/ingredienti/allergeni/uso/conservazione/peso/lotto/scadenza) aveva altezza fissa con `overflow: hidden` "cieco" — contenuto lungo tagliato silenziosamente invece di adattarsi, bug preesistente indipendente dal barcode ma reso più visibile da esso.

1. **QR mancante aggiunto** — `default.tsx` e `banner.tsx` avevano già il QR verso `/card` (`<img src=".../api/card/qr-code?format=png&size=200">`), `fullbleed.tsx` no. Aggiunto con lo stesso pattern.
2. **Barcode ripristinato**: da riga a piena larghezza nel pannello legale a stack verticale compatto (barcode ~14mm sopra, QR ~8mm sotto) in basso a destra — libera spazio verticale. **Confermato via screenshot funzionante.**
3. **Shrink-to-fit**: contenuto del pannello info avvolto in un wrapper scalabile; script iniettato nell'HTML (eseguito da Chromium reale prima della cattura Gotenberg) misura `scrollHeight` vs spazio disponibile e riduce la scala in step del 5% fino a un pavimento del 75% (sotto quella soglia il testo diventerebbe non conforme al Reg. 1169/2011 — se un prodotto tocca il pavimento e resta tagliato, è segnale che serve un formato etichetta fisico più grande per quel prodotto specifico, non altro testo compresso). **Confermato via screenshot: entrata in gioco solo quando serve.**
4. **Tabella nutrizionale a due colonne** (richiesta di Robertin dopo aver visto che con tutti e 9 i valori compilati la tabella singola spingeva fuori altro contenuto): split in colonna sinistra (energia + grassi, 4 righe) e destra (carboidrati + fibre/proteine/sale, 5 righe) sotto un'unica intestazione — dimezza l'ingombro verticale. Etichette senza traduzione inglese in questa versione compatta (l'italiano da solo è legalmente sufficiente per la dichiarazione nutrizionale). **✅ Eseguito e testato (confermato da Robertin).**

### Stato — ciclo chiuso
1. ✅ Migration 031 applicata al DB reale.
2. ✅ PDF reale generato da Gotenberg testato (non solo preview HTML).
3. ✅ Split tabella nutrizionale eseguito e testato.
4. GS1 ufficiale — non perseguito, era solo curiosità (vedi sopra).
5. Resta aperto solo: comunicare a Dalice che il barcode è generato internamente (non un vero codice prodotto pubblico) — utile per evitare sorprese se lo scansiona con lo smartphone senza trovare nulla online. Non bloccante.

---

## 17. Variabili d'ambiente complete (Vercel)

⚠️ Nessun `.env.example` è committato nel repo (il `README.md` ne referenzia uno — `apps/storefront/.env.local.example` — che non esiste su disco). Questa tabella resta l'unica fonte di verità per le variabili attese.

```bash
# Tenant
NEXT_PUBLIC_TENANT_SLUG=chloefood

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://lefihestoozeptzonhkt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Stripe — ⚠️ sostituire con chiavi LIVE ChloeFood
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# Packlink PRO — ⚠️ cambiare URL a produzione
PACKLINK_API_KEY=...
PACKLINK_API_BASE=https://api.packlink.com   # ← era apisandbox.packlink.com

# n8n
N8N_WEBHOOK_URL=https://n8n.lepefy.com
N8N_WEBHOOK_SECRET=...

# Tracking + preventivo spedizione (HMAC)
TRACKING_SECRET=...
NEXT_PUBLIC_APP_URL=https://chloefood.com

# Admin auth
ADMIN_EMAILS=...

# Gotenberg (necessaria per /api/admin/labels/generate — throw esplicito se assente)
GOTENBERG_URL=...
GOTENBERG_AUTH=...
```

---

## 18. Checklist go-live

| Task | Responsabile | Stato |
|---|---|---|
| Importare ~120 prodotti reali da catalogo v2 | Robertin | ✅ FATTO |
| Aggiungere autenticazione a `/admin` (pagine) | Robertin | ✅ FATTO |
| Aggiungere autenticazione alle API `/api/admin/*` | Robertin | ✅ FATTO (revisione sicurezza 2026-07-02) |
| Ricalcolo server-side prezzi/spedizione al checkout | Robertin | ✅ FATTO (revisione sicurezza 2026-07-02) |
| Chiudere policy RLS insert-any + idempotenza webhook | Robertin | ✅ FATTO (migration 016) |
| Configurare dominio personalizzato `chloefood.com` | Robertin | ✅ FATTO |
| Risolvere errore 400 su `/api/admin/labels/preview` | Robertin | ✅ FATTO |
| Cambiare `PACKLINK_API_BASE` → `api.packlink.com` | Robertin | ⚠️ DA FARE |
| Correggere `FROM_ADDRESS` hardcoded IT 42122 in shipping quote | Robertin | ⚠️ DA FARE |
| Sostituire chiavi Stripe test con chiavi live ChloeFood | ChloeFood | ⚠️ DA FARE |
| Registrare webhook Stripe sull'account ChloeFood | ChloeFood | ⚠️ DA FARE |
| Confermare trattamento IVA spedizione con commercialista | ChloeFood | ⚠️ DA FARE |
| Eliminare ordini di test dal DB | Robertin | ⚠️ DA FARE |
| Test E2E: ordine IT + ordine FR + Click & Collect | Robertin | ⚠️ DA FARE |
| Installare/confermare Gotenberg raggiungibile su Hetzner + Caddy auth | Robertin | ✅ FATTO (verificato end-to-end 14/07: deploy Hetzner + PDF reale generato da job vero) |
| Verificare dati nutrizionali/lotto con produttori prima di stampare etichette (in particolare Bobolo, valori sospetti) | ChloeFood / produttori | ⚠️ DA FARE — competenza ChloeFood, non blocco tecnico |
| Rimuovere file morti admin (`AdminNav.tsx`, `AdminOrdersClient.tsx`, `orders/id/`) | Robertin | ✅ FATTO (Fase 0 redesign admin, §8bis) |
| Decisione brand charter v2 (font, colore, elemento signature) | Dalice | ✅ FATTO — Bricolage Grotesque, blu `#1267C7`, cartellino `ShopTag`: validati su mockup, implementati e deployati (§12bis) |
| Pushare il branch redesign storefront | Robertin | ⚠️ Commit presenti solo su questo branch — **non mergiati su `main`** (correzione v3.7, verificato via `git merge-base`; smentisce lo stato "FATTO" delle revisioni precedenti) — vedi §12bis |
| Eseguire query SQL colore primario ChloeFood | Robertin | ✅ FATTO (17/07, operazione DB indipendente da git) — ma il codice che lo consuma tramite `var(--color-primary)` è solo su questo branch, non su `main` (vedi riga sopra) |
| Redesign admin (Fase 0–4 + 2 addenda) — accessibilità, responsive, dark mode, bulk actions, polling, nav mobile | Robertin | ⚠️ Implementato, ma **non mergiato su `main`** (correzione v3.7, verificato via git — non solo "non confermato in sessione" come detto in v3.6) — vedi §8bis |
| Eseguire KPI "Aujourd'hui" (prompt già scritto) | Robertin | ✅ FATTO — correzione v3.7, verificato nel codice (v3.6 la segnalava per errore ancora pendente) |
| Confermare quale branch è collegato al deploy Vercel di `chloefood.com` | Robertin | ⚠️ DA FARE — punto critico aperto da v3.7, nessun `vercel.json` nel repo per verificarlo da qui |
| Comunicare a Dalice la deviazione export CSV (invece di XLSX) e il rinvio delle notifiche push | Robertin | ⚠️ DA FARE — vedi §8bis |
| Completare contratto SaaS (dati fiscali, foro, DPA) | Robertin | ⚠️ DA FARE |
| Applicare migration 031 sistema barcode (`supabase db push`) + verificare 0 prodotti senza barcode/0 duplicati | Robertin | ✅ FATTO |
| Verifica visiva PDF reale Gotenberg per layout full-bleed (barcode+QR+nutrizione due colonne) | Robertin | ✅ FATTO |
| Eseguire prompt split tabella nutrizionale a due colonne (template full-bleed) | Robertin | ✅ FATTO — eseguito e testato |
| Comunicare a Dalice che il barcode è generato internamente (non un vero codice GS1 pubblico) | Robertin | ⚠️ DA FARE |
| Toggle lingua a livello descrizione, titolo prodotto localizzato, prodotti correlati semantici | Robertin | ✅ FATTO — vedi §12bis Fase 4 |
| Applicare migration 032+033 chatbox su Supabase (`ai_chatbox_enabled`/`chatbox_extra_context`, tabella `tenant_knowledge_base`) | Robertin | ✅ FATTO — confermato da Robertin in chat (24/07), non riverificato contro Supabase da questa sessione, vedi §13ter |
| Popolare `chatbox_extra_context` ChloeFood (orari, indirizzo Click&Collect, paesi consegna, soglia spedizione gratuita) | Robertin | ⚠️ DA FARE — bozza SQL preparata in chat, in attesa di conferma email/telefono pro e paesi consegna reali prima dell'esecuzione, vedi §13ter |
| Abilitare `ai_chatbox_enabled` per ChloeFood (`UPDATE tenants ... WHERE slug = 'chloefood'`) e test manuale su preview | Robertin | ⚠️ DA FARE — vedi §13ter |
| Raccogliere contenuto reale da Dalice per `tenant_knowledge_base` (ricette, espressioni, FAQ) | Dalice / Robertin | ⚠️ DA FARE — tabella vuota, questionario di raccolta già preparato, vedi §13ter |
| Redesign Product Detail Page (galleria dinamica, spec row, tab etichetta, trust badge) | Robertin | ✅ FATTO — testato, vedi §33 |
| Eseguire migration 035 (`is_homemade`) + 036 (`tenant_story`) su Supabase | Robertin | ✅ FATTO — confermato in chat (26/07), non riverificato contro Supabase da questa sessione |
| Popolare `story_heading`/`story_text` ChloeFood (sezione "Notre origine" resta invisibile finché vuoti) | Dalice / Robertin | ⚠️ DA FARE — form admin ora disponibile (`/admin/parametres`), manca solo il contenuto, vedi §33 |
| Attivare `is_homemade` per i prodotti realmente artigianali | Dalice / Robertin | ⚠️ DA FARE — scelta editoriale, nessun prodotto attivato dalla migration |
| Home grid vedettes + footer esteso condizionale + revert BottomNav a Tabler | Robertin | ✅ FATTO — riportato in chat con elenco file/deviazioni, vedi §33 |
| Form admin `/admin/parametres` per campi "Notre origine" | Robertin | ✅ FATTO — report dettagliato ricevuto (file + comportamento upload/whitelist), `pnpm typecheck` pulito, vedi §33 |
| Creare pagine mancanti Livraison/Retours/Contact/FAQ (oggi assenti, footer "Aide" omesso per questo) | ChloeFood | ⚠️ DA FARE — gap di contenuto segnalato durante il ciclo footer, non solo estetico: rilevante anche per compliance consumatore EU |
| Autenticazione cliente (Supabase Auth, OTP 6 cifre) | Robertin | ✅ FATTO (31/07) — eseguito e testato, **confermato su `main`** (v3.18), vedi §9bis |
| Pagina storico ordini cliente `/orders` | Robertin | ⚠️ **Corretto in v3.18 — separata dalla riga sopra**: era erroneamente accorpata a "✅ FATTO". Codice esiste e funziona, ma **non è su `main`** — solo su questo branch di lavoro, vedi §9bis punto 3 |
| Pre-compilazione checkout + indirizzo di default per clienti autenticati (`044_customer_default_address.sql`) | Robertin | ⚠️ **Non in v3.17 — aggiunta in v3.18.** Codice esiste e funziona, stessa situazione della riga sopra: **non su `main`**, vedi §9bis punto 4 |
| Tabella `admin_users` (ruoli `platform_owner`/`tenant_admin`) al posto di `ADMIN_EMAILS` | Robertin | ✅ FATTO (31/07) — `requireAdmin()` ora richiede `tenantId` esplicito, **confermato su `main`** (v3.18), vedi §8/§9bis |
| Impostare Dalice come `tenant_admin` scoped a ChloeFood in `admin_users` | Robertin | ⚠️ DA FARE — tabella pronta, riga non ancora creata per Dalice (confermato v3.18: nessun `INSERT INTO admin_users` in alcuna migration; non verificabile se creata a mano da Supabase Dashboard, nessuna credenziale disponibile da qui) |
| Sistema Loyalty/Referral multi-tier (albero configurabile, ledger punti, anti-frode) | Robertin | ✅ FATTO (31/07) — eseguito, typecheck pulito, flusso end-to-end verificato, **confermato su `main`** incluse le UI `/compte/parrainage` e `/admin/loyalty` (v3.18), vedi §9bis |
| Configurare percentuali per livello e profondità albero referral per ChloeFood | Dalice / Robertin | ⚠️ DA FARE — sistema pronto ma nessuna configurazione tenant-specifica ancora impostata per ChloeFood |
| Comunicare a Dalice il nuovo programma Loyalty/Referral (percentuali, funzionamento, cosa vede il cliente) | Robertin | ⚠️ DA FARE — nessuna comunicazione risulta inviata finora |
| Mergiare su `main` la pagina `/orders` e la pre-compilazione checkout (§9bis punti 3/4) | Robertin | ⚠️ **Nuova riga v3.18** — unico pezzo del ciclo 31/07 rimasto solo su branch, vedi sopra |
| Rimuovere/valutare `ADMIN_EMAILS` da env Vercel ora che `admin_users` è attivo | Robertin | ⚠️ DA VERIFICARE — **confermato v3.18**: il codice non la referenzia più in alcun punto (`grep` a zero risultati), quindi se ancora impostata su Vercel è un env var inutilizzato, non un fallback attivo; la rimozione da Vercel stesso resta non verificabile da qui |
| Integrare design "Mon compte" (header brand, loyalty card reale, indirizzi, CTA) | Robertin | ✅ FATTO — **corretto in v3.20**: verificato nel codice (commit `fd09629`, 31/07 stessa sera), non solo "prompt generato" come in v3.19 — resta solo su questo branch, non su `main`, vedi §9bis punto 6 |
| Integrare redesign home page (hero carousel, category blocks scroll, "Suggestions pour vous", FAB chat, admin hero slides) | Robertin | ✅ FATTO — **corretto in v3.20**: `pnpm typecheck` ora confermato pulito (eseguito in questa sessione, non solo riportato) — vedi §12bis Fase 5 |
| Link di pagamento diretto su digital card (`extra.link`, nessuna migration) | Robertin | ✅ FATTO — **corretto in v3.20**: verificato nel codice (commit `a2e1da1`), IBAN confermato non mascherato — vedi §14 |
| Spostare `ProductSpecs` subito dopo il prezzo in PDP + trattamento colore vivace | Robertin | ✅ FATTO — **corretto in v3.20**: verificato nel codice (commit `27e3e7e`) — vedi §12bis Fase 4bis |
| Sistema Ambassadeur (commissioni euro al primo ordine referral, sconto opzionale, ruolo `tenant_cashier`) | Robertin | ✅ FATTO — **corretto in v3.20**: `046_ambassador_commission_system.sql` + UI cliente/admin verificate nel codice (commit `c708742`), non solo prompt come in v3.19 — resta solo su questo branch, non su `main`, vedi §9ter |
| Carta fedeltà con barcode EAN-13 proprio (namespace `21`) per accumulo punti in negozio | Robertin | ✅ FATTO — **corretto in v3.20**: `047_loyalty_card_system.sql` + `/admin/loyalty/scan` + `/compte/carte-fidelite` verificati nel codice (commit `8e31642`), non solo decisioni chiuse in chat come in v3.19 — resta solo su questo branch, non su `main`, vedi §9ter |
| Mergiare su `main` i 17 commit 30/07–3/08 (Mon compte, home redesign, digital card link, PDP, Ambassadeur, carta fedeltà) | Robertin | ⚠️ **Nuova riga v3.20** — `main` è fermo a `043_drop_redundant_customer_referral_code.sql`, tutto questo lavoro esiste solo su questo branch, vedi §38 |
| Aprire account Google Play Console e avviare verifica identità | Robertin | ⚠️ DA FARE — **personale** scelto (non Organization), gate 12 tester/14gg nel percorso critico, vedi §37. **Confermato v3.20**: nessun codice TWA trovato nel repo, punto ancora genuinamente da avviare |
| Migration `tenants.android_package_name`/`android_sha256_fingerprint` + route dinamica `/.well-known/assetlinks.json` | Robertin | ⚠️ DA FARE — solo pianificato, nessun prompt ancora generato, vedi §37. **Confermato v3.20**: grep su `assetlinks`/`android_package_name`/`bubblewrap` nel repo → zero risultati |

---

## 19. Roadmap Phase 2 (post go-live)

**Nota:** le tre feature IA trasversali (descrizioni multilingue, rate limiting/cost tracking, ricerca semantica) sono state completate — non compaiono più come "Non avviato" in questa tabella, dettaglio in §13bis.

| Feature | Categoria | Priorità | Stato |
|---|---|---|---|
| Autenticazione clienti (Supabase Auth) | Contrattuale | P0 | ✅ FATTO (31/07) — **confermato su `main`** (v3.18), vedi §9bis |
| Pagina `/orders` storico ordini + pre-compilazione checkout | Contrattuale | P0 | ⚠️ **Corretto in v3.18**: v3.17 la segnava "FATTO" insieme alla riga sopra — codice pronto e testato, ma **non ancora mergiato su `main`**, vedi §9bis punti 3/4 |
| Sistema Loyalty/Referral multi-tier (albero configurabile, ledger punti, anti-frode, UI "corda dei cartellini") | Contrattuale | P0 | ✅ FATTO (31/07) — **confermato su `main`** incluse le UI cliente/admin (v3.18), vedi §9bis; **configurazione ChloeFood-specifica ancora da impostare, non comunicato a Dalice** |
| Onboarding secondo tenant su `admin_users` (assegnare ruolo `tenant_admin` scoped) | SaaS | P1 | Non avviato — tabella pronta, nessun tenant_admin creato oltre al platform_owner (confermato v3.18, nessun seed in migration) |
| Rimozione/deprecazione `ADMIN_EMAILS` ora che `admin_users` copre lo stesso ruolo | Tecnico | P2 | Non avviato — **confermato v3.18**: zero riferimenti nel codice (`grep` a vuoto), quindi non serve più come fallback lato applicazione; resta da verificare/rimuovere solo lato env Vercel |
| Enforcement `subscription_status` (blocco soft storefront tenant scaduto) | Tecnico | P0 | Non avviato — mai controllato oggi |
| Gestione stock reale al checkout (decremento, blocco esaurito) | Tecnico | P0 | Non avviato |
| Sistema etichette prodotto — deploy Gotenberg su Hetzner | Tecnico | P0 | ✅ FATTO — verificato end-to-end (14/07) |
| Draft Packlink automatico al pagamento ("effet waouhhh") | Tecnico | P1 | Non avviato |
| `carrierName` + `serviceName` in `shipping_details` DB | Tecnico | P1 | Non avviato |
| Stripe Connect (destination charges, giroconto automatico tenant) | Tecnico/Business | P1 | Non avviato |
| Risoluzione tenant per dominio (un solo deployment multi-tenant) | Tecnico | P1 | Non avviato — collo di bottiglia oltre ~5 tenant |
| Recupero carrelli abbandonati (dati già in `checkout_sessions`) | Business | P1 | Non avviato — infrastruttura dati già presente |
| Email transazionali robuste (outbox / provider diretto, fallback a n8n) | Tecnico | P1 | Non avviato |
| IA nel sistema etichette (sfondi, estrazione dati bozza, QA coerenza) | Tecnico | P2 | Idea salvata, non implementata |
| Query embedding cache (risparmio chiamate Gemini su ricerca semantica) | Tecnico | P2 | Idea salvata, non implementata — vedi §13bis |
| i18n (`next-intl` + `tenants.locale`) prima di espandere fuori da area francofona | Tecnico | P2 | Non avviato |
| Sostituire `xlsx@0.18.5` (vulnerabilità note) con alternativa (es. `exceljs`) | Tecnico | P2 | Non avviato — nel frattempo l'export bulk admin (§8bis) usa CSV puro proprio per questo motivo |
| Notifiche push vere per l'admin (Web Push API, service worker, VAPID, `push_subscriptions`, trigger da webhook Stripe) | Tecnico | P1 | Decisa con Dalice il 17/07, **rimandata** il 18/07 — solo avviso in-tab (Notification API, richiede la scheda aperta) implementato, vedi §8bis |
| Realtime vero per l'admin (Supabase Realtime + RLS `tenant_admins` su `orders`) invece del polling attuale | Tecnico | P2 | Prompt scritto e scartato consapevolmente (18/07) — volumi attuali non lo giustificano; riprendere solo se crescono admin concorrenti o ordini/giorno, vedi §8bis |
| Estrarre `Badge.tsx`/`KpiCard.tsx`/`Toast.tsx`/`BulkBar.tsx` come componenti condivisi admin (oggi inline) | Tecnico | P2 | Non avviato — raccomandazione audit §4, debito di organizzazione, zero impatto utente |
| Test automatizzati (almeno `calculateShipping.ts` + webhook, Vitest) | Tecnico | P2 | Non avviato |
| Google Play Store via TWA/PWABuilder | Growth | P1 | ✅ In gran parte eseguito (5/08, v3.21) — vedi §14ter e §18. Resta il gate Closed Testing 12 tester/14gg |
| Smart-link QR negozio `/go` + gating `android_public` | Growth | P1 | ✅ Eseguito (6/08, v3.21) — vedi §14ter e §18 |
| Apple App Store via Capacitor | Growth | P2 | Non avviato |
| Onboarding secondo tenant (self-service, wizard) | SaaS | P1 | Guida `Lepefy_Onboarding_Tenant_v1.docx` pronta; asset statici mono-tenant + limite build-time tenant da rimediare prima |
| Rate limiting su `/api/checkout` e `/api/shipping/quote` | Tecnico | P1 | Non avviato |
| Decidere destinazione reale del CTA hero "Notre histoire" | Contenuto/Prodotto | P1 | ✅ FATTO (26/07) — punta a `#origine` (anchor sezione "Notre origine" in home), nascosto se la sezione non è renderizzata; vedi §33 |
| Pagine Livraison/Retours/Contact/FAQ (assenti oggi, footer "Aide" omesso per mancanza di destinazione reale) | Contenuto/Prodotto | P1 | Non avviato — emerso durante il ciclo footer (26/07), vedi §33 |
| Recensioni/rating prodotto reali ("Avis et notes clients") — dati finti scartati esplicitamente sia da un design handoff pagina prodotto sia da uno home page in questo ciclo | Contrattuale | P2 | Non avviato — già in roadmap, confermato ancora non costruito durante il ciclo 26/07 |
| Allineare `tenant.accent_light` al nuovo primary blu (coerenza visiva, non bloccante) | Tecnico | P2 | Non avviato — query pronta, vedi §12bis |
| Promuovere le frasi small-talk del chatbox da placeholder generico a voci `tenant_knowledge_base` categoria `greeting` (tono autentico Dalice) | Contenuto | P2 | Idea salvata, non implementata — vedi §13ter |
| Unificare `chatbox_extra_context` con `tenants.click_collect_hours` esistente (migration 009) — oggi rischiano di duplicare la stessa informazione (orari) in due campi che possono disallinearsi | Tecnico | P3 | Idea salvata, non implementata — il system prompt del chatbox potrebbe leggere `click_collect_hours` direttamente invece di richiederne la ritrascrizione manuale in `chatbox_extra_context` |
| Import batch multi-voce per `tenant_knowledge_base` (incolla un blocco di testo con separatore, il server lo spezza e calcola gli embedding uno per uno) | Tecnico | P3 | Idea salvata, non implementata — non necessaria per il volume iniziale (8-10 voci), da valutare solo se il volume di contenuto da Dalice/altri tenant cresce molto |
| Estendere `name_alt` da campo singolo a jsonb multilingua (come `descriptions`) per un tenant futuro a 3+ lingue | Tecnico | P2 | Non avviato — limite noto, non bloccante con 2 lingue, vedi §12bis Fase 4 |
| Sistema Ambassadeur (commissioni euro primo ordine, sconto opzionale, ruolo `tenant_cashier`) | Business/Growth | P1 | ✅ FATTO (2/08) — **corretto in v3.20**: eseguito e verificato nel codice, **non ancora su `main`**, vedi §9ter. Resta da fare: configurare tassi/soglie per ChloeFood, comunicare a Dalice |
| Carta fedeltà EAN-13 propria (namespace `21`) + widget dashboard in stile tessera fisica | Business/Growth | P1 | ✅ FATTO (3/08) — **corretto in v3.20**: eseguito e verificato nel codice, **non ancora su `main`**, vedi §9ter. Resta da fare: formare il personale cassa sull'uso di `/admin/loyalty/scan`, creare i primi account `tenant_cashier` |
| Pubblicazione Play Store (TWA) | Growth | P1 | ✅ **In gran parte eseguito (5/08, v3.21)** — riportato in chat, non riverificato contro filesystem/git: infrastruttura (`048`), packaging via PWABuilder, `assetlinks.json` con 3 fingerprint, TWA installata e verificata funzionante su Internal Testing (2 tester). **Resta bloccante**: Closed Testing 12 tester/14gg consecutivi non ancora avviato — vedi §14ter |
| Smart-link QR negozio `/go` (redirect shop/app, gating su `android_public`) | Growth | P1 | ✅ **Eseguito (6/08, v3.21)** — riportato in chat, non riverificato: migration `049`, bug dominio canonico e bug font SVG (tofu box) corretti in sessione, vedi §14ter. Debito noto non risolto in questo ciclo: `overlayLogo()` (viewBox errato, logo invisibile su `/card` e su questa nuova route) |
| Avviare Closed Testing Play Store (12 tester attivi, 14 giorni consecutivi) | Robertin | ⚠️ DA FARE — unico blocco residuo prima della produzione pubblica, vedi §14ter |
| Testare con Dalice il flusso iscrizione OTP prima dell'evento comunitario del 15 agosto | Dalice | ⚠️ DA FARE — richiesto via WhatsApp, non confermato eseguito, vedi §14ter |
| Correggere `overlayLogo()` (viewBox module-units invece di pixel, logo invisibile su QR `/card` e QR shop) | Robertin | ⚠️ DA FARE — bug preesistente, esplicitamente lasciato fuori scope nel ciclo QR shop, vedi §14ter |

### Phase 2 — Packlink draft feature (dettaglio)

Al pagamento, chiamare `POST /v1/draft` Packlink per creare una spedizione pre-compilata. Salvare `shipment_reference` in `orders.packlink_draft_ref`. Mostrare bottone "Créer expédition Packlink →" nella dashboard admin che apre direttamente il draft in Packlink. Richiede: API route `POST /api/orders/[id]/draft-packlink` + migration campo `orders.packlink_draft_ref`.

---

## 20. Principi di sviluppo

### Workflow preferito (Robertin)

1. Discussione + validazione con mockup/widget interattivi
2. Generazione prompt Claude Code con tutte le modifiche consolidate, salvato come `.md` in `/mnt/user-data/outputs/`
3. Output come file completi (non diff), pronti per GitHub web UI
4. Nessun comando bash locale — tutto via GitHub web + Vercel auto-deploy
5. Robertin esegue separatamente e riporta i risultati (build error, screenshot) per l'iterazione successiva

### Regole critiche

- **No ambiente locale.** Robertin lavora esclusivamente via GitHub web UI + Vercel. Tutti i file devono essere pronti per copia-incolla diretto.
- **Webhook-first sempre.** Gli ordini esistono solo dopo `payment_intent.succeeded`. Mai creare ordini in anticipo.
- **Mai fidarsi del client per prezzo/spedizione.** Regola aggiunta dopo la revisione di sicurezza 2026-07-02: prezzo e `storage_type` sempre riletti dal DB, spedizione sempre verificata via token HMAC.
- **Multi-tenancy vigilance — regola permanente.** Ogni valore hardcodato (`'chloefood'`, `'Packlink'`, carrier names, icone PWA statiche, indirizzi mittente spedizione) è un bug. Sempre usare `tenant.id`/`getTenant()` e logica switch-based/API route dinamica. Se una soluzione non è multi-tenant compatibile, va segnalato esplicitamente prima di procedere, proponendo l'alternativa corretta.
- **API admin sempre protette.** Ogni nuova route sotto `/api/admin/*` deve chiamare `requireAdmin()` in testa — prima della revisione del 2026-07-02 questo non era garantito.
- **Supabase permissions.** Sempre `GRANT USAGE ON SCHEMA public TO anon, authenticated` + `GRANT SELECT` esplicito per tabella + `GRANT UPDATE ... TO service_role` per tabelle scritte da API route admin. Testare con `SET role anon;`.
- **TypeScript strict.** Build errors tracciati dai Vercel build logs. Fix sistematici via prompt Claude Code, non patch one-off.
- **Repo pubblico.** Necessario per Vercel free plan. Non inserire mai segreti nel codice.
- **Dati sensibili (nutrizionali, allergeni, legali, lotto/date) mai generati o dedotti dall'IA** — sempre campo esplicito con default sicuro, conferma umana obbligatoria prima della pubblicazione.
- **Script batch AI (`.mjs`)** — filtro `SKIP_EXISTING` sempre lato JavaScript dopo il fetch (mai lato query PostgREST su colonne jsonb), logging diagnostico esplicito (totale fetchati vs dopo filtro), workflow `.yml` gemello creato nello stesso prompt dello script, `maxOutputTokens` generoso + `thinkingBudget: 0` per Gemini 2.5 Flash su task semplici, `usageMetadata` letto prima del tentativo di parsing così i token sono loggati anche sugli errori. Vedi §13bis per il dettaglio dei bug reali incontrati.
- **Vercel monorepo + middleware.** Root Directory = `apps/storefront` impedisce l'Edge middleware: l'auth va gestita a livello di route group `(protected)` con Server Component, non middleware (`middleware.ts` resta un `export {}` vuoto di proposito).
- **`@supabase/ssr` 0.3.x** — implementare sempre sia le API cookie vecchie che nuove insieme, o le sessioni si rompono tra client e server.

---

## 21. Documenti di riferimento nel progetto

| File | Contenuto |
|---|---|
| `docs/PROJECT_REVIEW.md` | Revisione tecnica/business completa — 4 falle di sicurezza risolte (2026-07-02), debito residuo, roadmap raccomandata; base delle sezioni §2.1, §18, §19 aggiornate qui |
| `INTEGRATION.md` | Guida integrazione sistema spedizione Packlink |
| `Lepefy_Roadmap_Tecnica.docx` | Roadmap completa Phase 1/2/3, stack, checklist go-live, rischi |
| `Maquette/` | Design reference originale ChloeFood |
| `ClaudeCode_Prompt_MobileLayout.md` | Prompt Claude Code per bottom nav + homepage (file esterno, non nel repo) |
| `ClaudeCode_Prompt_SistemaEtichette.md` | Prompt Claude Code originale per sistema etichette (file esterno, non nel repo — referenziato ma non versionato) |
| `ClaudeCode_Prompt_ProducerImporterUI.md` | Prompt Claude Code per UI produttori/importatori, referenziato nel commento della migration 019 (file esterno, non nel repo) |
| `Lepefy_Onboarding_Tenant_v1.docx` | Guida interna onboarding secondo tenant |
| `Contrat_SaaS_LepefyLabs_ChloeFood.docx` | Contratto SaaS bilingue FR/IT (versione precedente) |
| Contratto SaaS 16 articoli (diritto italiano) | Versione estesa — mancano dati fiscali, foro, email contrattuale, DPA |
| `Charte_graphique_Chloe_Food_1.pdf` | Nuova brand charter v2 (20 pagine) — decisioni derivate (font, elemento signature) implementate, colore primario ancora da migrare via SQL (§12bis) |
| `chloe_food_logo.svg` | Logo vettoriale ricostruito (bug viewBox corretto) |
| `Mockup_Fase3_Validazione_UIUX.html` | Mockup interattivo di validazione Fase 3 (toggle colore verde/blu, toggle font Bricolage/Fraunces) — allegato di sessione, non versionato nel repo; decisioni approvate implementate in `apps/storefront`, vedi §12bis |
| `AUDIT_ADMIN_UIUX.md` | Audit UI/UX del pannello admin (17/07) — origine del redesign Fase 0–4, allegato di sessione, non versionato nel repo; vedi §8bis |
| `admincommandesredesign.html` | Mockup interattivo di validazione redesign admin (tabella responsive, dark mode, bulk bar) — allegato di sessione, non versionato nel repo; decisioni approvate implementate parzialmente (righe espandibili mantenute contro il mockup, vedi §8bis) |
| `ClaudeCode_Prompt_ProductLocaleToggle_RelatedProducts.md` | Prompt Claude Code per toggle lingua a livello descrizione, titolo prodotto localizzato (`name_alt`) e prodotti correlati semantici (file esterno, non nel repo) — vedi §12bis Fase 4 |
| `ClaudeCode_Prompt_ChatboxIA.md` | Prompt Claude Code Fase 1 chatbox: widget storefront + ricerca semantica prodotti + rate limiting/cost tracking riusati (file esterno, non nel repo) — vedi §13ter |
| `ClaudeCode_Prompt_ChatboxIA_Fase2.md` | Prompt Claude Code Fase 2 chatbox: filtro small-talk, `tenant_knowledge_base`, admin `/ai-lab` (file esterno, non nel repo) — vedi §13ter |
| `Miglioramento_pagina_prodotto_e-commerce.zip` (design handoff) | Prototipo HTML pagina prodotto (galleria, spec row, tab, badge) — allegato di sessione, non versionato nel repo; recensioni/rating finti del prototipo scartati esplicitamente, vedi §33 |
| `ClaudeCode_Prompt_ProductPage.md` | Prompt Claude Code redesign Product Detail Page, corretto rispetto al design handoff (colori derivati da token, niente recensioni finte, galleria dinamica) — vedi §33 |
| `Home_Boutique_dc.html` (design handoff) | Prototipo HTML homepage completa — allegato di sessione, non versionato nel repo; testimonianze finte e claim non confermati scartati esplicitamente, vedi §33 |
| `ClaudeCode_Prompt_IconsAndTicker.md` | Prompt Claude Code audit icone Tabler→emoji storefront cliente + fix colore ticker — vedi §12 |
| `ClaudeCode_Prompt_HomeGridOriginFooter.md` | Prompt Claude Code grid vedettes + sezione "Notre origine" + footer condizionale + revert BottomNav a Tabler — vedi §33 |
| `ClaudeCode_Prompt_OriginAdminForm.md` | Prompt Claude Code form admin `/admin/parametres` per campi "Notre origine" — vedi §33 |
| `ClaudeCode_Prompt_CustomerAuth.md` (nome ricostruito, file esterno) | Prompt Claude Code prerequisito: autenticazione cliente via Supabase Auth OTP a codice, checkout guest preservato come opzionale — da eseguire prima del prompt loyalty, vedi §9bis |
| `ClaudeCode_Prompt_LoyaltyReferralSystem.md` | Prompt Claude Code sistema Loyalty/Referral multi-tier completo — migration `040_loyalty_referral_system.sql` (corretto in v3.18, v3.17 la citava come `039_...`) + route `/api/admin/loyalty/*` + `lib/loyalty/*.ts` — vedi §9bis |

---

## 22. Changelog di questa revisione (v3.2, 15 Luglio 2026)

Verifica riga-per-riga di v3.1 contro il filesystem reale del repo (branch `claude/lepefy-context-audit-i2teds`). Correzioni apportate:

- **§4** — numerazione migration IA confermata: `026_ai_descriptions.sql`, `027_ai_rate_limiting_cost_tracking.sql`, `028_semantic_search.sql` (non collisioni con 023–025 come temuto in v3.1). Tabella migration aggiornata da 001–025 a 001–028.
- **§3** — corretta la struttura repo: `lib/` mancava intere sottocartelle reali (`ai/embeddings.ts`, `ai/usageTracking.ts`, `images/removeBackground.ts`, `store/localeStore.ts`, `tenant/getTenantSocialLinks.ts`, `utils/`); `packages/types/` mancava `index.ts` e `ai.ts`; aggiunti `admin/_components/AdminSidebar.tsx` e i componenti dashboard (`AdminNav.tsx`, `AdminFilters.tsx`, `OrdersTable.tsx`) non elencati prima.
- **§3/§8** — corretta l'affermazione errata di una route dedicata `/admin/orders/[id]/picking-list`: non esiste come route separata. La picking list è renderizzata nella stessa pagina `admin/(protected)/orders/[id]/page.tsx` di fianco al dettaglio ordine, con `@media print` che nasconde il blocco `.no-print` in fase di stampa.
- **§16** — il sistema etichette ha **tre** template, non due: oltre a `default.tsx` e `fullbleed.tsx` esiste `banner.tsx` ("Fascia Dorata"), anch'esso con stile origine implementato (a differenza di `fullbleed.tsx`, che resta l'unico senza bandiera/stile origine).

Il resto del documento (stack tecnologico, sicurezza, shipping, checkout, admin auth, PWA, roadmap) è stato controllato a campione contro `package.json`, `pnpm-workspace.yaml`, le route API reali e `docs/PROJECT_REVIEW.md` e risulta accurato — nessuna ulteriore discrepanza rilevata in questa passata.

---

## 23. Changelog v3.3 (16 Luglio 2026) — conferma deploy Gotenberg fuori-repo

L'audit v3.2 aveva correttamente lasciato lo stato del deploy Gotenberg come "non verificabile da repo" — è una limitazione intrinseca di un audit basato solo sul codice: uno stato di infrastruttura live (container Docker su Hetzner, DNS, certificato SSL, reverse proxy) non è deducibile leggendo `gotenberg.ts`. Questa revisione aggiorna quel punto con una verifica diretta effettuata fuori-repo (sessione SSH sul VPS + test curl + generazione PDF reale da un job in produzione):

- **§2** (stack), **§16** (dettaglio etichette), **§18** (checklist go-live), **§19** (roadmap Phase 2) — tutte le occorrenze "deploy da verificare/confermare" sostituite con conferma di deploy completo e funzionante end-to-end.
- **§18** — riga verifica dati nutrizionali/lotto: responsabile corretto da "Robertin" a "ChloeFood / produttori" (è una verifica di competenza del tenant sui propri dati prodotto, non un task di sviluppo piattaforma).
- Nessuna modifica al resto del documento (struttura repo, template etichette, migration IA) rispetto a v3.2 — quella parte resta l'audit di riferimento.

---

## 24. Changelog v3.4 (17 Luglio 2026) — audit e redesign UI/UX storefront (Fase 1–3)

> ⚠️ **Nota v3.7:** il "branch `claude/lepefy-storefront-audit-69xss0`" citato sotto non risulta mai esistito nel repository remoto verificabile da questa sessione, e le affermazioni di questo changelog e di v3.5 sul push/merge su `main` **non sono confermate dallo stato reale di git** — vedi intestazione documento e §12bis per il dettaglio.

Verifica del documento contro lo stato reale del branch `claude/lepefy-storefront-audit-69xss0` (5 commit, tutti locali, **mai pushati**) dopo un audit UI/UX completo dello storefront pubblico seguito da implementazione in 3 fasi più una passata di allineamento a un mockup di validazione approvato. Dettaglio completo in §12bis (sezione nuova). Correzioni apportate al resto del documento:

- **§2** — la nota "il verde `#1D9E75` è l'unico colore nel codice" era vera fino a questa fase ma descriveva anche un problema (hardcoding sparso, non solo un dato): riscritta per distinguere il valore DB attuale (invariato) dallo stato del codice (ora interamente token-based). Aggiunto il dettaglio delle 3 decisioni brand-charter-v2 effettivamente prese (font, colore come task dato, elemento signature) con la query SQL preparata e non eseguita.
- **§3** (tabella stack) — corretti i nomi dei CSS vars (`--primary`/`--secondary` → `--color-primary`/`--color-secondary`, mai stati questi i nomi reali nel codice).
- **§5** — aggiunta nota sul de-hardcoding completato per lo storefront pubblico.
- **§11** — colore/nome del banner PWA erano hardcoded (con un `TODO multi-tenant` esplicito mai risolto, scoperto durante l'audit) — ora corretti, sezione aggiornata.
- **§12** — la descrizione dell'hero ("verde scuro `#085041` con cerchi") era quella pre-redesign, ora obsoleta — riscritta per riflettere gradiente/pattern a triangoli/layout a due colonne introdotti in Fase 3.
- **§12bis** — nuova sezione, riepiloga le 3 fasi dell'audit UI/UX + la passata di allineamento al mockup, cosa è stato corretto, cosa resta aperto, la query SQL da eseguire.
- **§18** — riga "Decisione brand charter v2" aggiornata da "pendente" a "deciso" per font/elemento signature; aggiunte 3 righe nuove (push del branch, esecuzione query colore, destinazione CTA "Notre histoire").
- **§21** — aggiunto il mockup di validazione alla tabella documenti di riferimento.

Nessuna modifica alle sezioni non toccate da questo lavoro (shipping, checkout, admin auth, n8n, sistema etichette, feature IA, roadmap Phase 2) — verificate a campione, restano accurate rispetto a v3.3.

---

## 25. Changelog v3.5 (17 Luglio 2026) — branch pushato, colore live, CTA in roadmap

Chiusura operativa del redesign UI/UX documentato in v3.4: i due blocchi che risultavano ancora "solo pronti in locale" sono stati eseguiti manualmente da Robertin (workflow abituale: nessun ambiente locale, esecuzione via GitHub web UI + Supabase).

- **§1 (intestazione)** — branch `claude/lepefy-storefront-audit-69xss0` confermato pushato e mergiato su `main`; query colore confermata eseguita.
- **§2** — colore primario ChloeFood aggiornato da `#1D9E75` a **`#1267C7`** come valore DB live (non più "pronto ma non eseguito"). Aggiunta nota di coerenza su `tenant.accent_light`, non toccato dalla migrazione.
- **§12bis** — stato sezione da "⚠️ branch locale, non pushato" a "✅ live in produzione"; blocco migrazione dati aggiornato da "preparata, non eseguita" a "eseguita"; "Cosa resta aperto" ridotto al solo CTA hero + nota accent_light (push e query rimossi, essendo risolti).
- **§18** — righe push branch e query SQL segnate FATTO; riga CTA hero rimossa dalla checklist go-live e spostata in roadmap (vedi sotto), su richiesta esplicita: non è un blocco per il go-live, è una decisione di prodotto a sé.
- **§19** — aggiunte due righe roadmap Phase 2: decisione destinazione CTA "Notre histoire" (P1) e allineamento `accent_light` al nuovo blu (P2, non bloccante).

Nessuna modifica alle sezioni non toccate da questo aggiornamento rispetto alla revisione di v3.4 verificata da Claude Code.

---

## 26. Changelog v3.6 (18 Luglio 2026) — audit e redesign UI/UX pannello admin (Fase 0–4)

Aggiunto il resoconto completo di una sessione separata dedicata al pannello admin (`(protected)/page.tsx`, `OrdersTable.tsx`, `AdminFilters.tsx`, `AdminSidebar.tsx`), partita da un audit UI/UX (`AUDIT_ADMIN_UIUX.md`) e proseguita in 5 fasi + 2 addenda. **Differenza importante rispetto a v3.5**: questa revisione documenta lo stato riportato in chat dal committente (checklist di fine-fase confermate), non una verifica indipendente di Claude Code contro git/filesystem come le revisioni precedenti — vale la stessa cautela di "non ancora confermato" ovunque segnalato.

- **§8** — rimossa la nota "file morti da pulire" (ora eliminati); aggiornata la lista funzionalità con tabella responsive, dark mode, bulk actions, polling, blocco tracking obbligatorio; segnalato il bug pre-esistente della route picking-list (mai esistita, ora corretta) trovato durante il redesign, non dal lavoro precedente.
- **§8bis** — nuova sezione, riepiloga le 5 fasi + 2 addenda del redesign admin: cosa è stato fatto, le decisioni tecniche prese in sessione che divergono dal piano originale dell'audit (CSV invece di XLSX, notifiche rimandate, polling invece di Realtime), e un elenco esplicito di verifiche manuali segnalate ma mai confermate chiuse.
- **§18** — riga file morti admin segnata FATTO; aggiunte righe per il redesign admin (stato "implementato, deploy non confermato"), l'esecuzione pendente della KPI "Aujourd'hui", e la comunicazione a Dalice ancora da fare sulle due deviazioni.
- **§19** — aggiunta la voce "notifiche push vere per l'admin" (decisa con Dalice il 17/07, rimandata il 18/07); aggiunta la voce "Realtime vero per l'admin" come possibile upgrade futuro del polling attuale, con la condizione esplicita per cui vale la pena riprenderlo; aggiunta la voce estrazione componenti condivisi admin; annotata la riga esistente su `xlsx@0.18.5` con il collegamento alla scelta CSV fatta nel frattempo.
- **§21** — aggiunti `AUDIT_ADMIN_UIUX.md` e `admincommandesredesign.html` alla tabella documenti di riferimento.

Nessuna modifica alle sezioni relative allo storefront pubblico (§12bis e altre) rispetto a v3.5 — quel lavoro resta confermato live, non riverificato in questa sessione.

---

## 27. Changelog v3.7 (18 Luglio 2026) — verifica indipendente su git/filesystem, due correzioni

A differenza di v3.6 (basata sullo stato riportato in chat), questa revisione verifica il documento **direttamente contro il repository reale** (`git log`, `git merge-base`, `git diff main..HEAD`, lettura diretta dei file sorgente) sul branch `claude/update-lepefy-project-context-fke5jo`. Due correzioni rilevanti:

1. **KPI "Aujourd'hui" — da "non eseguita" a "eseguita".** v3.6 la segnalava ancora pendente ("prompt dato a Claude Code, in attesa"). Il codice mostra invece che è già implementata in `admin/(protected)/page.tsx` (prima KPI card, conteggio ordini di oggi + totale come sotto-riga). Causa della discrepanza: il commit che l'ha implementata (18/07, 23:03) precede cronologicamente il commit che ha scritto v3.6 (18/07, 23:42) — la chat riportata a Claude Code non rifletteva più lo stato reale del codice al momento della stesura. **§8, §8bis, §18 aggiornati.**

2. **Nessuno dei due redesign (storefront §12bis, admin §8bis) risulta mergiato su `main`.** Le revisioni v3.4–v3.6 affermavano che il branch storefront `claude/lepefy-storefront-audit-69xss0` fosse stato "pushato e mergiato su `main`". Verifica reale: quel branch non esiste (né locale né su `origin`); `git merge-base main HEAD` coincide con la punta di `main` stessa (ultimo commit 16/07 11:47); `ShopTag.tsx` non esiste su `main`; `BottomNav.tsx` su `main` ha ancora l'hex hardcoded `#1D9E75`. In realtà **tutto** il lavoro di entrambi gli audit (storefront 16–17/07, admin 17–18/07, 27 commit "Add files via upload" più le 3 delete) è finito su questo unico branch di lavoro, mai mergiato — coerente col workflow reale di Robertin (upload diretto GitHub web UI, non PR per feature). **Non verificabile da qui quale branch Vercel deploya effettivamente** (nessun `vercel.json` committato) — punto critico da chiarire con Robertin, aggiunto come voce propria in checklist go-live (§18). **Intestazione, §2, §5, §12bis, §8bis, §18 aggiornati**, changelog storici (§24) annotati con nota di correzione senza riscrivere la cronologia.

Scoperta aggiuntiva, non un errore ma un'omissione: **`AdminMobileNav.tsx`** (drawer di navigazione mobile per l'admin, commit 18/07 23:20) non era mai stato documentato — colma un gap reale (sidebar admin `hidden md:block`, nessuna navigazione alternativa sotto `md` prima di questo componente). Aggiunto a §8 e §8bis (nuovo "Addendum 2").

Nessuna modifica al resto del documento (shipping, checkout, n8n, sistema etichette, feature IA, roadmap Phase 2) — verificato a campione, resta accurato rispetto a v3.6.

---

## 27bis. Changelog v3.8 (21 Luglio 2026) — ciclo "Digital card evolution"

Copre una serie di prompt consecutivi sulla digital card (`/card`), tutti consegnati come diff/zip senza push diretto sul branch di lavoro — vedi note di verificabilità sotto per cosa resta da confermare live prima di considerare questo lavoro chiuso.

- **§11** — aggiunta nota sul bug dimensioni icona PWA: `/api/pwa-icon` ignorava `?size=` e serviva sempre lo stesso asset, causa concreta e verificata nel codice di un fallimento silenzioso di installazione Android (mismatch tra dimensioni dichiarate nel manifest e byte reali serviti, rifiutato dal servizio di minting WebAPK di Google). Fix applicato con `sharp`, verificato con uno smoke test locale ma **non** contro l'installazione reale su un dispositivo Android — resta un secondo sospetto aperto (doppio `<link rel="manifest">`, mai verificato contro l'HTML renderizzato).
- **§14** — esteso con quattro blocchi nuovi: metodi di pagamento (`tenant_payment_methods`, migration 030, CRUD admin, sezione "Comment payer" su `/card`, dati placeholder ancora attivi su ChloeFood — **da non condividere pubblicamente**), CRUD réseaux sociaux mai esistito prima (`tenant_social_links` esisteva dalla migration 017 ma senza UI/API), badge social e pagamento a colori brand (`badgeBackground` nel registro condiviso), poster stampabile A5 via Gotenberg riusato dal sistema etichette (bug pagina PDF vuota diagnosticato e correzione scritta, **verifica sul PDF reale ancora in sospeso**), shortcut home screen dedicato a `/card` con manifest separato dal negozio.
- **§14bis** — nuova sezione: route generica `PATCH /api/admin/tenant` con whitelist esplicita per i campi finora modificabili solo via SQL diretto (tagline, WhatsApp, click & collect, dati legali etichette), due sezioni UI in Paramètres che la condividono. Include due voci di debito tecnico scoperte durante il ciclo: logging verboso temporaneo da rimuovere su `/api/admin/payment-methods` (espone dettagli d'errore interni), e un pattern GRANT mancante confermato su due migration consecutive (017 e 030) confrontandolo con il pattern già stabilito altrove nel repo (018, 026, 027) — **possibile causa non confermata**, mai verificata live, del 500 diagnosticato in una sessione precedente sul salvataggio dei metodi di pagamento.

**Cosa resta esplicitamente non verificato, da chiudere prima di dichiarare il ciclo concluso:** (1) se il fix icona PWA basta da solo a sbloccare l'installazione Android segnalata, o se serve anche indagare il doppio manifest link; (2) se `metadata.manifest` in `card/page.tsx` produce davvero un solo `<link rel="manifest">` renderizzato, mai controllato contro HTML reale in nessuna sessione di questo ciclo (ambiente di sviluppo senza credenziali Supabase, `getTenant()` non eseguibile); (3) se il fix del PDF a pagina singola tiene sul poster generato realmente da Gotenberg, non solo sul calcolo manuale delle altezze CSS; (4) se il GRANT mancante su 017/030 è davvero la causa del 500 di `/api/admin/payment-methods`, o se la causa reale era altra (il logging verboso temporaneo aggiunto proprio per isolarla non ha mai ricevuto una risposta con l'errore reale in questa sessione).

Nessuna modifica alle sezioni relative a shipping, checkout, admin dashboard (§8/§8bis), storefront (§12bis), catalogo, IA, sistema etichette (§16) oltre al riuso esplicito di `lib/labels/gotenberg.ts` già segnalato sopra — verificato a campione, resta accurato rispetto a v3.7.

---

## 28. Changelog v3.9 (21 Luglio 2026) — ciclo "Sistema barcode + fix layout etichetta full-bleed"

Come v3.8, questa revisione documenta lo stato riportato in chat in questa sessione (report di esecuzione di Claude Code + screenshot di verifica di Robertin), **non** una verifica indipendente contro git/filesystem come v3.7 — vale la stessa cautela su "riportato" vs "confermato" ovunque segnalato.

- **§4** — aggiunte le colonne `tenants.barcode_prefix`/`barcode_sequence` e `products.barcode_value`/`barcode_generated_at` allo schema; aggiunte le migration `029_atomic_stock_decrement.sql` e `030_payment_methods.sql` alla tabella per colmare il salto numerico 028→031 (contenuto da lavoro precedente non riverificato in questa sessione, riportato per coerenza) e la nuova `031_barcode_system.sql` (contenuto verificato in questa sessione — typecheck pulito, checksum controllato a mano — **ma non ancora applicata al DB reale**).
- **§16** — nota aggiornata sul template `fullbleed.tsx`: non più solo "origine non implementata", ora rimanda a §16bis per i fix recenti (QR, barcode, shrink-to-fit, tabella nutrizionale).
- **§16bis** — nuova sezione: sistema barcode EAN-13 interno multi-tenant (formato, generazione automatica, deviazioni emerse in esecuzione), valutazione GS1 ufficiale non implementata (in attesa di risposta di Dalice su marketplace/wholesale), e i tre fix successivi al template full-bleed (QR mancante, barcode+QR impilati, shrink-to-fit, split tabella nutrizionale — quest'ultimo scritto ma non ancora eseguito). Elenco esplicito di cosa resta da verificare prima di chiudere il ciclo.
- **§18** — aggiunte quattro righe: apply migration 031, verifica visiva PDF reale Gotenberg, esecuzione prompt split nutrizionale, comunicazione a Dalice sulla natura interna del barcode.
- **§19** — aggiunta la voce "Registrazione GS1 Italy ufficiale" (P2, condizionata a una decisione di Dalice non ancora raccolta).

Nessuna modifica alle sezioni non toccate da questo aggiornamento (shipping, checkout, n8n, admin dashboard, storefront, catalogo, IA, digital card) rispetto a v3.8 — non riverificate in questa sessione, restano quanto documentato in precedenza.

---

## 29. Changelog v3.10 (21 Luglio 2026) — chiusura ciclo barcode/full-bleed

Chiusura dei punti aperti lasciati da v3.9, confermati da Robertin in chat (nessuna verifica indipendente contro git/filesystem in questa sessione).

- **§4** — migration 031 segnata applicata al DB.
- **§16bis** — titolo sezione aggiornato a "✅ migration applicata, PDF testato"; blocco GS1 riscritto: era curiosità di Robertin, non un'esigenza del progetto, **non perseguito** (nessuna voce roadmap residua); blocco fix full-bleed punto 4 (split nutrizionale) segnato eseguito e testato; elenco "cosa resta da verificare" sostituito da elenco "stato — ciclo chiuso", con un solo punto ancora aperto (comunicazione a Dalice sulla natura interna del barcode, non bloccante).
- **§18** — tre righe segnate FATTO (migration applicata, PDF testato, split nutrizionale eseguito).
- **§19** — rimossa la voce "Registrazione GS1 Italy ufficiale" — su richiesta esplicita di Robertin, non era un'esigenza reale.

Nessuna modifica alle sezioni non toccate da questo aggiornamento rispetto a v3.9.

---

## 30. Changelog v3.11 (23 Luglio 2026) — localizzazione titolo prodotto + prodotti correlati semantici

Come v3.8/v3.9, questa revisione documenta lo stato riportato in chat da Robertin ("Fatto e tutto ok"), non una verifica indipendente contro git/filesystem come v3.7.

- **§4** — nota aggiunta alla riga `products`: `name_alt` è oggi consumato anche dal titolo prodotto storefront, non solo dall'editor etichette admin; `embedding` è oggi riusato anche per i prodotti correlati.
- **§12bis** — nuova sottosezione "Fase 4": toggle FR/IT spostato dall'header globale alla scheda descrizione, titolo prodotto localizzato via `name_alt`, nuova sezione "Produits similaires" con similarità semantica come metodo primario (riuso `match_products`/embedding esistente, zero costo Gemini aggiuntivo) e repli su categoria, prodotti esauriti esclusi del tutto dal pool dei correlati. Nessuna migrazione DB — riusa solo oggetti già esistenti (migration 026, 028). Aggiunta anche una riga in "Cosa resta aperto" sul limite di `name_alt` a 2 lingue.
- **§13bis** — bullet "Toggle lingua FR|IT" aggiornato per riflettere lo spostamento a livello descrizione; aggiunta menzione del riuso di `match_products` per i correlati nella sottosezione ricerca semantica.
- **§18** — aggiunta una riga FATTO per il ciclo.
- **§21** — aggiunto il prompt `ClaudeCode_Prompt_ProductLocaleToggle_RelatedProducts.md` all'elenco dei documenti di riferimento.

Nessuna modifica alle sezioni non toccate da questo aggiornamento (shipping, checkout, n8n, admin dashboard, sistema etichette/barcode, digital card) rispetto a v3.10.

---

## 31. Changelog v3.12 (23 Luglio 2026) — Chatbox IA pubblica (fasi 1+2)

A differenza di v3.9/v3.11 (stato riportato in chat), questa revisione documenta lavoro **scritto e verificato direttamente in questa sessione** (`pnpm typecheck` verde dopo ciascuna delle due fasi) sullo stesso branch che aveva già prodotto v3.11 (`claude/storefront-lang-toggle-related-11741t`), più una **verifica indipendente contro git/filesystem reale** nello stile di v3.7: `git fetch origin main` + `git diff HEAD origin/main` confermano che Robertin ha già applicato entrambi gli zip di consegna direttamente su `main` (4 commit "Add files via upload", 24/07) — il codice chatbox esiste già su `main`, non solo su questo branch. Non verificabile da qui se le migration SQL 032/033 siano state eseguite su Supabase.

- **Intestazione** — nuova voce v3.12, con la scoperta della sincronizzazione già avvenuta su `main`.
- **§3** — aggiunti alla struttura repository: `products/[slug]/` (nota correlati), `api/chat/`, `api/admin/knowledge-base/` (+`[id]`), `admin/(protected)/ai-lab/`, `lib/ai/chatbox.ts`/`smallTalk.ts`; aggiunto un blocco `components/` (assente prima in questa sezione) con le aggiunte recenti (`ProductTitle.tsx`, `RelatedProducts.tsx`, `ChatWidget.tsx`) oltre a due file preesistenti mai elencati (`ProductCard.tsx`, `ShopTag.tsx`).
- **§4** — riga `tenants` estesa con `ai_chatbox_enabled`/`chatbox_extra_context`; nuova riga tabella `tenant_knowledge_base`; tabella migrations estesa con `032_ai_chatbox.sql`/`033_ai_chatbox_knowledge_base.sql` (entrambe rinumerate rispetto al prompt originale, che le chiamava `029`/`030` — già occupate); corretto il nome file della riga `030` (`030_tenant_payment_methods.sql`, non `030_payment_methods.sql` come scritto in v3.11).
- **§13bis** — aggiunta menzione del terzo riuso di `match_products` (dal chatbox, oltre a ricerca semantica e prodotti correlati).
- **Nuova §13ter** — sezione dedicata: architettura fase 1 (widget + ricerca semantica), fase 2 (filtro small-talk a costo zero, `tenant_knowledge_base` scritta sempre a mano, admin `/ai-lab`, wiring nel system prompt), perimetro escluso deliberatamente (allergeni/ingredienti/nutrizione/lotto/origine — mai risposti dall'IA), file toccati, cosa resta aperto (migration non confermate, tenant non abilitato, knowledge base vuota).
- **§18** — 3 nuove righe: applicare migration 032+033, abilitare `ai_chatbox_enabled` per ChloeFood, raccogliere contenuto reale da Dalice.
- **§19** — 2 nuove righe roadmap: promuovere i placeholder small-talk a voci knowledge base autentiche; estendere `name_alt` a jsonb per tenant multilingua futuri (limite già notato in v3.11, non ancora in roadmap).
- **§21** — aggiunti i due prompt Claude Code del ciclo (`ClaudeCode_Prompt_ChatboxIA.md`, `ClaudeCode_Prompt_ChatboxIA_Fase2.md`).

Nessuna modifica alle sezioni non toccate da questo ciclo (shipping, checkout, n8n, admin dashboard/redesign, sistema etichette/barcode, digital card, catalogo) rispetto a v3.11 — verificate a campione, restano accurate.

---

## 32. Changelog v3.13 (24 Luglio 2026) — conferma migration chatbox + roadmap contenuto

Come v3.9/v3.11, questa revisione documenta lo stato riportato in chat da Robertin ("migrazioni e seed sono state fatte"), non una verifica indipendente contro git/filesystem come v3.7/v3.12. Nessuna modifica di codice in questo ciclo — solo aggiornamento documentazione a valle di una discussione su costi, tono culturale e raccolta contenuto avvenuta nella stessa sessione che aveva prodotto il codice di v3.12.

- **Intestazione** — nuova voce v3.13.
- **§13ter** — riga "Stato" e sezione "Cosa resta aperto" aggiornate: migration 032+033 segnate confermate eseguite (non riverificate contro il DB reale); aggiunta la nota sulla bozza `chatbox_extra_context` non ancora eseguita (dati email/telefono/paesi consegna da confermare) e sulla duplicazione con `click_collect_hours`; formalizzata la regola "una voce = un concetto" per `tenant_knowledge_base` (con eccezione `greeting`); aggiunta nota sul comportamento del filtro small-talk su formulazioni non previste dal regex (degrada, non si rompe); aggiunto riferimento al questionario di raccolta contenuto per Dalice, preparato ma non ancora girato.
- **§18** — riga migration chatbox segnata ✅ FATTO; nuova riga per il popolamento di `chatbox_extra_context` (⚠️ DA FARE, bozza pronta); riga abilitazione tenant e riga raccolta contenuto Dalice mantenute ⚠️ DA FARE con nota aggiornata.
- **§19** — due nuove idee roadmap P3: unificare `chatbox_extra_context` con `click_collect_hours` esistente; import batch multi-voce per `tenant_knowledge_base` se il volume di contenuto cresce (non necessario per il volume iniziale).

Nessuna modifica alle sezioni non toccate da questo ciclo (shipping, checkout, n8n, admin dashboard/redesign, sistema etichette/barcode, digital card, catalogo, resto di §13ter) rispetto a v3.12.

---

## 33. Changelog v3.15 (26 Luglio 2026) — Product Detail Page + Home (grid/origine/footer) + form admin — tre cicli consolidati

**Nota sul livello di verifica:** questi tre cicli sono avvenuti nella stessa sessione (26/07) ma non erano mai stati registrati come changelog individuali finché non è stato ricaricato il documento a fine sessione. Tutti e tre hanno infine ricevuto un report dettagliato di file toccati e deviazioni esplicite (stile v3.6/v3.12) — il ciclo 3 (form admin) inizialmente era stato confermato solo con "tutto fatto e funzionante" senza dettaglio, poi integrato con report completo in un messaggio successivo. Le migration 035/036 sono confermate eseguite su Supabase in chat, non riverificate contro il DB reale da questa sessione (stesso trattamento riservato altrove in questo documento, es. §32/§13ter per le migration chatbox).

### Ciclo 1 — Product Detail Page

Partito da un design handoff esterno (`Miglioramento_pagina_prodotto_e-commerce.zip`, prototipo HTML) rivisto e corretto prima dell'esecuzione — non applicato pixel-per-pixel:

- **Colori**: nessun oklch/hex fisso introdotto; il prototipo usava un verde con 5-6 varianti tonali fisse, sostituite da derivazione via `color-mix()` da `--color-primary` (token già esistenti da §12bis, nessun nuovo file necessario).
- **Recensioni**: il prototipo mostrava rating/conteggio finti ("4.8, 127 avis") — rimossi del tutto. `ProductTabs.tsx` ha solo 2 tab (Ingrédients&Allergènes, Conservation), niente tab Avis — la feature "Avis et notes clients" resta non costruita (roadmap, §19).
- **Galleria** (`ProductGallery.tsx`): thumbnail renderizzate solo se `product.images.length > 1` — oggi ogni prodotto ha una sola immagine reale, quindi il componente è già pronto per la futura pipeline foto multi-immagine (rembg/sharp, mai implementata) senza bisogno di rifarlo.
- **Spec row** (`ProductSpecs.tsx`): Poids da `net_quantity_display`/`weight_grams`, Origine da `country_of_origin`, **Conservation da un'etichetta breve mappata da `storage_type`** (`dry→Ambiant`, `fresh→Réfrigéré`, `frozen→Congelé`) — deliberatamente NON il testo lungo di `conservation_instructions` (quello resta nella tab). Colonne assenti se il campo sorgente è NULL, mai un valore inventato.
- **Font**: Fraunces del prototipo scartato — riusato `--font-display` (Bricolage Grotesque) già in uso in piattaforma, deviazione comunicata esplicitamente da Claude Code invece di applicata in silenzio.
- **Trust badge** (`TrustBadges.tsx`): 3 iterazioni di stile su feedback screenshot — da testo inline nudo, a chip con sfondo piatto (troppo simile allo sfondo pagina), a versione finale bianco + bordo 1px + `box-shadow: 0 1px 3px rgba(0,0,0,0.06)` (elevazione minima, non un pulsante). Claim ammorbiditi rispetto al prototipo: "Livraison suivie" (non "sous 48h", SLA non confermato), "Conservé au frais" condizionato a `storage_type` del prodotto, "Emballage soigné" al posto di "Satisfait ou remboursé" (garanzia di rimborso non confermata contrattualmente).
- **`products.is_homemade`** (migration `035`, rinumerata da `030` per collisione): boolean, default `false`, nessun prodotto attivato dalla migration — badge "Fait maison" mostrato solo se esplicitamente attivato per prodotto, mai dedotto dal nome/categoria.
- **`packages/types/product.ts`**: esposti nel tipo `Product` i campi etichetta già esistenti dalla migration 018 (`ingredients_text`, `allergens_text`, `gluten_free_certified`, `usage_instructions`, `conservation_instructions`, `conservation_after_opening`, `country_of_origin`, `net_quantity_display`) — stessa fonte dati del sistema etichette stampate, mai duplicata altrove (rilevante perché evita di ripetere l'errore già noto Bobolo/Foufou, §16).
- Report ricevuto: `pnpm typecheck` pulito, zip inviato senza push (working tree con modifiche non committate), elenco file completo, 2 deviazioni segnalate esplicitamente (font, numerazione migration).

### Ciclo 2 — Home: grid vedettes + "Notre origine" + footer + revert BottomNav

Partito da un secondo design handoff (`Home_Boutique_dc.html`, homepage completa, stesso design system della pagina prodotto) — la maggior parte (header, ticker, hero, trust-row, card prodotto) risultava già live da cicli precedenti; il resto mappato sezione per sezione prima di scrivere il prompt, con scelta esplicita dell'utente su quali sezioni includere (grid vedettes + quick-add, "Notre origine", footer — NON i category chip a filtro, NON la newsletter, entrambi lasciati fuori scope).

- **"Nos produits vedettes"**: da scroll orizzontale (`variant="shelf"`) a vera grid (`variant="grid"`, bottone quick-add rotondo 44px già esistente nel componente `ProductCard`, riuso puro non feature nuova). Le sezioni per categoria sotto restano scroll orizzontale, decisione di piattaforma invariata (§12).
- **Sezione "Notre origine"** (`StorySection.tsx`, migration `036`): condizionale su `tenants.story_text` (NULL → sezione non renderizzata, niente placeholder). Statistica prodotti = `count(*)` reale su `products active=true`, mai hardcoded (il prototipo mostrava "120+" fisso). `countries_served` mostrato solo se non NULL — mai un numero stimato. CTA hero "Notre histoire" ricollegato a `#origine` (anchor), nascosto se la sezione non è visibile.
- **Recensioni/testimonianze**: il prototipo homepage conteneva anch'esso recensioni finte ("Ils nous font confiance", 3 nomi/quote inventati) — stessa decisione presa sulla pagina prodotto, scartate esplicitamente, non implementate.
- **Footer**: reso condizionale per pagina — versione estesa a colonne SOLO in home (`pathname === '/'`), versione minimale invariata altrove. Motivo: un footer di navigazione pesante compete con la bottom nav fissa su mobile se ripetuto su ogni schermata (valutazione UX esplicita, non solo estetica). Colonne "Boutique"/"Aide" del prototipo omesse per intero — nessuna pagina reale dietro Catalogue (duplica la bottom nav, tolto anche per quello), Nouveautés, Promotions, Livraison, Retours, Contact, Nos producteurs. Instagram tramite `tenant_social_links` già esistente (migration 017), nessuna nuova tabella. Claude Code ha riportato esplicitamente cosa ha omesso e perché, invece di linkare a pagine vuote.
- **Ticker**: colore corretto da `color-mix(... 25% ...)` (letto come nero puro) a `55%` (riconoscibile come tinta brand), su feedback diretto dopo il deploy.
- **BottomNav — revert**: la decisione v3.14 (Tabler→emoji) invertita di nuovo solo per la BottomNav, su richiesta esplicita — hero trust-row e ticker restano emoji, perimetro esplicitamente limitato nel prompt per evitare un revert generale non richiesto.
- Report ricevuto: elenco file completo, `pnpm typecheck` pulito, zip senza push, 3 omissioni footer segnalate esplicitamente con motivazione.

### Ciclo 3 — Form admin "Notre origine"

Estende `/admin/parametres` riusando il pattern esistente (`EDITABLE_TENANT_FIELDS` whitelist su `PATCH /api/admin/tenant`, componente `BoutiqueInfoSection.tsx` come stampo) invece di crearne uno nuovo. `story_image_url` deliberatamente escluso dalla whitelist testuale — si aggiorna solo tramite l'endpoint di upload dedicato (`upload-story-photo` già creato nel ciclo 2), stesso pattern già in uso per gli asset etichetta.

- **Whitelist**: `story_heading`/`story_text`/`countries_served` aggiunti a `EDITABLE_TENANT_FIELDS`; `countries_served` trattato come campo numerico dedicato (stringa vuota → `null`, nessun minimo forzato — coerente con la regola "mai un numero non confermato").
- **`OriginSection.tsx`**: stesso schema di `BoutiqueInfoSection.tsx` (props/valori iniziali, `useState`, PATCH su save, toast) + dropzone upload ricalcata su `ProductEditClient.tsx` (stato "Envoi...", anteprima immediata via `URL.createObjectURL` poi sostituita dall'URL reale). L'upload foto è indipendente dal pulsante Save principale — si scrive su `tenants.story_image_url` al momento del caricamento, non in coda al resto del form.
- **Inserimento**: `<OriginSection>` tra `BoutiqueInfoSection` e `SocialLinksSection` in `parametres/page.tsx`, valori iniziali dal tenant già caricato server-side.
- **Nota tecnica emersa**: un tentativo di `pnpm lint` durante l'esecuzione ha innescato il setup interattivo ESLint (mai completato in questo repo) e modificato accidentalmente `tsconfig.json`/`next-env.d.ts` — ripulito prima della consegna. Utile saperlo per cicli futuri: **non lanciare `pnpm lint` in questo repo**, non è configurato.
- Report ricevuto: `pnpm typecheck` pulito, elenco file completo per tutti e 3 i task.

### Altri aggiornamenti in questo changelog
- **§3** — nuovi file: `ProductDetail.tsx`, `ProductGallery.tsx`, `ProductSpecs.tsx`, `ProductTabs.tsx`, `TrustBadges.tsx`, `StorySection.tsx`, endpoint `upload-story-photo`, route `admin/tenant` esplicitata.
- **§4** — righe `tenants`/`products` estese; nuove righe migration `034` (occupata, contenuto non identificato), `035`, `036`.
- **§12** — grid vedettes, card hero cliccabili, colore ticker, footer condizionale.
- **§18** — 6 nuove righe (redesign product page FATTO, migration 035/036 da eseguire, popolamento story da fare, `is_homemade` da attivare per prodotto, ciclo home FATTO, form admin non verificato, pagine legali mancanti da creare).
- **§19** — CTA "Notre histoire" segnato FATTO; 2 nuove voci (pagine Livraison/Retours/Contact/FAQ mancanti; recensioni/rating ancora non costruito, riconfermato in questo ciclo).
- **§21** — 6 nuovi riferimenti (2 design handoff esterni, 4 prompt Claude Code del ciclo).

Nessuna modifica alle sezioni non toccate da questo ciclo (shipping, checkout, n8n, admin dashboard/redesign, sistema etichette/barcode stampa, digital card, chatbox IA §13ter) rispetto a v3.14.

---

## 34. Changelog v3.16 (26 Luglio 2026) — verifica di coerenza contro filesystem/repo reale

Passata di controllo coerenza richiesta esplicitamente (non un nuovo ciclo di feature): rilettura del documento intero e confronto puntuale con `git`/filesystem sul branch di lavoro corrente. Nessuna modifica al codice applicativo in questa sessione — solo correzioni a questo documento.

### Cosa è stato verificato

- **`git status`**: working tree pulito. **`git merge-base main HEAD`** coincide con la punta di `main` (`9873b22`) — confermato ancora una volta che questo branch di lavoro è avanti rispetto a `main` e non ci è stato rimergiato, coerente con lo stato riportato da v3.7 in poi (nessuna novità, solo riconferma).
- **`ls supabase/migrations/`**: 41 file, non ~39. Due lacune trovate:
  1. **`031_storefront_ready.sql`** esiste sul filesystem e non era mai menzionato in questo documento — collide sul numero 031 con `031_barcode_system.sql` (due file distinti con lo stesso prefisso, non un refuso). Aggiunge `tenants.storefront_ready` (default `true`); se `false`, `/card` mostra "boutique bientôt disponible" al posto del link al catalogo. Confermato usato nel codice reale (`card/page.tsx`, `DigitalCard.tsx`, `packages/types/tenant.ts`). Documentato ora in §4 e §14.
  2. **`034_click_collect_hours_it.sql`** era segnato in v3.15 come "contenuto non identificato" — letto il file: aggiunge `tenants.click_collect_hours_it` (versione italiana degli orari click & collect, fallback sul campo francese se NULL). Confermato cablato end-to-end: nella whitelist `EDITABLE_TENANT_FIELDS` (`api/admin/tenant/route.ts`), nel form `BoutiqueInfoSection.tsx`, nel tipo `Tenant`. Documentato ora in §4 e §14bis.
- **Componenti nuovi di §33** (`ProductDetail.tsx`, `ProductGallery.tsx`, `ProductSpecs.tsx`, `ProductTabs.tsx`, `TrustBadges.tsx`, `StorySection.tsx`, `api/admin/upload-story-photo/route.ts`): tutti presenti sul filesystem, nessuna discrepanza.
- **`products.is_homemade`**: presente in `packages/types/product.ts` e letto/passato in `ProductDetail.tsx` e `products/[slug]/page.tsx` — coerente con §33.
- **BottomNav**: conferma icone `@tabler/icons-react` (`IconSmartHome`/`IconCategory`/`IconShoppingBag`/`IconTruckDelivery`), coerente col revert documentato in §12/§33 (non più emoji).
- **AdminSidebar**: voce "IA — Base de connaissance" verso `/admin/ai-lab` presente, coerente con §13ter.

### Cosa NON è stato riverificato in questa passata (fuori dal perimetro di un controllo di coerenza documentale)

Stato Supabase reale (nessuna credenziale disponibile in questo ambiente — stesso limite di tutte le sessioni precedenti), deploy Vercel/dominio quale branch serve `chloefood.com`, contenuto delle migration 029/030 (già segnalate nelle revisioni precedenti come "riga aggiunta per coerenza numerica, non riverificata" — non riaperto qui perché non contraddetto da nessuna nuova evidenza).

### Altri aggiornamenti in questo changelog
- **§4** — due nuove righe migration (`031_storefront_ready.sql`, `034_click_collect_hours_it.sql` ora con contenuto reale) + nota di verifica sul conteggio file.
- **§14** — aggiunto paragrafo `tenants.storefront_ready`.
- **§14bis** — aggiunta menzione `click_collect_hours_it` nella whitelist campi tenant.

Nessuna modifica alle altre sezioni — il resto del documento (§1–§3, §5–§13ter, §15–§33) è stato riletto integralmente in questa sessione e risulta coerente con quanto trovato sul filesystem, nessun'altra discrepanza rilevata.

---

## 35. Changelog v3.17 (31 Luglio 2026) — Autenticazione cliente + `admin_users` + Sistema Loyalty/Referral multi-tier

Ciclo più corposo del progetto ad oggi in termini di superficie DB toccata in una sola sessione. Basato sullo stato riportato in chat da Robertin (typecheck confermato pulito, flusso end-to-end verificato per il sistema loyalty) — **nessuna verifica indipendente contro git/filesystem in questa sessione**, coerente con l'approccio delle revisioni v3.8–v3.15 (a differenza delle passate di verifica esplicite v3.7/v3.16).

### Cosa è stato aggiunto in questo ciclo

1. **Autenticazione cliente** — Supabase Auth, OTP email a codice 6 cifre (non magic link, per non rompere il contesto PWA su iOS/Android), login opzionale al checkout (guest checkout preservato ma senza punti/referral). Due migration impreviste emerse durante il debug (`037_checkout_sessions_customer_id.sql`, `038_customers_grants.sql`).
2. **`admin_users`** — sostituisce la whitelist `ADMIN_EMAILS`, introduce ruoli `platform_owner`/`tenant_admin` con scoping. `requireAdmin()` cambia firma in `requireAdmin(tenantId)`.
3. **Pagina storico ordini `/orders`** — riusa il pattern token HMAC esistente di `/orders/[id]`. Voce "Compte" aggiunta al BottomNav mobile (punto d'ingresso mancante, corretto in sessione).
4. **Pre-compilazione checkout** per clienti autenticati.
5. **Sistema Loyalty/Referral multi-tier** (`040_loyalty_referral_system.sql` — **corretto in v3.18**: era citata come `039_...`, ma quel numero appartiene ad `admin_users`; la cascata di collisioni è tripla — 037+038+039 — non doppia come scritto qui originariamente) — albero referral a profondità configurabile (default 2, max 5, tetto hard), percentuali per livello versionate per tenant, ledger punti append-only con anti-frode graduato, eleggibilità codice referral configurabile, link `/invite/[code]`, concept UI "la corda dei cartellini" (**corretto in v3.18**: componente separato con la stessa geometria di `ShopTag.tsx`, non una sua estensione — vedi §9bis) con albero referral visibile lato utente. **Otto** bug intercettati e corretti durante l'esecuzione (dettaglio in §9bis — corretto in v3.18 da "sette": un ottavo, distinto, emerso in produzione e documentato solo da `042_customers_service_role_grant.sql`, non ancora in questo changelog quando fu scritto), inclusi due pattern già noti nel progetto (RLS senza `GRANT` esplicito; client service usato al posto del client di sessione).

Dettaglio architetturale completo, motivazioni delle scelte tecniche, e tabella bug→causa→fix in **§9bis** (nuova sezione).

### Cosa NON è stato ancora fatto (aperto in roadmap/checklist)

- Configurazione percentuali/profondità referral specifica per ChloeFood
- Comunicazione a Dalice del nuovo programma loyalty/referral
- Impostare Dalice come `tenant_admin` in `admin_users`
- Verificare se `ADMIN_EMAILS` può essere rimossa dalle env Vercel

### Altri aggiornamenti in questo changelog

- **§4** — riga `customers` aggiornata (FK ora effettivamente in uso, colonna `referral_code` rimossa), nuova riga `admin_users`, nuova riga riassuntiva 7 tabelle loyalty/referral, tre nuove migration in tabella.
- **§8** — sezione autenticazione admin aggiornata con `admin_users` e nuova firma `requireAdmin(tenantId)`.
- **§9** — stato Phase 2 aggiornato da "non avviata" a fatto, con rimando a §9bis.
- **§9bis** — nuova sezione, dettaglio completo del ciclo.
- **§18** — 8 nuove righe checklist go-live.
- **§19** — 2 righe portate da "Non avviato" a "✅ FATTO", 2 nuove righe roadmap.
- **§21** — 2 nuovi riferimenti prompt Claude Code.

Nessuna modifica alle sezioni non toccate da questo ciclo (shipping, checkout prezzi/spedizione, n8n, sistema etichette/barcode stampa, chatbox IA, home/product page storefront) rispetto a v3.16.

---

## 36. Changelog v3.18 (31 Luglio 2026) — verifica di coerenza contro filesystem/git reale

Passata di controllo coerenza richiesta esplicitamente contro v3.17, che era stata scritta sulla base dello stato riportato in chat da Robertin senza verifica indipendente (vedi apertura §35). Stesso tipo di lavoro già fatto in v3.7 e v3.16. Nessuna modifica al codice applicativo in questa sessione — solo lettura, verifica, e correzioni a questo documento.

### Cosa è stato verificato

- **`git status`**: working tree pulito. **`git merge-base main HEAD`** coincide con la punta di `main` (`0fee676`) — HEAD è 5 commit avanti, `main` ha 0 commit non presenti in HEAD (la storia di `main` è interamente contenuta in questo branch). **Diversamente da ogni verifica precedente** (v3.7, v3.16 — sempre "nulla mergiato"), qui la maggior parte del ciclo 31/07 risulta **già su `main`**: confermato con `diff` byte-per-byte contro `git show main:...` per le migration `037`–`043`, `requireAdmin.ts`, `admin/(protected)/loyalty/page.tsx`, `ReferralRope.tsx`, `BottomNav.tsx` — tutti identici tra questo branch e `main`. Solo un sottoinsieme resta non mergiato: `044_customer_default_address.sql` + la pagina `/orders` (`OrdersListClient.tsx` e satelliti) + le modifiche a `CheckoutForm.tsx`/`api/checkout/route.ts`/`api/customers/me/route.ts`/`lib/customers/*` per la pre-compilazione checkout — corrispondenti esattamente ai punti 3 e 4 di §9bis.
- **`ls supabase/migrations/`**: 49 file su questo branch (48 su `main`), non le "3 nuove migration" implicite dall'intestazione v3.17. Il file `039_loyalty_referral_system.sql` citato ovunque in v3.17 **non esiste**: `039` è `admin_users.sql` (migration distinta, mai citata in v3.17), il sistema loyalty è realmente `040_loyalty_referral_system.sql`. Lette per intero anche `041`, `042`, `043`, `044` — nessuna era documentata prima d'ora.
- **`040_loyalty_referral_system.sql` letta per intero**: confermate 4 tabelle nuove (`referral_codes`, `tenant_referral_tiers`, `points_ledger`, `referral_fraud_signals`), 1 vista (`customer_points_balance`), alterazioni a `tenants`/`customers`/`orders`, e 4 funzioni Postgres (`resolve_referral_chain`, `resolve_referral_downline`, `apply_referral_on_signup`, `process_order_points_atomic`) — solo la prima era citata per nome in v3.17.
- **File applicativi elencati nel prompt di verifica**: tutti trovati e confermati — `src/lib/auth/requireAdmin.ts` (firma `requireAdmin(tenantId)` esatta), `src/lib/auth/getSessionCustomer.ts`, 12 file sotto `lib/loyalty/*.ts`, 8 route sotto `/api/admin/loyalty/*` + 5 sotto `/api/loyalty/*`, pagina `/orders` (storico, distinta da `/orders/[id]`), pagina login cliente `/compte/connexion`, voce "Compte" in `BottomNav.tsx` (→ `/compte/connexion`, confermata su `main`).
- **UI "corda dei cartellini"**: esiste (`RopeTag.tsx` + `ReferralRope.tsx`, montati in `/compte/parrainage`) — ma **non** estende `ShopTag.tsx` come affermava v3.17: è un componente separato per esplicita scelta documentata nel codice. Trovati anche `LockedTagProgress.tsx` e l'intera UI admin `/admin/loyalty` (4 sezioni), nessuno dei due citato in v3.17.
- **`customers.referral_code`**: confermato rimosso (`043_drop_redundant_customer_referral_code.sql`) — ma la colonna era stata aggiunta nello stesso ciclo (`040`), non un residuo pre-esistente come implicava v3.17.
- **`ADMIN_EMAILS`**: zero occorrenze in `apps/storefront/**/*.{ts,tsx}` (`grep` a vuoto) — codice interamente migrato a `admin_users`, nessun fallback residuo lato applicazione.
- **`admin_users` per Dalice**: nessun `INSERT INTO admin_users` in alcuna migration — coerente con lo stato "DA FARE" già indicato in v3.17.

### Cosa NON è stato verificato (non verificabile da questo ambiente)

Stato Supabase reale (nessuna credenziale disponibile — stesso limite di ogni sessione precedente): se esista già una riga `admin_users` per Dalice creata a mano da Supabase Dashboard (il progetto crea così gli account admin, vedi CLAUDE.md) non è verificabile da qui — solo l'assenza di un `INSERT` in migration lo è. Deploy Vercel/dominio, cioè quale branch serve realmente `chloefood.com` (punto aperto dalla v3.7, non riaperto qui perché nessuna nuova evidenza). Env Vercel reali — se `ADMIN_EMAILS` sia ancora impostata lì (solo l'assenza lato codice è verificabile da qui). Contenuto delle migration `029`/`030` (già segnalate come non riverificate dalle revisioni precedenti, non riaperto qui). Nessuna incoerenza trovata in questa sessione ha richiesto una correzione di codice applicativo — come da istruzioni del prompt, nessun file applicativo è stato toccato, solo questo documento.

### Altri aggiornamenti in questo changelog

- **§4** — aggiunta la riga mancante `039_admin_users.sql`, corretto il numero file del sistema loyalty (`039`→`040`), aggiunte righe `041`–`044`, corrette le descrizioni "7 tabelle" e le righe `customers`/`admin_users`.
- **§8** — nota `ADMIN_EMAILS` aggiornata con conferma "zero riferimenti nel codice".
- **§9bis** — punti 3 e 4 annotati come non mergiati su `main`; punto 5 corretto (numero file, conteggio tabelle/funzioni, chiarimento su `ShopTag.tsx`, componenti/UI non citati prima); tabella bug estesa a 8 righe; paragrafo "Stato" riscritto per riflettere lo split main/branch.
- **§18/§19** — righe checklist/roadmap divise dove necessario (auth cliente vs `/orders` vs pre-compilazione checkout), stato "confermato su `main`" aggiunto dove verificato.
- **§21** — corretto il nome file migration nel riferimento al prompt loyalty.
- **§35** — corretto nome file migration, numero di collisioni (due→tre), chiarimento su `ShopTag.tsx`, conteggio bug (sette→otto) nel proprio changelog storico.

Nessuna modifica alle altre sezioni — il resto del documento (§1–§3, §5–§8bis, §9–§17, §20, §22–§34) è stato riletto o controllato a campione in questa sessione e risulta coerente con quanto trovato sul filesystem/git, nessun'altra discrepanza rilevata.

---

## 37. Changelog v3.19 (3 Agosto 2026) — cinque cicli 1–3 agosto, **nessuna verifica contro filesystem/git in questa sessione**

**Metodo di questa revisione:** aggiornamento basato esclusivamente su ricerca nelle chat del progetto (`conversation_search`/`recent_chats`), coerentemente con la distinzione che il documento mantiene da v3.7 in poi tra "riportato in chat" e "verificato contro filesystem/git reale". Nessuno dei cinque cicli sotto è stato riverificato da questa sessione — dove l'esecuzione stessa non è confermata in chat, è segnalato esplicitamente.

### 1. Integrazione design "Mon compte" (`/compte`) — 31/07

Design handoff ricevuto come ZIP (`account-page-1a.html` + `README.md`). Claude ha analizzato il mockup e segnalato le violazioni multi-tenant prima di generare il prompt: colori `oklch()` hardcoded (da convertire in `var(--color-primary)`/`color-mix()`), brand/logo "Chloe Food" cablato, emoji al posto delle icone Tabler, dati loyalty statici invece che dal ledger reale, CTA non collegate ai flussi backend esistenti. Struttura visiva e gerarchia del design considerate vincolanti; solo il livello di implementazione corretto.

Prompt salvato come `ClaudeCode_Prompt_AccountPage.md`, con Step 0 obbligatorio (verifica esistenza `/compte/page.tsx`, funzioni lettura loyalty lato cliente, pattern `ShopTag.tsx`, schema `customers`/`addresses`, route referral, campi `TenantProvider`) e divieto esplicito di toccare `connexion/page.tsx`, `OtpLoginForm.tsx`, l'iniezione CSS in `layout.tsx`, le migration loyalty, `BottomNav.tsx`.

**Stato: prompt generato, esecuzione non confermata in chat.** Da verificare con Robertin prima di segnare come fatto.

### 2. Integrazione redesign home page — 1–2/08

Pacchetto design esterno ("Redesign_Homepage_E-commerce_Food") analizzato e integrato parzialmente. Claude ha segnalato le violazioni multi-tenant del pacchetto originale (branding "Baobab Market" hardcoded, colori oklch fissi, font non caricati) e i conflitti con decisioni precedenti (26/07: grid con quick-add invece di scroll orizzontale per i prodotti vedette — decisione poi **invertita** in questa sessione dopo revisione mockup).

Quattro elementi integrati in un unico prompt Claude Code: hero carousel, category blocks a scroll orizzontale, riga "Suggestions pour vous", restyling FAB chat — più un quinto elemento aggiunto su richiesta: form admin CRUD per gestire gli hero slides. Mockup HTML interattivo generato con i token reali ChloeFood (primary `#1267C7`, secondary `#F2C811`, font Bricolage Grotesque + Inter) con toggle live grid/scroll per validare la scelta prima di procedere.

**Eseguito da Robertin.** Ciclo di fix successivo dopo test dal vivo: i category blocks comparivano in fondo alla pagina invece che dopo "Nos produits vedettes"; la sezione vedette necessitava conversione da grid multi-riga a riga singola scrollabile; l'autoscroll dei category blocks non si muoveva, mostrava un artefatto di sfondo trasparente durante il drag manuale, e su desktop non c'era un modo utilizzabile di scorrere orizzontalmente. Fix strutturato con diagnosi Step 0 obbligatoria (loop JS silenziosamente cancellato, falsi positivi `prefers-reduced-motion`, inizializzazione pausa errata, `metàLarghezza` calcolata a `0`/`NaN` prima che le dimensioni DOM siano disponibili) invece di assumere le cause. Soluzione: autoscroll via `scrollLeft` + `requestAnimationFrame` (non transform CSS, incompatibile con lo scroll nativo simultaneo), `prefers-reduced-motion` verificato via `matchMedia`, layout differenziato per breakpoint (autoscroll solo mobile `<md`, grid completa multi-riga su desktop) implementato con classi responsive CSS (`hidden md:grid`/`md:hidden`) invece di `matchMedia` in JS, per evitare flash di layout sbagliato.

**Stato: eseguito e testato dal vivo da Robertin (bug reali intercettati e corretti in un secondo giro). Nessun `pnpm typecheck` esplicitamente riportato in chat per nessuno dei due prompt** — da confermare/richiedere a Robertin.

### 3. Digital card: link di pagamento diretto + PDP: riordino `ProductSpecs` — 2/08

Due richieste distinte nella stessa sessione:

- **Digital card (`/card`):** nuovo campo opzionale "link di pagamento diretto", da mostrare prima di IBAN/email (es. PayPal: link cliccabile + email copiabile insieme). Soluzione: riuso della colonna `extra jsonb` già esistente su `tenant_payment_methods` con nuova chiave `link` — **nessuna migration necessaria**. Prompt copre route API (POST e PUT), form admin (`PaymentMethodsSection.tsx`), `DigitalCard.tsx`. Corretto in sessione un errore nel mockup di Claude (IBAN mostrato mascherato): confermato che nel codice reale l'IBAN è sempre visualizzato per intero — mockup e prompt aggiornati per vietare esplicitamente `maskSensitiveValue()` su quel campo. Richiesto anche di rendere il box di copia (`CopyableValue`) visivamente più prominente.
- **PDP:** sezione `ProductSpecs` (Poids/Origine/Conservation) spostata da dopo la descrizione a subito dopo il prezzo. Trattamento colore vivace valutato e approvato su mockup via `color-mix(in srgb, var(--color-primary) ..., white)` — coerente con la convenzione esistente di derivare i colori da `var(--color-primary)`, nessun hex hardcoded. Prompt copre `ProductDetail.tsx` (solo riordino) e `ProductSpecs.tsx` (solo markup, logica di calcolo colonne invariata).

**Stato: entrambi i prompt generati e approvati su mockup, esecuzione non confermata in chat.**

### 4. Due nuovi sistemi progettati (non eseguiti) — 2/08

**a) Programma "Ambassadeur"** (rinominato da "influencer" su suggerimento di Claude, per riflettere un referral community-based piuttosto che reach social). Sistema separato dal Loyalty/Referral esistente (`040_loyalty_referral_system.sql`), pensato per riusare `referred_by_id`/`referral_codes`/`/invite/[code]`/segnali anti-frode senza duplicare l'attribuzione. Decisioni chiuse in sessione:
- Commissione in **euro reali** (non punti), pagata manualmente fuori piattaforma al raggiungimento di un tetto configurabile per tenant
- Modello proporzionale: soglia minima di spesa + commissione minima configurabili → tasso derivato (`rate = commissione_minima / soglia_minima`), applicato all'importo **effettivamente pagato** dal cliente referenziato (post-sconto, non pre-sconto — scelta esplicita per proteggere il margine)
- Sconto opzionale al primo ordine per il cliente invitato (percentuale o importo fisso, a scelta del tenant); se applicato, **niente punti fedeltà** su quel primo ordine per il cliente invitato — dal secondo ordine i punti valgono normalmente
- Gli ambassador non guadagnano mai punti fedeltà propri sulle commissioni; toggle `ambassador_loyalty_from_second_order` per abilitare punti su ordini successivi del referenziato
- Promozione ad ambassador solo manuale da admin; l'ambassador deve completare profilo (nome, cognome, IBAN o PayPal) prima di diventare pagabile
- Nuova tabella dedicata `ambassador_commissions` (separata da `points_ledger`), vincolo `unique` a livello DB per garantire "solo il primo acquisto"
- **Analisi di sostenibilità fornita**: il modello è sano come costo di acquisizione cliente (CAC) una tantum, non come revenue share ricorrente; il rischio reale è sommare uno sconto alto **e** un tasso di commissione alto sulla stessa transazione, che può portare a margine negativo — consigliato partire conservativi e monitorare il tasso di riacquisto a 60-90 giorni prima di alzare le leve. Segnalato anche un possibile obbligo fiscale per ambassador che ricevono pagamenti cash ricorrenti (da verificare con commercialista)
- Prompt Claude Code (`ClaudeCode_Prompt_AmbassadorCommissionSystem.md`) generato con Step 0 obbligatorio che include la localizzazione precisa (non assunta) del punto dove oggi scatta `process_order_points_atomic` alla consegna ordine, e del punto esatto nel flusso checkout/pricing dove innestare lo sconto (probabilmente vicino alla logica HMAC di validazione spedizione)

**Stato: solo prompt pronto in output — non inviato/eseguito.**

**b) Carta fedeltà fisica/virtuale con accumulo punti in negozio.** Ogni cliente riceve un numero di carta fedeltà EAN-13 a 13 cifre (namespace `21`, distinto dal namespace `20` usato dai barcode prodotto, stesso algoritmo check-digit). Gli acquisti in negozio vengono registrati in una nuova tabella dedicata `loyalty_manual_purchases` (non ordini finti), generando una nuova voce `IN_STORE_PURCHASE_EARNED` nel `points_ledger` esistente. Introdotto un nuovo ruolo `tenant_cashier`, deliberatamente valutato e scoperto necessario: dato che la piattaforma ora conserva anche dati IBAN/PayPal degli ambassador, dare accesso pieno `tenant_admin` a personale cassa part-time esporrebbe dati finanziari sensibili — il ruolo cashier è quindi scoperto esclusivamente su `/admin/loyalty/scan`, fuori dal gruppo layout `(protected)` dell'admin. Pagina carta fedeltà completa `/compte/carte-fidelite` mostra sia QR che barcode lineare a piena scala. Richiesto anche un widget dashboard che sostituisca il banner punti verde esistente: proporzioni fisiche di una vera tessera (aspect ratio ~1.586:1), nome brand, nome cliente, saldo punti, barcode lineare visibile direttamente sulla card (riuso della funzione `renderBarcodeSVG` esistente, nessuna duplicazione) — il QR resta solo nella vista ingrandita. Card interamente tappabile, naviga alla pagina completa per affidabilità di scansione o accesso al QR.

**Stato: solo decisioni chiuse in chat — generazione/invio del prompt Claude Code non confermato.**

### 5. Pianificazione pubblicazione Play Store (TWA) — 3/08

Solo fase di analisi e pianificazione, **nessun codice scritto**. Vincolo chiave 2026 individuato via ricerca web: un account Play Console **personale** creato dopo il 13 novembre 2023 non può pubblicare in produzione senza un closed test con **almeno 12 tester attivi per 14 giorni consecutivi** (con reale utilizzo, non solo installazione — Google traccia l'engagement); gli account Organization ne sono esenti. Claude ha segnalato che un account Organization avrebbe fatto risparmiare le 2 settimane di gate, ma **Robertin ha scelto account personale** (Lepefy Labs non è ancora costituita come organizzazione), quindi il gate 12/14gg è ora nel percorso critico verso il lancio pubblico.

App scelta per il primo pacchetto: **storefront completo** (non `/card`). Timing stimato: verifica identità account personale 1-3 giorni, setup tecnico TWA + store listing 2-4 giorni, poi 14 giorni di closed testing obbligatorio.

**Flag multi-tenant permanente segnalato esplicitamente**: una TWA è legata via Digital Asset Links a un singolo dominio + package name Android — ogni tenant futuro avrà quindi la propria app/listing separata, il che è normale e non è di per sé una violazione multi-tenant. Il punto da non sbagliare: il file `/.well-known/assetlinks.json` **non va creato come file statico hardcoded per ChloeFood** — va servito dinamicamente da una route Next.js che legge dominio/tenant dalla request e recupera package name + SHA256 fingerprint da nuove colonne `tenants.android_package_name`/`tenants.android_sha256_fingerprint`, così onboardare un nuovo tenant su Play Store richiede solo popolare la riga DB, non toccare codice.

Step operativi delineati (non ancora eseguiti): apertura Play Console personale + verifica identità; verifica manifest.json storefront (`display: standalone`, icone 512×512 maskable, `start_url`, `theme_color` — da confermare se già letti da `tenant.*`); generazione TWA via Bubblewrap CLI; gestione keystore di firma; migration + route dinamica assetlinks; build AAB firmato su Internal Testing track; asset store listing (icona, feature graphic, screenshot, descrizione FR); privacy policy URL, Content Rating, Data Safety form; reclutamento 12 tester reali per il closed test.

**Stato: nessun prompt Claude Code ancora generato per la migration/route assetlinks — prossimo passo proposto ma non confermato eseguito.**

### Altri aggiornamenti in questo changelog

- **§18** — 9 nuove righe aggiunte alla checklist go-live per i cinque cicli sopra.
- **§19** — 3 nuove righe aggiunte alla roadmap Phase 2 (Ambassadeur, carta fedeltà EAN-13, Play Store).
- Nessuna modifica alle altre sezioni — questa revisione è basata **solo su ricerca nelle chat**, non su verifica filesystem/git; §1–§36 non sono stati riverificati e potrebbero necessitare un nuovo giro di verifica di coerenza (pattern già usato in v3.7/v3.16/v3.18) prima del prossimo go-live check.

---

## 38. Changelog v3.20 (3 Agosto 2026) — verifica di coerenza contro filesystem/git reale, ribalta lo stato "non eseguito" di v3.19

**Metodo di questa revisione:** verifica diretta contro `git`/filesystem sul branch di lavoro `claude/update-lepefy-project-context-lxyoyq` — stesso tipo di passata già fatta in v3.7/v3.16/v3.18, a differenza di v3.19 (basata solo su ricerca chat, esplicitamente dichiarato nel suo stesso changelog). Comandi eseguiti: `git log --oneline`, `git merge-base main HEAD`, `git log main..HEAD --stat --oneline`, `git ls-tree -r main -- supabase/migrations/`, lettura per intero delle migration `045`–`047`, lettura del codice applicativo dei 5 cicli, `pnpm install` + `pnpm typecheck` (pulito) in questa sessione.

### Scoperta principale: i cinque cicli di v3.19 sono tutti eseguiti

`git log main..HEAD --stat --oneline` mostra **17 commit** "Add files via upload", tutti dell'autore `robertinsmartinvestor-gif`, datati dal 30/07 22:52 al 3/08 20:43 (l'ultimo dei 17 è proprio il commit che ha scritto v3.19 in questo stesso file). Nessuno di questi commit è su `main` (`git log HEAD..main` → 0 commit: `main` non ha nulla che non sia già su questo branch). In ordine cronologico, i commit rilevanti ai cinque cicli di v3.19:

| Commit | Data | Contenuto |
|---|---|---|
| `fd09629` | 31/07 22:35 | Mon compte: `AccountDashboard.tsx`, `AddressFormModal.tsx`, `Modal.tsx`, `ProfileEditModal.tsx`, CRUD indirizzi |
| `a19ecb8` | 31/07 23:53 | Home redesign: `045_tenant_hero_slides.sql`, `HeroCarousel.tsx`, `CategoryBlock.tsx`, `/admin/accueil-slides` |
| `34be473`, `661fcfc`, `af91ff1` | 2/08 16:16–17:05 | Fix ciclo successivo home redesign (autoscroll, `CategoryBlocksRow`/`CategoryBlocksGrid`) |
| `a2e1da1` | 2/08 17:13 | Digital card: link di pagamento diretto (`pm.extra.link`), `PaymentMethodsSection.tsx` |
| `27e3e7e` | 2/08 21:17 | PDP: riordino `ProductSpecs.tsx`/`ProductDetail.tsx` |
| `c708742` | 2/08 22:31 | Programma Ambassadeur: `046_ambassador_commission_system.sql` + 31 altri file (32 file totali, +2025/-20 righe) |
| `8e31642` | 3/08 01:04 | Carta fedeltà: `047_loyalty_card_system.sql` + `/admin/loyalty/scan` + `html5-qrcode` in `package.json` (16 file, +1098 righe) |
| `1bf4475` | 3/08 01:40 | `LoyaltyCardWidget.tsx` montato in `/compte` |
| `131806d` | 3/08 20:43 | Questo file — v3.19 |

Verificato che nessuno di questi commit è un artefatto vuoto o solo-scaffolding: le migration `045`–`047` contengono le tabelle/funzioni/trigger descritti nelle decisioni di prodotto riportate in §37 (letta ciascuna migration per intero, non solo `grep` sui nomi), e il codice applicativo che le consuma è wired end-to-end (es. `processOrderPointsOnDelivery.ts` chiama esplicitamente `processAmbassadorCommissionOnDelivery()` e usa il suo risultato per decidere se il buyer guadagna punti propri — non due sistemi paralleli mai collegati). Dettaglio completo per sistema in §9bis punto 6 (Mon compte) e §9ter (Ambassadeur + carta fedeltà); §12bis Fase 4bis/Fase 5 (PDP + home); §14 (digital card).

### Cosa NON è cambiato rispetto a v3.19

- **Punto 5 (Play Store/TWA) confermato correttamente "solo pianificato" in v3.19**: `grep` ricorsivo su `assetlinks`/`android_package_name`/`android_sha256`/`bubblewrap`/`TWA` in tutto il repo (escluso `node_modules`) → zero risultati in codice applicativo. Nessuna azione da correggere su questo punto.
- **Il gap tra branch e `main` non si è chiuso — si è allargato.** `git ls-tree -r main -- supabase/migrations/` conferma `main` fermo a `043_drop_redundant_customer_referral_code.sql` (stesso punto già noto da v3.18: `044` non era ancora su `main`). Da allora il branch di lavoro ha aggiunto `044`–`047` più tutto il codice applicativo dei 5 cicli — nessuno di questi 17 commit è mai stato portato su `main`. Il documento stesso su `main` è fermo a v3.16 (`git show main:LEPEFY_PROJECT_CONTEXT.md` — un'intera generazione di revisioni, v3.17–v3.19, esiste solo su branch di lavoro successivi).

### Verifica indipendente: `pnpm typecheck`

Non eseguibile direttamente nell'ambiente precedente senza `node_modules` — installato con `pnpm install` (20s, lockfile esistente rispettato) e poi eseguito `pnpm typecheck` da `apps/storefront`: **nessun errore**, su tutto il codice del branch inclusi i 5 cicli sopra. Prima informazione di questo tipo per questi cicli — v3.19 segnalava esplicitamente "nessun `pnpm typecheck` riportato in chat" per il redesign home page, e "esecuzione non confermata" per gli altri quattro punti.

Nota collaterale: `pnpm lint` non è utilizzabile in modalità non interattiva in questo repo — al primo avvio richiede una configurazione ESLint interattiva (`next lint` propone "Strict (recommended)/Base/Cancel") e nel farlo **modifica silenziosamente `tsconfig.json`** (aggiunge `allowJs`/`noEmit`, riformatta i `paths`) prima ancora di completare il prompt. Modifica scartata (`git checkout -- tsconfig.json`) in questa sessione, non committata. Nessun file `.eslintrc*` risulta committato nel repo — da chiarire se `pnpm lint`/`next lint` sia mai stato eseguito con successo in CI o solo mai invocato finora.

### Aggiornamenti in questo changelog

- **§4** — migration `045`–`047` aggiunte alla tabella; tabelle `ambassador_commissions`/`loyalty_manual_purchases`/`tenant_hero_slides` aggiunte all'elenco; righe `tenants`/`customers`/`admin_users` aggiornate con le nuove colonne/ruolo.
- **§8** — voci `AdminSidebar` aggiornate (`accueil-slides`, `loyalty/scan`, `ambassadeurs`), scoping `tenant_cashier` documentato.
- **§9bis** — nuovo punto 6 (Mon compte), stato paragrafo finale aggiornato.
- **§9ter** — nuova sezione, dettaglio completo Ambassadeur + carta fedeltà.
- **§12bis** — nuove Fase 4bis (PDP) e Fase 5 (home redesign).
- **§14** — link di pagamento diretto documentato come eseguito.
- **§18/§19** — 6 righe capovolte da "DA FARE"/"non confermato" a "✅ FATTO", 1 riga nuova aggiunta (merge su `main` dei 17 commit).
- **§1–§17, §20** (esclusi i punti sopra) e **§21–§37** non sono stati modificati oltre ai pointer inline sopra — restano validi come base storica del progetto.

---

## 39. Changelog v3.21 (6 Agosto 2026) — due cicli 5–6 agosto (Play Store TWA + smart-link QR negozio), **nessuna verifica contro filesystem/git in questa sessione**

**Metodo di questa revisione:** solo ricerca chat (`conversation_search`/`recent_chats`), **come v3.19 e a differenza di v3.18/v3.20/v3.38** — nessun accesso a `git`/filesystem in questa sessione. Due cicli individuati dopo v3.20 (3/08), entrambi non ancora documentati:

1. **Pubblicazione Google Play Store via TWA (5/08)** — infrastruttura (migration `048_tenant_android_app.sql`: `android_package_name`/`android_sha256_fingerprint`), route `/.well-known/assetlinks.json` dinamica, hardening PWA (`PWARegister.tsx` → `next/script`, `manifest.ts` arricchito), distinzione icona maskable/any risolta, pagina `/politique-confidentialite`, packaging via **PWABuilder** (non Bubblewrap CLI — coerente col workflow senza ambiente locale), Package ID `com.lepefy.chloefood.twa`, scoperta del signing "hybrid quantum-ready" a 3 certificati/3 fingerprint. App verificata funzionante su Internal Testing (2 tester); **Closed Testing 12 tester/14gg non ancora avviato — resta l'unico blocco residuo**. Regola permanente stabilita: mai `pnpm lint` su questo repo (riscrive silenziosamente `tsconfig.json`).
2. **Smart-link QR negozio `/go` (6/08)** — secondo QR distinto dal QR carta/loyalty, migration `049_tenant_android_public.sql` (`tenants.android_public`), design testo-sotto-QR dopo due iterazioni scartate, due bug di produzione scoperti e corretti (dominio canonico via `NEXT_PUBLIC_APP_URL` invece di `req.nextUrl.origin`; rendering testo SVG via satori+resvg invece di `<text>`, che produceva tofu box su Vercel serverless senza font di sistema). Debito noto lasciato fuori scope: bug preesistente `overlayLogo()` (viewBox module-units vs pixel), comune a `/card` e alla nuova route.

**Nota metodologica esplicita:** come già segnalato nel changelog v3.19 (poi confermato corretto quasi per intero dalla verifica v3.20), questi due cicli sono ricostruiti **solo da quanto riportato in chat** — nessun `pnpm typecheck` di questa sessione, nessun `git log`/`git diff` eseguito. Il pattern è coerente con l'affidabilità storica di questo tipo di changelog (v3.19 → confermato ~100% da v3.20 alla verifica successiva), ma resta comunque **da riverificare** alla prossima passata di coerenza contro filesystem/git, come da convenzione del documento (§37→§38, ecc.).

### Aggiornamenti in questo changelog

- **§4** — riga `tenants` aggiornata con `android_package_name`/`android_sha256_fingerprint`/`android_public`; tabella migration aggiornata con `048`/`049`.
- **§11** — distinzione icona maskable/any segnata risolta; `PWARegister.tsx`/`manifest.ts` aggiornati; riga TWA aggiornata da "roadmap, non avviato" a eseguito, puntatore a §14ter.
- **§14ter** — nuova sezione, dettaglio completo dei due cicli (Play Store TWA + QR shop).
- **§18/§19** — righe Play Store aggiornate da "in pianificazione"/"non avviato" a eseguito con gate residuo esplicito; 3 righe nuove aggiunte (Closed Testing da avviare, test OTP con Dalice, debito `overlayLogo()`).
- **§1–§17, §20** (esclusi i punti sopra) e **§21–§38** non sono stati modificati oltre ai pointer inline sopra — restano validi come base storica del progetto.

---

## 40. Changelog v3.22 (10 Agosto 2026) — verifica di coerenza contro filesystem/git reale: tre cicli 6–9 agosto + fix crash scanner mobile oggi stesso

**Metodo di questa revisione:** accesso diretto a `git`/filesystem sul branch `claude/scanner-mobile-crash-fix-q6ez8r`, stesso tipo di passata di v3.7/v3.16/v3.18/v3.20 — a differenza di v3.19/v3.21 (solo ricerca chat). Tre cicli sostanziali trovati tra v3.21 (6/08) e oggi, nessuno documentato finora, più il lavoro di questa sessione.

### 1. Regole di spedizione per paese (6/08) — `050_shipping_country_rules.sql`

Layer di regole commerciali configurabili per paese sopra il calcolo Packlink/flat_rate/pickup_only esistente (§6): gratuità sopra soglia carrello (per paese o globale `'{*}'`), forfait fisso per paese (bypassa del tutto il calcolo Packlink per quel paese), sconto spedizione (percentuale o importo fisso) — le tre leve possono coesistere sulla stessa riga della tabella `shipping_country_rules`. Zero righe = comportamento identico a prima di questa migration.

- Funzioni pure in `apps/storefront/src/lib/shipping/resolveCountryRule.ts`: `resolveCountryRule()` (trova la riga applicabile, priorità paese esatto su fallback `'{*}'`) e `applyCountryRule()` (calcola costo finale/sconto/flag gratuità). Nessuna chiamata di rete — chiamate da `POST /api/shipping/quote` dopo aver caricato le regole dal DB.
- `apps/storefront/src/lib/shipping/freeShippingInfo.ts` — tipo condiviso client/server (`FreeShippingInfo`, discriminated union `threshold`/`country_promo`/`null`) per mostrare in UI *perché* la spedizione è gratuita, senza far ri-quotare il carrello al cambio quantità quando il risultato non può cambiare (caso `country_promo`, forfait/sconto 100% indipendente dal subtotale).
- UI admin: `/admin/livraison` (`ShippingCountryRulesSection.tsx`) per il CRUD delle regole + nuova pagina `/admin/livraison/simulateur` (`ShippingSimulator.tsx`, endpoint `api/admin/shipping-simulator`) — permette di testare un preventivo con paese/CAP/peso/subtotale arbitrari senza passare dal checkout reale.
- API CRUD: `api/admin/shipping-rules/route.ts` + `api/admin/shipping-rules/[id]/route.ts`.
- Toccati anche `CartClient.tsx`/`CheckoutForm.tsx` (mostrano il messaggio di gratuità quando applicabile) e `cartStore.ts`.

### 2. Modalità "pool condiviso" — programma Ambassadeur (7/08) — `051_ambassador_split_pool_mode.sql`

Seconda modalità di commissione per il programma Ambassadeur (`046_ambassador_commission_system.sql`, §9ter), alternativa alla proporzionale esistente (% sul valore ordine): pool condiviso a importo fisso, diviso in percentuale configurabile tra ambassador e cliente invitato (`ambassadorAmount` + `referredDiscount`, somma sempre pari al pool).

- Funzione pura condivisa `apps/storefront/src/lib/ambassador/calculateSplitPoolAmounts()` — riusata sia server-side (`resolveCheckoutAmbassadorDiscount.ts`, per il lato sconto dell'invitato in checkout) sia per il mini-esempio numerico live nel pannello admin (`AmbassadorConfigSection.tsx`), garantendo la stessa formula in entrambi i posti. Il lato commissione ambassador è reimplementato indipendentemente in SQL in `process_ambassador_commission_atomic()` (già esistente da `046`, aggiornata da `051` per gestire le due modalità).
- Numerazione: il commento di intestazione della migration segnala esplicitamente che la spec proponeva "presumibilmente 048" — al momento della scrittura la sequenza reale era già a `050`, quindi `051` è il primo numero libero, non una collisione risolta.

### 3. Modulo Événementiel + Services (9/08) — `052_events_module.sql`

Il ciclo più corposo dei tre. Due funzionalità distinte, entrambe dietro flag indipendenti su `tenants` (`events_enabled`, `services_enabled`), nessun dato seedato per un tenant specifico — attivazione e configurazione solo da `/admin`:

- **Événements** — soirées barbecue datate, formule/ticket types multipli, biglietteria con QR: prenotazione → pagamento Stripe → QR generato (`qrToken.ts`, HMAC come il resto del progetto) → redemption all'ingresso via scanner admin. Tabelle: `events`, `event_ticket_types`, `event_reservations`, `event_reservation_items`, `event_reservation_redemptions`.
- **Services** — prestazioni traiteur/location su preventivo (non pagamento diretto): richiesta cliente → `service_inquiries` → gestione admin (`/admin/evenementiel/devis`). Sottocaso location materiale con proprie tabelle `rental_items`/`rental_reservations`/`rental_reservation_items` e checkout dedicato (`api/rental/checkout`).
- Funzione Postgres `redeem_event_reservation(p_qr_token, p_quantity, p_admin_id)` — valida il token, decrementa i posti residui, registra la riga in `event_reservation_redemptions`.
- **Scelta di sicurezza esplicita** (commento di intestazione della migration): nessuna tabella admin di questo modulo concede INSERT/UPDATE diretto ad `authenticated`, a differenza dello scheletro RLS/GRANT proposto nella spec originale — tutte le scritture (prenotazioni create dal webhook Stripe, preventivi creati dall'API pubblica) passano dal client di servizio server-side (`createServiceClient()`), mai dal client browser con RLS. Stesso pattern già in uso altrove nel progetto (`045_tenant_hero_slides.sql`, `050_shipping_country_rules.sql`).
- **Struttura route**: storefront pubblico sotto un nuovo route group `(evenementiel)` (`evenementiel/page.tsx`, `evenementiel/evenements/[slug]`, `evenementiel/services/[slug]`, `evenementiel/billet/[qr_token]` — pagina biglietto pubblica), con `EventsHeader.tsx`/`EventsFooter.tsx` propri (non riusa header/footer del negozio principale). **Nota storica**: una prima versione delle stesse pagine era stata scritta sotto `(shop)/evenementiel/...` (route group del negozio principale) — l'intera directory è stata cancellata il 9/08 (commit "Delete apps/storefront/src/app/(shop)/evenementiel directory") in favore del route group dedicato `(evenementiel)`; se si trovano riferimenti a `(shop)/evenementiel` in materiale precedente questa data, sono superati.
- Admin: `/admin/(protected)/evenementiel/{evenements,services,devis,galerie,reservations-materiel}` (CRUD completo) + `/admin/evenementiel/scan` (**volutamente fuori** dal gruppo `(protected)`, stessa ragione di `/admin/loyalty/scan`: quel gruppo redirige ogni `tenant_cashier` verso lo scan fedeltà, quindi questa pagina ha una propria verifica d'accesso via cookie, pattern identico a `requireAdmin.ts`).
- Lo scanner d'ingresso (`ScanClient.tsx`) **riusa** `CameraScanButton.tsx` già scritto per la loyalty card (§9ter, dipendenza `html5-qrcode`) invece di duplicare la logica camera — origine del bug corretto nel punto 4 sotto.

### 4. Fix crash mobile scanner (10/08, questa sessione)

Bug segnalato oggi da Robertin: `/admin/evenementiel/scan` andava in crash lato client durante l'uso reale da mobile ("Application error: a client-side exception has occurred"), console con `Cannot stop, scanner is not running or paused.` seguito da errore React minificato #423.

**Causa confermata contro il sorgente reale di `html5-qrcode@2.3.8`** (installato e ispezionato in questa sessione): `stop()` lancia quella stringa **sincronicamente**, non come promise rifiutata — i `.catch(() => {})` esistenti in `CameraScanButton.tsx` non potevano quindi mai intercettarla. Punto d'innesco identificato: alla scansione riuscita, il callback di decodifica chiamava `stop()`; subito dopo `onDecoded` faceva avanzare `ScanClient` allo step di conferma, smontando `CameraScanButton` — il cleanup dell'effetto chiamava `stop()` una **seconda volta** su uno scanner già fermato, throw sincrono durante lo smontaggio → propagazione nella fase di commit di React, verosimile causa dell'errore #423 (non verificabile byte-per-byte offline, ma pienamente coerente: nessun altro sintomo scollegato trovato). Aggravante secondaria: `onDecoded` era nelle dipendenze dell'effetto camera mentre in `ScanClient` è una arrow function inline — l'effetto si riavviava (stop/start) a ogni re-render del genitore, moltiplicando le occasioni di stop su stato sbagliato.

**Correzione**: guardia `getState() === Html5QrcodeScannerState.SCANNING || PAUSED` prima di ogni `stop()`, avvolta in `try/catch` che logga senza rilanciare (difesa contro la race check→call), estratta in un helper `safeStop()` riusato sia dal callback di successo sia dal cleanup. `onDecoded` spostato in una ref per fermare il riavvio spurio dell'effetto; dipendenze ridotte a `[open]`. Unico file toccato: `apps/storefront/src/app/admin/loyalty/scan/CameraScanButton.tsx` (+34/−7). `pnpm typecheck` pulito, `tsconfig.json` invariato, logica di redemption (`redeem_event_reservation`, `extractQrToken`) non toccata come richiesto. Commit locale sul branch — **non pushato su richiesta esplicita di Robertin in chat**, consegna via zip contenente solo il file modificato con struttura repo preservata.

### Verifica indipendente: stato migration/git

`ls supabase/migrations/` conta **57 file** su questo branch. `git ls-tree -r main -- supabase/migrations/` conferma **`main` fermo a `049_tenant_android_public_release.sql`, 54 file** — gap invariato nella sua natura (mai chiuso dalla prima segnalazione in v3.7) ma allargato di 3 file (`050`–`052`, tutti e tre i cicli di questa revisione esistono solo su branch di lavoro). `git rev-list --count main..HEAD` = 19; `main` resta ancestor diretto (nessuna divergenza).

### Aggiornamenti in questo changelog

- **§4** — tabella migration aggiornata con `050`–`052`; corretto il nome file di `049` (`_public_release`, non `_public` come in v3.21); nuova nota di verifica conteggio (57 file branch / 54 `main`).
- **§6** — da integrare alla prossima passata con il layer regole-paese (`resolveCountryRule.ts`/`applyCountryRule()`, simulatore admin) — non riscritto qui per non duplicare il dettaglio già in §40.1 sopra; puntatore aggiunto.
- **§9ter** — da integrare alla prossima passata con la modalità pool condiviso (`051`) — puntatore a §40.2.
- Nuova sezione **§40** (questa), con il dettaglio completo dei tre cicli 6–9/08 più il fix odierno.
- **§1–§39** (esclusi i punti sopra) non sono stati modificati oltre ai pointer inline — restano validi come base storica del progetto.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.22 — 10 Agosto 2026 (base: v3.21; verifica di coerenza contro filesystem/git reale — tre cicli 6–9/08 confermati eseguiti solo su branch di lavoro [regole spedizione per paese `050`, Ambassadeur pool condiviso `051`, modulo Événementiel+Services `052`, `main` ancora fermo a `049`] + fix crash mobile scanner d'ingresso evenementiel eseguito e verificato oggi stesso [`pnpm typecheck` pulito, commit locale non pushato su richiesta esplicita] — vedi §40 per il dettaglio completo)*

---

## 41. Changelog v3.23 (14 Agosto 2026) — gap `main` chiuso; Événementiel Fase 2 + paiements via lien externe (3 moduli) + digital card montant libre (10–14 agosto)

**Metodo di questa revisione:** accesso diretto a `git`/filesystem sul branch `claude/lepefy-project-context-update-a8zju7`, stesso tipo di passata di v3.7/v3.16/v3.18/v3.20/v3.22 — `pnpm install` (515 pacchetti, lockfile invariato) + `pnpm typecheck` eseguiti realmente in questa sessione (non solo riportati), esito pulito su tutto il codice del branch.

### 0. Il gap `main` vs branch di lavoro, segnalato ininterrottamente da v3.7 (18/07), è chiuso

Ogni verifica di coerenza da v3.7 in poi (v3.16/v3.18/v3.20/v3.22) ha confermato che `main` era fermo indietro rispetto al branch di lavoro corrente, con il gap che si allargava ad ogni ciclo (da "niente mergiato" a un gap di 3–9 file di migration). In questa sessione: `git merge-base main HEAD` restituisce esattamente la punta di `main` (commit `1a2a1e3`, 13/08 18:55) — **`main` contiene già tutto**, incluse le migration fino a `062`, il redesign storefront/admin, il sistema loyalty/referral, il programma Ambassadeur e il modulo Événementiel. Questo branch di lavoro è `main` + **un solo commit** (`766604a`, 14/08, punto 4 sotto). Nessuna divergenza: `main` resta un ancestor diretto, non un branch parallelo.

**Non verificabile da qui:** se Vercel deploya effettivamente da `main` (nessun `vercel.json` nel repo, come già segnalato da v3.7) — resta da confermare con Robertin, come sempre.

### 1. Événementiel Fase 2 (10–11/08) — `053`–`058`

Sei migration in rapida sequenza, tutte sul modulo Événementiel (`052`, §40.3):

- **Redemption granulare per formula** (`053_event_reservation_item_redemptions.sql`, 10/08 15:58) — nuova tabella `event_reservation_item_redemptions`, redemption a livello di singola riga formula (`event_reservation_items`) in aggiunta alla redemption globale già esistente (`event_reservation_redemptions`). Permette allo scanner `/admin/evenementiel/scan` di validare parzialmente una formula precisa (es. "2 posti su 4 di questo ticket type") invece di poter solo decrementare il totale prenotazione. Il campo aggregato `event_reservations.quantity_remaining` resta la fonte di verità per il badge cliente pubblico (`/evenementiel/billet/[qr_token]`), aggiornato simmetricamente ad ogni redemption/void granulare.
- **Due bugfix "colonna ambigua" lo stesso giorno** (`054` 16:09, `055` 16:13) — stesso identikit di bug in entrambi i casi: una colonna di output dichiarata in `RETURNS TABLE(...)` di una funzione PL/pgSQL diventa variabile implicita visibile in tutto il corpo della funzione, e resta ambigua con la colonna reale della tabella in una query interna non qualificata (`reservation_item_id` in `054`, `quantity_remaining` in **entrambe** `redeem_event_reservation_items` e `void_event_reservation_item_redemption` in `055`). Fix: alias espliciti, stessa firma, `create or replace` idempotente — nessun'altra logica toccata.
- **Palette/tema per evento** (`056_events_theme_colors.sql`, 11/08 02:28) — `events.theme_primary_color`/`theme_secondary_color`, fallback a `tenant.primary_color`/`secondary_color` se null.
- **Indice galleria dedicato** (`057_event_gallery_photos_event_index.sql`, 11/08 02:44) — indice parziale `(tenant_id, event_id, sort_order)` su `event_gallery_photos` per le query filtrate per evento (carousel multi-immagine hub + dettaglio), distinto dall'indice generale già esistente da `052`.
- **Hero highlights + badge formule** (`058_events_highlights_badge.sql`, 11/08 13:42) — cambia il default palette da "colore tenant" a due valori fissi del modulo (`#E65C00`/`#FFB347`, arancione BBQ) — la pagina `evenements/[slug]` ora usa costanti `EVENT_MODULE_DEFAULT_PRIMARY`/`SECONDARY` invece del fallback al tenant; la colonna override per-evento di `056` resta invariata, cambia solo il fallback. Aggiunge `events.subtitle` (text) e `events.highlights` (jsonb, badge/punti salienti mostrati in hero).

### 2. Paiements via lien externe (PayPal/Revolut/autre) — tre fasi sequenziali, tre moduli (12/08) — `059`–`061`

Stessa regola assoluta su tutti e tre: **nessun ordine/prenotazione creato al click**, solo una richiesta in attesa di conferma manuale admin — nessun webhook possibile per un semplice link di pagamento esterno.

- **Fase 1 — boutique** (`059_external_payment_links.sql`, 00:29) — `checkout_sessions.payment_method` (`stripe` default / `external_link`) + snapshot `external_payment_type`/`external_payment_label`/`external_payment_link` (link già costruito con importo appeso, per non ridipendere da `tenant_payment_methods` al momento della conferma). Conferma dal bandeau **"Paiements en attente"** in `/admin` (`PendingPaymentsBanner.tsx`, query su `checkout_sessions` filtrata `payment_method = 'external_link'` — nessun ordine esiste ancora per quelle righe, stock non riservato). **Corregge di passaggio una deriva pregressa**: il CHECK `orders.payment_method` (schema iniziale `001`) non includeva `in_store`, benché il codice lo scrivesse da tempo — riscritto per includere sia `in_store` sia il nuovo `external_link`.
- **Fase 2 — billetterie événementiel** (`060_event_reservation_requests.sql`, 12:35) — il modulo événementiel non ha una tabella sessione equivalente a `checkout_sessions` (il PaymentIntent Stripe porta tutti i dati prenotazione nei metadata); `external_link` non genera un PaymentIntent, quindi nuova tabella dedicata `event_reservation_requests`. **Decisione esplicita presa con Robertin**: non introdurre una tabella generica condivisa shop/événementiel/location — ogni modulo resta gestito separatamente, deviazione consapevole rispetto a uno schema più "DRY".
- **Fase 3 — location matériel** (`061_rental_reservation_requests.sql`, 13:07) — stessa logica di `060`, tabella dedicata `rental_reservation_requests` (referenzia `service_offerings` di `052`) invece di condividerla con gli altri due moduli.
- Endpoint pubblici dedicati per modulo: `api/checkout/external-link`, `api/events/[id]/checkout-external-link`, `api/rental/checkout-external-link`; conferma admin dedicata per modulo: `api/admin/checkout-sessions/[id]/confirm-payment`, `api/admin/evenementiel/reservation-requests/[id]/confirm-payment`, `api/admin/evenementiel/rental-reservation-requests/[id]/confirm-payment`. Selezione del metodo lato cliente centralizzata in un unico componente condiviso, `ExternalPaymentMethodPicker.tsx` (riusato da `CheckoutForm.tsx`, `EventCheckoutClient.tsx`, `RentalCheckoutClient.tsx`), con pagine "en attente" dedicate per modulo (`en-attente/PendingEventPaymentClient.tsx`, `en-attente/PendingRentalPaymentClient.tsx`).
- **Scoperta non documentata prima d'ora**: il modulo "location matériel" (rental) vive sotto il route group `(evenementiel)` come terzo filone accanto a événements e services/devis (`evenementiel/services/[slug]` con `RentalCheckoutClient.tsx`), con una propria pagina admin `reservations-materiel` (`RentalReservationsClient.tsx`) — le tabelle `rental_items`/`rental_reservations`/`rental_reservation_items` esistevano già da `052` (§40.3) ma il flusso di prenotazione/checkout completo non era stato descritto in dettaglio prima di questa revisione.

### 3. Paiement carte à montant libre — Digital Card `/card` (13/08) — `062_tenant_card_payments.sql`

Nuovo metodo `card` per `tenant_payment_methods` (estende il CHECK esistente da `030`): apre un checkout Stripe Elements integrato direttamente in `/card`, importo inserito liberamente dal cliente — nessun carrello/prodotto dietro, pensato per un pagamento "importo libero" via il QR code già esposto in negozio. Nuova tabella `tenant_card_payments`, dominio deliberatamente indipendente da `orders`/`checkout_sessions`/`event_reservation_requests` (stesso principio di separazione per modulo di `052`/`059`/`061`). RLS attiva senza policy pubbliche — solo `service_role`, tramite `api/card/quick-pay` e un branch dedicato del webhook Stripe. **Nessuno Stripe Connect** (come per lo shop): PaymentIntent creato sul conto piattaforma Lepefy (`STRIPE_SECRET_KEY`), giroconto al tenant manuale.

- Componente `CardQuickPay.tsx` (nuovo, 13/08) — form importo + step pagamento Stripe Elements, montato in `DigitalCard.tsx`.
- Registro `PAYMENT_METHOD_REGISTRY` (nuovo `packages/types/paymentMethods.ts`) esteso con `card` — stesso pattern di `SOCIAL_PLATFORM_REGISTRY`, un solo punto da estendere per aggiungere un metodo (registro + CHECK SQL).

### 4. Refactor cosmetico digital card (14/08, oggi, questa sessione — commit non pushato del branch di lavoro)

`DigitalCard.tsx` refactorizzato: la lista metodi di pagamento, prima resa inline come sequenza di `CopyableLine`/`CopyableValue` (righe copiabili IBAN/PayPal/ecc., icone `PAYMENT_ICONS` locali), è estratta in un nuovo componente dedicato `PaymentMethodsAccordion.tsx` — **nessuna migration, nessun cambio funzionale ai flussi di pagamento** (Stripe/external_link/card restano quelli descritti sopra), solo riorganizzazione UI. `CardQuickPay.tsx` aggiornato di conseguenza (rimosso un `pl-[42px]` di indentazione fissa, non più necessario nel nuovo layout ad accordion). Verificato `git diff c332578 HEAD` (base della revisione v3.22): 121 file toccati, +6672/−936 righe in totale sull'intero ciclo v3.22→v3.23 (migration + codice applicativo).

### Aggiornamenti in questo changelog

- **§0 sopra** — gap `main` chiuso, correzione più rilevante di questa revisione rispetto a tutte le precedenti da v3.7.
- **§2** — versione Next.js aggiornata `14.2.3` → `14.2.35` (unico cambio di dipendenze rilevato, nessuna dipendenza nuova).
- **§3** — nuovo blocco "Aggiunte v3.23" nell'albero repository.
- **§4** — tabella migration aggiornata con `053`–`062`; nuova nota di verifica conteggio (67 file, gap `main` chiuso); riga `tenants` completata con le colonne `051`/`052` lasciate in sospeso da v3.22 (`events_enabled`/`services_enabled`, `ambassador_commission_mode`+split pool); righe `checkout_sessions`/`orders` aggiornate; nuove righe tabella per `shipping_country_rules`, cluster Événementiel/Services, `event_reservation_requests`/`rental_reservation_requests`, `tenant_card_payments`.
- **§6/§9ter** — restano da integrare per esteso alla prossima passata con il dettaglio §40.1/§40.2 (non riscritti qui, nessun cambio rispetto a v3.22 su quei due punti specifici).
- Nuova sezione **§41** (questa), con il dettaglio completo dei cicli 10–14/08.
- **§1–§40** (esclusi i punti sopra) non sono stati modificati oltre ai pointer inline — restano validi come base storica del progetto. Nessuna verifica specifica fatta in questa sessione sullo stato del gate Play Store Closed Testing (§14ter) — presumere invariato finché non riconfermato.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.23 — 14 Agosto 2026 (base: v3.22; verifica di coerenza contro filesystem/git reale — gap `main` vs branch di lavoro, segnalato ininterrottamente da v3.7, risulta chiuso [`main` = punta di questo branch meno 1 commit cosmetico]; dieci migration nuove `053`–`062` [Événementiel Fase 2, paiements via lien externe su 3 moduli, paiement carte montant libre su `/card`] verificate sul filesystem; `pnpm install`+`pnpm typecheck` eseguiti in questa sessione, esito pulito — vedi §41 per il dettaglio completo)*

---

## 42. Changelog v3.24 (17 Agosto 2026) — Porting TailAdmin v2.3.0 → Next.js 14.2.35, staging isolato

**Metodo di questa revisione:** verifica diretta dello zip di consegna (`tailadminstagingport.zip`) contro il report di fine ciclo fornito da Claude Code — non un audit git/filesystem sul repo reale come §27/§34/§36/§38/§40/§41 (il lavoro vive su un branch di lavoro non fornito in questa sessione, solo lo zip isolato). Confronto file-per-file tra l'elenco dichiarato nel report e il contenuto reale dello zip: nessuna discrepanza — 24 file dichiarati, 24 trovati, nessun file di produzione tra questi.

### Contesto della decisione

Valutazione template esterni per tre aree (frontend, admin, événementiel) conclusa con decisione di procedere **solo sull'admin**, con **TailAdmin v2.3.0** (`free-nextjs-admin-dashboard`, MIT license) — non la vecchia V1.3 ipotizzata inizialmente (verificata assente/non più rilevante), ma la versione corrente del template, nativa Next.js 16 + React 19 + Tailwind v4. Decisione esplicita di **non** comprare/integrare template per frontend storefront ed événementiel (aree già hardenate con pattern testati in produzione — sticky/overflow mobile, checkout esterno, QR redemption).

**Discussione icone risolta**: mantenere Tabler come convenzione di piattaforma (non passare a Lucide) — le icone del template TailAdmin si sono rivelate 58 SVG proprietari (non Lucide come ipotizzato), quindi la sostituzione futura è un mapping 1:1 nome-icona, non un conflitto tra due librerie esterne.

### Ciclo 1 — Porting isolato (17/08, questa sessione)

Obiettivo: rendere compilabile/visivabile il layout base del template (sidebar + topbar + card statistiche + una tabella) sotto Next 14.2.35/React 18/Tailwind v3, **senza collegarlo a dati reali né a route admin esistenti** — ciclo di solo porting tecnico, non di integrazione funzionale.

- **Isolamento totale rispettato**: tutti i 24 file nuovi vivono sotto `apps/storefront/src/_tailadmin-staging/` + una pagina di anteprima `admin/(protected)/_staging-preview/page.tsx` (protetta dallo stesso `requireAdmin()`/check inline del layout esistente, nessuna nuova logica di auth) + un `tailwind.staging.config.ts` separato da quello di produzione. Verificato: zero file esistenti modificati.
- **Conversione token Tailwind v4 → v3** completa: tutti i valori estratti da `@theme` (colori `brand-*`/`gray-*`, dimensioni testo custom, breakpoint `2xsm`/`xsm`/`3xl`, ombre, z-index, spacing `4.5`, `ring-3`) portati in `theme.extend` del config isolato; sintassi v4-only (`@utility`, `outline-hidden`, `max-w-(--breakpoint-2xl)`) convertita esplicitamente, non lasciata residua.
- **Nessuna API React 19** nei componenti portati (verificato: nessun uso di `use()`, `useActionState`, `useFormStatus`, Server Actions). Tutte le dipendenze esterne del template (`@fullcalendar/*`, `apexcharts`, `react-dnd`, `@react-jvectormap/*`) verificate compatibili con React 18 via `npm view peerDependencies`, ma **non installate** in questo ciclo perché i moduli che le usano (calendario, grafici, mappa, drag&drop) sono stati deliberatamente esclusi dallo scope.
- **Icone**: solo 15 dei 58 SVG del template inlineati a mano in `icons/index.tsx` (quelli effettivamente usati dai componenti portati) — evita la dipendenza `@svgr/webpack` che avrebbe richiesto toccare `next.config.mjs` di produzione, vietato dal prompt.
- **Deviazione tecnica principale**: il layout del template usa `position: fixed`/`sticky` per sidebar/header, pensato per occupare l'intero viewport. Per contenerlo dentro il frame isolato della pagina di anteprima (senza sovrapporsi al chrome admin reale) è stato usato `transform: translateZ(0)` + altezza fissa `h-[900px]` sul contenitore — soluzione accettabile *solo* per questo staging temporaneo; **da non riportare così nel ciclo di integrazione reale**, dove vale la regola permanente cross-device (preferire document flow nativo, non calcoli di viewport/altezza fissa).
- **Dark mode isolata**: il `ThemeContext` di staging applica `.dark` solo al contenitore `StagingShell`, non a `document.documentElement` come l'originale del template — evita conflitto con `AdminThemeProvider` esistente che già gestisce lo stesso meccanismo sull'intero `<html>`.
- **Verifica automatica limitata**: `pnpm dev`/`pnpm build` non esprimibili in sandbox (falliscono già su `getTenant()` per assenza di credenziali Supabase nell'ambiente di test, condizione preesistente non legata a questo lavoro) — solo `pnpm typecheck` eseguito (pulito) più lettura manuale del JSX per fedeltà al template. **Verifica visiva reale ancora da fare da Robertin in locale/branch.**
- **Non portato in questo ciclo** (per riferimento futuro, esplicitamente rimandato): calendario, grafici ApexCharts, mappa jVectorMap, drag&drop, pagine auth/profile/blank/error/UI-showcase del template, i restanti 43 SVG non referenziati, sostituzione icone → Tabler.

### Aggiornamenti in questo changelog

- Nuova sezione **§42** (questa) con il dettaglio del ciclo di porting.
- **§21** — da aggiungere alla prossima passata: `ClaudeCode_Prompt_TailAdminPorting.md` (prompt di questo ciclo) e `tailadminstagingport.zip` (deliverable) come documenti di riferimento esterni, non versionati nel repo.
- **§1–§41** non modificati oltre al pointer inline — nessuna verifica specifica fatta in questa sessione su altre aree del progetto (chatbox, loyalty, événementiel, ecc.); presumere invariato rispetto a v3.23.
- **Nota metodologica**: a differenza delle revisioni v3.7/v3.16/v3.18/v3.20/v3.22/v3.23, questa verifica **non** ha avuto accesso diretto al branch/repo — si basa sullo zip isolato fornito e sul confronto puntuale con il report di Claude Code. Il codice del branch di lavoro reale (`claude/tailadmin-nextjs-14-port-kiyafi`, non pushato per scelta esplicita) resta da confermare via git alla prossima passata di audit.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.24 — 17 Agosto 2026 (base: v3.23; ciclo di valutazione template esterni concluso con decisione: solo admin, TailAdmin v2.3.0, Tabler mantenuto come convenzione icone; primo ciclo di porting isolato Next 16→14 verificato via zip di consegna e confronto puntuale col report — nessuna discrepanza rilevata, 24/24 file confermati; deviazione tecnica nota da non ripetere in produzione: `translateZ(0)`+altezza fissa per contenere `fixed`/`sticky` nello staging — vedi §42 per il dettaglio completo)*

---

## 43. Changelog v3.25 (17 Agosto 2026) — Integrazione reale sidebar/header TailAdmin in `AdminSidebar.tsx`

**Metodo di questa revisione:** ⚠️ **basata solo sul report testuale di Claude Code, nessun file/zip caricato in questa sessione per riscontro diretto** — a differenza di §42, qui non è stato possibile confrontare le affermazioni del report con il codice reale. Trattare i punti sotto come non ancora verificati indipendentemente fino alla prossima passata con accesso a git/filesystem o a un deliverable scaricabile.

### Cosa riporta il ciclo

Sostituita la sidebar admin visiva (non funzionale) con lo stile portato da TailAdmin nel ciclo precedente (§42), collegata alla navigazione reale:

- **Voci di navigazione reali mappate** (13 voci, mappatura Tabler preservata 1:1, solo dimensione icone 16→20px e stroke attivo 2→1.75 cambiati): Commandes, Catalogue (con sottomenu categorie), Clients/Promotions (disabilitate, "Bientôt"), Slides d'accueil, Fidélité & parrainage, Scan fidélité, Livraison, Événementiel (collassabile, 6 sotto-voci: événements/scan/services/devis/reservations-materiel/galerie), Ambassadeurs, Paramètres, IA (`/admin/ai-lab` — non documentato prima d'ora in questo context doc), Abonnement.
- **Correzione a un'assunzione del prompt precedente**: la sidebar oggi **non** è `position: fixed` come ipotizzato nel prompt — è un `<aside>` in flusso normale dentro una riga flex (solo l'header è `sticky top-0`). Claude Code ha preservato questo comportamento reale invece di introdurre `fixed` per assecondare l'assunzione errata del prompt — comportamento corretto, da tenere a mente per correggere il prompt template dei prossimi cicli sidebar.
- **Sidebar collassabile del template**: scartata deliberatamente, come da Step 0.4 del prompt — non esiste oggi, non richiesta esplicitamente, e in conflitto con la regola cross-device di questo ciclo (niente stato/logica portata dallo staging che non rispecchi il comportamento reale attuale).
- **File toccati**: `(protected)/layout.tsx` (solo JSX header estratto in nuovo `AdminHeader.tsx`, logica auth/redirect dichiarata bit-per-bit identica), `AdminSidebar.tsx` (solo classi di stile). Nessun file eliminato. `AdminMobileNav.tsx` dichiarato non toccato (stessa interfaccia `<AdminSidebar categories={categories} />`).
- **Preservazione redirect `tenant_cashier`**: dichiarata verificata via lettura codice/diff (non eseguibile live, stessa limitazione Supabase del ciclo §42) — il blocco di redirect a `/admin/loyalty/scan` riportato come assente dal diff, quindi invariato.
- **Dark mode**: `AdminThemeProvider` esistente dichiarato non toccato; il `ThemeContext.tsx` portato nello staging (§42) confermato scartato, mai importato da codice reale.

### ⚠️❌ "Bug preesistente" — SMENTITO in v3.26, vedi §44

Questo paragrafo affermava che `--color-primary-dark` non fosse mai definita. **Falso, corretto in §44**: la var è dichiarata in `globals.css` (non in `layout.tsx`, unico file controllato all'epoca) fin dal redesign storefront di luglio — vedi anche riga 798 di questo stesso documento (§12bis), che la documentava già come token introdotto allora. Errore nato da una verifica basata solo sul report testuale di Claude Code, senza accesso al codice reale in quella sessione (limite dichiarato esplicitamente in §43, rivelatosi concreto). Lasciato qui barrato per traccia, non cancellato, invece di riscrivere la storia.

### Deviazioni dichiarate

- Header estratto in nuovo componente `AdminHeader.tsx` invece di restare inline nel layout (motivazione: separare presentazione da dati, rispecchia il pattern già esistente per la sidebar) — dimensioni/padding lasciati pixel-identici perché il layout sottostante assume un'altezza header precisa (`min-h-[calc(100vh-57px)]`).
- Consegna di nuovo come zip anziché push diretto, continuando il pattern del ciclo §42 senza richiederlo esplicitamente questa volta — segnalato da Claude Code stesso, da confermare con Robertin se preferisce il push diretto d'ora in poi.

### Aggiornamenti in questo changelog

- Nuova sezione **§43** (questa).
- **§8bis** — da integrare alla prossima passata con accesso diretto al codice: la sidebar reale ha 13 voci (elenco sopra), inclusa una voce `/admin/ai-lab` non ancora documentata nella sezione struttura repository/AdminSidebar prima d'ora.
- **§1–§42** non modificati oltre al pointer inline.
- **Promemoria per il prossimo ciclo con accesso a git/zip**: verificare indipendentemente (a) l'assenza reale di `--color-primary-dark`, (b) che il redirect `tenant_cashier` sia davvero bit-per-bit identico, (c) che `AdminMobileNav.tsx` non abbia richiesto modifiche.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.25 — 17 Agosto 2026 (base: v3.24; integrazione reale sidebar/header TailAdmin in `AdminSidebar.tsx`/nuovo `AdminHeader.tsx`, 13 voci di navigazione reali mappate, sidebar collassabile scartata deliberatamente, redirect `tenant_cashier` e dark mode dichiarati invariati — ⚠️ **verifica basata solo sul report testuale di Claude Code, nessun codice caricato per riscontro diretto in questa sessione**; bug segnalato in questa revisione [`--color-primary-dark` mai definita] risultato ❌ **falso positivo, smentito in v3.26** — vedi §44)*

---

## 44. Changelog v3.26 (17 Agosto 2026) — Correzione: `--color-primary-dark` esiste, il bug di §43 era un falso positivo

**Metodo di questa revisione:** verifica diretta da parte di Robertin sul codice reale (`grep` mirato su `globals.css` + l'intero `src/`), non da Claude Code — la prima verifica indipendente su questo punto specifico dall'apertura del caso in §43.

### Cosa era successo

§43 aveva segnalato `--color-primary-dark` come "mai definita", basandosi su un controllo di quella stessa sessione limitato a `src/app/layout.tsx`. **Errore**: la var è dichiarata in `apps/storefront/src/app/globals.css`, non in `layout.tsx` — file mai controllato in quella sessione per mancanza di accesso al codice (limite già dichiarato esplicitamente in §43, ma non sufficiente a evitare la conclusione errata).

**Ironia procedurale**: questo stesso context doc conteneva già, da §12bis (redesign storefront, fine luglio), la prova che il token esiste — riga 798: *"Nuovo token `--color-primary-dark` (`color-mix(in srgb, var(--color-primary) 75%, black)`) — varianti scure derivate senza bisogno di nuove colonne DB"*. Un controllo incrociato con le sezioni precedenti dello stesso documento avrebbe evitato l'errore prima ancora di guardare il codice.

### Dettaglio tecnico corretto

- Dichiarata in `globals.css`, non in `layout.tsx`: `--color-primary-dark: color-mix(in srgb, var(--color-primary) 75%, black)` in `:root` (riga ~8), ricalcolata in `.dark` come `color-mix(in srgb, var(--color-primary) 60%, white)` (riga ~63, schiarita invece di scurita per restare leggibile su sfondo scuro — coerente con quanto già documentato in §26/riga 577).
- **Perché "funziona" comunque senza essere ridichiarata per-tenant in `layout.tsx`**: le CSS custom properties si risolvono live in cascata, non a compile-time — `layout.tsx` inietta solo `--color-primary: ${tenant.primary_color}` in uno `<style>` che vince la cascata su quella singola var; `color-mix(in srgb, var(--color-primary) ...)` in `globals.css` la referenzia dinamicamente, quindi eredita automaticamente il colore tenant-corretto pur essendo scritta una sola volta, mai duplicata per tenant. Multi-tenant-first rispettato, zero hex fissi.
- Grep sull'intero `src/` (30+ occorrenze in shop/admin/événementiel): nessun altro uso orfano — tutti consumano questa stessa dichiarazione funzionante.
- **Colore atteso per ChloeFood** (`primary_color` default `#1D9E75`, nessuna migration lo sovrascrive): `--color-primary-dark` (light) ≈ `#167758` (verde scuro/foresta) su `--color-primary-light` `#e1f5ee` (menta pallido) — contrasto testo/sfondo teoricamente ben leggibile per la voce attiva sidebar, non un caso di colore invisibile.

### Il micro-prompt di fix generato in §43 non è stato eseguito

Claude Code (sessione di generazione del fix) ha correttamente rifiutato di applicarlo dopo aver verificato di persona che la premessa era falsa — **zero file toccati**, nessuna duplicazione introdotta. Comportamento corretto: meglio un ciclo "sprecato" per un bug inesistente che un fix che duplica una dichiarazione già funzionante.

### La domanda originale resta aperta

Il motivo per cui Robertin non notava differenze visive sulla dashboard dopo il deploy di §43 **non è quindi questo**. Ipotesi principale residua: le modifiche erano deliberatamente sottili (spaziatura/dimensione icone, non un redesign — l'admin era già stato ridisegnato a fondo a luglio, §8bis). Se il problema percepito persiste, serve uno screenshot/descrizione puntuale per individuare la causa reale — non ulteriori ipotesi da remoto senza riscontro visivo.

**✅ Chiusa in v3.27 — vedi §45: non era un problema, la sidebar funziona correttamente.**

### Aggiornamenti in questo changelog

- **§43** — paragrafo del bug barrato con nota di correzione, non cancellato, per tracciabilità.
- Nuova sezione **§44** (questa).
- **Nota di processo per le prossime sessioni**: quando una verifica si basa solo su un report testuale senza accesso al codice (come esplicitamente dichiarato in §43), qualunque conclusione "X non esiste/manca" andrebbe cross-referenziata con le sezioni precedenti di questo stesso documento prima di essere scritta come fatto accertato — non solo segnalata come "da verificare indipendentemente" a posteriori.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.26 — 17 Agosto 2026 (base: v3.25; correzione di un falso positivo del changelog precedente — `--color-primary-dark` esiste in `globals.css` dal redesign storefront di luglio [già documentato in §12bis, mai incrociato prima di scrivere §43], verificato direttamente da Robertin; zero file toccati nel ciclo di fix [correttamente non eseguito su premessa falsa]; causa reale della percezione "nessuna differenza visibile" sulla sidebar resta da accertare — vedi §44 per il dettaglio completo)*

---

## 45. Changelog v3.27 (17 Agosto 2026) — Chiusura: la sidebar funziona correttamente, colore blu atteso e confermato via screenshot

**Metodo di questa revisione:** screenshot reale di `shop.chloefood.com/admin` fornito da Robertin — prima verifica visiva diretta di questo intero filone (§43/§44/§45), dopo due cicli basati solo su report testuale/grep.

### Cosa mostra lo screenshot

La voce "Commandes" (attiva) mostra correttamente una pillola blu chiara con testo blu scuro — **non verde**. A un primo sguardo poteva sembrare un'anomalia (il micro-prompt di §43 aveva indicato "colore atteso: verde `#167758`"), ma è quel valore atteso a essere sbagliato, non il rendering:

- `tenant.primary_color` di ChloeFood è **blu `#1267C7`** dal 17/07 (migrazione brand charter v2, già documentata in §2/§12bis di questo stesso documento) — non più il verde `#1D9E75` di default usato erroneamente come riferimento nel micro-prompt di fix di §43.
- Il testo/pillola blu scuro visibile nello screenshot è quindi `color-mix(in srgb, #1267C7 75%, black)` — coerente, corretto, niente di rotto.
- **Causa reale della percezione "nessuna differenza visibile"** (la domanda aperta fin da §43): l'admin era già in tema blu da un mese; questo ciclo ha cambiato solo spaziatura/dimensione icone (§43), non i colori — che erano già corretti. Nessun mistero da risolvere oltre a questo.

### Catena di correzioni su questo filone (per traccia)

1. **§43**: bug "attivo non visibile" ipotizzato per `--color-primary-dark` mancante.
2. **§44**: smentito — la var esiste in `globals.css`, errore di verifica incompleta.
3. **§45 (questa)**: chiusura — nessun bug in nessun punto della catena; il colore blu è quello corretto per ChloeFood da luglio, il mio riferimento al verde nel micro-prompt di §43 era il vero errore all'origine di tutta la confusione.

### Aggiornamenti in questo changelog

- **§44** — riga finale aggiornata con puntatore a questa chiusura.
- Nuova sezione **§45** (questa).
- **Nota di processo**: il valore "colore primario atteso" per ChloeFood scritto nei prompt/fix va sempre preso dalla sezione §2 di questo documento (tabella "Colori brand ChloeFood — valore DB attuale"), mai da un default hardcoded ricordato a memoria — è il secondo errore su questo filone causato dallo stesso tipo di svista (dato non incrociato con la fonte più recente nel documento stesso).

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.27 — 17 Agosto 2026 (base: v3.26; chiusura del filone `--color-primary-dark`/sidebar attiva — screenshot reale confermato: il blu visibile è il `tenant.primary_color` corretto di ChloeFood dal 17/07, non un bug; l'errore era nel valore "verde atteso" scritto nel micro-prompt di §43, non nel codice; nessuna azione ulteriore richiesta su questo filone — vedi §45 per il dettaglio completo)*

---

## 46. Changelog v3.28 (17 Agosto 2026) — Chiarimento scope + Fase A del piano di integrazione stile TailAdmin

**Metodo di questa revisione:** confronto diretto zip vs report (come §42), non solo lettura testuale — 2/2 file confermati.

### Chiarimento scope (prima di questo ciclo)

Il ciclo §43 (sidebar/header) non esauriva l'obiettivo di Robertin: l'intento era un restyling generale dell'admin nel linguaggio visivo TailAdmin — card, tabelle, badge, bottoni, ricerca — non solo il guscio di navigazione. Prodotto un documento di audit/piano a fasi (`Audit_Piano_IntegrazioneStileTailAdmin.md`, allegato di sessione, non versionato nel repo) con approccio esplicito: **adattare i componenti reali esistenti allo stile del template, non copiare i componenti-vetrina del template** (fatti per dati finti, incompatibili con la logica reale già costruita nell'audit admin di luglio, §8bis).

**Piano a 4 fasi concordato**: A) design tokens/componenti condivisi → B) ricerca globale (gap concreto segnalato da Robertin: oggi solo client-side, solo su `/admin/catalogue`, si disabilita sopra soglia senza spiegazione, nessuna ricerca cross-entità) → C) dashboard/commandes come pilota → D) resto delle pagine (catalogue, événementiel, loyalty, ambassadeurs, paramètres, billing) una per una.

**Requisiti Fase B confermati da Robertin** (da usare quando si scrive quel prompt): ricerca su **tutte** le entità (commandes, produits, événements, clienti quando esisteranno) con possibilità di limitare l'ambito; **nessuna** scorciatoia da tastiera (solo click sull'icona).

### Fase A — design tokens e componenti condivisi (17/08, questo ciclo)

Obiettivo: creare i building block (`KpiCard`, `Button`) usati dalle fasi successive, senza toccare ancora nessuna pagina reale.

- **Scoperta Step 0 rilevante**: `_components/ui/` conteneva solo `StatusBadge.tsx`, `NotificationBell.tsx`, `BulkTrackingModal.tsx`, `ConfirmPaymentButton.tsx` — `KpiCard`/`Badge` generico/`Button`/`Toast`/`BulkBar` **non esistevano mai stati estratti**, nonostante l'audit di luglio (§4 di `AUDIT_ADMIN_UIUX.md`) li elencasse come pianificati. `KpiCard` esisteva solo come funzione locale dentro `(protected)/page.tsx` (righe 17-61, 5 istanze) — nessuna icona, delta come solo testo colorato, nessuna freccia trend.
- **`StatusBadge.tsx` già conforme**: dot colorato + pillola + token semantici `--status-*` — pattern già identico al template, zero modifiche necessarie. Non scontato: sarebbe stato facile "sistemarlo" senza verificare prima.
- **Creati 2 file, nessuna pagina toccata**: `KpiCard.tsx` (icona in badge tondo colorato per tono semantico/tenant, badge trend con freccia `IconArrowUpRight`/`IconArrowDownRight` di Tabler — non SVG del template, coerente con `CLAUDE.md`) e `Button.tsx` (varianti `primary`/`outline`/`ghost`, `--color-primary-dark` non `--color-primary` per il contrasto AA già misurato nell'audit di luglio — citato esplicitamente nel commento del codice). Entrambi già con supporto `dark:` per coerenza col dark mode admin esistente.
- **Nessuna adozione in questo ciclo** (verificato via grep, zero import dei due nuovi file altrove) — `(protected)/page.tsx` resta con la sua `KpiCard` locale invariata, essendo nei file vietati di questo prompt. La sostituzione — primo cambiamento visivo reale sulla dashboard commandes — è compito della Fase C.
- **Token spaziature/ombre/colori del template (scala grigi, `brand-*`, `theme-*`, breakpoint custom, `spacing['4.5']`, `ringWidth[3]`) deliberatamente NON applicati**: motivato punto per punto nel report — la scala grigi del template collide con quella Tailwind default usata in centinaia di classi in tutto l'app (rischio troppo alto); i colori `brand-*`/`blue-light` violerebbero la regola multi-tenant-first se applicati come hex fissi; il resto (ombre `theme-*`, z-index estesi, font size custom) non ha nessun consumatore reale oggi nei 2 componenti costruiti — introdurli "per il futuro" sarebbe stato scope-creep speculativo. Buona disciplina: nessun token aggiunto senza un consumatore reale nello stesso ciclo.

### Aggiornamenti in questo changelog

- Nuova sezione **§46** (questa).
- **§4 di `AUDIT_ADMIN_UIUX.md`** (documento esterno, non in questo file) — la lista "componenti condivisi da estrarre" risulta ora parzialmente evasa (`KpiCard`, `Button` fatti; `Badge` generico, `Toast`, `BulkBar` ancora da fare, non richiesti da questo ciclo).
- **Prossimo passo**: Fase B (ricerca globale) — requisiti già raccolti sopra, pronti per il prompt.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.28 — 17 Agosto 2026 (base: v3.27; chiarito lo scope reale del progetto TailAdmin — restyling generale, non solo sidebar/header; piano a 4 fasi concordato [A tokens → B ricerca → C dashboard pilota → D resto pagine]; Fase A completata e verificata zip-vs-report [2/2 file] — `KpiCard.tsx`/`Button.tsx` creati, non ancora adottati da nessuna pagina, token template speculativi deliberatamente scartati con motivazione puntuale — vedi §46 per il dettaglio completo)*

---

## 47. Changelog v3.29 (17 Agosto 2026) — Fase B: ricerca globale nell'header admin

**Metodo di questa revisione:** confronto diretto zip vs report (come §42/§46) — 3/3 file confermati, letti per intero (route API + componente + diff header).

### Cosa è stato costruito

Ricerca globale server-side raggiungibile dall'header admin (`AdminGlobalSearch.tsx`, innestato come primo elemento del cluster icone in `AdminHeader.tsx`), su 4 entità (Commandes, Produits, Événements, Clients) con selettore di ambito e **nessuna scorciatoia da tastiera** (solo `Escape` per chiudere) — coerente coi requisiti raccolti in §46.

- **Correzione a un'assunzione del prompt**: esiste già una tabella `customers` dedicata (`id`, `tenant_id`, `email`, `full_name`, `phone` — da `001_initial_schema.sql`), già usata da `api/admin/loyalty/customers-search/route.ts`. Non era "solo un campo dentro `orders`" come il prompt ipotizzava. **Non esiste però una pagina admin di dettaglio cliente** (`/admin/clients/[id]`) — i risultati "Clients" puntano a `mailto:{email}` come unica azione reale disponibile, dichiarato esplicitamente invece di inventare un link verso una pagina inesistente.
- **Pattern di query replicato da `customers-search/route.ts`** (non reinventato): query param sanificato via regex, due `.ilike()` tipizzate in parallelo + merge/dedup lato applicativo, **mai** un `.or()` in sintassi raw PostgREST — quel file documenta un bug 500 in produzione causato esattamente da quella sintassi, evitato qui a monte.
- **Sicurezza/scoping**: `requireAdmin(tenant.id)` prima di ogni query; `tenant_id` filtrato su tutte le 4 entità (8 query totali, mai una senza scoping) — verificato riga per riga nel codice, non solo dichiarato.
- **Buona pratica non richiesta esplicitamente dal prompt**: `export const dynamic = 'force-dynamic'` + `export const fetchCache = 'force-no-store'` applicati di iniziativa sulla nuova route — coerente con la regola permanente sulla Data Cache (§41), applicata correttamente senza doverlo specificare nel prompt.
- **Ricerca ordini non cerca su `id`**: `orders.id` è uuid, `ilike` su colonna uuid non è garantito senza cast esplicito lato PostgREST/Postgres — stessa classe di fragilità già causa di un 500 altrove (vedi sopra). Deviazione dichiarata: ricerca ordini solo su `full_name`/`email`; ricerca per numero ordine breve rimandata a un fix dedicato se servirà.
- **Mobile**: nessuna duplicazione in `AdminMobileNav.tsx` — l'header (dove vive la ricerca) è sempre visibile su ogni dispositivo (mai `hidden md:block`, a differenza della sidebar), quindi è bastato rendere il pannello risultati stesso responsive (overlay a piena larghezza sotto l'header su mobile, dropdown ancorato su desktop).
- **Nessun indice proposto** (`pg_trgm` o simile): con `LIMIT 5` per entità e volumi attuali (~500 ordini secondo l'audit di luglio), `ilike` senza indice resta accettabile — da rivalutare insieme alla Fase 5 dell'audit generale se il volume cresce.
- **Ricerca client-side esistente su `/admin/catalogue` invariata** — file nella lista dei non-toccabili, confermato non modificato.

### Struttura route API (per riferimento futuro)

`GET /api/admin/search?q=<string>&scope=orders,products,events,customers` — `q` minimo 2 caratteri, `scope` opzionale (CSV, default tutte e 4), risposta `{ query, results: { orders[], products[], events[], customers[] } }`, ogni entità limitata a 5 risultati con `label`/`sublabel`/`href` pronti per il rendering.

### Aggiornamenti in questo changelog

- Nuova sezione **§47** (questa).
- **§46** — correzione all'assunzione "Clients potrebbe non esistere come entità separata": esiste (`customers` table), annotato qui per non riproporre la stessa domanda in futuro.
- **Prossimo passo**: Fase C — dashboard/commandes come pagina pilota, adozione reale di `KpiCard.tsx`/`Button.tsx` (Fase A) nella pagina esistente.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.29 — 17 Agosto 2026 (base: v3.28; Fase B completata e verificata zip-vs-report [3/3 file] — ricerca globale server-side su 4 entità, tenant-scoped su ogni query, nessuna scorciatoia da tastiera come richiesto, tabella `customers` dedicata scoperta e riusata correggendo un'assunzione del prompt, link `mailto:` per clienti in assenza di pagina dettaglio — vedi §47 per il dettaglio completo)*

---

## 48. Changelog v3.30 (17 Agosto 2026) — Fase C: dashboard/commandes come pagina pilota + addendum Fase B in coda

**Metodo di questa revisione:** confronto diretto zip vs report (come §42/§46/§47) — 2/2 file confermati, letti per intero.

### Chiarimento scope intervenuto durante Fase B

Vedendo uno screenshot reale del template TailAdmin, Robertin ha chiesto di rivedere lo stile della ricerca (Fase B, §47): non un'icona che apre un dropdown, ma una **barra larga sempre visibile** nell'header, come nel template. **Decisione presa e confermata**: niente badge `⌘K` — mostrarlo senza la scorciatoia reale (esplicitamente esclusa in Fase B) sarebbe un'affordance ingannevole. Prompt scritto (`ClaudeCode_Prompt_FaseB_Addendum_BarraRicerca.md`, allegato di sessione) — **esito non ancora riportato**, da verificare al prossimo ciclo.

### Fase C — dashboard/commandes (17/08, questo ciclo)

Primo ciclo che cambia visivamente una pagina admin reale (non solo componenti isolati come in Fase A). `KpiCard.tsx`/`Button.tsx` (creati inerti in §46) finalmente adottati.

- **Adozione pulita**: funzione locale `KpiCard` (49 righe) rimossa da `(protected)/page.tsx`, sostituita dal componente condiviso di Fase A sulle 5 KPI esistenti (Aujourd'hui, CA total, CA ce mois, À expédier, Expédiées ce mois). **Query/calcoli invariati** — fatturato, delta % mese/mese, conteggi: stessa logica esatta, solo la presentazione cambia. Verificato leggendo l'intero file, non solo il diff dichiarato.
- **Icone Tabler scelte** (nessun indizio preesistente nel codice, decise ex novo in questo ciclo): `IconClock`/info (Aujourd'hui), `IconCurrencyEuro`/primary (CA total), `IconTrendingUp`/primary (CA ce mois), `IconTruck`/warn (À expédier — stessa icona già usata per "Livraison" in `AdminSidebar`, coerenza intenzionale con la nav), `IconTruckDelivery`/success (Expédiées ce mois — variante "consegnato" distinta da `IconTruck` "in attesa", evita ambiguità visiva tra i due stati).
- **Bug latente di Fase A scoperto e corretto**: `KpiCard.tsx` tipizzava la prop `icon` con `size?: number` invece di `size?: string | number` (il vero tipo di `IconProps` di `@tabler/icons-react`, non esportato nominalmente dal pacchetto) — mai emerso in Fase A perché nessuna pagina reale aveva ancora passato un'icona vera al componente. Bloccava `pnpm typecheck`; corretto qui con una modifica di una riga, non rimandato (era necessario per completare lo scope dichiarato del ciclo).
- **Bottoni**: nessuno trovato in `(protected)/page.tsx` (verificato: zero `<button>` nel file) — gli elementi interattivi vivono in `AdminFilters.tsx`/`OrdersTable.tsx`/`PendingPaymentsBanner.tsx`, tutti fuori scope di questo ciclo (i primi due nella lista dei file vietati, il terzo semplicemente non toccato).
- **Tabella ordini invariata** — righe espandibili (decisione 17/07) non toccate, come da regola permanente ribadita nel prompt.

### Aggiornamenti in questo changelog

- Nuova sezione **§48** (questa).
- **§47** — nota: la revisione "barra di ricerca larga, niente `⌘K`" è in coda, prompt scritto ma esito non ancora ricevuto.
- **Prossimo passo**: (a) esito dell'addendum Fase B (barra ricerca), (b) Fase D — resto delle pagine admin (catalogue, événementiel, loyalty, ambassadeurs, paramètres, billing), una alla volta, riusando ora `KpiCard`/`Button`/pattern validati in Fase C come riferimento.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.30 — 17 Agosto 2026 (base: v3.29; Fase C completata e verificata zip-vs-report [2/2 file] — dashboard commandes ora usa `KpiCard`/icone Tabler dedicate, query/calcoli invariati, bug latente di tipo in `KpiCard.tsx` scoperto e corretto; addendum Fase B [barra ricerca larga stile TailAdmin, niente badge ⌘K] scritto ma esito ancora da ricevere — vedi §48 per il dettaglio completo)*

---

## 49. Changelog v3.31 (17 Agosto 2026) — Addendum Fase B confermato (verbale) + Fase C-bis bottoni avviata

**Metodo di questa revisione:** ⚠️ **addendum Fase B confermato solo verbalmente da Robertin** ("La ricerca ora è OK!") — nessun report/zip fornito, nessuna verifica indipendente sul codice possibile in questa sessione. Trattare come da confermare alla prossima occasione con accesso al codice, coerente con la disciplina già applicata altrove in questo documento quando manca il riscontro diretto.

### Addendum Fase B — ricerca a barra larga

Confermato funzionante da Robertin. Non verificato via codice in questa sessione.

### Fase C-bis — bottoni nei componenti reali (avviata)

Il punto 4 del report di Fase C (§48) — "nessun bottone in `(protected)/page.tsx`, sostituzione rimandata" — viene ora smarcato esplicitamente: i bottoni esistono, ma vivono in `AdminFilters.tsx`/`OrdersTable.tsx`/`PendingPaymentsBanner.tsx`, tutti fuori scope di Fase C. Prompt scritto (`ClaudeCode_Prompt_FaseC_bis_Bottoni.md`, allegato di sessione) per adottare `Button.tsx` (Fase A) in questi 3 file, con attenzione esplicita a:
- Non forzare `Button.tsx` su elementi che non sono semanticamente bottoni-azione (chip/toggle filtro) o su bottoni-link (`<Link>` stilizzato — semantica HTML diversa da `<button>`)
- Possibile estensione minima di `Button.tsx` con una prop `size` per bottoni icon-only (bulk bar, azioni riga), se necessaria — da dichiarare esplicitamente nel report, non fatta silenziosamente
- Logica/comportamento (bulk actions, guardrail tracking, conferme) dichiarati invariati, solo il markup del bottone cambia

**Esito non ancora ricevuto** — da verificare al prossimo report.

### Aggiornamenti in questo changelog

- Nuova sezione **§49** (questa).
- **§48** — punto 4 (bottoni rimandati) ora in lavorazione, non più aperto senza seguito.
- **Prossimo passo**: (a) esito Fase C-bis (bottoni), (b) verifica indipendente addendum Fase B se/quando arriva codice, (c) Fase D — resto delle pagine admin.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.31 — 17 Agosto 2026 (base: v3.30; addendum Fase B [barra ricerca] confermato solo verbalmente, non verificato via codice in questa sessione; Fase C-bis [adozione `Button.tsx` in `AdminFilters`/`OrdersTable`/`PendingPaymentsBanner`] avviata, prompt scritto, esito da ricevere — vedi §49 per il dettaglio completo)*

---

## 50. Changelog v3.32 (17 Agosto 2026) — Fase C-bis completata e verificata: bottoni adottati con giudizio, non a tappeto

**Metodo di questa revisione:** confronto diretto zip vs report — 2/2 file confermati, letti per intero, incluso il contesto CSS reale della bulk bar per verificare la motivazione tecnica dichiarata (non solo presa per buona).

### Esito — ambito reale più piccolo di quanto ipotizzato, con buone motivazioni

- **`AdminFilters.tsx`**: zero `<button>` reali (solo `<select>`/`<input type="date">`) — il "Effacer filtres" ipotizzato dal prompt non esiste nel codice. Correttamente non toccato.
- **`PendingPaymentsBanner.tsx`**: il bottone di conferma è delegato a `ConfirmPaymentButton.tsx`, componente condiviso usato in **4 punti** (anche `OrderDetail.tsx`, `EventDetailAdminClient.tsx`, `RentalReservationsClient.tsx`, scoperto via grep) — toccarlo avrebbe esteso il ciclo ben oltre i 3 file dichiarati. Correttamente escluso, dichiarato invece di ignorato.
- **`OrdersTable.tsx`**: 8 `<button>` totali, solo **2 convertiti** (`Effacer la recherche`, freccia espansione riga) a `Button variant="ghost" size="sm"` — verificato nel codice, `onClick` (`setSearchQuery('')`/`toggleRow`) identici a prima.
- **Sort header colonna** (`<th><button>`): lasciato invariato — applicare lo stile `Button.tsx` avrebbe rotto l'allineamento dell'header, correttamente riconosciuto come un caso diverso da un "bottone" visivo.
- **Bulk bar NON convertita — motivazione verificata nel codice, non solo dichiarata**: è una pillola `bg-gray-900 dark:bg-gray-800` con testo bianco fisso, non theme-aware come il resto dell'admin. La variante `ghost` di `Button.tsx` imposta `text-gray-700 dark:text-gray-300` — su quello sfondo scuro reale il contrasto sarebbe scarso, una regressione di accessibilità che la regola "non regredire" del prompt vietava esplicitamente. **Confermato leggendo entrambi i file**: la pillola è davvero scura, la classe `ghost` è davvero quella. Decisione corretta, non un'omissione mascherata da giustificazione.
- **Bottoni-link** (`Voir →`, icona stampa picking-list): lasciati `<Link>`, non forzati in `Button.tsx` — sono navigazione, non azioni, distinzione semantica/accessibilità corretta.

### Estensione di `Button.tsx`

Aggiunta `size?: 'sm' | 'md'`, default `'md'` — **verificato che il default preserva esattamente il comportamento precedente** (nessun uso esistente in `(protected)/page.tsx` da Fase C, riconfermato qui). `sm` = `p-1.5 text-xs gap-1`, pensato per icon-only con target tattile ≥24×24px, commento nel codice cita esplicitamente §9 di `AUDIT_ADMIN_UIUX.md`.

### Aggiornamenti in questo changelog

- Nuova sezione **§50** (questa).
- **§49** — Fase C-bis chiusa, nessuna azione residua.
- **Nota di pattern per le fasi successive (D)**: questo ciclo conferma che l'adozione dei componenti condivisi va fatta caso per caso, non a tappeto — è normale e corretto che una parte dei casi ipotizzati nel prompt non esista o vada esclusa per motivi tecnici concreti (contrasto, semantica, raggio d'azione condiviso). I prompt di Fase D dovrebbero aspettarsi lo stesso pattern, non trattarlo come deviazione da correggere.
- **Prossimo passo**: Fase D — resto delle pagine admin (catalogue, événementiel, loyalty, ambassadeurs, paramètres, billing), una alla volta.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.32 — 17 Agosto 2026 (base: v3.31; Fase C-bis completata e verificata zip-vs-report [2/2 file] — solo 2/8 bottoni di `OrdersTable.tsx` convertiti a `Button.tsx`, resto correttamente escluso con motivazioni tecniche verificate nel codice [bulk bar contrasto, `ConfirmPaymentButton` condiviso su 4 moduli, sort header, bottoni-link]; `Button.tsx` esteso con `size` opzionale, default invariato — vedi §50 per il dettaglio completo)*

---

## 51. Changelog v3.33 (17 Agosto 2026) — Quattro cicli sul percorso di prenotazione evento: fix critico webhook + correzione email admin + messaggistica + validazione formato — ⚠️ nessuno pushato

**Metodo di questa revisione:** quattro cicli eseguiti in sequenza nella stessa sessione, ciascuno con Step 0 di esplorazione filesystem obbligatoria (lettura diretta del codice, non presunzione dello stato) prima di scrivere codice, e `pnpm typecheck` pulito verificato dopo ciascuno. **Nessuno dei quattro è stato pushato** — regola esplicita di Robertin in ogni prompt ("Nessun `git push` diretto... fornire zip con file toccati, mantenendo la struttura della repo"), consegna via zip ad ogni ciclo. A fine sessione tutte le modifiche restano solo su disco su questo branch di lavoro (`claude/stripe-webhook-event-reservations-iba64o`), confermate non committate dallo stop-hook del repository ad ogni tentativo di chiusura turno.

### 1. Fix critico — webhook Stripe non creava le prenotazioni evento

**Diagnosi:** in `apps/storefront/src/app/api/webhooks/stripe/route.ts`, il branch `payment_intent.succeeded` gestiva solo `metadata.type === 'card_quick_payment'` (§41.3) e, per tutto il resto, presupponeva un ordine shop cercando `metadata.session_id`. Un pagamento biglietto evento arriva con `metadata.type === 'event_reservation'` (impostato in `api/events/[id]/checkout/route.ts`) — non essendo riconosciuto né come `card_quick_payment` né avendo un `session_id`, il webhook loggava `No session_id in PaymentIntent metadata` e ritornava `{ received: true }` senza fare nulla: **pagamento incassato, nessuna riga `event_reservations`, nessun `qr_token`, nessuna notifica n8n → nessuna email col biglietto**. Il flusso Phase 2 (`external_link`, conferma manuale admin, §41.2) non era toccato: passa da `confirm-payment/route.ts`, che chiama direttamente `createEventReservationFromRequest` bypassando il webhook.

**Fix:** nuova funzione privata `handleEventReservationPaymentSucceeded(intent)` in fondo al file, stesso pattern difensivo di `handleCardQuickPaymentSucceeded` (ritorna sempre `{ received: true }`, mai un'eccezione non gestita che faccia fallire la risposta al webhook). Estrae `event_id`/`tenant_id`/`items` (JSON.parse, stringificato in checkout)/dati cliente dai metadata, verifica idempotenza su `event_reservations.stripe_payment_intent_id` (stesso pattern già in uso per il branch shop), poi chiama `createEventReservationFromRequest` — **riusata così com'è, zero modifiche**, contiene già tutta la logica (capacità atomica, `qr_token`, rimborso automatico su conflitto, notifica n8n con `ticketUrl`). Nuovo branch smistato in testa al blocco `payment_intent.succeeded`, prima del check `session_id` esistente, che resta bit-a-bit identico (confermato via `git diff` mirato).

Unico file toccato: `apps/storefront/src/app/api/webhooks/stripe/route.ts`.

**Nota operativa lasciata a Robertin** (non eseguibile da Claude Code): recuperare i pagamenti persi cercando in Stripe Dashboard i `payment_intent.succeeded` con `metadata.type = event_reservation` senza riga corrispondente in `event_reservations`, e usare "Resend" una volta che il fix è in produzione per far ripartire retroattivamente prenotazione + QR + email.

### 2. Admin — correzione email cliente + reinvio biglietto

Bug complementare, non di dominio (typo su `gmial.com`) ma di digitazione della mailbox stessa (`mario.rosis@` invece di `mario.rossi@`) — non risolvibile né da un correttore di dominio né da una verifica MX. Pagamento e prenotazione sono corretti, solo la notifica n8n parte verso un indirizzo sbagliato.

- **`apps/storefront/src/lib/events/resendReservationConfirmation.ts`** (nuovo) — rilegge lo stato attuale di una prenotazione esistente (`event_reservations` + join `event_reservation_items`/`event_ticket_types`, stessa logica di `createEventReservationFromRequest.ts`, replicata non reinventata) e rimanda la notifica n8n `/webhook/event-reservation-confirmed` con payload strutturalmente identico a quello di creazione (stessi nomi di campo, `ticketUrl` ricostruito dallo stesso `qr_token` — **mai rigenerato**, il cliente riceve lo stesso biglietto già valido per lo scanner).
- **`apps/storefront/src/app/api/admin/evenementiel/reservations/[id]/resend-email/route.ts`** (nuovo, `PATCH`) — stesso pattern `requireAdmin(tenant.id)` + tenant check di `refund/route.ts`. 404 se non trovata/tenant diverso, 409 se `status !== 'confirmed'`, 400 se l'email fornita non passa `isValidEmail` (stessa regex di `card/quick-pay/route.ts`, non un nuovo util condiviso). Aggiorna `customer_email` solo se fornita e diversa, poi chiama la funzione sopra.
- **`EventDetailAdminClient.tsx`** — editing inline dell'email nella lista prenotazioni (icona matita → input + check/annulla, icone Tabler `IconPencil`/`IconCheck`/`IconX` verificate esistenti nel pacchetto installato) + bottone "renvoyer" (`IconSend`) sempre visibile per prenotazioni confermate, per il caso email corretta ma finita in spam. Stato di loading condiviso (`resendingId`) per evitare doppio invio, nessun `confirm()` bloccante (azione non distruttiva).

### 3. Messaggistica evidente sull'email lungo il percorso di prenotazione

Terzo livello di difesa, complementare al punto 2 (che corregge dopo il fatto): rendere l'email scritta dall'utente **visibile e rileggibile** in tre punti del checkout/conferma, senza aggiungere campi o step (un doppio campo email o un codice di conferma via email erano stati scartati esplicitamente — troppa frizione).

- **Step `info`** (`EventCheckoutClient.tsx`) — avviso `text-xs text-gray-500` con `IconInfoCircle` sotto il campo email: "Vérifiez bien votre adresse — c'est ici que vous recevrez votre billet."
- **Step `select-payment`** (stesso file) — nuovo riquadro recap "Billet envoyé à {email}" + bottone "Modifier" (riusa `handleBackToInfo` esistente, non duplicato), posizionato tra il recap formule e la scelta del mezzo di pagamento: il punto a maggior impatto, l'utente rilegge l'email esatta immediatamente prima di pagare.
- **Pagina di conferma** (`EventConfirmationClient.tsx` + `confirmation/page.tsx`, quest'ultimo reso `async` per chiamare `getTenant()` e passare `whatsappNumber`) — il tipo `StatusResponse['reservation']` esteso con `customer_email` (già restituito dall'API `reservation-status`, solo il tipo TS lato client mancava); il testo generico "Un email de confirmation... a été envoyé" sostituito con l'indirizzo effettivo digitato dall'utente; rassicurazione esplicita che il biglietto è già disponibile in pagina anche se l'email non arriva; CTA "Contactez-nous sur WhatsApp" condizionale su `tenant.whatsapp_number` (stesso pattern `wa.me/` già in uso in `EventsFooter.tsx`, non reinventato — nessun link rotto se il campo è `null`).
- **Bandeau rosso** (stessa pagina di conferma) — promemoria visibile e insistente ("⚠️ Téléchargez votre billet maintenant...") sopra i bottoni di download, colore semantico di avvertimento (`bg-red-50`/`text-red-700`/`border-red-200`, stesso pattern già in uso altrove nel codebase per gli errori — non una deviazione dalla regola "niente colore hardcoded", quella regola riguarda i colori di brand, non gli stati semantici), mostrato **solo quando `reservation` è valorizzata** (mai in loading/timeout). Sugli step del checkout, il richiamo equivalente resta volutamente neutro (`text-xs text-gray-500`, nessun rosso) — nessun evento negativo è ancora accaduto in quel punto del percorso, un rosso lì sarebbe allarmante a torto.

### 4. Validazione formato email (client + server)

Livello complementare finale — non un correttore di typo sul dominio né una verifica MX/deliverability (entrambi scartati esplicitamente in precedenza), solo un controllo strutturale (`@`, dominio con punto) che cattura i casi più grossolani con feedback immediato.

- **`EventCheckoutClient.tsx`, step `info`** — funzione locale `isValidEmail` (stessa regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` già in uso in `OrderLookupForm.tsx` e `CardQuickPay.tsx`/`api/card/quick-pay/route.ts`, duplicata non condivisa in un util — fuori scope creare un package per una singola regex). Stato `emailTouched` (settato su `onBlur`, non ad ogni keystroke) determina `emailInvalid`; bordo rosso condizionale sull'input, messaggio di errore inline che **sostituisce** (non si sovrappone a) l'avviso generico del punto 3 quando attivo. `handleContinueToPayment` esteso col controllo di formato (oltre a quello di presenza già esistente), forzando `emailTouched` anche se l'utente non ha mai lasciato il focus dal campo.
- **`api/events/[id]/checkout/route.ts`** — stessa funzione `isValidEmail` (stessa regex, duplicata coerentemente col resto del codebase) aggiunta lato server, subito dopo il controllo esistente di campi mancanti e **prima** di qualunque query Supabase o chiamata `stripe.paymentIntents.create` — chiude il varco per chi bypassa il form (devtools, chiamata diretta all'API) con un'email palesemente malformata. Nessun altro controllo esistente in quella route (capienza, formule attive, quantità) toccato.

### File toccati in questo changelog (nessuno pushato)

| File | Ciclo |
|---|---|
| `apps/storefront/src/app/api/webhooks/stripe/route.ts` | 1 |
| `apps/storefront/src/lib/events/resendReservationConfirmation.ts` (nuovo) | 2 |
| `apps/storefront/src/app/api/admin/evenementiel/reservations/[id]/resend-email/route.ts` (nuovo) | 2 |
| `apps/storefront/src/app/admin/(protected)/evenementiel/evenements/[id]/EventDetailAdminClient.tsx` | 2 |
| `apps/storefront/src/app/(evenementiel)/evenementiel/evenements/[slug]/EventCheckoutClient.tsx` | 3, 4 |
| `apps/storefront/src/app/(evenementiel)/evenementiel/evenements/[slug]/confirmation/EventConfirmationClient.tsx` | 3 |
| `apps/storefront/src/app/(evenementiel)/evenementiel/evenements/[slug]/confirmation/page.tsx` | 3 |
| `apps/storefront/src/app/api/events/[id]/checkout/route.ts` | 4 |

### Aggiornamenti in questo changelog

- Nuova sezione **§51** (questa).
- Nessuna migration SQL, nessuna modifica RLS, nessuna nuova dipendenza npm in nessuno dei quattro cicli.
- **Prossimo passo**: decidere con Robertin se/quando committare e pushare i quattro cicli (attualmente solo su disco, consegnati via zip); una volta pushato, eseguire manualmente il recupero dei pagamenti evento persi durante la finestra del bug (§51.1) via Stripe Dashboard "Resend"; Fase D dell'audit admin (§50) resta indipendente e non toccata da questa sessione.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.33 — 17 Agosto 2026 (base: v3.32; quattro cicli sequenziali sul percorso di prenotazione evento — fix critico webhook Stripe `event_reservation` mancante, correzione email admin + reinvio biglietto, messaggistica email in 3 punti del checkout/conferma + bandeau rosso promemoria download, validazione formato email client+server — **nessuno pushato su richiesta esplicita di Robertin**, consegna via zip ad ogni ciclo, `pnpm typecheck` pulito dopo ciascuno — vedi §51 per il dettaglio completo)*

---

## 52. Changelog v3.34 (17 Agosto 2026) — Due cicli ulteriori: chiarimento canale email su `/en-attente` + pulizia trattini lunghi + "Changer de moyen de paiement" — ⚠️ nessuno pushato

**Metodo di questa revisione:** due cicli eseguiti in sequenza, in continuità diretta coi quattro di §51, stesso branch di lavoro. Step 0 di esplorazione filesystem obbligatoria prima di ciascuno, `pnpm typecheck` pulito verificato dopo entrambi. **Nessuno dei due pushato** — stessa regola esplicita di Robertin applicata ininterrottamente da §51, consegna via zip. A fine sessione tutte le modifiche di questo documento (§51+§52, sei cicli totali) restano solo su disco.

### 5. Chiarimento canale email su `/en-attente` + pulizia trattini lunghi

**Diagnosi:** per i pagamenti evento via link esterno (PayPal/Revolut), il cliente atterra su `/en-attente` e non torna mai su una pagina con QR scaricabile — `event_reservations` non esiste ancora a quel punto, solo una riga `event_reservation_requests` in stato `pending`. Il QR nasce solo alla conferma manuale admin, e l'unico modo in cui il cliente lo riceve è l'email inviata da n8n — nessun fallback di download, a differenza del flusso Stripe (§51.3, dove la pagina di conferma mostra sempre il QR).

**Fix:**
- `EventCheckoutClient.tsx` — `customerEmail: email.trim()` aggiunto al payload scritto in `sessionStorage` (`lepefy-pending-event-payment`) prima del redirect verso `/en-attente`.
- `en-attente/page.tsx` — reso `async`, chiama `getTenant()` (stesso pattern già applicato a `confirmation/page.tsx` in §51.3), passa `whatsappNumber={tenant.whatsapp_number}`.
- `PendingEventPaymentClient.tsx` — il blocco finale mostra ora l'email effettiva digitata, precisa in stile neutro (nulla è ancora andato storto, niente rosso) che per questo mezzo di pagamento l'email è l'**unico** canale di recupero del biglietto — non c'è pagina di download come per la carta — e invita a verificarla prima di pagare sul link esterno. CTA WhatsApp condizionale su `whatsappNumber`, stesso pattern `wa.me/` già riusato in `EventConfirmationClient.tsx` (§51.3).

**Pulizia trattini lunghi (nuova regola permanente):** i trattini lunghi (`—`) sono un tratto riconoscibile di testo generato da AI e sono stati rimossi da **tutti i testi utente (JSX)** del percorso Événementiel — 15 occorrenze corrette in `EventCheckoutClient.tsx`, `page.tsx` (evento), `EventConfirmationClient.tsx`, `PendingEventPaymentClient.tsx`, `EventDetailAdminClient.tsx` — sostituiti con virgola, due punti, o punto medio `·` (quest'ultimo per separare due valori affiancati in linea, es. badge/pill, coerente con lo stile già in uso altrove nel codebase) a seconda del contesto, mantenendo il senso esatto. Due occorrenze erano un caso concettualmente diverso — un glifo singolo usato come simbolo "valore assente" (placeholder lieu non défini, fallback label formula), non punteggiatura di prosa — sostituite comunque con un trattino corto ASCII (`-`) per rispettare la lettera della regola. **I commenti di codice (`//`, `{/* */}`) non sono soggetti a questa regola** e restano invariati — verificato con un secondo grep mirato dopo le modifiche, tutti gli `—` residui nei file toccati sono in commenti.

**Regola permanente da questo ciclo in poi:** i testi utente (JSX) non devono contenere trattini lunghi — preferire virgola, due punti o punto medio `·` per separare valori in linea; i commenti di codice non sono soggetti a questa regola.

File toccati: `EventCheckoutClient.tsx`, `page.tsx` (evento, sotto `[slug]`), `EventConfirmationClient.tsx`, `PendingEventPaymentClient.tsx`, `en-attente/page.tsx`, `EventDetailAdminClient.tsx`.

### 6. "Changer de moyen de paiement" da `/en-attente`

**Diagnosi:** il cliente che sceglie PayPal/Revolut e vuole ripensarci (pagare con carta) aveva solo il link "← Retour aux événements", che riporta da zero — `/en-attente` è una route separata, il componente checkout viene smontato completamente, nessun dato preservato. Inoltre la riga `event_reservation_requests` creata al momento della scelta resta `pending` per sempre se il cliente cambia idea, continuando a comparire nel bandeau admin "Paiements en attente" e confondendo Dalice con una richiesta che non sarà mai pagata su quel canale.

**Fix — precompilazione via draft in sessionStorage:**
- `EventCheckoutClient.tsx` — nuova chiave `lepefy-event-checkout-draft` (distinta da `lepefy-pending-event-payment`), contenente `eventId`/`quantities`/`name`/`email`/`phone`, scritta in `handleContinueToPayment` subito prima di `setStep('select-payment')` (nome/email già validati a quel punto). Nuovo `useEffect` al mount (`draftRestoredRef`, eseguito prima dell'effetto esistente di precompilazione da `/api/customers/me`, che resta invariato) legge il draft: se `draft.eventId === event.id`, ripristina i campi e salta direttamente allo step `select-payment`; se l'evento non corrisponde, nessuna azione. Il draft **non** viene cancellato quando si sceglie il link esterno (deve sopravvivere fino a `/en-attente`), ma **viene rimosso** quando lo step Stripe (`payment`) viene raggiunto con successo — a quel punto la prenotazione reale è in corso.
- `eventSlug: event.slug` aggiunto anche al payload `lepefy-pending-event-payment` esistente, necessario per il redirect di ritorno dalla pagina `/en-attente`.

**Fix — cancellazione richiesta abbandonata:** nuovo endpoint pubblico `DELETE /api/events/reservation-requests/[id]/route.ts` (nessuna auth admin — id UUID v4 non indovinabile, stesso principio già in uso per `checkout-external-link` e gli altri link opachi del modulo). Cancellazione atomica e condizionata in un'unica query (`delete().eq('id', ...).eq('tenant_id', ...).eq('status', 'pending').select('id').maybeSingle()`), per evitare una race condition con una conferma admin nel frattempo: se nessuna riga cancellata, `409 { error: 'already_confirmed_or_not_found' }` (non un errore generico — il frontend distingue questo caso); se cancellata, `200 { success: true }`. **Nessuno stato `abandoned` aggiunto** — decisione esplicita presa con Robertin di cancellare la riga piuttosto che introdurre un nuovo stato sul CHECK constraint, per non mischiare una migrazione in un ciclo altrimenti puramente UI.

`PendingEventPaymentClient.tsx` — nuovo bottone "Changer de moyen de paiement" (stile neutro, coerente con "← Retour aux événements") subito sotto "Ouvrir {label}". Al click: `DELETE` sull'endpoint sopra; su `409` mostra "Votre paiement a déjà été confirmé entre-temps. Vérifiez vos emails." senza navigare via silenziosamente; su successo, `router.push` verso la pagina evento (`/evenementiel/evenements/${eventSlug}`), dove il draft già in sessionStorage viene letto automaticamente al mount, saltando a `select-payment`.

**Lato admin: zero modifiche.** La cancellazione della richiesta fa sparire automaticamente la riga dal bandeau "Paiements en attente" al prossimo caricamento, grazie al `fetchCache: 'force-no-store'` già presente sulla pagina admin evento (confermato nello Step 0, non toccato).

**Limite noto, non risolto in questo ciclo:** se il cliente abbandona in silenzio (chiude la scheda senza cliccare "Changer de moyen de paiement" né completare il pagamento), la riga `event_reservation_requests` resta `pending` per sempre — nessuna pulizia automatica. Richiederebbe una pulizia periodica separata (cron/trigger che cancella le righe `pending` più vecchie di N giorni) — **non implementata, candidata per un ciclo futuro**.

File toccati: `EventCheckoutClient.tsx`, `PendingEventPaymentClient.tsx`, nuovo `apps/storefront/src/app/api/events/reservation-requests/[id]/route.ts`.

### Aggiornamenti in questo changelog

- Nuova sezione **§52** (questa).
- Nuova regola permanente registrata: niente trattini lunghi nei testi utente JSX (vedi punto 5 sopra).
- Nessuna migration SQL, nessuna modifica RLS, nessuna nuova dipendenza npm in nessuno dei due cicli.
- **Prossimo passo**: stesso di §51 — decidere con Robertin se/quando committare e pushare i sei cicli totali (§51+§52, tutti attualmente solo su disco); candidato per un ciclo futuro, non ancora pianificato: pulizia periodica delle richieste `event_reservation_requests`/`rental_reservation_requests` `pending` abbandonate in silenzio (limite noto del punto 6).

---

## 53. Changelog v3.35 (18 Agosto 2026) — Politique de confidentialité: anonimizzazione §5 "Destinataires et sous-traitants"

Contenuto legale, non funzionale. Sezione 5 della pagina `/politique-confidentialite` (`apps/storefront/src/app/(shop)/politique-confidentialite/page.tsx`, hardcoded nel componente, nessun file di contenuto separato, nessuna variante linguistica trovata) riscritta per elencare categorie funzionali di prestatori invece dei nomi commerciali espliciti (Supabase, Stripe, Satispay, Packlink PRO, Brevo, Google, Lepefy Labs). Nessun'altra sezione toccata. `pnpm typecheck` pulito. **Nessuno pushato su richiesta esplicita di Robertin**, consegna via zip.

File toccati: `apps/storefront/src/app/(shop)/politique-confidentialite/page.tsx`.

---

## 54. Changelog v3.36 (18 Agosto 2026) — Ciclo 1/6 gestione consensi: migration `tenant_legal_documents` + `user_consents` — **verified against filesystem**

Solo schema DB, nessuna UI toccata. Nuova migration `supabase/migrations/063_legal_documents_and_consents.sql` (numero verificato via `ls supabase/migrations/` — ultima esistente `062_tenant_card_payments.sql`).

**`tenant_legal_documents`**: versionamento documenti legali per tenant. `id uuid PK`, `tenant_id uuid NOT NULL references tenants(id)`, `doc_type text NOT NULL CHECK IN ('terms','privacy')` (solo `'terms'` usato in questo ciclo — `'privacy'` predisposto per il futuro, la Politique de confidentialité resta statica, vedi §53), `version integer NOT NULL`, `content text NOT NULL`, `effective_date timestamptz default now()`, `created_at timestamptz default now()`, UNIQUE (`tenant_id`, `doc_type`, `version`), indice su (`tenant_id`, `doc_type`, `version DESC`).

**`user_consents`**: audit trail immutabile. `id uuid PK`, `tenant_id uuid NOT NULL`, `user_id uuid NULL references customers(id)` (tabella utenti reale — **non `profiles`**, `customers.id` referenzia `auth.users(id)`), `order_id uuid NULL references orders(id)` (PK `orders.id` è `uuid`, nessun adattamento necessario), `consent_type text NOT NULL CHECK IN ('terms','marketing','cookies_analytics','cookies_marketing')`, `doc_version integer NULL`, `granted boolean NOT NULL`, `source text NOT NULL CHECK IN ('signup','checkout','reconsent_gate','cookie_banner','account_settings')`, `ip_address text NULL`, `user_agent text NULL`, `created_at timestamptz default now()`, CHECK `user_id IS NOT NULL OR order_id IS NOT NULL`. Indici: (`tenant_id`,`user_id`,`consent_type`,`created_at DESC`) e (`order_id`) parziale `WHERE order_id IS NOT NULL`.

**RLS**: entrambe abilitate. `tenant_legal_documents` — SELECT pubblico (`using (true)`), INSERT/UPDATE solo `service_role` (via GRANT, nessuna policy INSERT/UPDATE per `authenticated`/`anon`, quindi RLS le blocca comunque per default-deny). `user_consents` — SELECT solo righe proprie (`user_id = auth.uid()`), INSERT solo proprie righe per `authenticated`; `service_role` bypassa RLS di default per i consensi guest lato server. Nessun UPDATE/DELETE concesso da client su `user_consents` (record immutabile).

**GRANT**: `tenant_legal_documents` → SELECT a `anon, authenticated, service_role`; INSERT/UPDATE solo `service_role`. `user_consents` → SELECT, INSERT a `authenticated` e `service_role`; nessun UPDATE/DELETE lato client.

**Sync Brevo**: cercato nel codice storefront — nessuna integrazione di sync liste/newsletter trovata. Unico riferimento è un commento in `resendReservationConfirmation.ts` relativo all'invio email transazionali via Brevo/n8n, non sync consensi. **Confermato: da fare in un ciclo futuro**, non toccato qui.

**Seed CGV v1.0 per `chloefood`**: **NON eseguito in questo ciclo** — il prompt di esecuzione dichiarava che il contenuto CGV sarebbe stato incollato ma il testo non è stato fornito. Nessun contenuto legale è stato inventato; lo Step 5 resta da completare in un ciclo successivo con il testo reale.

> ⚠️ **Nota v3.42 (§60):** eseguita successivamente da Robertin stesso, fuori da questa sessione — file `supabase/064_seed_cgv_chloefood.sql` (fuori da `supabase/migrations/`), caricato su GitHub e dichiarato eseguito contro il DB reale. Vedi §60 per il dettaglio completo — questo paragrafo resta invariato come traccia storica di cosa non era stato fatto **in questo ciclo**.

**Verifica su ambiente reale**: non eseguita — nessun Supabase CLI/Docker disponibile in questa sessione (`supabase: command not found`, nessun daemon Docker). La migration non è stata applicata né verificata con `\d+`; verificata solo per coerenza sintattica e di pattern contro le migration esistenti (`002_rls_policies.sql`, `038_customers_grants.sql`, `060_event_reservation_requests.sql`).

`pnpm typecheck`: pulito (nessuna modifica TypeScript in questo ciclo). **Nessuno pushato su richiesta esplicita di Robertin**, consegna via zip.

File toccati: nuovo `supabase/migrations/063_legal_documents_and_consents.sql`.

### Aggiornamenti in questo changelog

- Nuova sezione **§54** (questa).
- Step 5 (seed CGV v1.0) **non completato** — contenuto non fornito nel prompt, in attesa per ciclo successivo.
- Verifica live su Supabase **non eseguita** — CLI/Docker non disponibili in sessione.

---

## 55. Changelog v3.37 (18 Agosto 2026) — Ciclo 2/6 gestione consensi: pagina CGV multi-tenant + link footer — **verified against filesystem**

Nuova pagina `apps/storefront/src/app/(shop)/conditions-generales-vente/page.tsx` (Server Component, stesso pattern di `politique-confidentialite/page.tsx`, nessun layout legale condiviso esistente da estrarre — verificato allo Step 0, ognuna resta un file standalone sotto `(shop)/`, header/footer forniti dal layout `(shop)/layout.tsx`).

**Lettura tenant + documento**: `getTenant(tenantSlug)` (pattern esistente, `NEXT_PUBLIC_TENANT_SLUG`) per risolvere `tenant.id`, poi query diretta su `tenant_legal_documents` (`doc_type = 'terms'`, `order('version', {ascending:false}).limit(1).maybeSingle()`) tramite `createPublicClient()` da `src/lib/supabase/public.ts` — stesso client usato internamente da `getTenant()` per letture pubbliche non legate a una sessione utente (preferito a `createClient()`/cookies di `server.ts`, riservato ai dati per-utente autenticato). Nessuna riga trovata → `maybeSingle()` restituisce `null` → fallback "Document non disponible pour le moment." invece di errore.

**`dynamic = 'force-dynamic'` + `fetchCache = 'force-no-store'`** impostati insieme, come da regola permanente (Next.js 14.2.x, `force-dynamic` da solo non basta).

**Rendering Markdown**: nessun renderer Markdown presente nel monorepo (verificato — solo dipendenze transitive di `eslint`/`html5-qrcode`, non utilizzabili). Chiesta conferma a Robertin prima di installare: scelta **`react-markdown`** (standard Next.js App Router, Server Component friendly, nessuna config webpack). Aggiunta come dipendenza in `apps/storefront/package.json` (+`pnpm-lock.yaml`). **Nessun plugin `@tailwindcss/typography`** (non presente, non installato per restare a una sola nuova dipendenza) — mapping esplicito dei componenti Markdown (`h1`/`h2`/`h3`→stile `h2` della pagina Politique de confidentialité, `ul`/`li`/`a`/`strong`) tramite la prop `components` di `react-markdown`, per riprodurre esattamente lo stesso trattamento tipografico Tailwind già in uso (`text-base font-bold text-gray-900 mb-2`, `list-disc pl-5 space-y-1`, `underline`) senza duplicare markup HTML statico.

**Footer**: `apps/storefront/src/components/layout/Footer.tsx` — link "Conditions générales de vente" aggiunto accanto a "Politique de confidentialité" in **entrambi** i punti dove questo appare (footer minimale non-home e footer esteso home), stesso stile (`text-gray-400 hover:text-gray-600 underline`), wrapper `<p>` reso `space-x-3` per accogliere i due link sulla stessa riga. Href statico `/conditions-generales-vente`, nessun hardcoding di slug tenant.

**Verifica visiva reale non eseguita**: nessuna variabile d'ambiente Supabase disponibile in questa sessione (nessun `.env.local`), oltre all'assenza di CLI/Docker già segnalata in §54 — non è stato possibile avviare il dev server con dati reali né confermare visivamente il rendering del Markdown seedato per `chloefood` (il seed stesso resta non eseguito, vedi §54 punto 5). Verificata solo la logica: percorso "nessuna riga" già testabile a livello di codice (`maybeSingle()` → `null` → fallback), come esplicitamente ammesso dal prompt di questo ciclo in assenza di un secondo tenant reale.

`pnpm typecheck`: pulito.

File toccati: nuovo `apps/storefront/src/app/(shop)/conditions-generales-vente/page.tsx`, `apps/storefront/src/components/layout/Footer.tsx`, `apps/storefront/package.json` + `pnpm-lock.yaml` (nuova dipendenza `react-markdown`). **Nessuno pushato su richiesta esplicita di Robertin**, consegna via zip.

### Aggiornamenti in questo changelog

- Nuova sezione **§55** (questa).
- Nuova dipendenza registrata: `react-markdown` (motivazione sopra), unica libreria Markdown nel monorepo storefront.
- Verifica visiva reale **non eseguita** — nessuna credenziale Supabase disponibile in sessione, oltre al limite CLI/Docker già noto da §54.

---

## 56. Changelog v3.38 (18 Agosto 2026) — Ciclo 3/6 gestione consensi: cookie consent banner multi-tenant — **verified against filesystem**

Nuovo componente Client `apps/storefront/src/components/consent/CookieConsentBanner.tsx`, innestato in `apps/storefront/src/app/(shop)/layout.tsx` dopo `<ChatWidget />` (globale su tutte le pagine shop, nessuna logica per-tenant hardcoded).

**Cookie `lepefy_cookie_consent`**: JSON `{ necessary, analytics, marketing, version, consented_at }`, scritto via `document.cookie` (`path=/`, `max-age` 1 anno, `SameSite=Lax`), `version` hardcoded a `1` nel componente — un bump futuro riapre il banner per tutti. Tre azioni: "Accepter tout", "Refuser non essentiels", "Personnaliser" (espande due toggle Analytics/Marketing, "Nécessaires" sempre attivo e disabilitato, bottone "Enregistrer mes choix").

**Colori tema**: nessun colore hardcoded — riusato il pattern esistente `style={{ backgroundColor: 'var(--color-primary)' }}` (già in uso in `ChatWidget.tsx`, `layout.tsx` root) per i bottoni primari del banner.

**Sync server**: nuova Route Handler `POST /api/consent/cookies` (`apps/storefront/src/app/api/consent/cookies/route.ts`). Determina la sessione via `getSessionCustomer(tenant.id)` (`src/lib/auth/getSessionCustomer.ts`, stesso pattern di `/api/customers/me`) — **nessun hook/context client-side per la sessione non esisteva ed è stato confermato non necessario**: il banner chiama la route fire-and-forget, è il server a decidere se scrivere. Se loggato: due INSERT in `user_consents` (`consent_type = 'cookies_analytics'` / `'cookies_marketing'`, `granted` dal valore ricevuto, `source = 'cookie_banner'`, `doc_version = null`) via `createServiceClient()` (bypassa RLS, stesso pattern di `PATCH /api/customers/me`). Se guest: `200 { success: true }` senza scritture — nessuna riga orfana, il cookie client resta l'unica fonte per i guest.

**Cookie parrainage esistente**: confermato **`referral_code`** (`apps/storefront/src/app/(shop)/invite/[code]/route.ts`), `httpOnly`, 30 giorni, `SameSite=Lax`. Categoria "necessari", **invariato**, nessuna sovrapposizione con `lepefy_cookie_consent`.

**Cross-device / viewport overlay ban**: confermato **nessun uso di `vh`/`dvh`, resize listener, `window.innerWidth`, `translateZ`** (verificato via grep sul file). Il banner è `position: fixed; bottom: 0; left: 0; right: 0` ad altezza automatica (contenuto), `paddingBottom: env(safe-area-inset-bottom)` — stesso pattern già in uso in `BottomNav.tsx`.

**z-index**: `z-[60]`, sopra `Header` (`z-40`), `BottomNav` e `ChatWidget` (entrambi `z-50`) — scelta deliberata: il banner deve restare sopra la bottom nav mobile fino alla scelta dell'utente, essendo un gate di consenso temporaneo, non un elemento di navigazione permanente.

**Verifica reale non eseguita**: come nei cicli precedenti, nessuna credenziale Supabase/CLI disponibile in sessione — non è stato possibile avviare il dev server e verificare visivamente comparsa/scomparsa del banner, il flusso "Personnaliser", o l'assenza di overflow su viewport stretti con dati reali. Verificata solo staticamente: assenza dei pattern vietati (grep), coerenza dei pattern Tailwind/z-index con i file esistenti, logica del componente (stato `visible`/`expanded`, valori inviati per ciascuna delle tre azioni).

`pnpm typecheck`: pulito (un errore iniziale di narrowing su `match[1]` corretto con `match?.[1]`).

File toccati: nuovo `apps/storefront/src/components/consent/CookieConsentBanner.tsx`, nuovo `apps/storefront/src/app/api/consent/cookies/route.ts`, `apps/storefront/src/app/(shop)/layout.tsx`. **Nessuno pushato su richiesta esplicita di Robertin**, consegna via zip.

### Aggiornamenti in questo changelog

- Nuova sezione **§56** (questa).
- Nessuna nuova dipendenza npm in questo ciclo.
- Verifica visiva reale **non eseguita** — stesso limite noto (nessuna credenziale/CLI Supabase in sessione) di §54/§55.

---

## 57. Changelog v3.39 (18 Agosto 2026) — Ciclo 4/6 gestione consensi: checkbox signup + registrazione consenso — **verified against filesystem**

**Deviazione architetturale rilevata allo Step 0, confermata con Robertin prima di scrivere codice**: il progetto **non ha un form di signup separato dal login** — l'autenticazione è OTP passwordless condivisa (`OtpLoginForm.tsx`, usato sia in `/compte/connexion` sia inline nel checkout), stesso componente per utenti nuovi ed esistenti, nessuna password, nessun campo nome/altro raccolto in questa fase (il profilo si arricchisce dopo via `/compte/modifier`). La creazione della riga `customers` è **sincrona**, dentro `verifyOtp.ts`, nella stessa richiesta che verifica il codice — nessuna conferma email differita (l'OTP stesso prova il possesso dell'email). Questo determina dove va la logica di consenso: nella Route Handler `POST /api/auth/verify-otp`, subito dopo la creazione riuscita del customer.

**Soluzione concordata con Robertin** (per evitare che la checkbox CGV ricompaia ad ogni login per utenti già registrati, violando la regola "nessuna richiesta ridondante"): **pre-check in `POST /api/auth/request-otp`** — la route (già nel flusso signup/login, nessun nuovo endpoint) ora risolve il tenant e restituisce anche `isNewCustomer: boolean`, calcolato con una lettura `customers` tenant-scoped via `createServiceClient()` in `src/lib/auth/requestOtp.ts` (stesso client già usato per l'upsert in `verifyOtp.ts`, nessuna sessione garantita a questo punto). `OtpLoginForm.tsx` mostra le due checkbox **solo nello step "code" e solo se `isNewCustomer === true`** — un utente esistente non le vede mai.

**Checkbox**: obbligatoria CGV+Privacy (`termsAccepted`) — le celle del codice OTP restano `disabled` finché non è spuntata (nessun bottone "submit" esplicito in questo step: la sottomissione è automatica al 6° carattere, quindi il gate è sulla possibilità di digitare); guardia duplicata anche dentro `submitCode()` (blocca e mostra errore anche via incolla di 6 cifre, che bypassa il disabled degli input). Checkbox opzionale marketing, non pre-spuntata, testo con `tenant.name` dinamico via `useTenant()` (stesso context provider già usato in `Footer.tsx`) — nessun nome tenant hardcoded. Link CGV/Privacy relativi (`/conditions-generales-vente`, `/politique-confidentialite`), `target="_blank"`.

**Funzione riutilizzabile estratta**: `getLatestLegalDocument(tenantId, docType)` in nuovo `apps/storefront/src/lib/legal/getLatestLegalDocument.ts` — la logica era duplicata solo nella pagina CGV (Ciclo 2), ora estratta e riusata sia da `conditions-generales-vente/page.tsx` (refactor **senza cambio di comportamento/contenuto visibile** — solo lettura, nessuna modifica al testo o alla pagina Politique de confidentialité) sia dal nuovo `registerSignupConsent`.

**Registrazione consenso**: nuovo `apps/storefront/src/lib/legal/registerSignupConsent.ts`, chiamato da `verify-otp/route.ts` **solo se `result.isNewCustomer`** (già calcolato in `verifyOtp.ts` per l'attribuzione referral, riusato). Inserisce sempre due righe in `user_consents` via `createServiceClient()`: `consent_type='terms'` (`granted=true`, `doc_version=` versione corrente letta da `getLatestLegalDocument`, `source='signup'`) e `consent_type='marketing'` (`granted=` valore checkbox, **sempre scritta anche a `false`**, `doc_version=null`, `source='signup'`). Se la creazione del customer fallisce, `verifyOtp()` lancia prima di arrivare qui → nessuna riga orfana. Se l'insert dei consensi fallisce dopo un signup riuscito: **try/catch dedicato, `console.error` con prefisso `[api/auth/verify-otp]` e `customer_id`** (stesso pattern già in uso per `registerWithReferral` nello stesso file), **non blocca la risposta** — l'utente resta autenticato.

**Verifica reale non eseguita**: stesso limite noto (nessuna credenziale Supabase/CLI in sessione) — non è stato possibile testare un signup end-to-end. Verificata solo staticamente: il gate lato client (celle disabilitate + guardia in `submitCode`), l'assenza di scrittura consensi quando `isNewCustomer` è `false`, la non-orfanità delle righe consenso rispetto alla creazione customer.

`pnpm typecheck`: pulito.

File toccati: `apps/storefront/src/lib/auth/requestOtp.ts`, `apps/storefront/src/app/api/auth/request-otp/route.ts`, `apps/storefront/src/app/api/auth/verify-otp/route.ts`, `apps/storefront/src/components/auth/OtpLoginForm.tsx`, nuovo `apps/storefront/src/lib/legal/getLatestLegalDocument.ts`, nuovo `apps/storefront/src/lib/legal/registerSignupConsent.ts`, refactor (solo estrazione, nessun cambio visibile) `apps/storefront/src/app/(shop)/conditions-generales-vente/page.tsx`. **Nessuno pushato su richiesta esplicita di Robertin**, consegna via zip.

### Aggiornamenti in questo changelog

- Nuova sezione **§57** (questa).
- Deviazione architetturale documentata: nessun form di signup separato — soluzione del pre-check `isNewCustomer` concordata esplicitamente con Robertin prima di procedere.
- Nessuna nuova dipendenza npm in questo ciclo.
- Verifica reale **non eseguita** — stesso limite noto (nessuna credenziale/CLI Supabase in sessione).

---

## 58. Changelog v3.40 (18 Agosto 2026) — Ciclo 5/6 gestione consensi: checkbox condizionale al checkout + migration di trasporto (eccezione concordata) — **verified against filesystem**

**Mappa checkout confermata allo Step 0**: `CheckoutForm.tsx` → `POST /api/checkout` (Stripe/in_store) o `POST /api/checkout/external-link` — nessuno crea l'ordine al click, entrambi scrivono una riga `checkout_sessions` (tranne `in_store`, che crea l'ordine subito, nessun intermediario di pagamento). L'ordine vero nasce in due punti **duplicati** (scoperta rilevante, il codice ha un commento fuorviante che dichiara riuso della funzione condivisa mentre in realtà non lo fa): logica inline in `POST /api/webhooks/stripe` (`payment_intent.succeeded`) **e** `createOrderFromCheckoutSession()` (usata solo da `POST /api/admin/checkout-sessions/[id]/confirm-payment`, il flusso di conferma manuale per i pagamenti esterni).

**Conflitto di regole rilevato e risolto con Robertin**: `checkout_sessions` non aveva alcuna colonna adatta a trasportare i valori delle checkbox fino alla creazione dell'ordine — l'unico campo JSON libero (`shipping_details`) viene copiato 1:1 in `orders.shipping_details`, mostrato sia in admin sia al cliente, quindi scartato per rischio di fuga dati. **Eccezione esplicita alla regola "nessuna migration in questo ciclo", concordata prima di scrivere codice**: nuova migration `supabase/migrations/064_checkout_consent_columns.sql` (numero verificato via `ls`), tre colonne nullable su `checkout_sessions` (`consent_terms_accepted boolean`, `consent_terms_doc_version integer`, `consent_marketing_accepted boolean`) — stesso pattern già usato in `059_external_payment_links.sql` per un problema di trasporto identico. Nessun nuovo GRANT necessario (`checkout_sessions` ha già `grant all ... to service_role`).

**Determinazione server-side** (Step 1): nuovo `src/lib/legal/resolveCheckoutConsentState.ts` — guest → entrambe le checkbox sempre mostrate; loggato → query `user_consents` per `consent_type='terms'` con `doc_version` = versione corrente (`getLatestLegalDocument`, riusata dal ciclo 4) e per `consent_type='marketing'` (qualunque riga, `granted` true o false conta come "ha già scelto"); nessun documento CGV pubblicato → checkbox CGV non mostrata (nulla da far accettare). Chiamata da `checkout/page.tsx` (Server Component) e **ri-verificata server-side dentro entrambe le route POST** (`/api/checkout`, `/api/checkout/external-link`) — il client trasmette solo la sua scelta (checked/unchecked), mai la decisione "va mostrata", per non fidarsi di un client che potrebbe forzare `termsAccepted=true` senza che la checkbox fosse davvero richiesta.

**UI checkout** (Step 2): checkbox aggiunte in `CheckoutForm.tsx`, step `select-payment`, stesso testo/link del ciclo 4, CTA di pagamento `disabled` se CGV obbligatoria non spuntata.

**Trasporto** (Step 3): `sharedPayload` di `handleConfirmPayment()` include `termsAccepted`/`marketingOptIn` (solo se la relativa checkbox era mostrata, altrimenti `undefined`) verso entrambe le route. Le route ricalcolano `resolveCheckoutConsentState` e scrivono `consent_terms_accepted`/`consent_terms_doc_version`/`consent_marketing_accepted` su `checkout_sessions` (Stripe) o direttamente registrano il consenso (in_store, che crea l'ordine subito — nessuna colonna intermedia necessaria per quel ramo).

**Registrazione al momento della creazione ordine** (Step 4): nuovo `src/lib/legal/registerCheckoutConsent.ts`, condiviso e chiamato da **tre punti** (in linea con la duplicazione reale scoperta allo Step 0): inline in `POST /api/checkout` (ramo `in_store`, `order_id` disponibile subito), inline in `POST /api/webhooks/stripe` (`payment_intent.succeeded`, subito dopo `order.id`), e dentro `createOrderFromCheckoutSession()` (copre sia il ramo Stripe se mai richiamato sia — nella realtà odierna — il ramo `confirm-payment` external_link). `source='checkout'`, `order_id` sempre valorizzato, `user_id` null per i guest (il CHECK `user_id IS NOT NULL OR order_id IS NOT NULL` di `063` resta soddisfatto). Nessuna riga se nessuna checkbox era mostrata. Ogni chiamata è in try/catch, non bloccante, `console.error` con `order_id` — stesso principio del ciclo 4.

**`OtpLoginForm.tsx`**: **non toccato in questo ciclo** (confermato via `git diff --stat`, zero righe modificate rispetto allo stato lasciato dal ciclo 4) — usato in sola lettura dentro `CheckoutForm.tsx` per il login opzionale pre-pagamento, nessun conflitto con la logica `isNewCustomer`.

**Verifica reale non eseguita**: stesso limite noto (nessuna credenziale Supabase/CLI in sessione) — non è stato possibile testare un checkout end-to-end nei tre casi (guest, loggato con consenso valido, loggato con consenso mancante) né un vero webhook `payment_intent.succeeded`. Verificata solo staticamente: la logica di `resolveCheckoutConsentState` per i tre casi, la ri-verifica server-side in entrambe le route POST, la propagazione dei nuovi campi attraverso `CheckoutSessionRow` fino a entrambi i punti di creazione ordine, l'assenza di righe `user_consents` quando nessuna checkbox è mostrata.

`pnpm typecheck`: pulito.

File toccati: nuovo `supabase/migrations/064_checkout_consent_columns.sql`, nuovo `apps/storefront/src/lib/legal/resolveCheckoutConsentState.ts`, nuovo `apps/storefront/src/lib/legal/registerCheckoutConsent.ts`, `apps/storefront/src/app/(shop)/checkout/page.tsx`, `apps/storefront/src/app/(shop)/checkout/CheckoutForm.tsx`, `apps/storefront/src/app/api/checkout/route.ts`, `apps/storefront/src/app/api/checkout/external-link/route.ts`, `apps/storefront/src/app/api/webhooks/stripe/route.ts`, `apps/storefront/src/lib/orders/createOrderFromCheckoutSession.ts`. **Nessuno pushato su richiesta esplicita di Robertin**, consegna via zip.

### Aggiornamenti in questo changelog

- Nuova sezione **§58** (questa).
- Eccezione migration documentata: concordata esplicitamente con Robertin prima di procedere, motivata dall'assenza di un campo di trasporto adatto su `checkout_sessions`.
- Scoperta di duplicazione della logica di creazione ordine (webhook Stripe inline vs `createOrderFromCheckoutSession`) — non risolta in questo ciclo (fuori scope, solo aggiunta del trasporto consenso in entrambi i punti), segnalata per eventuale refactoring futuro.
- Verifica reale **non eseguita** — stesso limite noto (nessuna credenziale/CLI Supabase in sessione).

---

## 59. Changelog v3.41 (18 Agosto 2026) — Ciclo 6/6 gestione consensi: gate di re-consenso — **verified against filesystem** — feature "Consenso CGV + cookie + marketing" COMPLETATA (6 cicli)

**Deviazione architetturale rilevata allo Step 0**: **nessun `(shop)/compte/layout.tsx` esiste** — ogni pagina sotto `/compte/**` (7 in totale: `page.tsx`, `modifier`, `parrainage`, `ambassadeur`, `carte-fidelite`, `adresses/nouvelle`, `adresses/[id]`) fa già, in modo duplicato, il proprio `const customer = await getSessionCustomer(tenant.id); if (!customer) redirect('/compte/connexion')`. Nessun middleware nel progetto (confermato in `CLAUDE.md`) — un layout Server Component n'a de toute façon aucun moyen fiable de connaître le chemin courant sans lui, ce qui aurait rendu impossible la garde "sauf si déjà sur /compte/consentement" décrite dans le prompt. Scelta presa senza nuova conferma (constraint tecnico oggettivo, non una preferenza di design): **stesso pattern già in uso** — un nuovo `requireTermsConsentOrRedirect(tenantId, customerId, currentPath)` (`src/lib/legal/requireTermsConsentOrRedirect.ts`) chiamato esplicitamente in ciascuna delle 7 pagine, subito dopo la guardia di sessione esistente, con il proprio path statico passato in chiaro (mai un valore letto dinamicamente — nessun rischio open-redirect a questo punto).

**Separazione area admin confermata**: `admin/(protected)/layout.tsx` (dove vive il redirect `tenant_cashier` → `/admin/loyalty/scan`) usa `admin_users` + Supabase Auth via `createServerClient` dedicato, **zero import/componente condiviso** con `(shop)/compte/**` — verificato leggendo l'intero file. Nessuna modifica in quest'area.

**`hasValidTermsConsent(tenantId, customerId)`** — nuovo `src/lib/legal/hasValidTermsConsent.ts`: nessun documento CGV pubblicato → `true` (nessun gate possibile); altrimenti verifica una riga `user_consents` (`consent_type='terms'`, `doc_version` = versione corrente da `getLatestLegalDocument`, riusata invariata dal ciclo 4).

**Riuso, non duplicazione** (regola esplicita di questo ciclo): estratto `insertConsentRows(supabase, rows)` in nuovo `src/lib/legal/insertConsentRows.ts` — base condivisa per l'insert finale in `user_consents`, con tipo `ConsentRow` comune. `registerSignupConsent` (ciclo 4) e `registerCheckoutConsent` (ciclo 5) refattorizzati per usarla (**comportamento identico, solo l'ultimo blocco insert+throw centralizzato** — nessuna riga o campo cambiato), e la registrazione del gate (dentro `POST /api/consent/reconsent-gate`) la usa direttamente. Non è stata creata una quarta funzione `registerReconsentGateConsent` separata: la logica di costruzione righe per il gate è abbastanza diversa (nessun `order_id`, ricontrollo se la riga marketing esiste già prima di deciderne l'inserimento) da non giustificare un ulteriore livello di wrapper — la sola parte davvero comune (`insert` + `throw`) è quella estratta.

**Pagina gate** `apps/storefront/src/app/(shop)/compte/consentement/page.tsx` + `ConsentementClient.tsx`: redirect immediato a `returnPath` se il consenso è già valido (nessuno schermo, anche per accesso diretto all'URL) o se nessun documento CGV è pubblicato; altrimenti titolo, link a `/conditions-generales-vente` (nuova scheda), checkbox marketing opzionale **solo se nessuna riga `consent_type='marketing'` esiste ancora** per quel customer, bottone "J'accepte" obbligatorio (nessun "plus tard"). `dynamic='force-dynamic'` + `fetchCache='force-no-store'` (stessa regola del ciclo 2).

**Redirect con `return` — pattern nuovo, non esisteva nel progetto** (verificato via grep, nessuna occorrenza di `return=`/`next=`/`redirect_to=` altrove): nuovo `src/lib/legal/safeReturnPath.ts`, valida che il valore inizi con un singolo `/` e non con `//` (blocca redirect protocollo-relativi tipo `//evil.com`, interpretati dal browser come URL assoluta) — usato sia nella pagina gate (lettura `searchParams.return`) sia nella route `POST /api/consent/reconsent-gate` (corpo `returnPath`) prima di restituirlo come destinazione.

**Registrazione al click "J'accepte"**: nuova `POST /api/consent/reconsent-gate` (`apps/storefront/src/app/api/consent/reconsent-gate/route.ts`) — 401 se non autenticato; inserisce sempre la riga `terms` (`granted=true`, `doc_version` corrente, `source='reconsent_gate'`); la riga `marketing` solo se nessuna esiste già (ricontrollato server-side, mai fidandosi del client sul "va mostrata"); **non best-effort** (a differenza dei cicli 4/5) — un fallimento dell'insert propaga un 500 al client, che mostra l'errore senza navigare via, per evitare che l'utente venga rimandato a `/compte` senza che il consenso sia realmente stato registrato (altrimenti nuovo redirect verso il gate al giro successivo).

**Verifica loop**: nessun loop possibile — la pagina gate non richiama mai `requireTermsConsentOrRedirect` su se stessa, fa il proprio check diretto con redirect immediato solo se valido (mai verso se stessa). Un utente `tenant_cashier` non attraversa mai `(shop)/compte/**` (nessun customer, area completamente separata).

**Verifica reale non eseguita**: stesso limite noto di tutti i cicli precedenti (nessuna credenziale Supabase/CLI in sessione) — non è stato possibile testare live i tre scenari (consenso valido/mancante/obsoleto) né il redirect round-trip. Verificata solo staticamente: presenza della guardia nelle 7 pagine, assenza di guardia su `/compte/connexion` e sulla pagina gate stessa, validazione `safeReturnPath` contro input tipo `//evil.com`.

`pnpm typecheck`: pulito.

File toccati: nuovi `src/lib/legal/hasValidTermsConsent.ts`, `requireTermsConsentOrRedirect.ts`, `insertConsentRows.ts`, `safeReturnPath.ts`, `apps/storefront/src/app/(shop)/compte/consentement/page.tsx` + `ConsentementClient.tsx`, nuovo `apps/storefront/src/app/api/consent/reconsent-gate/route.ts`; refactor (comportamento invariato) `registerSignupConsent.ts`, `registerCheckoutConsent.ts`; aggiunta guardia + `fetchCache` alle 7 pagine `/compte/**` esistenti. **Nessuno pushato su richiesta esplicita di Robertin**, consegna via zip.

### Stato finale della feature "Consenso CGV + cookie + marketing" (6 cicli, §54–§59)

| Ciclo | Contenuto | Stato |
|---|---|---|
| 1 | Schema DB (`tenant_legal_documents`, `user_consents`, RLS, GRANT) | Fatto — seed CGV v1.0 **mai eseguito** (contenuto non fornito) |
| 2 | Pagina `/conditions-generales-vente` + link footer | Fatto |
| 3 | Cookie consent banner (`lepefy_cookie_consent`) | Fatto |
| 4 | Checkbox signup (OTP, pre-check `isNewCustomer`) | Fatto |
| 5 | Checkbox checkout condizionale + migration trasporto | Fatto |
| 6 | Gate di re-consenso `/compte/consentement` | Fatto |

**Debito tecnico tracciato per un ciclo futuro dedicato** (scoperto nel ciclo 5, non risolto per essere fuori scope): la creazione ordine è duplicata in due punti — logica inline in `POST /api/webhooks/stripe` (`payment_intent.succeeded`) e `createOrderFromCheckoutSession()` (usata solo da `POST /api/admin/checkout-sessions/[id]/confirm-payment`) — nonostante un commento nel codice dichiari (erroneamente) un riuso completo. Un refactoring che unifichi i due punti eliminerebbe il rischio strutturale di far divergere in futuro logica che oggi è mantenuta manualmente sincronizzata in due file (già capitato per il consenso in questo stesso ciclo 5/6).

**Punto ancora aperto, non di competenza di un ciclo di sviluppo**: il seed CGV v1.0 per `chloefood` (§54) non è mai stato eseguito — nessun contenuto legale reale è mai stato inventato in nessuno dei 6 cicli. `tenant_legal_documents` resta vuota finché Robertin non fornisce il testo reale; fino ad allora `hasValidTermsConsent` ritorna sempre `true` (nessun documento → nessun gate) e le pagine `/conditions-generales-vente` e `/compte/consentement` mostrano correttamente i rispettivi fallback ("Document non disponible" / redirect immediato) invece di comportarsi in modo scorretto.

### Aggiornamenti in questo changelog

- Nuova sezione **§59** (questa) — chiude la feature a 6 cicli.
- Deviazione architetturale documentata: nessun layout `/compte` condiviso, guardia applicata per-pagina (pattern già esistente nel progetto).
- Refactor "riuso non duplicazione" applicato (`insertConsentRows`) — comportamento invariato per i cicli 4/5.
- Verifica reale **non eseguita** in nessuno dei 6 cicli — limite costante di questa sessione (nessuna credenziale/CLI Supabase disponibile).
- Nessun push in nessuno dei 6 cicli — consegna via zip su richiesta esplicita di Robertin.

---

## 60. Changelog v3.42 (18 Agosto 2026) — Riconciliazione con lo stato reale di GitHub: seed CGV eseguita, tutti i 6 cicli già live su `main` — **verified against filesystem/git**

**Correzione rispetto a §54–§59**: durante i 6 cicli precedenti, ogni consegna è stata fatta via zip ("nessuno pushato su richiesta esplicita di Robertin") perché questa sessione non doveva eseguire `git push`. Verificato ora con `git fetch origin` + confronto file-per-file (`diff` contro `origin/main`) che **Robertin ha caricato manualmente ogni file consegnato via l'interfaccia web di GitHub** ("Add files via upload", storico commit confermato) — tutti i file dei cicli 1–6 sono **byte-per-byte identici** tra la working tree di questa sessione e `origin/main`: le 16 pagine/route/librerie del sistema di consenso, `Footer.tsx`, `OtpLoginForm.tsx`, `CheckoutForm.tsx`, le route checkout/webhook, `package.json`/`pnpm-lock.yaml` (dipendenza `react-markdown`), e le migration `063_legal_documents_and_consents.sql` + `064_checkout_consent_columns.sql`. **La feature "Consenso CGV + cookie + marketing" è quindi già interamente live su `main`**, non più solo su disco in questa sessione.

**Seed CGV v1.0 — ESEGUITA**, contrariamente a quanto riportato in §54 (mai fornita "nel prompt di esecuzione") e ripetuto come debito aperto fino a §59. Robertin ha scritto e caricato il testo definitivo direttamente su GitHub in un file **`supabase/064_seed_cgv_chloefood.sql`** — **fuori da `supabase/migrations/`** (alla radice di `supabase/`), quindi non applicato tramite `supabase db push` ma eseguito manuellement (confirmé par Robertin — non vérifiable depuis cette session, aucun accès Supabase CLI/Docker/credentials, cf. limite déjà noté depuis §54). Copiato ora anche dans la copie locale de ce repo pour cohérence (`git show origin/main:supabase/064_seed_cgv_chloefood.sql`).

**Contenuto**: CGV complete in francese per `chloefood` (Chloé Food, Via Angelo Zanti 1C, 42122 Reggio Emilia, P.IVA 03104260355), 16 articles — objet, produits concernés (boutique/événementiel/traiteur), capacité et zone de livraison, compte client, prix, paiement (standard + lien externe avec confirmation manuelle, cohérent avec le flux réel `checkout_sessions`/`external_payment_link`), livraison, **droit de rétractation exclu pour le frais/surgelé** (art. 16 c/d directive 2011/83/UE, art. 59 Codice del Consumo) avec délai de 14 jours pour l'épicerie sèche non descellée, conditions particulières événementiel (politique d'annulation dégressive 14j/7j) et traiteur/location, réclamations, programme fidélité/parrainage (renvoi à son propre règlement), responsabilité, données personnelles (renvoi à `/politique-confidentialite`), droit applicable (droit italien + règlement Rome I pour les consommateurs UE), modification des CGV. `version: 1`, `on conflict (tenant_id, doc_type, version) do nothing` — cohérent avec le design append-only du Ciclo 1 (toute révision future devra être une nouvelle ligne `version = 2`, jamais un `UPDATE`). **Note explicite laissée par Robertin dans le fichier** : forme juridique précise de Chloé Food manquante à l'article 1, et le texte reste "à soumettre à révision légale avant le go-live" — non vérifié ni modifié par cette session (contenu fourni par l'utilisateur, jamais inventé, conformément à la règle permanente du Ciclo 1).

**Conséquence pratique pour toute la feature** : `hasValidTermsConsent` (Ciclo 6), `resolveCheckoutConsentState` (Ciclo 5), `getLatestLegalDocument` (Ciclo 2/4) trouvent désormais une vraie version 1 pour `chloefood` — le gate de re-consentement `/compte/consentement`, les cases CGV au signup et au checkout, et la page `/conditions-generales-vente` sont donc **actifs en pratique**, pas seulement en logique de repli ("Document non disponible") comme documenté (par précaution, en l'absence de contenu) dans les Cicli 2 à 6.

**Non vérifié dans cette session** (limite inchangée) : aucune confirmation directe que la ligne a été insérée dans `tenant_legal_documents` côté base réelle (pas d'accès Supabase CLI/Docker/credentials) — se fie à la déclaration explicite de Robertin ("era già stata eseguita").

### Aggiornamenti in questo changelog

- Nuova sezione **§60** (questa) — corregge lo stato "in sospeso"/"nessuno pushato" di §54 e §59.
- Copiato `supabase/064_seed_cgv_chloefood.sql` nella working tree locale di questa sessione, per coerenza con `origin/main`.
- Nessun'altra modifica di codice in questo changelog — solo riconciliazione documentale.

---

## 61. Changelog v3.43 (18 Agosto 2026) — Ciclo 7: consenso marketing esteso a email + SMS + WhatsApp — **verified against filesystem**

**`customers.phone`**: già esistente (`text`, nullable, `001_initial_schema.sql`), gestito in `/compte/modifier` (`ModifierProfilClient.tsx` → `PATCH /api/customers/me`), validato in formato E.164 via `libphonenumber-js`. **Nessuna verifica del numero** (nessun OTP telefonico, nessuna conferma SMS) — solo controllo di formato. Vedi roadmap sotto.

**Testo centralizzato**: era duplicato in 3 file (nessuna costante condivisa prima di questo ciclo). Nuovo `apps/storefront/src/lib/legal/consentCopy.ts` → `marketingConsentLabel(tenantName)`, testo: *"Je souhaite recevoir les offres et actualités de {tenant} par email, SMS et WhatsApp."* — importata da tutti e tre i punti, nessun testo hardcoded rimasto:
- `apps/storefront/src/components/auth/OtpLoginForm.tsx` (signup, ciclo 4)
- `apps/storefront/src/app/(shop)/checkout/CheckoutForm.tsx` (checkout, ciclo 5)
- `apps/storefront/src/app/(shop)/compte/consentement/ConsentementClient.tsx` (gate, ciclo 6)

**Cutoff documentato**: commento in `apps/storefront/src/lib/legal/insertConsentRows.ts` (nessuna logica di lettura per invii non esiste ancora nel progetto — commento posizionato lato scrittura, come da istruzioni in alternativa) — righe `consent_type='marketing'` create **prima del 2026-08-18** vanno considerate valide solo per email, non per SMS/WhatsApp, finché l'utente non riesprime il consenso con il nuovo testo. Nessuna riga esistente in `user_consents` è stata toccata, letta o reinterpretata da questo ciclo — solo copy futura.

`pnpm typecheck`: pulito.

File toccati: nuovo `apps/storefront/src/lib/legal/consentCopy.ts`; modificati `OtpLoginForm.tsx`, `CheckoutForm.tsx`, `ConsentementClient.tsx`, `insertConsentRows.ts` (solo commento, nessuna modifica di comportamento).

### Roadmap — raccolta/verifica telefono prima dell'invio SMS/WhatsApp

Non implementata in questo ciclo (fuori scope, "nessuna infrastruttura di invio esiste ancora"). Prima di poter costruire un invio SMS/WhatsApp reale, mancano:
- Un momento esplicito di raccolta del telefono al signup/checkout (oggi opzionale, raccolto solo su `/compte/modifier` o come campo checkout non obbligatorio) — un utente può aver accettato "email, SMS e WhatsApp" senza aver mai fornito un numero.
- Una verifica del numero (OTP SMS o equivalente) — il formato E.164 valido non garantisce che il numero sia realmente raggiungibile dal titolare dell'account.
- Il filtro `created_at >= '2026-08-18'` documentato sopra, da applicare nel punto di lettura quando quella logica verrà scritta.

### Aggiornamenti in questo changelog

- Nuova sezione **§61** (questa).
- Nessuna migration, nessuna modifica alla logica di consenso CGV (`consent_type='terms'`), nessuna riga `user_consents` esistente toccata.
- Nuova voce di roadmap (raccolta/verifica telefono) registrata sopra.

---

## 62. Changelog v3.44 (18 Agosto 2026) — Fix `return_url` mancante su `/card` + Payment Funnel Logs (4 moduli) — **verified against filesystem**

**Bug corretto — `return_url` mancante su `/card`:** `CardQuickPay.tsx` chiamava `stripe.confirmPayment({ elements, confirmParams: {}, redirect: 'if_required' })` senza `return_url`, a differenza degli altri tre moduli (shop/event/rental) già corretti. Se la banca del cliente richiedeva 3D Secure con redirect a pagina intera (non risolvibile in iframe), il browser non aveva modo di tornare su `/card` — rischio aumentato dal fatto che `/card` è tipicamente aperto da un QR scansionato in negozio, spesso in una WebView (WhatsApp/Instagram/fotocamera) più fragile sui redirect completi rispetto a un browser pieno. Fix: `return_url: ${window.location.origin}/card` aggiunto. Poiché `/card` non ha una pagina di conferma dedicata (a differenza di `/order-confirmation`), un `useEffect` al mount di `CardQuickPay` rilegge ora lo stato del PaymentIntent dai query params che Stripe aggiunge automaticamente al ritorno del redirect (`payment_intent_client_secret`) via `stripe.retrievePaymentIntent()`, imposta `paid` se `status === 'succeeded'`, e pulisce l'URL con `history.replaceState` per evitare che un refresh rilegga lo stesso client secret. `getStripe()` è ora richiamabile indipendentemente dal gate `clientSecret` (nessuna riscrittura strutturale oltre a questo, il resto del componente — form, validazione, step successivi — invariato).

**Nuova tabella `payment_funnel_logs` (migration `065_payment_funnel_logs.sql`, numero verificato via `ls supabase/migrations/` — ultima esistente `064_checkout_consent_columns.sql`):** log di sola telemetria, deliberatamente **condivisa tra i 4 moduli di pagamento** (`shop`/`card`/`event`/`rental`) — a differenza delle tabelle di business come `event_reservation_requests`/`rental_reservation_requests` (§41), qui non c'è logica applicativa sopra, solo eventi diagnostici per capire dove i clienti abbandonano il funnel, quindi condividere lo schema è corretto invece di duplicarlo 4 volte. Colonne: `tenant_id`, `module` (CHECK `shop|card|event|rental`), `reference_id` (uuid nullable), `event_type` (CHECK sui 7 valori sotto), `detail` (jsonb), `created_at`. RLS attivo: `INSERT` pubblico per `anon`/`authenticated` (il log parte anche da clienti anonimi durante il checkout), nessuna policy di `SELECT` pubblica, `GRANT` espliciti a `service_role` (select+insert) e `anon`/`authenticated` (solo insert) — coerente con la regola permanente "RLS da sola non basta". Nessun cron di pulizia in questo ciclo (retention da valutare in futuro se il volume cresce).

**7 event_type disponibili:** `intent_created` (server, alla creazione del PaymentIntent), `elements_mounted` (client, quando Stripe Elements viene montato), `confirm_attempted` (client, subito prima di `confirmPayment`), `requires_action` (client, se il PaymentIntent richiede 3D Secure al ritorno da un redirect — solo `/card`, unico modulo con retrieve al mount), `confirm_error`, `confirm_succeeded_client`, `abandoned_payment_form` (client, via `sendBeacon` su `pagehide`/`visibilitychange` — più affidabile di `fetch keepalive` per la chiusura tab/swipe-away su mobile Safari/WebView, con guardia esplicita `hasSucceededRef` per non marcare come abbandonato chi ha appena pagato).

**Endpoint + helper condiviso:** nuovo `POST /api/funnel-log/route.ts` (pubblico, scrittura sola, mai awaited lato client, errori sempre silenziosi — un fallimento qui non deve mai riflettersi sul flusso di pagamento) e nuovo `apps/storefront/src/lib/funnelLog.ts` con `logFunnelEvent()` (fire-and-forget via `fetch keepalive`) e `registerAbandonmentListener()` (montato **solo** nel sotto-componente Elements di ciascun modulo — mai nel genitore, altrimenti scatterebbe anche per chi abbandona prima di arrivare al form carta, caso già coperto per assenza dal confronto `intent_created` vs `elements_mounted`).

**`reference_id` per modulo — necessario per ricostruire il funnel di un singolo tentativo con una query:**
- **card** → `quickPaymentId` (id della riga `tenant_card_payments`, non tornava al client prima di questo ciclo: `POST /api/card/quick-pay` ora risponde anche `quickPaymentId: row.id`, oltre a `clientSecret`)
- **event** → `event.id` (già disponibile come prop)
- **rental** → `service.id` (già disponibile come prop)
- **shop** → `sessionId` (id della riga `checkout_sessions`, non tornava al client prima di questo ciclo: `POST /api/checkout` ora risponde anche `sessionId: session.id`, oltre a `clientSecret` — **deviazione dal contesto operativo iniziale**, che elencava `api/checkout/route.ts` tra i file da non toccare senza eccezione: la propagazione di `sessionId` è stata comunque applicata, come esplicitamente richiesto nel ciclo, poiché la copertura del funnel `shop` la richiedeva; nessun'altra riga di quel file toccata)

**4 moduli strumentati**, tutti con gli stessi 4 punti di log (`elements_mounted` dopo la ricezione del `clientSecret`, `confirm_attempted` prima di `confirmPayment`, `confirm_error`/`confirm_succeeded_client` dopo la risposta) più un log server `intent_created` subito dopo la creazione del PaymentIntent: `CardQuickPay.tsx` (`QuickPayPaymentStep`), `EventCheckoutClient.tsx` (`EventPaymentStep`), `RentalCheckoutClient.tsx` (`RentalPaymentStep`), `CheckoutForm.tsx` (`StripePaymentStep`) — **in nessuno dei tre moduli già corretti (shop/event/rental) è stata toccata la logica di `confirmPayment`/`return_url` esistente**, solo aggiunte le chiamate di log e il listener di abbandono attorno al comportamento invariato. Log server `intent_created` aggiunto anche in `api/events/[id]/checkout/route.ts` (`reference_id: eventRow.id`) e `api/rental/checkout/route.ts` (`reference_id: offering.id`), oltre a `api/card/quick-pay/route.ts` (`reference_id: row.id`, che era anche l'unica delle 4 route priva del `console.info` di conferma — aggiunto insieme al log). `console.info` esistenti in events/rental non toccati.

`pnpm typecheck`: pulito (dopo `pnpm install` — `node_modules` non presente all'inizio del ciclo).

File toccati/creati: nuovo `supabase/migrations/065_payment_funnel_logs.sql`; nuovo `apps/storefront/src/app/api/funnel-log/route.ts`; nuovo `apps/storefront/src/lib/funnelLog.ts`; modificati `CardQuickPay.tsx`, `api/card/quick-pay/route.ts`, `EventCheckoutClient.tsx`, `api/events/[id]/checkout/route.ts`, `RentalCheckoutClient.tsx`, `api/rental/checkout/route.ts`, `CheckoutForm.tsx`, `api/checkout/route.ts`.

### Aggiornamenti in questo changelog

- Nuova sezione **§62** (questa).
- Una migration SQL nuova (`065`), nessuna modifica a migration esistenti.
- Deviazione consapevole dal contesto operativo iniziale: `api/checkout/route.ts` toccato per aggiungere `sessionId` alla response (necessario per il `reference_id` del modulo shop) — confermato esplicitamente nel ciclo, nessun'altra riga di quel file modificata.

---

## 63. Changelog v3.45 (18 Agosto 2026) — Deferred PaymentIntent creation + mécaniques de paiement partagées + multi-compte Stripe par module — **verified against filesystem**

**Pattern adopté — "deferred intent creation" :** jusqu'à ce cycle, les 4 modules de paiement (shop/card/event/rental) créaient le `PaymentIntent` Stripe dès que le client atteignait l'étape du formulaire de paiement (`elements_mounted`), avant même d'avoir saisi une carte. Tout client qui regardait ce formulaire et repartait sans payer générait un `PaymentIntent` orphelin visible côté Stripe comme "Non complété" — c'était la source de bruit la plus large sur le dashboard Stripe. Ce cycle applique le pattern officiel Stripe "deferred intent creation" (https://docs.stripe.com/payments/accept-a-payment-deferred) : `Elements` est monté en mode `{ mode: 'payment', amount, currency }` (pas `clientSecret`), le `PaymentIntent` n'est créé que dans le handler du clic sur "Payer" — juste avant `stripe.confirmPayment()` — via `elements.submit()` puis un appel serveur (`createIntent`). Un client qui regarde le formulaire et repart sans jamais cliquer "Payer" ne génère plus aucun `PaymentIntent`, uniquement les logs `elements_mounted`/`abandoned_payment_form` déjà en place (table `payment_funnel_logs`, §62 — schéma inchangé, ce cycle n'y touche pas).

**Nouveaux fichiers partagés `lib/payments/` — mécaniques de paiement, jamais la logique métier :**
- `stripeServerConfig.ts` (server-only, jamais importé côté client) — `getStripeSecretKey(module)`, `getStripeClient(module)` (instance mise en cache par secret key), `getConfiguredWebhookSecrets()` (liste dédupliquée `{module, secret}` pour la vérification multi-compte du webhook). Résolution par module avec fallback : `STRIPE_SECRET_KEY_<MODULE>` → `STRIPE_SECRET_KEY`.
- `stripeClientConfig.ts` (`'use client'`, publishable key uniquement — jamais de secret key) — `getStripeForModule(module)`, cache par module (`Map<PaymentModule, Promise<StripeJs|null>>`, plus un singleton global unique comme avant, car deux modules peuvent désormais avoir des comptes Stripe différents). Résolution avec `switch` explicite, chaque `process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_*` écrit en toutes lettres (jamais de nom construit dynamiquement — Next.js ne remplace ces variables au build que dans ce cas, sinon `undefined` en prod).
- `usePaymentRedirectRecovery.ts` (`'use client'`) — hook partagé qui relit `payment_intent_client_secret` dans l'URL au mount de chaque module et rappelle `onSucceeded` si `status === 'succeeded'` (recovery après un redirect 3DS complet — comportement introduit pour `/card` seul au §62, désormais partagé et actif sur les 4 modules).

**Nouveau composant partagé `components/payments/StripePaymentStep.tsx` :** remplace les 4 sous-composants quasi-dupliqués (`QuickPayPaymentStep`/`EventPaymentStep`/`RentalPaymentStep`/`StripePaymentStep` local à `CheckoutForm.tsx`). Contient tout ce qui concerne *comment* un paiement Stripe s'exécute — montage `Elements` en mode différé, `elements.submit()`, appel à la prop `createIntent` fournie par l'appelant, `stripe.confirmPayment()`, les 3 logs funnel côté client (`elements_mounted` au mount, `confirm_attempted`/`confirm_error`/`confirm_succeeded_client`/`requires_action` autour de la confirmation) et `registerAbandonmentListener`. Ne contient **aucune** logique de domaine (stock, capacité, création de commande/réservation) — celle-ci reste dans chaque route API/module, invoquée depuis la fonction `createIntent` que chaque appelant passe en prop, décision confirmée dès le départ de ce cycle et non remise en cause.

**Multi-compte Stripe par module (TASK 3) :** support ajouté pour que Dalice puisse bientôt utiliser un second compte Stripe dédié événements/location, distinct de shop/card — secret key, publishable key et webhook secret résolus indépendamment par module, avec fallback total sur les variables globales actuelles tant que le second compte n'est pas configuré (zéro variable ajoutée sur Vercel = comportement strictement identique à avant ce cycle). Webhook (`api/webhooks/stripe/route.ts`) : la vérification de signature essaie chaque secret configuré (`getConfiguredWebhookSecrets()`, dédupliqué par valeur) jusqu'à ce qu'un matche, log du module vérifié (`verifiedModule`), et le client Stripe utilisé pour toute action après vérification (remboursement inclus) est celui du module vérifié — jamais un client fixe.

**Variables d'environnement attendues (à configurer sur Vercel quand le second compte Stripe de Dalice sera prêt — aucune action requise aujourd'hui) :**
- Server-only : `STRIPE_SECRET_KEY` (existante, fallback), `STRIPE_SECRET_KEY_SHOP`, `STRIPE_SECRET_KEY_CARD`, `STRIPE_SECRET_KEY_EVENT`, `STRIPE_SECRET_KEY_RENTAL`
- Webhook : `STRIPE_WEBHOOK_SECRET` (existante, fallback), `STRIPE_WEBHOOK_SECRET_SHOP`, `STRIPE_WEBHOOK_SECRET_CARD`, `STRIPE_WEBHOOK_SECRET_EVENT`, `STRIPE_WEBHOOK_SECRET_RENTAL`
- Client (`NEXT_PUBLIC_*`) : `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (existante, fallback), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_SHOP`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_CARD`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_EVENT`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_RENTAL`

**Appels Stripe trouvés hors des points déjà documentés dans le brief (Step 0), mis à jour pour utiliser le client résolu par module :** `lib/orders/createOrderFromCheckoutSession.ts` (`getStripeClient('shop')` — remboursement automatique en cas de conflit de stock post-paiement, appelé par le webhook et par `api/admin/checkout-sessions/[id]/confirm-payment`) et `api/admin/evenementiel/reservations/[id]/refund/route.ts` (remboursement manuel admin — gère à la fois les réservations événement et location dans une seule route ; le client est résolu séparément par branche, `getStripeClient('event')` ou `getStripeClient('rental')`, selon le type de réservation trouvée).

**4 modules intégrés (TASK 6) :**
- `CardQuickPay.tsx` — "Continuer" ne fait plus qu'une validation client (montant/email), sans appel réseau. La logique métier de `POST /api/card/quick-pay` (validation serveur, insert `tenant_card_payments`, création du PaymentIntent) est strictement inchangée, seul le moment de l'appel change : elle est désormais invoquée par la prop `createIntent`, déclenchée par le clic "Payer" dans `StripePaymentStep`. `reference_id` (id de la ligne `tenant_card_payments`) n'est plus connu avant le clic — il est retourné par `createIntent` et propagé via `referenceIdRef` (déjà géré en interne par `StripePaymentStep`).
- `EventCheckoutClient.tsx` / `RentalCheckoutClient.tsx` — même pattern : le clic "Continuer vers le paiement" (branche stripe) ne fait plus que passer à l'étape `payment` sans réseau ; `api/events/[id]/checkout` et `api/rental/checkout` (validation capacité/stock, création du PaymentIntent) sont invoqués tels quels depuis `createIntent`. `reference_id` = `event.id`/`service.id`, connu dès le départ (prop `referenceId`).
- `CheckoutForm.tsx` — le payload partagé (adresse, items, coordonnées) est extrait dans `buildSharedPayload()` pour être réutilisé par `createIntent` sans dupliquer cette construction. Branche stripe : `POST /api/checkout` (validation stock/prix, création `checkout_sessions` + PaymentIntent) déplacée dans `createIntent`, `reference_id` = `sessionId`, connu seulement au retour de cet appel (prop `referenceId={null}` initiale). Branches `in_store` et `external_link` **non touchées** — restent des appels synchrones à `handleConfirmPayment`, sans `StripePaymentStep`, aucun changement de comportement.

**Aucune double journalisation funnel :** les anciens appels `logFunnelEvent`/`registerAbandonmentListener` ad-hoc dans les 4 sous-composants locaux ont été supprimés — `StripePaymentStep` est l'unique point qui les émet désormais pour les 4 modules.

**Aucune migration nécessaire pour ce cycle** — tout le travail est env var (nouvelles variables optionnelles, avec fallback) + code, schéma `payment_funnel_logs` et reste du schéma inchangés.

`pnpm typecheck` : propre (après `pnpm install` — `node_modules` absent au début du cycle, comme au §62).

Fichiers créés : `lib/payments/stripeServerConfig.ts`, `lib/payments/stripeClientConfig.ts`, `lib/payments/usePaymentRedirectRecovery.ts`, `components/payments/StripePaymentStep.tsx`.
Fichiers modifiés : `api/webhooks/stripe/route.ts`, `api/card/quick-pay/route.ts`, `api/events/[id]/checkout/route.ts`, `api/rental/checkout/route.ts`, `api/checkout/route.ts`, `lib/events/createEventReservationFromRequest.ts`, `lib/rental/createRentalReservationFromRequest.ts`, `lib/orders/createOrderFromCheckoutSession.ts`, `api/admin/evenementiel/reservations/[id]/refund/route.ts`, `components/card/CardQuickPay.tsx`, `EventCheckoutClient.tsx`, `RentalCheckoutClient.tsx`, `CheckoutForm.tsx`.

### Aggiornamenti in questo changelog

- Nuova sezione **§63** (questa).
- Nessuna migration SQL — solo codice + variabili d'ambiente opzionali.
- Due chiamate Stripe trovate fuori dall'elenco iniziale del brief (`createOrderFromCheckoutSession.ts`, `admin/evenementiel/reservations/[id]/refund/route.ts`), aggiornate per usare il client risolto per modulo — vedi dettaglio sopra.

---

## 64. Changelog v3.46 (18 Agosto 2026) — Scoping metodi di pagamento per modulo (HUB pagamenti — Fase B) — **verified against filesystem**

**Chiude la Fase B dell'HUB pagamenti** discusso con Robertin — la Fase A (mechanics condivise `StripePaymentStep`/`usePaymentRedirectRecovery` + multi-account Stripe per modulo `getStripeClient`/`getConfiguredWebhookSecrets`) era già stata completata e verificata nei due cicli precedenti (§63 + verifica di sola lettura successiva). Questa fase tocca esclusivamente il livello "policy" — **quali** metodi vengono proposti in **quale** modulo — mai **come** un pagamento Stripe viene eseguito: nessuna riga di `lib/payments/` o `components/payments/StripePaymentStep.tsx` toccata.

**Nuova colonna `tenant_payment_methods.enabled_modules`** (migration `066_tenant_payment_methods_module_scope.sql`, numero verificato via `ls supabase/migrations/` — ultima esistente `065_payment_funnel_logs.sql`): `text[] not null default array['shop','card','event','rental']`, con `CHECK (enabled_modules <@ {shop,card,event,rental} and array_length(...) > 0)`. Default = tutti e 4 i moduli → **zero rottura per ogni riga esistente**, comportamento storico preservato finché Dalice non restringe esplicitamente qualcosa da `/admin/parametres/paiements`. Nessuna modifica a RLS/GRANT — la colonna eredita le policy già esistenti sulla tabella.

**`PaymentModule` consolidato in un solo punto** — prima duplicato identicamente in `lib/payments/stripeServerConfig.ts` e `stripeClientConfig.ts` (stesso union type `'shop' | 'card' | 'event' | 'rental'` scritto due volte). Ora definito una sola volta in `packages/types/paymentMethods.ts` ed esportato via `@lepefy/types`; i due file Stripe lo importano e lo ri-esportano (`export type { PaymentModule }`) per non rompere gli import esistenti altrove (`usePaymentRedirectRecovery.ts`, `StripePaymentStep.tsx`, `api/webhooks/stripe/route.ts` continuano a importarlo dai due file come prima, senza modifiche).

**4 punti di lettura di `getTenantPaymentMethods` trovati e verificati** (via `grep -rn "getTenantPaymentMethods" apps/storefront/src`), di cui 3 filtravano già con il pattern "Décision 7" (`method !== bank_transfer/cash && !!extra.link`) e uno — `/card` — non filtrava affatto:
- `(shop)/checkout/page.tsx` → aggiunta `&& m.enabled_modules.includes('shop')`
- `evenements/[slug]/page.tsx` → aggiunta `&& m.enabled_modules.includes('event')`
- `services/[slug]/page.tsx` → aggiunta `&& m.enabled_modules.includes('rental')` (confermato: stesso filtro "Décision 7" già presente, come per gli altri due — l'ipotesi dello Step 0 era corretta)
- `app/card/page.tsx` → **nuovo filtro aggiunto** (`allPaymentMethods.filter((m) => m.enabled_modules.includes('card'))`), assente prima di questo ciclo — `/card` mostrava tutti i metodi attivi senza eccezione, ora rispetta lo scoping come gli altri 3 moduli. `DigitalCard.tsx`/`PaymentMethodsAccordion.tsx` non toccati — ricevono `paymentMethods` già filtrato come prop.

**Un quinto punto trovato dal grep, volutamente NON toccato** — `api/admin/card/poster/route.ts` (genera il PDF del poster da stampare per `/card`) chiama anch'esso `getTenantPaymentMethods` senza alcun filtro modulo. Non era nell'elenco dei file da toccare di questo ciclo (né in Step 0 né nei TASK), quindi lasciato invariato: **deviazione nota da segnalare** — il poster stampabile può ora mostrare metodi che il cliente non vede più su `/card` se `enabled_modules` esclude `'card'` per una riga. Da correggere in un ciclo dedicato se confermato come comportamento indesiderato.

**Admin UI (`PaymentMethodsSection.tsx`)** — 4 checkbox (`Boutique`/`Carte /card`/`Événements`/`Location`) in `grid grid-cols-2 gap-2`, sia nel form "Ajouter" sia in ogni riga esistente in edit, tramite un sotto-componente `ModulesCheckboxGroup` condiviso. Validazione client: bottone "Enregistrer"/"Ajouter" disabilitato (`disabled`) a zero moduli selezionati, con messaggio d'errore visibile — miroir esatto del constraint DB `array_length(...) > 0`. `emptyForm` default a tutti e 4 i moduli, coerente col DEFAULT della colonna.

**API admin (`api/admin/payment-methods/route.ts` POST, `[id]/route.ts` PATCH)** — validazione `isValidEnabledModules` (array non vuoto, valori tutti in `{shop,card,event,rental}`) → `400` se presente ma invalido. Se assente nel body: POST non lo specifica nell'insert (il DEFAULT della colonna si applica), PATCH non lo include nell'update payload (valore esistente preservato) — retro-compatibilità con eventuali chiamate esterne non aggiornate.

**Sottovoce "Moyens de paiement" sotto "Paramètres" (TASK 7)** — "Paramètres" era un unico `<Link>` diretto in `AdminSidebar.tsx`, ora è una tendina (`parametresOpen`/`setParametresOpen`), pattern **identico** a quello già usato per Catalogue/Événementiel: stesso bouton avec icône (`IconSettings`) + `IconChevronDown`/`IconChevronRight` conditionnel (`size={14}`, comme Catalogue), même `navClass(pathname.startsWith(...))` sur le bouton parent, deux sous-liens en `ml-5 border-l ... pl-3` avec le même style de lien actif/inactif. Sous-liens : "Général" (`/admin/parametres`, comparaison exacte `pathname === item.href`, pas `startsWith`, pour ne pas rester surligné depuis `/admin/parametres/paiements`) et "Moyens de paiement" (`/admin/parametres/paiements`). Nouvelle page dédiée `parametres/paiements/page.tsx` — même fetch exact que celui retiré de `parametres/page.tsx` (tenant + `tenant_payment_methods` triés par `sort_order`), rendu de `<PaymentMethodsSection>` seul, `<h1>` au même style que `/admin/loyalty` (`text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1` + sous-titre `text-sm text-gray-500 dark:text-gray-400 mb-6`). `parametres/page.tsx` général : section Moyens de paiement et son fetch dédié retirés — Infos boutique (`BoutiqueInfoSection`/`OriginSection`), Réseaux sociaux (`SocialLinksSection`), Données légales (`LegalInfoSection`), Carte digitale (QR + poster) et QR Shop restent identiques, même ordre, `socialLinks` toujours fetché (partagé avec `SocialLinksSection`, jamais retiré). `AdminMobileNav.tsx` — non modifié : rend `<AdminSidebar>` tel quel, la tendina Paramètres fonctionne dans le drawer mobile exactement comme Catalogue/Événementiel (même state React interne à AdminSidebar, aucune dépendance au contexte desktop/mobile).

`pnpm typecheck`: pulito.

File creati: `supabase/migrations/066_tenant_payment_methods_module_scope.sql`, `admin/(protected)/parametres/paiements/page.tsx`.
File modificati: `packages/types/paymentMethods.ts`, `lib/payments/stripeServerConfig.ts`, `lib/payments/stripeClientConfig.ts`, `(shop)/checkout/page.tsx`, `evenements/[slug]/page.tsx`, `services/[slug]/page.tsx`, `app/card/page.tsx`, `admin/(protected)/parametres/PaymentMethodsSection.tsx`, `admin/(protected)/parametres/page.tsx`, `admin/_components/AdminSidebar.tsx`, `api/admin/payment-methods/route.ts`, `api/admin/payment-methods/[id]/route.ts`.

### Aggiornamenti in questo changelog

- Nuova sezione **§64** (questa).
- Una migration SQL nuova (`066`), nessuna modifica a migration esistenti, nessun cambiamento RLS/GRANT.
- Deviazione nota: `api/admin/card/poster/route.ts` non filtra per `enabled_modules` (fuori scope di questo ciclo) — segnalato sopra, da correggere in un ciclo dedicato se necessario.

---

## 65. Changelog v3.47 (18 Agosto 2026) — Fix poster PDF: rispetta `enabled_modules('card')` — **verified against filesystem**

Chiude la deviazione segnalata al §64: `api/admin/card/poster/route.ts` chiamava `getTenantPaymentMethods` senza applicare il filtro `enabled_modules`, mostrando sul poster PDF stampabile anche metodi disattivati per il modulo `card` — incoerente con `/card`, che li nasconde correttamente. Stesso filtro di `app/card/page.tsx` ora applicato subito dopo il fetch (`allPaymentMethods.filter((m) => m.enabled_modules.includes('card'))`), unico punto di consumo di `getTenantPaymentMethods` nel file; nessuna modifica alla generazione PDF/Gotenberg né al template HTML. Comportamento invariato per ogni tenant che non ha ancora ristretto nulla (default = tutti e 4 i moduli).

`pnpm typecheck`: pulito.

File modificato: `apps/storefront/src/app/api/admin/card/poster/route.ts`.

---

## 66. Changelog v3.48 (18 Agosto 2026) — Checkout Stripe compattato (layout accordion, billing address 'never', appearance API) — **verified against filesystem**

Compattato il `PaymentElement`/`Elements` condiviso (`components/payments/StripePaymentStep.tsx`, unico punto pour i 4 moduli) con le sole opzioni ufficiali Stripe — nessuna modifica alla logica di pagamento (`createIntent`, `elements.submit()`, `confirmPayment`, `return_url`, `logFunnelEvent`, ecc.). `layout: 'accordion'` riduce lo spazio quando compaiono più metodi selezionabili. `fields: { billingDetails: { address: 'never' } }` disattiva la raccolta dell'indirizzo di fatturazione — verificato allo Step 0 che nessun `confirmParams`/`createIntent` dei 4 moduli si aspetta un indirizzo dal Payment Element, applicato senza eccezioni. Nuovo prop opzionale `customerEmail` su `StripePaymentStep`, propagato a `defaultValues.billingDetails.email` per velocizzare l'autenticazione Link — passato da `EventCheckoutClient`/`RentalCheckoutClient`/`CheckoutForm` (email già raccolta e validata prima dello step di pagamento) e da `CardQuickPay` solo se non vuota (campo lì opzionale). Aggiunta `appearance: { theme: 'stripe', variables: { colorPrimary: props.color, borderRadius: '12px', fontFamily: 'inherit' } }` su `<Elements>` (assente prima) — `colorPrimary` resta il prop `color` del tenant, mai un hex fisso.

**Nota permanente — Accelerated Sign-up di Link**: il blocco "Enregistrer mes informations pour un paiement plus rapide" NON è controllabile da codice/API (`PaymentElement`/`Elements` non espone alcuna opzione per disattivarlo) — è un'impostazione esclusivamente Dashboard Stripe, per-account (Settings → Payment Methods → Link → "Enable accelerated sign-up"). Da disattivare manualmente da Robertin su ogni account Stripe attivo — oggi quello unico, e separatamente sul secondo account di Dalice quando sarà configurato (Fase A, multi-account per modulo).

`pnpm typecheck`: pulito.

File modificati: `components/payments/StripePaymentStep.tsx`, `components/card/CardQuickPay.tsx`, `EventCheckoutClient.tsx`, `RentalCheckoutClient.tsx`, `(shop)/checkout/CheckoutForm.tsx`.

---

## 67. Changelog v3.49 (19 Agosto 2026) — Ciclo 4/4: checkout_sessions modificabili in-place + due entry point (guest/loggato) + carrello cross-device — ⚠️ nessuno pushato

Ciclo di 4 prompt, eseguiti in sequenza (`pnpm typecheck` verde su ognuno, mai eseguito `pnpm lint` come da regola permanente). Trasforma `checkout_sessions` da riga "usa e getta" (creata da `/api/checkout`/`/api/checkout/external-link`, cancellata dal webhook o dalla conferma admin) a entità che il cliente può riprendere, modificare e pagare più tardi — guest via link firmato, cliente loggato via `/orders` — e aggiunge continuità cross-device al carrello per i clienti autenticati.

### 1/4 — Fondamenta: migration `067` + `GET`/`PATCH /api/checkout-sessions/[id]`

- **Migration `067_checkout_sessions_edit_and_status.sql`**: colonna `status` (`'open'|'cancelled'`, default `'open'`) + `stripe_payment_intent_id` (indice unico parziale `where stripe_payment_intent_id is not null`) + indice `(tenant_id, customer_id, status, created_at desc) where customer_id is not null`. Nessun nuovo `GRANT` necessario (`checkout_sessions` ha già `grant all ... to service_role` da `006`).
- **`/api/checkout/route.ts`** (branch Stripe): dopo la creazione del `PaymentIntent`, un update best-effort persiste `paymentIntent.id` in `stripe_payment_intent_id` sulla riga appena creata (mai bloccante per la risposta al cliente).
- **`lib/checkout/checkoutSessionAccessToken.ts`**: mirror esatto di `generateTrackingToken.ts` (stesso algoritmo HMAC-SHA256, stesso `TRACKING_SECRET`) — autorizza un guest a leggere/modificare la propria sessione senza login.
- **`GET`/`PATCH /api/checkout-sessions/[id]`**: auth doppia — `customer_id` match (cliente loggato, via cookie/`getSessionCustomer`) oppure `accessToken` HMAC (guest). Una sessione `status='cancelled'` risponde sempre 404 (mai riesumabile). Il `PATCH` ricalcola sempre prezzo/nome/storage_type dei prodotti dal DB (mai dal client), verifica il `quoteToken` di spedizione con `verifyQuote`, ricalcola lo sconto ambassador se il subtotale cambia, e gestisce il cambio metodo di pagamento: stripe→stripe con intent esistente aggiorna l'importo Stripe (`paymentIntents.update`); stripe→external_link cancella l'intent attivo (idempotente) e costruisce il link esterno; external_link→stripe azzera lo snapshot esterno senza creare un intent (creazione differita al momento del pagamento, lato frontend).

### 2/4 — Entry point guest: editor su `/checkout/en-attente`

- **`/api/checkout/external-link/route.ts`**: la risposta include ora `accessToken` (`generateCheckoutSessionAccessToken`), per autorizzare le modifiche successive senza login.
- **`components/checkout-session/CheckoutSessionEditor.tsx`**: editor riusabile — CTA "Payer maintenant" sempre in cima (apre il link esterno o monta `StripePaymentStep`, già estratto e riusato tal quale, nessun embed Stripe reinventato), sezione "Modifier la commande" secondaria e richiudibile (metodo di pagamento, indirizzo, quantità articoli — feedback visivo lato client, il `PATCH` resta l'unica fonte di verità sul totale reale), link terziario "Annuler cette demande". Props reali: `{ tenant, externalPaymentMethods, sessionId, accessToken?, onCancelled? }` — `tenant` ed `externalPaymentMethods` sono obbligatorie (non menzionate esplicitamente nel prompt originale), il chiamante deve fetcharle server-side come già fa `checkout/page.tsx`.
- **`POST /api/checkout-sessions/[id]/create-intent`**: route separata (il `PATCH` non crea mai un intent quando manca, per design) — crea o riusa il `PaymentIntent` quando l'editor porta una sessione fino allo step di pagamento Stripe (es. switch `external_link → stripe` che non ne aveva mai avuto uno).
- **Estensione del `PATCH` esistente**: branch `status='cancelled'` (annullamento esplicito) — cancella l'eventuale `stripe_payment_intent_id` attivo (stesso principio non bloccante del cambio metodo) prima di aggiornare `status`.
- **`/checkout/en-attente`**: `PendingPaymentClient.tsx` risolve `sessionId`/`accessToken` da `sessionStorage`/`?ref=` e monta `CheckoutSessionEditor` — non mostra più dati statici potenzialmente stantii se la sessione è stata modificata da un altro dispositivo.

### 3/4 — Entry point cliente loggato: sezione "En attente" su `/orders`

- **`/orders/page.tsx`**: seconda query indipendente su `checkout_sessions` (`tenant_id` + `customer_id` + `status='open'`, più recente in cima) — mai fusa con gli ordini confermati, mostrata anche se `orders` è vuoto (stile Amazon: ogni richiesta pending è un'entità a sé).
- **`PendingCheckoutSessionsList.tsx`**: card per sessione con badge "En attente de confirmation" (volutamente distinto da `ORDER_STATUS_LABELS`), link verso `/orders/en-attente/[id]` — nessuna azione diretta dalla lista.
- **`/orders/en-attente/[id]/page.tsx`**: Server Component, redirect a `/compte/connexion` se non loggato (nessun meccanismo di return-url esiste nel repo — verificato, `ConnexionClient.tsx` non legge `searchParams`; stesso pattern minimale di `/compte/parrainage`), `notFound()` se la sessione non appartiene al `customer_id` corrente (mai un 403 che confermerebbe l'esistenza). Un piccolo wrapper client (`PendingSessionDetailClient.tsx`) passa `onCancelled={() => router.push('/orders')}` a `CheckoutSessionEditor` (una funzione non può attraversare il confine RSC da un Server Component).

### 4/4 — Carrello cross-device (clienti autenticati)

- **Migration `068_carts.sql`**: tabella `carts` (`tenant_id`, `customer_id`, `items` jsonb `[{product_id, quantity}]` — mai prezzo/nome), unique su `(tenant_id, customer_id)`, RLS `customer_id = auth.uid()` (confermato: `customers.id === auth.uid()`, verificato in `verifyOtp.ts` — upsert `customers` con `id: data.session.user.id` — e in `getSessionCustomer.ts`), `GRANT select/insert/update` a `authenticated` + `all` a `service_role`.
- **`GET`/`PUT /api/customers/me/cart`**: 401 se non autenticato. `GET` rilegge `products` dal DB per ogni riga salvata, scarta i prodotti non più `active`/non trovati, clampa la quantità allo stock attuale. `PUT` fa upsert di `{product_id, quantity}` (mai altro), scartando in silenzio le righe non valide.
- **`CartSyncProvider`** (montato in `(shop)/layout.tsx`, wrapper trasparente): al mount o all'evento `lepefy:customer-authenticated`, fa il merge una sola volta per sessione di login (`hasMergedRef`) — somma le quantità per prodotto in comune (info prodotto presa dal panier server, più fresca), clampata allo stock, applicata con un solo `setState` atomico (non un loop di `addItem`, per evitare scritture `persist`/re-render multipli per un solo evento logico), poi `PUT` immediato per riallineare il server. Dopo il merge, sottoscrive lo store (`useCartStore.subscribe`) e fa `PUT` debounced (~900ms) ad ogni cambiamento, **solo se un cliente è autenticato in quel momento** (`isAuthedRef`) — zero chiamate di rete per un carrello guest.
- **Eventi `window`**: `lepefy:customer-authenticated` (aggiunto in `OtpLoginForm.tsx`, subito dopo la verifica OTP riuscita) e `lepefy:customer-logged-out` (aggiunto in `AccountDashboard.tsx`, dopo `/api/auth/logout`) — necessari perché `CartSyncProvider` è montato una sola volta nello `ShopLayout` e non si rimonta navigando verso/da `/compte/connexion`.
- **Limite noto (v1, accettato)**: il carrello locale NON viene svuotato al logout — resta come carrello guest sul dispositivo. Compromesso noto su device condivisi, non risolto in questo ciclo.
- **Nota tipi**: `CartItem['product']` (`@lepefy/types`) richiede anche `slug`, non solo i campi elencati nel prompt originale (`id, name, price, storage_type, stock, image_url, weight_grams`) — aggiunto alla `select` di `GET /api/customers/me/cart`.
- **Retry pagamento Stripe**: `CheckoutForm.tsx` riusa la `checkout_sessions` esistente sui retry (via `POST /api/checkout-sessions/[id]/create-intent`) invece di crearne una nuova ad ogni click "Payer" — riduce le righe orfane. Fallback automatico a una nuova sessione se quella riusata non è più valida (es. annullata da un altro dispositivo).
- **Indicatore di progresso checkout**: `CheckoutProgressIndicator` (colocato con `CheckoutForm.tsx`) mostra le 3 tappe (`form`/`select-payment`/`payment`), nessuna modifica allo state machine esistente.
- **Autosalvataggio checkout**: `sessionStorage['lepefy-checkout-shipping']` ora include anche contatti (nome/email/telefono) oltre all'indirizzo, aggiornato live via `watch()` debounced (non solo allo snapshot iniziale da `CartClient.tsx`) — sopravvive a reload/retry nella stessa tab, azzerato alla chiusura tab (scelta privacy-conscious deliberata, non `localStorage`) e alla fine di un checkout riuscito.
- **Riepilogo carrello mobile**: su schermi stretti (`<md`) il riepilogo checkout diventa una barra compatta `position: sticky` in alto (totale + espandi/riduci inline), invariato su desktop. Nessun `vh`/`dvh`, nessun overlay.
- **Validazione indirizzo inline**: feedback su CAP/paese (formato generico lato client + stato/errore della verifica Packlink reale) ora mostrato vicino ai campi in `CheckoutForm.tsx`, non solo nel riepilogo. Nessuna regola specifica per paese (piattaforma multi-tenant/multi-paese).

### Stato

4/4 prompt eseguiti, `pnpm typecheck` verde su ognuno, `pnpm lint` mai eseguito (vietato). **Nessun commit pushato su `main`** — lavoro committato in locale sul branch `claude/checkout-sessions-in-place-w4m55n`, consegnato via zip di volta in volta su richiesta esplicita ("non fare push"). Non ancora testato end-to-end in produzione (nessun ambiente locale disponibile in questa sessione).

File toccati in questo changelog (4 prompt):
`supabase/migrations/067_checkout_sessions_edit_and_status.sql`, `068_carts.sql` · `apps/storefront/src/app/api/checkout/route.ts` · `apps/storefront/src/lib/checkout/checkoutSessionAccessToken.ts` · `apps/storefront/src/app/api/checkout-sessions/[id]/route.ts` · `apps/storefront/src/app/api/checkout-sessions/[id]/create-intent/route.ts` · `apps/storefront/src/app/api/checkout/external-link/route.ts` · `apps/storefront/src/components/checkout-session/CheckoutSessionEditor.tsx` · `apps/storefront/src/app/(shop)/checkout/CheckoutForm.tsx` · `apps/storefront/src/app/(shop)/checkout/en-attente/PendingPaymentClient.tsx`, `page.tsx` · `apps/storefront/src/app/(shop)/orders/page.tsx`, `PendingCheckoutSessionsList.tsx`, `en-attente/[id]/page.tsx`, `en-attente/[id]/PendingSessionDetailClient.tsx` · `apps/storefront/src/app/api/customers/me/cart/route.ts` · `apps/storefront/src/components/cart/CartSyncProvider.tsx` · `apps/storefront/src/components/auth/OtpLoginForm.tsx` · `apps/storefront/src/app/(shop)/compte/AccountDashboard.tsx` · `apps/storefront/src/app/(shop)/layout.tsx`.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.49 — 19 Agosto 2026 (base: v3.48; checkout_sessions modificabili in-place, due entry point guest/loggato, carrello cross-device — vedi §67; nessuno pushato su main)*
