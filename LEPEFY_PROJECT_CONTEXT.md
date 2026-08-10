# Lepefy Food Platform — Project Context

> Documento di riferimento per Claude Code, onboarding sviluppatori, e continuità tra sessioni.
> Aggiornato: 10 Agosto 2026 (v3.25) — **Modulo Événementiel completo** (8–10 agosto, sessione lunga e multi-ciclo, **parzialmente verificato**: alcuni cicli confermati con evidenza reale — decodifica QR testata con OpenCV, screenshot PDF stampa, deviation report dettagliati con diff — altri riportati solo in chat senza verifica diretta contro `main`, segnalato caso per caso nel dettaglio sotto). Nuovo business "a parte" (BBQ événementiel, service Traiteur, Location Matériel) con vetrina dedicata `/evenementiel`, raggiungibile anche via sottodominio `events.chloefood.com`. Architettura: stesso repo/DB/deploy della boutique (mai un sito separato), isolato solo a livello di layout/routing. **Nuove tabelle** (`052_events_module.sql`): `events`, `event_ticket_types`, `event_reservations`, `event_reservation_items`, `event_reservation_redemptions`, `service_offerings`, `service_inquiries`, `rental_items`, `rental_reservations`, `rental_reservation_items`, `event_gallery_photos`, + `tenants.events_enabled`/`tenants.services_enabled`. **3 RPC atomiche** (`reserve_event_capacity`, `redeem_event_reservation` con redemption parziale anti-riuso, `reserve_rental_stock`) + 1 RPC aggiunta in un ciclo di fix (`create_event_with_ticket_types`, transazione singola per evitare eventi orfani all'inserimento). QR biglietto: codifica un URL pubblico (`/evenementiel/billet/[qr_token]`, non più il token nudo), logo tenant compositato al centro via iniezione SVG nativa (non sharp/satori — bug di coordinate scoperto per riflesso in `api/shop/qr-code`, esistente ma non corretto lì, solo aggirato nella nuova route), **verificato scansionabile con OpenCV anche col logo reale ChloeFood**. Due bug di produzione reali scoperti e corretti in questa sessione: **rewrite `next.config.mjs` in forma array** (categoria `afterFiles`, mai raggiunto per `/` perché la home boutique esiste già a filesystem — corretto in `beforeFiles` con 3 regole per prefisso, non un catch-all che avrebbe rotto asset/API) e **`tenants.primary_color` mai migrato al blu** della brand charter v2 (restava `#1D9E75` verde in produzione nonostante il codice fosse corretto — fix diretto via SQL). Contratto: **Addendum n°1** (docx, IT) per una tantum di attivazione modulo (590€, concordata come prezzo "founding tenant" sotto il valore di mercato stimato), clausola esplicita di non cessione IP — bozza non ancora vista da un legale né firmata. Primo evento reale creato e testato end-to-end (pagamento, QR, stampa): "Braises & Saveurs — La Première", 29/08/2026 14:00, Via Dante Freddi 148, Reggio Emilia. Dettaglio completo in §14quater. Revisione precedente (v3.24) sotto.
> Aggiornato: 6 Agosto 2026 (v3.24) — **eliminazione completa del sistema di modali bottom-sheet in `/compte`**, stesso giorno di v3.23, **verificato direttamente contro `main` in questa sessione** (`git pull` + grep mirati). Dopo due fix falliti su device Android reale (v3.22, v3.23), decisione strutturale: sostituire sia il modale profilo sia il modale indirizzi con **pagine intere**, stesso pattern già in uso per `/compte/connexion` e `/compte/carte-fidelite` — bottone d'azione nel normale flusso del documento, zero `vh`/`dvh`/`position: fixed`/`sticky`. Nuove pagine: `/compte/modifier` (`ModifierProfilClient.tsx`), `/compte/adresses/nouvelle` e `/compte/adresses/[id]` (componente condiviso `AdresseFormClient.tsx`, pagina `[id]` scoped a `customer_id`+`tenant_id` di sessione, mai fidata del solo id in URL). `AccountDashboard.tsx` aggiornato con `Link` al posto dei trigger di stato-modale. **Cascata di rimozioni verificata via grep prima di ogni eliminazione** (non per assunzione): `ProfileEditModal.tsx`, `AddressFormModal.tsx`, `Modal.tsx` (zero import residui confermati), `lib/store/uiStore.ts` (zero riferimenti residui confermati) — `ChatWidget.tsx` di conseguenza semplificato, torna a nascondersi solo in base alla prop `enabled`, senza più dipendere da uno stato globale "modale aperto" ormai privo di senso. `pnpm typecheck` pulito. **Nuova regola permanente stabilita in questo ciclo**: compatibilità cross-device esplicita (Android/iPhone/PC/tablet) come requisito trasversale per ogni fix UI futuro, non solo per questo — vedi "Chiave di lettura" più sotto. **Debito minimo residuo, non bloccante**: un commento (non funzionale) in `api/customers/me/route.ts:49` cita ancora `ProfileEditModal.tsx` per nome — file lasciato intenzionalmente fuori perimetro ("da non toccare"), segnalato invece di corretto silenziosamente, da sistemare alla prossima occasione di tocco naturale di quel file. Revisione precedente (v3.23) sotto.
> Aggiornato: 6 Agosto 2026 (v3.23) — **hotfix Modal.tsx + chiusura debito `AddressFormModal.tsx`**, stesso giorno di v3.22, **verificato direttamente contro `main` in questa sessione** (`git pull` + lettura diretta dei file, non solo report chat — primo hotfix di questa serie con verifica reale contro il codice). Causa del bug segnalato via screenshot Android (bottone "Enregistrer" invisibile nel modale profilo, PWA installata): `Modal.tsx` usava solo `max-h-[90dvh]` senza fallback — su un browser/webview senza supporto `dvh` l'intera dichiarazione `max-height` viene scartata (nessun limite applicato), combinato con l'assenza di `min-h-0` sul body flex scrollabile (nessuno shrink garantito), che insieme spiegano perché il footer finisse fuori dai bordi visibili. Fix: `className` con `max-h-[90vh] max-h-[90dvh]` in sequenza (CSS applica l'ultima dichiarazione valida per la stessa proprietà — se `dvh` è scartato resta attivo `vh`) + `min-h-0` sul body. **Chiuso anche il debito aperto di v3.22 (§40)**: `AddressFormModal.tsx` migrato allo stesso pattern `<form>` esterno + `Modal footer={...}` di `ProfileEditModal.tsx` — bottoni "Enregistrer" e "Supprimer cette adresse" (condizionale `isEdit`) ora nel footer sticky, logica invariata. `pnpm typecheck` pulito. Nessuno scostamento sostanziale dal prompt (solo re-indentazione whitespace per il nuovo wrapper `<div className="space-y-3">`). **Non verificato in questo ciclo**: comportamento reale su un device/webview Android privo di supporto `dvh` (nessun accesso a device fisico o emulazione in ambiente Claude Code) — il fix si basa su comportamento CSS standard documentato, da confermare empiricamente al prossimo test con Dalice. Dettaglio in continuità con §40 (nessuna nuova sezione dedicata, modifica minima e localizzata). Revisione precedente (v3.22) sotto.
> Aggiornato: 6 Agosto 2026 (v3.22) — **ciclo UX modifica profilo `/compte`** (stesso giorno di v3.21, sessione chat separata, integrato solo da report Claude Code in chat — nessuna verifica contro filesystem/git in questa sessione): consolidamento dei due bottoni "Modifier" (Nom/Téléphone) in un unico "Modifier mes informations" (Variante A, scelta confrontata su mockup interattivo prima dell'esecuzione, vedi §40); normalizzazione telefono E.164 via nuova dipendenza `libphonenumber-js` (`lib/utils/phone.ts` con `formatPhoneLive`/`toE164`, formatting live + validazione in `ProfileEditModal.tsx`, placeholder tenant-aware sostituisce il precedente `+33...` hardcoded, validazione server-side in `api/customers/me/route.ts` sostituisce il vecchio regex permissivo `PHONE_RE`, dato salvato sempre in forma E.164 canonica); fix di due bug iOS reali segnalati da screenshot in produzione — bottone "Enregistrer" nascosto dalla tastiera su iPhone (footer sticky spostato fuori dall'area scrollabile di `Modal.tsx` tramite nuova prop `footer?`, `max-h-[90vh]` → `max-h-[90dvh]`, `env(safe-area-inset-bottom)`) e collisione visiva tra il FAB di `ChatWidget.tsx` e il foglio modale (nuovo store Zustand `lib/store/uiStore.ts`, `isModalOpen`, senza persistenza — `Modal.tsx` lo aggiorna su mount/unmount, `ChatWidget` si nasconde quando `true`). `pnpm typecheck` pulito, riportato esplicitamente. **Riconferma della regola permanente "mai `pnpm lint` su questo repo"** (già stabilita nel ciclo Play Store, v3.21): alla prima esecuzione, `next lint` ha nuovamente modificato `tsconfig.json` in autonomia (nessun `.eslintrc*` nel repo) — rilevato e ripristinato con `git checkout` prima di procedere, `git diff` verificato a zero output dopo il ripristino. **Debito aperto non chiuso in questo ciclo**: `AddressFormModal.tsx` (esplicitamente escluso dal perimetro del prompt per non violare il vincolo "file da non toccare") eredita `max-h-[90dvh]` da `Modal.tsx` ma **non** il bottone spostato in footer sticky — il bug "bottone salva nascosto dalla tastiera" resta quindi presente sul form indirizzi, da correggere in un ciclo dedicato. Script di backfill `scripts/backfill-phone-e164.mjs` + workflow `.github/workflows/backfill-phone-e164.yml` creati (pattern `DRY_RUN` default `true`, deliberatamente invertito rispetto a `backfill-admin-users.mjs` viste le poste in gioco su dati di contatto cliente) ma mai eseguiti contro il DB reale (nessuna credenziale Supabase in ambiente Claude Code) — nessun numero realmente convertito, incluso quello di Dalice stesso salvato in produzione come `00393880945556`. Dettaglio completo in §40 (nuova sezione). Revisione precedente (v3.21) sotto.
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
| **Frontend** | Next.js 14.2.3 (App Router) | Storefront + API routes, SSR — versione confermata in `apps/storefront/package.json` |
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

---

## 4. Schema database (Supabase)

### Tabelle principali

| Tabella | Descrizione |
|---|---|
| `tenants` | Un record per boutique. Colori, slug, Stripe account, `shipping_provider`, `show_powered_by`, `ai_image_generation`, `whatsapp_number`, `catalogue_search_threshold`, campi billing, **`locales`** (lingue attive, prima = default), **`ai_description_generation`**, **`ai_semantic_search`**, **`ai_rate_limit_public_per_minute`/`ai_rate_limit_public_per_day`/`ai_rate_limit_admin_per_day`**, **`barcode_prefix`** (3 cifre, assegnate automaticamente da trigger alla creazione tenant, mai a mano — vedi §16bis), **`barcode_sequence`** (contatore atomico), **`ai_chatbox_enabled`** (default `false`, nessun tenant abilitato automaticamente dalla migration), **`chatbox_extra_context`** (testo libero scritto a mano in admin, iniettato nel system prompt — mai generato dall'IA) — vedi §13ter, **`story_heading`/`story_text`/`story_image_url`/`countries_served`** (sezione "Notre origine" in home; se `story_text` è NULL la sezione non viene renderizzata — mai un placeholder al posto del contenuto mancante; `countries_served` resta NULL finché non confermato, mai un valore stimato) — vedi §33; **v3.20**: `loyalty_card_sequence` (`047`, contatore tessere fedeltà, indipendente da `barcode_sequence`), 7 colonne configurazione programma Ambassadeur (`ambassador_min_purchase_amount` e affini, `046`) — vedi §9ter; **nuove in v3.21 (riportato in chat, non riverificato contro filesystem/git in questa sessione)**: `android_package_name`/`android_sha256_fingerprint` (`048_tenant_android_app.sql` — il secondo campo è una stringa con 3 fingerprint separati da virgola, non un solo valore, per via del signing "hybrid quantum-ready" di Google Play che genera 3 certificati distinti), `android_public` (`049`, boolean default `false` — distingue "app esiste in closed testing" da "app pubblicamente installabile", usato dalla smart-link `/go` per non mandare i clienti su una scheda Play Store non ancora accessibile) — vedi §14ter |
| `categories` | Categorie prodotti per tenant (con supporto background per etichette) |
| `products` | Prodotti — `storage_type` (dry/fresh/frozen), `weight_grams`, `position`, `warehouse_location`, `name_alt` (⚠️ dal 23/07 letto anche dal titolo prodotto storefront, non più solo dall'editor etichette — vedi §12bis Fase 4), `producer_id`/`importer_id`, campi etichetta (ingredienti, allergeni, nutrizione, paese origine), **`descriptions`** jsonb multilingue (`{"fr":"...","it":"..."}`), **`description_source`** (`ai`/`human`), **`embedding`** vector(768) per ricerca semantica (dal 23/07 riusato anche per i prodotti correlati, vedi §12bis Fase 4), **`barcode_value`** (EAN-13 a 13 cifre, generato internamente, unique a livello piattaforma), **`barcode_generated_at`** — vedi §16bis; **`is_homemade`** (nuovo 26/07, boolean, default `false`, mai dedotto — vedi §33); i campi etichetta già esistenti dalla migration 018 (`ingredients_text`, `allergens_text`, `gluten_free_certified`, `usage_instructions`, `conservation_instructions`, `conservation_after_opening`, `country_of_origin`, `net_quantity_display`) sono dal 26/07 esposti anche nel tipo `Product` di `packages/types` e letti dalla scheda prodotto storefront, non più solo dall'editor etichette admin — stessa fonte dati, mai duplicata (vedi §33) |
| `ai_pricing` | Listino prezzi AI configurabile — `provider` (`gemini`, futuro `anthropic`), `model`, prezzi input/output/immagine per milione token, `currency`. Aggiornato via SQL quando i provider cambiano prezzo, mai hardcoded nel codice |
| `ai_usage_log` | Log per-chiamata di ogni richiesta AI (tutte le route, admin e pubbliche) — token input/output, immagini generate, `estimated_cost_usd` calcolato dai prezzi correnti in `ai_pricing`, `status` (`success`/`error`/`rate_limited`). Base sia per il rate limiting (query su finestra temporale) sia per il cruscotto costi (vista `ai_usage_monthly_by_tenant`) |
| `orders` | Ordini creati SOLO dopo `payment_intent.succeeded` webhook; indice unico su `stripe_payment_intent_id` (idempotenza) |
| `order_items` | Righe ordine con `storage_type`, `warehouse_location`, `name_alt` copiati dal prodotto |
| `customers` | Linked a `auth.users(id)` — la FK esisteva già dallo schema iniziale ma **restava inutilizzata fino al 31/07**: il checkout creava solo ordini guest con `customer_id null`. Dal 31/07 il login cliente via Supabase Auth (OTP email, vedi §9bis) popola effettivamente questa relazione. Colonna `referral_code` — **correzione v3.18**: non era un residuo legacy come implicava la formulazione precedente; è stata **aggiunta da `040_loyalty_referral_system.sql`** e **rimossa di nuovo da `043_drop_redundant_customer_referral_code.sql`** nello stesso ciclo (ridondante, mai scritta — la fonte di verità è la tabella dedicata `referral_codes`, vedi §9bis). **Nuove in v3.20**: 8 colonne profilo Ambassadeur (`is_ambassador`, `ambassador_iban`/`ambassador_paypal_email`, ecc., `046`) + `loyalty_card_number` (EAN-13 namespace `21`, assegnato da trigger a ogni riga, `047`) — vedi §9ter |
| `addresses` | Indirizzi clienti |
| `admin_users` | **Nuova (31/07, `039_admin_users.sql`** — correzione v3.18: file distinto da quello del sistema loyalty, non citato prima in questa tabella), sostituisce la whitelist flat `ADMIN_EMAILS` in env var. Ruoli `platform_owner` (accesso a tutti i tenant, Robertin), `tenant_admin` (scoped a un tenant specifico, es. Dalice per ChloeFood quando verrà attivata) e — **nuovo in `047_loyalty_card_system.sql` (v3.20)** — `tenant_cashier` (stesso scoping tenant di `tenant_admin`, ma `requireAdmin(tenantId, [...])` lo ammette solo sulla route di scan fedeltà; il layout `(protected)` lo reindirizza forzatamente a `/admin/loyalty/scan`, non vede mai dashboard/ordini/catalogo). `requireAdmin()` cambia firma in `requireAdmin(tenantId, allowedRoles?)` — ogni route sotto `/api/admin/*` deve passare esplicitamente il tenant, non solo verificare l'email — vedi §8, §9bis, §9ter |
| `checkout_sessions` | Sessioni temporanee checkout (eliminate dal webhook dopo creazione ordine) — contengono anche email/telefono carrelli incompleti, mai sfruttate per recupero carrello abbandonato (vedi §19) |
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
| `049_tenant_android_public.sql` | **Nuova in v3.21 — riportato in chat, non riverificato contro filesystem/git in questa sessione.** Aggiunge `tenants.android_public` (boolean, default `false`). Distingue "app esiste in closed testing" da "app pubblicamente installabile su Play Store", usato dalla nuova smart-link `/go` per decidere se reindirizzare al Play Store o mostrare un fallback. Vedi §14ter |
| `052_events_module.sql` | **Nuova in v3.25** (dopo `051_ambassador_split_pool_mode.sql`, non citata prima in questa tabella — verificare se già documentata in una revisione intermedia non ancora incorporata). Modulo Événementiel completo: 11 tabelle nuove + 2 flag booleani su `tenants` (`events_enabled`, `services_enabled`, indipendenti — un tenant può attivare solo eventi, solo servizi, o entrambi). RLS: **nessuna policy `authenticated` in scrittura** su nessuna delle tabelle di prenotazione/richiesta — deviazione deliberata e più sicura dello scheletro originale del prompt, tutte le scritture passano da `service_role` via webhook/API server-side, il client non può mai creare una riga `status='confirmed'` senza passare da Stripe. RPC atomiche: `reserve_event_capacity`, `redeem_event_reservation` (redemption parziale, log in `event_reservation_redemptions`), `reserve_rental_stock`, + `create_event_with_ticket_types` (aggiunta in un ciclo di fix successivo: singola funzione PL/pgSQL per creare evento+formule in un'unica transazione implicita, elimina il rischio di eventi orfani che esisteva con insert+delete di compensazione lato JS). Vedi §14quater |

**⚠️ Verificato in questa sessione (26/07, seconda passata):** `ls supabase/migrations/` conta **41 file**, non i ~38 impliciti dalla tabella sopra nelle revisioni precedenti — mancavano `031_storefront_ready.sql` (collisione di numero mai segnalata) e l'identificazione di `034_click_collect_hours_it.sql`. Entrambi i campi (`storefront_ready`, `click_collect_hours_it`) sono confermati letti/scritti nel codice reale (`packages/types/tenant.ts`, `card/page.tsx`, `DigitalCard.tsx`, `api/admin/tenant/route.ts`, `BoutiqueInfoSection.tsx`) — non sono migration orfane, la feature è cablata end-to-end, solo mai documentata qui prima d'ora.

**⚠️ Verificato in questa sessione (31/07, v3.18):** `ls supabase/migrations/` conta **49 file** su questo branch, non i 41 della revisione precedente (+8: `037`–`044`, vedi sopra). Su `main` invece sono **48**: `044_customer_default_address.sql` esiste solo su questo branch di lavoro, non ancora mergiata (verificato con `git cat-file -e main:supabase/migrations/044_customer_default_address.sql`, fallisce) — le altre 7 (`037`–`043`) sono invece confermate identiche su `main` (`diff` byte-per-byte contro `git show main:...`), a differenza del pattern "nulla mergiato" di tutte le verifiche precedenti (v3.7/v3.16). Dettaglio in §9bis e §36.

**⚠️ Verificato in questa sessione (3/08, v3.20):** `ls supabase/migrations/` conta **52 file** su questo branch (+3: `045`–`047`, vedi sopra — non le +8 implicite dal solo confronto coi numeri, dato che `037`–`044` erano già presenti da v3.18). `git ls-tree -r main -- supabase/migrations/` conferma che **`main` è invece fermo a `043`** — non solo `044` manca ancora (come già noto da v3.18), ma il gap si è allargato a 9 file (`044`–`047` + le altre 4 che restavano già solo-branch). `git merge-base main HEAD` coincide esattamente con la punta di `main`: questo branch di lavoro contiene tutta la storia di `main` più **17 commit ulteriori**, tutti "Add files via upload" datati 30/07–3/08, zero commit su `main` che non siano già su questo branch. Dettaglio completo in §38.

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

## 14quater. Modulo Événementiel (8–10/08/2026)

### Decisione di posizionamento e contratto

Nato da una richiesta del business reale di ChloeFood: oltre alla boutique e-commerce, Dalice organizza serate barbecue, propone un servizio Traiteur, e noleggia materiale da ricevimento (chafing dish, BBQ industriale — catalogo reale fornito via PDF fornitore "Luxury Equipments"). Decisione esplicita presa a inizio ciclo: **stesso repo/DB/deploy della boutique**, mai un sito separato — l'alternativa (sito a parte) avrebbe raddoppiato manutenzione (auth, tema, deploy, DNS) per un beneficio che il solo banner cross-promo nello shop rende comunque necessario accoppiare strettamente. La vetrina ha però un'identità visiva "a parte" (palette derivata dagli stessi token tenant ma applicazione diversa, header/footer dedicati) — vedi mockup sotto.

**Modello di business:** una tantum di attivazione di **590€** (non canone ricorrente), concordata con un ragionamento esplicito a tre leve — costo di mercato stimato per un modulo equivalente (20-30h a tariffa freelance italiana, 800-2000€), valore atteso per Dalice (si ripaga in poche settimane di eventi), sconto "founding tenant" perché ChloeFood sta co-validando un modulo che diventa IP riutilizzabile per Lepefy su tenant futuri (prezzo di listino stimato 1200-2000€ per un tenant che lo riceve già pronto). **Punto legale importante emerso durante la discussione:** Lepefy Labs non ha ancora un'entità giuridica — questo esclude di fatto l'opzione "commissione su transazione via Stripe Connect" (richiede status di piattaforma verificata), lasciando la tantum/canone come unico canale di monetizzazione finché non c'è almeno una partita IVA aperta. Redatto **Addendum n°1** al contratto SaaS esistente (docx, italiano — il contratto principale è in italiano, 16 articoli, redatto in sessione precedente): 4 articoli, oggetto del modulo, corrispettivo 590€, **clausola esplicita di non cessione IP** (l'accesso al modulo resta legato all'abbonamento attivo, esattamente come il resto della piattaforma — la tantum è inquadrata come "frais d'activation", non come sviluppo custom commissionato, per evitare la presunzione di cessione dei diritti di utilizzazione economica prevista dal diritto d'autore italiano quando manca una clausola esplicita contraria). **Bozza non ancora vista da un legale né firmata da Dalice** — segnalato esplicitamente come da fare prima di considerare la questione IP chiusa.

### Architettura dati

11 tabelle nuove (`052_events_module.sql`), pensate esplicitamente per generalizzare a tenant futuri (mai un valore ChloeFood hardcoded):

- **`events`** + **`event_ticket_types`** (formule multiple per evento, es. "Formule Repas" 10€ / "Formule Repas + Bière" 15€ — non un prezzo fisso per evento) + **`event_reservations`** (creata SOLO dopo webhook `payment_intent.succeeded`, mai prima) + **`event_reservation_items`** (righe formula dentro una prenotazione) + **`event_reservation_redemptions`** (log di ogni scansione QR, chi/quando/quanti — supporta redemption **parziale**: un gruppo di 5 posti può essere servito in scan separati se arriva in momenti diversi)
- **`service_offerings`** (Traiteur, Location Matériel — categorie "cappello", non datate) con campo `cta_type` (`'devis'` | `'reservation'`) **configurabile per singolo servizio**, non fisso per tipo — riflette la decisione esplicita "dipende dal servizio, misto"
- **`service_inquiries`** (richieste di preventivo strutturate: nome, email, telefono, data desiderata, numero invitati, messaggio — per servizi con `cta_type='devis'`)
- **`rental_items`** (catalogo articoli noleggiabili con prezzo/stock individuali — dal PDF fornitore reale: chafing dish oro/argento 10-15€, BBQ industriale 50€ — sostituisce il concetto iniziale di "singola marmite a prezzo fisso al giorno", troppo semplice rispetto al catalogo reale) + **`rental_reservations`** + **`rental_reservation_items`** (stesso pattern multi-articolo di un carrello, con `reserve_rental_stock` come RPC atomica gemella di quella eventi)
- **`event_gallery_photos`** (foto eventi passati)

**3 RPC atomiche** seguono lo stesso pattern già consolidato per lo stock prodotti: `reserve_event_capacity` (decremento capienza evento al pagamento confermato), `redeem_event_reservation` (decremento `quantity_remaining` alla scansione QR, con `WHERE quantity_remaining >= p_quantity` — un codice esaurito non può essere riusato), `reserve_rental_stock`. **RLS/GRANT — deviazione deliberata rispetto allo scheletro originale del prompt, confermata come miglioramento non come scostamento**: nessuna policy `authenticated` in scrittura su nessuna tabella di prenotazione/richiesta; tutte le scritture passano da `service_role` via webhook Stripe o API route admin (`requireAdmin()`), mai dal client browser in scrittura diretta — coerente col pattern reale già in uso nel progetto (`045`, `050`), più sicuro dello scheletro RLS originale che il prompt stesso proponeva.

**Bug di produzione trovato e corretto in un ciclo di fix successivo:** la creazione evento+formule via API route usava due insert separati (evento, poi formule) con un delete di compensazione se il secondo falliva — la compensazione stessa non controllava il proprio errore, rischio di eventi orfani in caso di doppio fallimento di rete. Corretto con `create_event_with_ticket_types()`, una singola funzione PL/pgSQL (transazione implicita, rollback automatico se una qualsiasi insert fallisce) — stesso principio delle RPC di redemption/capacità, applicato per coerenza a un quarto punto di scrittura del modulo.

### Routing sottodominio `events.chloefood.com`

Env var per-tenant `NEXT_PUBLIC_EVENTS_SUBDOMAIN` + rewrite in `next.config.mjs` con `has: [{ type: 'host', ... }]`. **Non usa `middleware.ts`** (noto non funzionante su questo progetto per via del Root Directory Vercel = `apps/storefront`) — i rewrites di `next.config.js` sono un meccanismo diverso, risolto a livello di configurazione/routing di Next, confermato funzionante indipendentemente da quel vincolo.

**Bug di produzione reale scoperto e corretto:** la prima implementazione usava `return [...]` (array semplice) in `rewrites()` — Next.js tratta questa forma come categoria `afterFiles`, valutata **solo dopo** aver verificato che non esista già una pagina filesystem corrispondente. Poiché `/` esiste come pagina reale (la home boutique), Next.js la serviva sempre prima di leggere l'header `host`, quindi `events.chloefood.com` mostrava sempre la boutique qualunque fosse la configurazione Vercel. **Tentativo di fix iniziale anch'esso sbagliato**, scoperto in fase di test empirico prima del deploy (non dopo): spostare tutto in `beforeFiles` con un catch-all `/:path*` avrebbe rotto asset (`_next/static`) e API (`/api/*`), perché `beforeFiles` intercetta *tutto* prima del filesystem. **Fix finale:** `beforeFiles` con **3 regole per prefisso mirato** (`/`, `/evenements/*`, `/services/*`) invece di un catch-all — copre il 100% della superficie pubblica attuale del modulo senza toccare asset/API, a costo di dover aggiungere esplicitamente una quarta regola se in futuro si aggiunge un percorso pubblico fuori da questi tre prefissi (annotato come nota tecnica permanente, non automatico).

**Bug di layout scoperto dopo il primo deploy funzionante:** `events.chloefood.com` mostrava il rewrite corretto ma ereditava l'intero chrome della boutique (navbar Catalogue/Panier/Compte, banner installazione PWA, ticker promozionale "Livraison en Europe...") — le route eventi erano annidate nello stesso route group `(shop)`. Corretto isolando in un route group dedicato con `EventsHeader` (logo tenant dinamico, nav Événements/Services/Galerie, CTA Réserver) e **footer dedicato** (non quello condiviso della boutique) con CTA di ritorno esplicito verso `shop.chloefood.com`.

**Bug di colore, causa non era nel codice:** l'hero mostrava un gradiente verde-giallo invece del blu/oro brand — non un bug di implementazione, il codice leggeva correttamente `tenant.primary_color`, ma quel campo in produzione era rimasto `#1D9E75` (verde), la migrazione al blu `#1267C7` della brand charter v2 (decisa in sessione precedente, già annotata come "nessuna occorrenza di questo blu altrove nel codice" in §15) non era mai stata eseguita contro il DB reale. Corretto via `UPDATE tenants SET primary_color = '#1267C7' WHERE slug = 'chloefood'` diretto — con l'avvertenza esplicita che questo cambia il colore di **tutta** la boutique, non solo la pagina eventi.

### QR code — biglietto, redemption, branding

Il QR generato alla conferma prenotazione codifica un **URL pubblico** (`https://events.chloefood.com/evenementiel/billet/[qr_token]`), non più il token nudo come nella prima implementazione (scansionato con una fotocamera generica restituiva testo illeggibile). Nuova pagina pubblica in sola lettura (stesso principio di sicurezza di `/orders/[id]?token=`, già in uso — il token stesso è la capability, nessuna autenticazione richiesta ma nessuna azione di redemption disponibile lì). Lo scanner admin (`html5-qrcode`, riusato da `/admin/loyalty/scan`) è stato aggiornato per estrarre il token dall'URL (`extractQrToken()`, regex host-agnostica) con passthrough per i vecchi QR a token nudo (retrocompatibilità, nessuna prenotazione precedente rotta).

**Logo tenant al centro del QR:** error correction level `H`, compositing via **iniezione SVG nativa** (non sharp/satori — scelta motivata: un `<image href="https://...">` esterno non renderizza mai dentro un `<img>`, i browser lo trattano in "secure static mode" senza risorse esterne; il logo va embeddato come data URI dopo fetch server-side). **Scoperta collaterale rilevante:** questo stesso bug di coordinate (viewBox in unità pixel invece che in unità-modulo dell'SVG generato da `qrcode`) esiste già, non corretto, in `api/shop/qr-code` (già annotato come debito noto in §14ter) — il bug lì non si è mai manifestato visivamente solo perché il contesto in cui è servito nasconde l'effetto, non perché assente. **Verificato con decodifica reale** (OpenCV, non solo ispezione visiva): il QR con logo ChloeFood reale (non simulato) si decodifica correttamente anche stampato — nessun fallback alle iniziali necessario, contrariamente al timore iniziale post-test con un logo simulato "al limite".

### Pagina di conferma (redesign da pacchetto design esterno)

Un handoff di design esterno (HTML + JSX) per la pagina `/evenementiel/evenements/[slug]/confirmation` è stato valutato, **non incollato alla cieca**: due bug reali trovati e corretti prima dell'integrazione — badge "1 SCAN VALIDE" hardcoded (doveva essere dinamico su `quantity_remaining`, non disponibile nell'oggetto di polling e aggiunto in questo ciclo) e assenza di foglio di stile `@media print` (il bottone "Télécharger le billet" avrebbe stampato l'intera pagina, navbar e bottoni inclusi). **Verificato end-to-end con un PDF di stampa reale**: badge dinamico corretto ("3 SCANS VALIDES" su una prenotazione di test a 3 posti), stampa pulita (solo la card ticket), QR con logo reale confermato scansionabile anche nel PDF. Nota tecnica: la regola CSS di stampa aggiunta è **globale** (`header, nav, aside, footer { display:none }` in `@media print`), non scoped alla sola pagina eventi — verificato che non tocca pagine admin (nessuna usa `<footer>`), **non verificato** se tocca altre pagine pubbliche con footer e un possibile caso d'uso di stampa (es. `/orders/[id]?token=`).

### Admin

`/admin/evenementiel` con 6 sezioni (Événements, Scan, Services, Catalogue matériel, Demandes de devis, Réservations matériel, Galerie). Due bug UI reali trovati durante l'uso reale (non ipotetici): (1) form creazione evento senza campo upload immagine né gestione formule — corretto riusando il pattern upload già esistente in `GalleryClient.tsx` verso l'endpoint `kind: 'event-banner'` (esisteva già lato backend, mai usato lato UI) e costruendo un pattern di righe ripetibili per le formule (nessun pattern preesistente da riusare nel form di creazione, esisteva solo nel form di modifica); (2) i campi `label`/`description` delle formule renderizzati a pochi pixel, illeggibili — causa: conflitto CSS `w-full` + `flex-1` sullo stesso elemento dentro un flex container affollato, diagnosticato per confronto diretto col form di modifica (che non aveva `w-full` e funzionava) prima di applicare il fix, non per tentativi. **Bug non ancora verificato in produzione:** lo scanner admin va in crash ("Application error") su mobile — causa isolata dalla console browser ("Cannot stop, scanner is not running or paused", errore nativo `html5-qrcode` non gestito, probabile chiamata `.stop()` senza controllo dello stato dello scanner) — prompt di fix generato, **non ancora eseguito/verificato**.

### n8n — notifiche email

**7 webhook "gemelli" identificati** per i vari eventi del modulo (`event-reservation-confirmed`, `event-reservation-capacity-conflict`, `rental-reservation-confirmed`, `rental-reservation-stock-conflict`, `service-inquiry-created`) + 2 preesistenti del core e-commerce mai riconfigurati (`order-confirmed`, `order-shipped` — questi due **erano già attivi**, `order-stock-conflict` **no**, segnalato come priorità più alta in assoluto perché è un gap sul business già live, non sul nuovo modulo). Payload iniziale del webhook Stripe per gli eventi conteneva solo id grezzi (`eventId`, `ticket_type_id`), insufficiente per un template email leggibile — arricchito con `eventTitle`/`eventDateStart`/`eventLocation`/`ticketTypeLabel`/`ticketUrl` prima di costruire i workflow n8n, per evitare query aggiuntive lato n8n. **Configurati e attivati in questa sessione:** `event-reservation-confirmed` e `event-reservation-capacity-conflict`, template HTML duplicati da quello ordine esistente e allineati al blu/oro brand (il template ordine originale era verde `#2d6a4f` con link a un dominio preview Vercel `chloefood.vercel.app`, non quello di produzione) — **in questo stesso passaggio sono stati aggiornati anche i tre template ordine esistenti** (`order-confirmed`, `order-shipped`, più uno non ancora nominato) allo stesso blu/oro e dominio corretto `shop.chloefood.com`, per coerenza tra tutte le comunicazioni email del tenant. **Nota gotcha n8n:** i campi Subject/HTML del nodo email devono essere in modalità "Expression" (icona `fx` attiva) perché `{{ $json.body.* }}` venga risolto da n8n prima dell'invio — altrimenti Brevo riceve la sintassi grezza e restituisce un errore di parsing (capitato e risolto in sessione). **Non ancora configurati:** `order-stock-conflict` (priorità più alta, non di questo modulo), `rental-reservation-confirmed`/`rental-reservation-stock-conflict`, `service-inquiry-created`.

### Primo evento reale

Creato e testato end-to-end: **"Braises & Saveurs — La Première"**, 29/08/2026 14:00, Via Dante Freddi 148 — 42123 Reggio Emilia, capienza 100 (valore prudenziale di partenza, non un vincolo fisico reale confermato), due formule (Repas 10€, Repas + Bière 15€). Flyer promozionale fornito da Dalice (formato verticale WhatsApp/Instagram) — **valutato non riusabile così com'è** come banner web (testo/contatti WhatsApp incorporati nei pixel, duplica dati ora nel DB; formato verticale non adatto a un banner largo) — fornito un prompt per farlo rielaborare con AI image editing (rimozione testo/loghi, outpainting per formato panoramico 21:9). **Componente "spotlight" per dare al flyer prominenza in prima pagina: discusso, non ancora costruito** — resta il principale item aperto lato vetrina pubblica.

### Stato di verifica — riepilogo onestà

A differenza di altri cicli di questo documento, questa sessione mescola livelli di verifica diversi punto per punto: QR/stampa/n8n-payload **verificati con evidenza tecnica reale** (decodifica OpenCV, PDF di test, deviation report con diff); layout/colore/rewrite **verificati da Robertin in produzione** dopo ogni fix (screenshot alla mano); scanner crash **diagnosticato ma non ancora corretto**; email n8n **configurate e testate per 2 dei 7 webhook**; contratto/tantum **deciso ma non formalizzato legalmente**. Nessuna verifica diretta di questa sessione contro `git`/`main` da parte di Claude (a differenza delle sessioni "verifica di coerenza" come v3.18/v3.20) — tutto quanto sopra riflette report Claude Code + conferme dirette di Robertin in chat, non un audit filesystem indipendente.

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
- **Cross-device compatibility — regola permanente (stabilita v3.24).** Ogni fix/feature UI deve funzionare correttamente su Android, iPhone, PC e tablet — mai una soluzione verificata solo su un device/browser specifico. Evitare in particolare soluzioni fragili legate a unità viewport (`vh`/`dvh`) o calcoli di altezza dipendenti dal browser/webview. Caso reale che ha portato alla regola: il bottone "Enregistrer" nel modale `/compte` è rimasto invisibile su Android reale nonostante due tentativi di fix CSS (fallback `vh`→`dvh`, poi scroll nativo dell'overlay) — risolto solo abbandonando del tutto il pattern modale a favore di pagine intere con scroll nativo del documento (§40bis). Preferire sempre pattern basati sul flusso normale del documento invece di overlay/modali con altezza calcolata, quando possibile. Prima di considerare un fix "risolto", verificare esplicitamente che non introduca dipendenze da un singolo tipo di device/OS/browser.
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

## §40. Ciclo UX modifica profilo `/compte` (6 agosto 2026, v3.22)

**Stato di verifica:** solo da report Claude Code in chat, nessuna verifica contro filesystem/git in questa sessione.

### Contesto
Screenshot in produzione (inviato da Robertin, presa da Dalice via WhatsApp) ha mostrato due problemi concreti sull'iPhone di Dalice mentre modificava "Informations personnelles": (1) il bottone "Enregistrer" non visibile con la tastiera aperta, (2) il FAB della chat sovrapposto/tagliato dal foglio del modale. In parallelo, revisione UX ha rilevato che il numero telefono di Dalice era salvato come `00393880945556` (formato non-E.164) e che il placeholder del campo telefono era hardcoded in francese (`+33...`) su un tenant italiano.

### Decisioni di design
Due varianti mockup confrontate (bottone unico "Modifier mes informations" per tutta la sezione vs. due bottoni distinti, ognuno con modale a campo singolo) — scelta la **Variante A** (bottone unico), più semplice e senza aspettative disattese sul singolo campo.

### Task eseguiti
1. **`AccountDashboard.tsx`** — due "Modifier" per riga rimossi, un solo bottone "Modifier mes informations" (stile outline, coerente con "Se déconnecter").
2. **Normalizzazione telefono** — nuova dipendenza `libphonenumber-js`; `lib/utils/phone.ts` (`formatPhoneLive`, `toE164`); `ProfileEditModal.tsx` con prop `defaultCountry`, format live, hint di validazione in tempo reale (soglia 3 cifre prima di segnalare invalido), placeholder dinamico via mappa locale `COUNTRY_PLACEHOLDER: Partial<Record<CountryCode, string>>` (mercati reali da `AddressFormModal.tsx`: IT, FR, BE, DE, CH — non "IT, FR, BE, LU" come da bozza iniziale del prompt, LU non esiste nel codebase); `api/customers/me/route.ts` valida con `parsePhoneNumberFromString(...).isValid()` e salva sempre `.number` (E.164).
3. **Fix bottone salva nascosto (iOS)** — `Modal.tsx` ristrutturato header/body-scroll/footer fisso via nuova prop `footer?`; `max-h-[90vh]` → `max-h-[90dvh]`; `env(safe-area-inset-bottom)` sul footer; `ProfileEditModal.tsx` ora avvolge `<Modal>` in un `<form>` esterno, bottone submit nel footer.
4. **Fix collisione FAB chat** — nuovo `lib/store/uiStore.ts` (Zustand, `isModalOpen`, no persist); `Modal.tsx` lo aggiorna su mount/unmount; `ChatWidget.tsx` ritorna `null` (e chiude il pannello se aperto) quando `isModalOpen === true`.
5. **Bonus, creato ma non eseguito** — `scripts/backfill-phone-e164.mjs` + `.github/workflows/backfill-phone-e164.yml` (`DRY_RUN` default `true`), mai lanciato contro Supabase in questo ciclo (nessuna credenziale in ambiente Claude Code).

### `pnpm typecheck`
Pulito, nessun errore. Riportato esplicitamente da Claude Code.

### Incidente `tsconfig.json` (nessun impatto — stessa dinamica già nota)
`next lint` (nessun `.eslintrc*` nel repo) ha modificato `tsconfig.json` in autonomia alla prima esecuzione. Rilevato subito, ripristinato con `git checkout`, `git diff` verificato a zero output. Riconferma la regola permanente "mai `pnpm lint` su questo repo" già stabilita nel ciclo Play Store TWA (v3.21, §14ter).

### Debito — chiuso in v3.23
`AddressFormModal.tsx` **non** ereditava il footer sticky (solo `max-h-[90dvh]`, per via del vincolo esplicito "non toccare quel file" nel prompt originale) — il bug "bottone nascosto" restava presente sul form indirizzi. **Risolto nell'hotfix v3.23** (vedi entry in testa al documento), insieme al fix del fallback `dvh`/`min-h-0` in `Modal.tsx` scoperto dallo stesso bug segnalato in produzione.

### Dati da sistemare
Il numero di Dalice in produzione (`00393880945556`) resta nel formato sbagliato finché il backfill non viene eseguito con credenziali reali — non ancora pianificato.

---

## Aggiornamenti in questo changelog (v3.22)

- **Nuovo §40** — dettaglio completo del ciclo UX modifica profilo `/compte`.
- **§9bis/§4** (sezione "Mon compte", se presente più sopra) — implicitamente da integrare con la Variante A e i nuovi file `lib/utils/phone.ts`, `lib/store/uiStore.ts` alla prossima passata di coerenza contro filesystem; non modificati direttamente in questo aggiornamento per non introdurre dati non verificati contro git in una sezione già marcata "verificata" da v3.20.
- **§1–§39** (esclusi i punti sopra) non sono stati modificati oltre al pointer inline in testa al documento — restano validi come base storica del progetto.

## Aggiornamenti in questo changelog (v3.23)

- **Nuova entry in testa** — hotfix `Modal.tsx` (fallback `vh`/`dvh` + `min-h-0`) e migrazione `AddressFormModal.tsx` al footer sticky, **verificato via `git pull` diretto su `main`**, non solo da report chat.
- **§40** — paragrafo "Debito aperto" aggiornato a "Debito — chiuso in v3.23".
- Nessuna altra sezione modificata.

---

## §40bis. Eliminazione modali `/compte` → pagine intere (6 agosto 2026, v3.24)

**Stato di verifica:** verificato direttamente contro `main` in questa sessione (`git pull` + grep mirati sui file toccati), non solo da report chat.

### Perché
Due cicli di fix (v3.22, v3.23) sul modale bottom-sheet condiviso (`Modal.tsx`) non hanno risolto il bottone "Enregistrer" invisibile su Android reale (PWA installata). Invece di un terzo tentativo CSS, decisione strutturale: eliminare il pattern modale per `/compte` e usare pagine intere, come già `/compte/connexion`/`/compte/carte-fidelite`.

### Nuove pagine
- `/compte/modifier` (`ModifierProfilClient.tsx`) — sostituisce `ProfileEditModal.tsx`.
- `/compte/adresses/nouvelle` e `/compte/adresses/[id]` (componente condiviso `AdresseFormClient.tsx`) — sostituiscono `AddressFormModal.tsx`. La pagina `[id]` interroga `addresses` scoped a `customer_id`+`tenant_id` di sessione, mai fidandosi del solo id nell'URL; redirect a `/compte` se non trovata/non di proprietà.
- `AccountDashboard.tsx`: tutti e tre i trigger (profilo, nuovo indirizzo, modifica indirizzo) ora sono `Link`, nessuno stato di modale residuo.

### Cascata di rimozioni (verificata via grep prima di ogni eliminazione)
`ProfileEditModal.tsx`, `AddressFormModal.tsx` → `Modal.tsx` (zero import residui confermati) → `lib/store/uiStore.ts` (zero riferimenti residui confermati, essendo usato solo da `Modal.tsx` e `ChatWidget.tsx`). `ChatWidget.tsx` semplificato di conseguenza: torna a nascondersi solo in base alla prop `enabled`, nessuna dipendenza da uno stato globale "modale aperto" ormai privo di senso.

### Verifica cross-device (nuova regola permanente da questo ciclo)
Grep mirato su `compte/modifier/` e `compte/adresses/`: zero occorrenze di `vh`/`dvh`, `position: fixed`, `sticky`. Unico scroll è quello nativo di pagina (`min-h-screen`).

### Debito minimo residuo (non bloccante)
Un commento (non funzionale) in `apps/storefront/src/app/api/customers/me/route.ts:49` cita ancora `ProfileEditModal.tsx` per nome — quel file era fuori dal perimetro "da non toccare" del prompt, quindi il commento stantio non è stato corretto. Da sistemare alla prossima occasione naturale di modifica di quel file.

---

## Aggiornamenti in questo changelog (v3.24)

- **Nuova entry in testa** — eliminazione completa del sistema di modali `/compte`, verificata via `git pull` diretto su `main`.
- **Nuovo §40bis** — dettaglio completo del ciclo.
- **§ principi permanenti (dopo "Multi-tenancy vigilance")** — aggiunta la regola "Cross-device compatibility".
- Nessun'altra sezione modificata.

---

## 41. Changelog v3.25 (10 Agosto 2026) — Modulo Événementiel (8–10/08/2026), sessione lunga multi-ciclo

- **Nuova entry in testa** — riepilogo completo del modulo Événementiel: architettura, tabelle, RPC, QR, admin, n8n, contratto/tantum, primo evento reale.
- **Nuovo §14quater** — dettaglio completo, inclusi 4 bug di produzione reali scoperti e corretti in sessione (rewrite `next.config.mjs` in forma array/`afterFiles`, layout eventi che ereditava il chrome boutique, `primary_color` mai migrato in DB nonostante il codice corretto, compensazione non verificata nella creazione evento+formule) e 1 bug diagnosticato ma **non ancora corretto** (crash scanner admin su mobile).
- **Nuova riga migration `052_events_module.sql`** in §4 — 11 tabelle nuove + 2 flag `tenants`, con nota sulla deviazione RLS deliberata (nessuna scrittura client diretta) e la RPC `create_event_with_ticket_types` aggiunta in un ciclo di fix successivo.
- **Item aperti non chiusi in questa sessione, da riprendere:** componente "spotlight" per il flyer evento in prima pagina (non costruito); verifica in produzione del fix scanner crash; configurazione dei restanti 5 webhook n8n (`order-stock-conflict` priorità più alta — non è del modulo eventi, è un gap sul core e-commerce già live; più `rental-reservation-*` e `service-inquiry-created`); revisione legale e firma dell'Addendum n°1; verifica che la nuova regola CSS di stampa globale non interferisca con altre pagine pubbliche con footer.
- Nessun'altra sezione modificata.

---

*Lepefy Labs — Lepefy Food Platform — Context document v3.25 — 10 Agosto 2026 (base: v3.24; modulo Événementiel completo — vetrina `/evenementiel` + sottodominio `events.chloefood.com`, prenotazione BBQ a formule multiple con pagamento e QR redemption, catalogo Location Matériel, servizio Traiteur su preventivo, admin dedicato, 2 dei 7 webhook n8n configurati, contratto Addendum n°1 non ancora firmato — **verifica mista: alcuni cicli con evidenza tecnica reale (decodifica QR, PDF di stampa), altri solo da report chat/conferma diretta di Robertin, nessun audit filesystem indipendente in questa sessione** — vedi §14quater)*
