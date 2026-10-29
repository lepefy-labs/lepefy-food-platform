-- 173 — Lepefy Auth Mailer (multi-tenant Auth emails via Supabase Send Email Hook).
--
-- Additive only: no existing table or tenant behaviour changes. A tenant with no
-- settings row gets safe defaults (sender = official tenant name, language from
-- tenants.locales, enabled). The hook stays inactive until the platform owner
-- switches it on in Supabase; this migration alone changes nothing.
--   * tenant_auth_mail_settings: platform-owner overrides (sender name, language).
--   * auth_mail_log: technical audit, never an OTP, token, link or address.
-- Both tables: RLS on, no policy; service_role only (Edge Function + platform
-- pages). Rollback: supabase/rollback/173_auth_mailer.psql.

begin;

create table if not exists public.tenant_auth_mail_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default true,
  sender_name_override text check (sender_name_override is null or char_length(sender_name_override) between 2 and 60),
  language text check (language is null or language in ('fr', 'it', 'en')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.auth_mail_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  tenant_id uuid,
  kind text check (kind is null or kind in ('customer', 'admin', 'platform', 'deletion')),
  email_action_type text,
  provider text not null default 'resend',
  outcome text not null check (outcome in ('accepted', 'failed', 'rejected', 'skipped')),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 100),
  correlation_id text check (correlation_id is null or char_length(correlation_id) <= 64)
);

create index if not exists auth_mail_log_created_idx on public.auth_mail_log (created_at desc);
create index if not exists auth_mail_log_tenant_idx on public.auth_mail_log (tenant_id, created_at desc);

alter table public.tenant_auth_mail_settings enable row level security;
alter table public.auth_mail_log enable row level security;

revoke all on public.tenant_auth_mail_settings from public, anon, authenticated;
revoke all on public.auth_mail_log from public, anon, authenticated;
grant select, insert, update on public.tenant_auth_mail_settings to service_role;
grant select, insert on public.auth_mail_log to service_role;
grant usage on sequence public.auth_mail_log_id_seq to service_role;

commit;
