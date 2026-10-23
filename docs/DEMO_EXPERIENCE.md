# Demo Experience

> Revue sur `main` @ `022217c1` (23/10/2026). Migration `167_demo_experience.sql`.
> Principe : une démo commerciale utilise le vrai produit, sans effet réel.

Démonstration de la plateforme à des commerçants prospects : boutique, événements,
commandes, gestion commerciale et Nala, sur un tenant fictif. Même code que la
production (aucun fork), base Supabase et projet Vercel séparés.

## 1. Vue d'ensemble

| Élément | Où |
|---|---|
| Page d'accueil (5 parcours, demande de boutique) | `/demo` — `app/demo/page.tsx` |
| Messages simulés (ce qui serait parti) | `/demo/messages` |
| Lien de paiement simulé | `/demo/paiement-simule` |
| Bandeau permanent + visite guidée | `components/demo/DemoRibbon.tsx`, `DemoTour.tsx` (root layout, démo active seulement) |
| Visite admin lecture seule | `POST /api/demo/visit` → compte éphémère `demo_visitor` |
| Lien d'accès d'une démo privée | `GET /api/demo/access?token=` (cookie `lepefy_demo_access`) |
| Demandes « Demander ma propre boutique » | `POST /api/demo/requests` → `demo_requests` |
| Compteurs agrégés | `POST /api/demo/events` → `demo_event_counts` |
| Console (propriétaire de la plateforme) | `/admin/platform/demo` (Développement → Démo) |
| Seed / remise à zéro | `scripts/demo/seed-demo.mjs`, workflows `demo-seed`, `demo-reset` |
| Schéma de la base démo | `scripts/demo/build-demo-schema.mjs`, workflow `demo-database` |
| Seed en SQL (premier chargement sans clé) | `scripts/demo/build-seed-sql.mjs` (lots `-- ─── lot` < 120 Ko) |

**État (23/10/2026)** : démo publique en service sur `demo.lepefy.com` et `evenements.demo.lepefy.com`
(projet Vercel `lepefy-demo`, team robertinsmartinvestor-3745s-projects ; Ignored Build Step = production seulement).
Base Supabase `lepefy-demo` (`swthkhrjacdfpqksfdmi`, eu-central-1) : schéma appliqué via l'éditeur SQL en 11 lots
(l'éditeur refuse une requête de 1,2 Mo), seed `traiteur-africain` chargé par le workflow `Demo seed`
(tenant `lepefy-demo`). Vérifié : accueil, boutique (promos, nouveautés, petits plus, retrait), Traiteur, visite
admin lecture seule (écriture refusée `DEMO_READ_ONLY`, console et paramètres inaccessibles), Gestion, Devis.
Restent : compte platform owner de la démo, routage IA de Nala, démo privée.

Deux déploiements possibles, sur la même base démo :

| Projet Vercel | Domaine | Tenant | Scénario | Accès |
|---|---|---|---|---|
| `lepefy-demo` | `demo.lepefy.com` (+ `evenements.demo.lepefy.com`) | `lepefy-demo` | `traiteur-africain` | public |
| `lepefy-demo-prive` (au besoin) | ex. `prive.demo.lepefy.com` | `demo-tata-pao` | `tata-pao` | privé (lien signé) |

## 2. Isolation

**Base séparée.** Le tenant de démo ne vit jamais dans la base de production : un
nouveau projet Supabase reçoit tout le schéma (`demo-database`, mode `initial`),
aucune donnée de production n'est lue ni copiée. Un compte visiteur, même en
cas de bug d'autorisation, ne peut donc atteindre aucun client réel.

**Deux clés.** `LEPEFY_DEPLOYMENT_KIND=demo` (variable serveur du projet Vercel)
et `tenants.is_demo = true` (colonne privée, toujours avec `is_test`, contrainte
SQL `tenants_demo_is_test`). `lib/demo/demoEnvironment.ts` :

- **bloquer** un effet réel : une seule clé suffit (`isDemoDeployment()` ; le
  tenant is_demo est aussi is_test, donc couvert par les garde-fous de la 138) ;
- **ouvrir** une fonction de démo (accueil, comptes visiteurs, console, liens) :
  les deux (`isDemoActive()`). Une seule = incohérence signalée dans la console.

Les RPC de la 167 refusent (`demo_disabled`) tant qu'aucun tenant is_demo actif
n'existe : appliquée en production, la migration reste inerte.

## 3. Aucun effet réel (garde-fous serveur)

| Canal | Garde-fou | Résultat en démo |
|---|---|---|
| Stripe (paiements, remboursements) | `getStripeSecretKey()` refuse toute clé non `sk_test_`/`rk_test_` ; webhook : évènement `livemode` refusé | mode test uniquement, carte 4242 4242 4242 4242 |
| E-mails et webhooks n8n | `sendNotification()` → `recordSimulatedMessage()` ; `sendViaBrevo()` ne part pas | « Messages simulés » (destinataire masqué) |
| WhatsApp Meta | `metaCloudProvider` : `not_configured / demo_blocked` | rien n'est envoyé |
| WhatsApp staff (Green API) | `sendGreenApiText` : échec définitif `demo_blocked` | jamais réessayé |
| WhatsApp → n8n | `dispatchWhatsAppProcessing` force le mode inline | aucun appel n8n |
| Packlink, brouillons d'expédition | `resolvePacklinkApiKey()` → `null` | forfait interne (`flat_rate`) |
| Test de notifications platform | `/api/admin/platform/notifications/test` → 409 | — |
| Nala / IA | 20 messages par heure et par connexion (`demo_rate_hit`) + limites du tenant (6/min, 300/jour) | puis `rate_limited` |
| Documents, exports | autorisés (données fictives) | — |
| Tâches planifiées (GitHub Actions, n8n) | pointent vers la production uniquement | aucune exécution sur la démo |

Les limites de fréquence de la démo sont en base (atomiques, globales, pas par
instance), sur une empreinte tronquée de l'IP (`demoBucket`) : jamais l'IP en clair.

## 4. Expérience

- `/demo` : cinq parcours (`lib/demo/tours.ts`) — boutique, événements, commandes,
  gestion commerciale, Nala. Les deux parcours admin ouvrent une visite lecture seule.
- Visite guidée : panneau en bas de l'écran (jamais un voile), réductible, quittable,
  état dans `sessionStorage` de l'onglet (`lepefy-demo-tour`). Chaque étape pointe
  vers un vrai écran ; `gap` dit les limites actuelles du produit.
- Bandeau permanent : « Démonstration · données fictives · aucun paiement ni message
  réel », carte de test, liens « Messages simulés » et « Retour à la démo ».
- Admin en visite : bandeau « Mode visite · lecture seule » avec l'heure de fin ; une
  action refusée renvoie `DEMO_READ_ONLY` et un message français explicite.
- Identité Lepefy (tokens admin V2) sur les pages `/demo`, jamais l'habillage du tenant.

**Limites dites aux visiteurs** (pas simulées) : devis chiffré et acompte hors
plateforme ; pas de calendrier des prestations privées ; pas de créneau de retrait
par commande ni de livraison locale par zone.

## 5. Scénarios

`scripts/demo/scenarios/<clé>.mjs` : données seulement. Nouveau prospect = nouveau
fichier (souvent un habillage d'un scénario existant, comme `tata-pao`).

- `traiteur-africain` : commerce fictif « Le Comptoir de Mama (exemple) », 60
  produits (plats chauds en retrait seul, épicerie livrable, promotions, nouveautés,
  petits plus), 45 clients, 120 commandes sur 90 jours, 16 avis, services traiteur et
  location, 12 demandes de devis (mariage 80 invités, anniversaire 35, entreprise 50,
  devis en attente…), 3 soirées et leurs réservations, 12 articles de location, 6
  fournisseurs, 10 achats avec réceptions et paiements (via les RPC de la 139),
  base de connaissance et sessions Nala.
- `tata-pao` : même jeu de données, nom du prospect. `requiresPrivate` : le seed
  refuse sans `DEMO_ACCESS_MODE=private`. Aucun logo, photo ni texte du site du
  prospect ; les prix et plats sont des exemples, dit dans la page « histoire ».

Identités : e-mails `@example.com`, téléphones dans la plage de fiction ARCEP
(`06 39 98 xx xx`), adresses « rue de la Démo ». Rien n'est copié d'un tenant.

Images produit : aucune au premier chargement (cartes sans photo). Pour en ajouter,
suivre `docs/STOREFRONT_PRODUCT_IMAGE_RUNBOOK.md` sur la base démo (illustrations
générées, jamais de photos du prospect).

## 6. Seed et remise à zéro

`node scripts/demo/seed-demo.mjs --scenario <clé> [--reset] [--dry-run] [--force]`

- Garde-fous : `DEMO_SUPABASE_URL` doit contenir `DEMO_SUPABASE_PROJECT_REF` ; le
  tenant visé doit être is_demo + is_test ; plan validé avant écriture
  (`lib/validatePlan.mjs` : totaux, règles de quantité, mode de réception, capacité,
  identités fictives).
- Déterministe : PRNG par scénario et version ; identifiants `stableUuid(tenant, clé)` ;
  dates relatives au jour du seed (la journée « Aujourd'hui » reste crédible).
- Idempotent : relancer le seed sur le même tenant n'insère rien. Les réglages de modules créés par
  défaut (triggers à l'insertion du tenant) sont activés, pas dupliqués.
- Variante SQL : `node scripts/demo/build-seed-sql.mjs --scenario <clé> --slug <slug> --app-url <url>`,
  même plan et mêmes RPC, refusée si le slug existe ; à exécuter lot par lot (éditeur SQL) ou d'un trait (psql).
- **Remise à zéro par rotation** : `audit_events`, mouvements de stock et finances
  fournisseurs refusent toute suppression. Le reset crée un tenant `…-next-<date>`, le
  remplit, archive l'ancien (`active = false`, slug `…-archive-<date>`), donne le slug
  au nouveau, réattribue les présentateurs, supprime les comptes visiteurs ouverts,
  puis invalide le cache (`POST /api/internal/demo/revalidate`).
- `demo_begin_reset` : refusé pendant une présentation (sauf `--force`), une seule
  remise à zéro à la fois (index unique), une remise bloquée > 30 min est déclarée échouée.
- Nuit : `demo-reset` à 02:00 UTC, sur `demo` et `demo-private` ; s'abstient si une
  présentation est en cours ou si l'environnement GitHub n'est pas configuré.
- Les tenants archivés s'accumulent dans la base démo : la recréer (mode `initial`
  sur un projet vidé) quand le volume gêne. Jamais en production.

## 7. Sessions

- Visiteur : `visiteur-<id>@demo.invalid`, mot de passe aléatoire jamais montré,
  rôle `demo_visitor` (capabilities `*.view` listées dans `lib/demo/visitorPermissions.ts`,
  miroir de la 167), 4 heures (`demo_visitor_accounts.expires_at`, 12 h max en SQL).
  `getAdminAccessContext` refuse une visite expirée ; les comptes expirés sont supprimés
  à l'ouverture d'une nouvelle visite et à chaque remise à zéro. 6 visites par heure
  et par connexion.
- Présentateur : compte Lepefy nommé, `tenant_admin` du tenant de démo
  (`DEMO_PRESENTER_EMAILS`), créé une fois depuis `/admin/team` de la démo.
- Présentation : « Démarrer une présentation » dans la console (2 h, prolongeable,
  8 h max) bloque toute remise à zéro.

Aucune session isolée par visiteur : le tenant est fixé par déploiement
(`NEXT_PUBLIC_TENANT_SLUG`). La lecture seule des visiteurs garde le jeu de données
propre ; seules les commandes de test de la boutique s'ajoutent, effacées la nuit.

## 8. Acquisition

« Demander ma propre boutique » : nom du commerce, ville, e-mail ou téléphone,
message, intérêts, consentement explicite non pré-coché (version
`DEMO_REQUEST_CONSENT_VERSION`), champ piège anti-robot, 3 demandes par heure et
par connexion. Aucun e-mail automatique, ni au prospect ni à l'équipe : la console
démo liste les demandes (Nouvelles / Contactées / Closes, note de suivi). Durée de
conservation annoncée : 12 mois — supprimer les demandes plus anciennes à la main.

## 9. Mise en service (une fois)

1. **Supabase** : créer le projet `lepefy-demo` (région UE). Noter la référence du projet.
2. **GitHub → Settings → Environments → `demo`** :
   - secrets `DEMO_DATABASE_URL` (connexion Postgres du projet démo),
     `DEMO_SUPABASE_URL`, `DEMO_SUPABASE_SERVICE_ROLE_KEY`, `DEMO_INTERNAL_TOKEN` ;
   - variables `DEMO_SUPABASE_PROJECT_REF`, `DEMO_TENANT_SLUG=lepefy-demo`,
     `DEMO_SCENARIO=traiteur-africain`, `DEMO_ACCESS_MODE=public`,
     `DEMO_APP_URL=https://demo.lepefy.com`, `DEMO_PRESENTER_EMAILS`.
3. Workflow **Demo database**, mode `initial`, confirmation `DEMO`.
4. Workflow **Demo seed** en dry-run, puis réel.
5. **Vercel** : projet `lepefy-demo`, Root Directory `apps/storefront`, variables :
   `LEPEFY_DEPLOYMENT_KIND=demo`, `DEMO_ACCESS_MODE`, `DEMO_ACCESS_SECRET` (≥ 32
   caractères), `DEMO_INTERNAL_TOKEN`, `NEXT_PUBLIC_TENANT_SLUG=lepefy-demo`,
   `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_EVENTS_SUBDOMAIN=evenements.demo.lepefy.com`,
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
   **du projet démo**, `STRIPE_SECRET_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` **de test**,
   `STRIPE_WEBHOOK_SECRET` (webhook de test), `TRACKING_SECRET` propre,
   `N8N_WEBHOOK_URL=https://n8n.demo.invalid` (jamais contacté : il active seulement
   l'enregistrement des messages simulés), clé du fournisseur IA dédiée avec plafond
   de dépense, `GOTENBERG_URL` / `GOTENBERG_AUTH` si les PDF doivent fonctionner.
   **Jamais** : `PACKLINK_API_KEY`, `BREVO_API_KEY`, `META_*`, `GREEN_API_*`,
   `STRIPE_SECRET_KEY_TEST`, `E2E_TEST_SECRET`, clé Stripe live, secrets de production.
   Ignored Build Step comme `lepefy-food-test` (production uniquement).
6. Auth du projet démo : URL du site et URL de redirection = domaine de la démo
   (comptes clients de la boutique, invitations admin).
7. Routage IA : créer provider, modèle et politique `nala / structured_chat` dans
   `/admin/platform/ai-routing` **de la démo** (registre vide au départ).
8. Premier platform owner de la démo : Supabase Dashboard → Auth → Users + ligne
   `admin_users` (comme en production) ; puis les présentateurs via `/admin/team`.
9. Démo privée : second projet Vercel, environnement GitHub `demo-private`
   (`DEMO_TENANT_SLUG=demo-tata-pao`, `DEMO_SCENARIO=tata-pao`, `DEMO_ACCESS_MODE=private`),
   liens créés depuis la console (« Lien d'accès privé », 1 à 7 jours).

**Nouvelle migration** : l'appliquer à la démo avec **Demo database**, mode
`migration`, fichier = nom du fichier (même fichier que la production).

## 10. Vérification

- `pnpm test:unit` → `tests/unit/demoExperience.spec.ts` : clés, Stripe live refusé,
  e-mails/n8n/WhatsApp/Packlink bloqués sans réseau, parité du rôle visiteur, aucune
  API admin d'écriture accessible au visiteur, étapes admin de la visite ouvertes au
  visiteur, lien signé, formulaire, plan de seed déterministe et fictif, refus d'une
  base qui n'est pas la démo, schéma démo complet.
- CI : `supabase/tests/167_demo_experience.*` (rôle, RPC inertes sans démo, limite,
  bail, réinitialisation unique, privilèges).
- Après mise en service : parcours boutique (commande de test → message simulé),
  événements (devis, réservation de test), visite admin (action refusée), console
  (présentation, lien privé, demande), remise à zéro manuelle hors présentation.

## 11. Dépannage

| Symptôme | Cause probable |
|---|---|
| `/demo` en 404 | une des deux clés manque (variable Vercel ou `is_demo`) ; voir la console |
| Paiement impossible, erreur « clé Stripe live refusée » | clé live sur le projet démo : remettre les clés de test |
| « La visite n'a pas pu s'ouvrir » | rôle `demo_visitor` absent (167 non appliquée) ou Auth admin indisponible |
| Remise à zéro « reportée » | présentation en cours (console → Terminer) |
| `demo_reset_running` | une remise à zéro tourne ou a planté : attendre 30 min ou lancer avec `force` |
| Pages encore à l'ancien tenant après un reset | `DEMO_APP_URL`/`DEMO_INTERNAL_TOKEN` absents : le cache expire seul (1 h) |
| Nala répond « rate_limited » | limite par connexion (20/h) ou du tenant (300/jour) atteinte |
