# PWA — Smart refresh e ciclo di vita (storefront + Lepefy Admin)

Stato: implementata. Nessuna migration, nessuna modifica a pagamenti, auth, webhook o schema. Spegnimento senza deploy: vedi «Rollback».

## Quattro livelli distinti
| Livello | Cosa | Dove |
|---|---|---|
| Service worker | `registration.update()`. Il worker (`public/sw.js`) resta **network-only**, senza handler `fetch`: nessuna cache HTML/RSC/chunk da invalidare. | `PwaLifecycle.tsx` (`updateServiceWorker`) |
| Versione app | Confronto tra la versione del bundle (`NEXT_PUBLIC_APP_VERSION` = `VERCEL_GIT_COMMIT_SHA` a build time) e quella servita da `GET /api/app-version`. | `lib/pwa/versionCheck.ts`, `app/api/app-version/route.ts` |
| Dati | `router.refresh()` (solo Server Component della route corrente, stato client intatto). Carrello: motore esistente (`cartSyncEngine`), non toccato. | controller → `refreshData` |
| Reload completo | `location.reload()` solo per nuova versione / chunk mancante, solo se «sicuro», al massimo una volta per target ogni 30 min. | controller → `reload` |

`registration.update()` non è mai considerato un refresh della UI.

## File
- `lib/pwa/lifecycle.ts` — controller puro (dipendenze iniettate, testato in `tests/unit/pwaLifecycle.spec.ts`).
- `lib/pwa/busyRegistry.ts` + `useBusyLock.ts` — registro dei blocchi «non ricaricare».
- `lib/pwa/activityTracker.ts` — rileva lavoro non registrato: campi di form modificati e scritture (POST/PUT/PATCH/DELETE) in volo (wrapper trasparente di `window.fetch`, nessuna modifica a richieste/risposte).
- `components/pwa/PwaLifecycle.tsx` — montato una volta nel root layout (sostituisce `PWARegister`): registra il SW, collega gli eventi, mostra il banner.
- `app/api/app-version/route.ts` — `{ v: <sha> }`, `no-store`, nessun DB, nessun tenant, nessun cookie.

## Quando agisce
Eventi: avvio, `visibilitychange` (visibile), `pageshow` con `persisted`, `online`; `focus` solo come ripiego desktop. Un'unica finestra di dedupe di 1 s evita che i tre eventi simultanei producano tre azioni. Nessun `setInterval`.

| Assenza in background | Azione |
|---|---|
| < 30 s | niente |
| ≥ 30 s | update SW + controllo versione (throttle 5 min) |
| ≥ 30 min | + `router.refresh()` (se non occupato) |
| ≥ 6 h | + rivalidazione sessione cliente (solo storefront; admin: il layout protetto rivalida con il refresh) |

All'avvio a freddo: update SW + controllo versione (nessun refresh dati: l'HTML è appena stato caricato). Offline: nessuna richiesta, il lavoro è ripreso una volta all'evento `online`.

## Criteri di sicurezza (reload automatico solo se TUTTI veri)
1. nessun blocco nel registro (checkout montato, form di pagamento Stripe, form admin con modifiche non salvate via `useUnsavedChangesGuard`/`useBusyLock`);
2. nessun campo di form modificato ancora in pagina e nessuna scrittura in volo (`activityTracker`);
3. route non critica (`/checkout`, `/pay`, `/order-confirmation`, `/panier/retrouver`) — in aggiunta, mai al posto, dei blocchi reali;
4. nessuna mutazione del carrello non sincronizzata (`pendingMutations`); il pulsante «Mettre à jour» fa prima il flush;
5. admin: nessun form modificabile montato (policy più prudente: solo banner);
6. la guardia anti-loop (`sessionStorage` `lepefy:pwa-reload`, per target) non ha già ricaricato per lo stesso target negli ultimi 30 min. Senza `sessionStorage` il reload automatico è disattivato.

Se non sicuro: banner discreto «Une nouvelle version est disponible» con «Mettre à jour» / chiusura. Al rilascio di un blocco, dopo 2 s, se ancora sicuro il reload parte da solo. Nulla cancella cache, cookie, sessioni o localStorage.

ChunkLoadError: stessa strada (target `chunk-error`, stessi criteri), non più `location.replace` incondizionato.

## Storefront vs admin
Un solo controller, policy per scope (`scopeForPath`): `/admin/**` = admin. Il flag anti-loop vive in `sessionStorage` (per origine/scheda). Il polling ordini admin (18 s) rispetta il registro e riapplica il refresh al rilascio del blocco.

## Costo e comportamento in errore
- Controllo versione: ~60 byte, 1 invocazione di Vercel Function, **0 Supabase**, 0 immagini. Max 1 ogni 5 min per scheda tornata in primo piano (ordine di una decina al giorno per utente attivo), 8 s di timeout.
- Rivalidazione sessione: 1 chiamata a `/api/auth/session`, solo dopo ≥ 6 h.
- `router.refresh()`: 1 per ritorno dopo ≥ 30 min; usa le Data Cache/ISR esistenti (nessun download del catalogo, nessuna invalidazione immagini).
- Errore di rete / timeout / 5xx / JSON non valido: `null`, silenzioso, nessun retry (il throttle copre anche i fallimenti); si riprova al prossimo ritorno o all'evento `online`.
- Versione del bundle vuota (sviluppo locale, build fuori Vercel): sistema inerte.

## Rollback
Revert del commit. Spegnimento senza deploy: rimuovere `VERCEL_GIT_COMMIT_SHA` non è possibile su Vercel; in alternativa far restituire `{ v: '' }` dalla route (il client ignora versioni vuote) con un deploy minimo.

## Piattaforme
Verificato da test unitari (logica pura con orologio/storage simulati). **Non verificato su dispositivi**: Android Chrome PWA, iPhone PWA da Home, connessioni lente reali. Note: su iOS non esiste un evento universale di «riapertura»; `visibilitychange`/`pageshow(persisted)` sono i segnali migliori, `focus` è inaffidabile. Se il sistema ripristina l'app senza alcun evento, il controllo avviene al primo evento successivo (navigazione/ritorno).

## Test
`tests/unit/pwaLifecycle.spec.ts`: nessun aggiornamento, nuova versione, background breve/lungo, checkout attivo, admin con modifiche non salvate, carrello, sessione, offline/ritorno online, errore di rete, SW obsoleto, anti-loop (versione e chunk), nessuna scrittura da parte dei controlli, scope separati.
