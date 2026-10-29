# Lepefy Auth Mailer (multi-tenant Auth emails)

Reviewed base: `cf107483` (2026-10-29). Status: **live in production since 2026-10-29** (migration 173, function `auth-mailer`, Send Email hook enabled; customer and admin OTP verified with real emails; platform-owner and account-deletion emails not yet exercised).

## 1. Architecture

```
storefront / admin  ──signInWithOtp(emailRedirectTo = …?lctx=<signed context>)──▶ Supabase Auth
Supabase Auth: generates the OTP, expiry, verification, sessions
        └─ Send Email Hook (HTTPS, Standard Webhooks) ──▶ Edge Function `auth-mailer`
                 verify signature → verify context → load tenant → render → Resend
```

Supabase keeps OTP generation, validity, verification and sessions. The Edge Function (Deno, `supabase/functions/auth-mailer/index.ts`) only resolves the tenant, renders FR/IT/EN HTML + text and calls Resend. Edge Function rather than Vercel: same network as Auth (hook budget is a few seconds), no extra public endpoint, the signed webhook is the only entry.

Code layout (single source of truth, tested in the storefront):

- `apps/storefront/src/lib/authMailer/core/*` — pure TS, Web Crypto only (`webhook`, `contextToken`, `payload`, `sender`, `templates`, `resend`, `handler`).
- `supabase/functions/_shared/authMailer/*` — GENERATED copy (`node apps/storefront/scripts/syncAuthMailer.mjs`; `--check`; a unit test fails when stale). Run it after any change to `core/`.
- `src/lib/authMailer/otpContext.ts` — storefront side: builds `emailRedirectTo` with the context.
- Migration `173_auth_mailer.sql` (+ `supabase/rollback/173_auth_mailer.psql`); platform page `/admin/platform/notifications/auth-mail`.

## 2. Tenant context (the critical part)

The tenant is **never** inferred from the recipient, `user_metadata` or a last-tenant lookup. The server that calls `signInWithOtp` knows the tenant (customer: the deployment's tenant; admin: the deployment tenant when the user has access to it via `getAdminAccessContext`, else the legacy `admin_users.tenant_id`; platform owner: none) and signs a context into the `redirect_to` URL, which Supabase returns unchanged as `email_data.redirect_to`:

`lctx = base64url(claims) . base64url(HMAC-SHA256(secret, "lepefy-auth-mail.v1." + claims))`

Claims: `v`, `tid` (canonical tenant id, `null` only for `platform`), `kind` (`customer|admin|platform|deletion`), `cid` (correlation id), `iat`, `exp` (10 min), `eh` (keyed hash of the recipient address), optional `ws`.

Hook fail-closed rules (nothing is sent, Supabase gets a 4xx/5xx, the user sees a generic failure): context missing, malformed, bad signature, expired, not yet valid, recipient not matching `eh`, invalid claims, tenant unknown, inactive, or mail disabled for the tenant. Two concurrent requests for the same address on two tenants carry two different contexts, so they cannot cross.

Residual risks: (a) a captured context can be replayed within 10 min but only for the same address and tenant (it can only trigger that tenant's email for that address); (b) there is no server-side nonce registry (not needed for integrity; a registry would add a DB round-trip per email); (c) **to verify at cutover**: GoTrue must keep the `redirect_to` query intact, which requires the storefront/admin origins in Auth → URL Configuration → Redirect URLs (e.g. `https://shop.chloefood.com/**`). If GoTrue replaces it with the Site URL the hook fails closed and the smoke test catches it (rollback §8).

## 3. Hook behaviour

Method POST only; Standard Webhooks signature (`webhook-id/timestamp/signature`, `v1,whsec_` secret, 5 min tolerance); payload validated; action routed:

- `magiclink`, `email`, `signup`: login code (customer, admin, platform) or account-deletion code (`kind=deletion`);
- `reauthentication`: confirmation code;
- `email_change`: secure mode → two emails (current address gets `token`, new address gets `token_new`; hash field names are crossed by Supabase and unused here); non-secure → one email to `new_email`;
- `invite`, `recovery`: button with `<SUPABASE_URL>/auth/v1/verify?token=<hash>&type=…&redirect_to=…` (today the team invite uses `createUser`, no Auth email; recovery is not used by the app);
- `*_notification`: acknowledged (200) without sending; unknown action: rejected.

Success (200) is returned only after Resend answered 2xx **with a message id** (accepted ≠ delivered). Provider errors → 502 `email_provider_failed`; timeout 4 s (`provider_timeout`). Duplicates: the Resend `Idempotency-Key` is `auth-mail/<webhook-id>/<role>`, so a Supabase retry of the same hook call does not send twice; two separate OTP requests are two legitimate emails. Residual: if Resend accepts but the response is lost, Supabase's retry is absorbed by the idempotency key (24 h Resend window); a retry after that window would send again.

Logs: no OTP, token, hash, link, address or secret is logged or stored (tested). The function has no `console.*`.

## 4. Sender identity

From: `"<Tenant name>" <no-reply@auth.lepefy.com>`. The address is fixed to the verified technical domain (`AUTH_MAIL_FROM_ADDRESS` is accepted only if it ends with `@auth.lepefy.com`); tenants cannot set an address. The name comes from `tenants.name` or the platform-owner override `tenant_auth_mail_settings.sender_name_override`, sanitised (control/bidi chars, `<>"\@;:,`, URL-like or address-like names → `Lepefy`, max 60). Platform owner sign-in: `Lepefy`.

## 5. Templates

Table-based responsive HTML + plain text, no tracking pixel, https-only logo, brand colour validated (`#rrggbb`, text colour chosen for contrast), large monospaced code, footer “Connexion sécurisée par Lepefy” (IT/EN equivalents). Chloe Food subject: “Ton code de connexion” (tutoiement, simple French). Language: platform override → `tenants.locales[0]` → `tenants.locale` → `fr`. Expiry sentence only if `AUTH_OTP_EXPIRY_MINUTES` is set to the real Auth value (otherwise nothing is promised). Add a language/purpose = one entry in `COPY` (`templates.ts`) then sync.

## 6. Data (migration 173, additive)

- `tenant_auth_mail_settings(tenant_id pk, enabled, sender_name_override, language, updated_at, updated_by)` — no row = defaults, so existing and new tenants work with no setup.
- `auth_mail_log(created_at, tenant_id, kind, email_action_type, provider, outcome accepted|failed|rejected|skipped, error_code, duration_ms, provider_message_id, correlation_id)`.
- RLS enabled, no policy, `service_role` only. No retention job yet (rows are small; add a purge before the volume matters).

The platform page shows technical sends only (accepted / failed / rejected, success rate, by type and by tenant) and a preview. Delivery/open data would come from Resend webhooks (not wired): until then nothing claims delivery. Settings are changed in SQL by the platform owner (`insert … on conflict`); there is no edit UI/API yet.

## 7. Secrets and configuration (names only)

Edge Function (`supabase secrets set`): `SEND_EMAIL_HOOK_SECRET` (the `v1,whsec_…` from Auth → Hooks), `AUTH_MAILER_CONTEXT_SECRET`, `RESEND_API_KEY`; optional `AUTH_MAIL_FROM_ADDRESS`, `AUTH_OTP_EXPIRY_MINUTES`. Injected: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
Storefront / admin (Vercel): `AUTH_MAILER_CONTEXT_SECRET` (same value), `AUTH_MAILER_CONTEXT_ENABLED=1` (**set only at cutover**; without it no `emailRedirectTo` is sent and nothing changes), `NEXT_PUBLIC_APP_URL`.
Deploy: `supabase functions deploy auth-mailer --no-verify-jwt` (the hook is authenticated by its signature, not a JWT).

## 8. Cutover and rollback

Before: Resend domain `auth.lepefy.com` verified; snapshot the current Auth SMTP settings (Dashboard → Auth → SMTP) and Redirect URLs; apply migration 173; deploy the function; set secrets; add redirect URLs.
Cutover: set `AUTH_MAILER_CONTEXT_ENABLED=1` and redeploy the storefront; in Auth → Hooks enable “Send Email” → HTTPS/Edge Function `auth-mailer`. Smoke test with own addresses: customer OTP (sender “Chloe Food”), verify code → session, admin login, deletion code; check `auth_mail_log` and function logs.
Rollback (minutes, sessions untouched): disable the Send Email hook (Auth reverts to SMTP) → unset `AUTH_MAILER_CONTEXT_ENABLED` → redeploy. The redirect context is harmless to SMTP emails. Optional data rollback: `supabase/rollback/173_auth_mailer.psql`.

## 9. Test evidence and limits

`tests/unit/authMailer.spec.ts` (24 tests): OTP Chloe/second tenant, same email on two tenants concurrently, repeated OTP and retry idempotency keys, inactive/unknown tenant, expired/tampered/missing context, wrong recipient, invalid webhook signature, provider failure/timeout, admin/platform, signup/existing user, email change (1 and 2 emails), notifications, FR/IT/EN, escaping/branding, no secrets in audit, generated copy in sync.
**Not done from this workstation:** a real end-to-end run against GoTrue (no Supabase access token, Docker or CLI here), real Resend delivery, and the production cutover. The actual hook payload transport (`redirect_to` preserved) is therefore verified only against Supabase's documented schema; it must be proven in a staging/real project before activating (§2c).

## 10. Troubleshooting

- Users get “erreur” on login after cutover: `auth_mail_log` `outcome=rejected` with `context_*` → `AUTH_MAILER_CONTEXT_SECRET` differs between Vercel and the function, or the redirect URL is not allow-listed (`context_missing`).
- `signature_*` rejections are not logged in the table (unauthenticated); read the function logs/status codes. `signature_bad_signature` → wrong `SEND_EMAIL_HOOK_SECRET`.
- `failed` with `provider_http_403/422`: Resend domain/sender; `provider_http_429`: rate limit; `provider_timeout`: Resend slow (Auth surfaces an error, the user retries).
- Wrong language/name: check `tenants.locales/name` and `tenant_auth_mail_settings`.

## 11. Costs

No new paid service: Resend (already in use), Supabase Edge Function invocations (one per Auth email). Per email: 2 small PostgREST reads (tenant + settings) and 1 insert; no polling, no logo fetching server-side (the logo is a remote https URL in the email).
