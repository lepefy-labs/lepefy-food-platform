# Lepefy Admin — PWA installabile e origine admin canonica

Stato: implementata, spenta finché non si configurano le variabili sotto (nessun cambio di comportamento senza `ADMIN_HOST`). Nessuna migration.

## Cosa è
Una sola app installabile per tenant, **Lepefy Admin** (identità Lepefy, non del tenant; il tenant è riconoscibile nell'header admin), con i workspace Boutique (`/admin`) ed Événementiel (`/admin/evenementiel`) sulla stessa origine. La PWA storefront (`app/manifest.webmanifest/route.ts`, `public/sw.js`) è invariata.

## Manifest e metadata
- `lib/admin/adminManifest.ts` → route `app/admin/manifest.webmanifest/route.ts` (statica, senza DB né auth). `id` `/admin`, `start_url` `/admin?source=pwa`, `scope` `/admin` (senza slash finale: lo `start_url` deve starci dentro), standalone, tema `#6D5AF6`.
- Icone: `public/brand/admin-192.png`, `admin-512.png`, `admin-maskable-512.png`, `admin-apple-180.png` (sorgente `lepefy-admin-icon.svg`, rigenerabili con sharp).
- `app/admin/layout.tsx` sovrascrive `manifest`, `icons`, `appleWebApp`, `viewport.themeColor` del root layout. Il root layout dichiara apple-touch-icon e theme-color come metadata (non più `<head>` a mano) proprio per consentire l'override. Il manifest storefront è una route handler: il file `app/manifest.ts` avrebbe la precedenza sul campo `manifest`.
- Service worker: resta `public/sw.js` network-only senza handler `fetch`; nessuna cache di HTML o dati autenticati.
- Installazione: `AdminInstallPrompt` (prompt nativo Android/desktop, istruzioni Safari su iPhone/iPad, nascosto se già installata, rimando 30 giorni).

## Workspace
`resolveAdminWorkspace(host, pathname)`: `/admin/evenementiel/**` è events, il resto shop; l'host eventi legacy mappa ancora tutto l'admin su events. Il layout protetto usa il path; `defaultAdminDestination` indirizza un collaboratore con un solo workspace in quello che ha (opzione `onLegacyEventsHost`). Il cambio workspace è un link completo (il layout non si rirenderizza in navigazione soft). `lepefy_admin_ws` (cookie UX, path `/admin`) viene letto dal middleware solo con `/admin?source=pwa`; i permessi sono sempre verificati dal server.

## Domini (variabili server, lette a build time per i redirect)
- `ADMIN_HOST`: origine canonica (`admin.<dominio-tenant>`). Imposta link workspace relativi, redirect `/` e pagine storefront → `/admin` su quell'host (`adminHostRedirects.mjs`).
- `ADMIN_FALLBACK_HOST`: indirizzo Lepefy; redirect **307** (temporaneo, ritirabile) verso l'host canonico. Se il dominio custom non è disponibile: rimuovere `ADMIN_HOST` e rifare il deploy, il fallback torna a servire direttamente. Nessun failover automatico.
- `ADMIN_LEGACY_REDIRECT=1`: `/admin/**` sul dominio storefront → host canonico (esclusa `/admin/accept-invite`, il token è nel fragment). Spento di default; accenderlo solo dopo il periodo di coesistenza.
- Sessione: cookie Supabase host-only, nessun `domain` condiviso. Il primo accesso sul nuovo host richiede un login. Una PWA installata non è mai autenticata di per sé.
- DNS e alias Vercel sono azioni manuali fuori dal repository (alias del dominio sul progetto del tenant). Schema fallback `{tenant}.admin.lepefy.com` richiede wildcard `*.admin.lepefy.com` e certificato; alternativa `admin-{tenant}.lepefy.com`.

## Scanner
`/admin/evenementiel/scan` (pagina autonoma, `scan.access`, token admin); `/scan` e le vecchie URL reindirizzano lì mantenendo `event_id`.

## Separazione futura (Owner Admin)
Nessuna dipendenza nuova: le route `/admin/platform/**` restano dietro `platform.access`; un futuro `owner.lepefy.com` avrà manifest e `id` propri.

## Test
`tests/unit/adminPwa.spec.ts`, `adminNavigation.spec.ts`.
