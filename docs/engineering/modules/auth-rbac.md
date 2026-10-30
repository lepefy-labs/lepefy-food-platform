---
id: eng-module-auth-rbac
titolo: Auth e RBAC
modulo: auth-rbac
categoria: Sicurezza
stato: parziale
owner: Platform Owner
file_monitorati: [apps/storefront/src/lib/auth/requireAdmin.ts, apps/storefront/src/lib/auth/requirePlatformOwner.ts, apps/storefront/src/lib/audit/eventCatalog.ts, docs/ADMIN_RBAC_PERMISSIONS.md, docs/AUTH_MAILER_MULTITENANT.md, docs/ADMIN_ACTIVITY_AUDIT.md]
---

# Auth e RBAC

> Bozza iniziale derivata dalla documentazione di progetto (`CLAUDE.md`, `docs/`). **Non verificata da una persona**: lo stato resta «Parziale» finché una revisione non la lega a uno SHA.

## Scopo

Accesso alla console admin con Supabase Auth (e-mail e password), ruoli e permessi dinamici, guardie delle API, inviti degli admin, e-mail di autenticazione per tenant e giornale d'attività.

## Punti di ingresso

- Guardia di ogni API admin: `apps/storefront/src/lib/auth/requireAdmin.ts` (il `platform_owner` passa sempre; gli altri ruoli devono essere nella lista `allowedRoles` **e** combaciare con il tenant della route).
- Guardia solo-owner: `apps/storefront/src/lib/auth/requirePlatformOwner.ts` (console piattaforma, Engineering Hub).
- Layout protetto: `app/admin/(protected)/layout.tsx` verifica la sessione e la riga attiva in `admin_users`; il controllo di navigazione nascosta è solo UX.
- Login: `POST /api/admin/login` imposta i cookie di sessione sulla risposta; invito admin: `POST /api/admin/team/invite`.

## Invarianti

- `admin_users` non ha policy pubblica: lo legge solo il service role.
- I client `createServerClient` devono fornire `get/set/remove/getAll/setAll` (versione `@supabase/ssr` 0.3.x), altrimenti la sessione fallisce in silenzio.
- `canAdmin()` lascia passare un `tenant_admin` per ogni permesso che non inizia con `platform.`: per capability riservate alla piattaforma non va usato (vedi `docs/engineering/SECURITY.md`).
- Il giornale `audit_events` è append-only; gli attori arrivano dagli header `x-lepefy-audit-*` impostati da `createServiceClient()` solo sulle scritture.
- Le e-mail di autenticazione risolvono il tenant solo dal contesto firmato `lctx`, mai dall'indirizzo e-mail.

## Dati

Tabelle `admin_users`, ruoli e permessi (migration 039, 085–087, 173), `audit_events` e catalogo tipi (153).

## Limiti noti

Il documento non descrive ancora la matrice completa dei permessi: la fonte è `docs/ADMIN_RBAC_PERMISSIONS.md`.
