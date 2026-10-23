-- 167_demo_experience.sql
-- Demo Experience (docs/DEMO_EXPERIENCE.md) : un tenant de démonstration qui
-- utilise le vrai produit, sans effet réel. Appliquée d'abord au projet
-- Supabase SÉPARÉ de la démo ; appliquée aussi en production pour garder le
-- même schéma, où tout reste vide et inactif (aucun tenant is_demo).
--
-- 1. tenants.is_demo : deuxième clé de la démo (la première est la variable
--    serveur LEPEFY_DEPLOYMENT_KIND=demo). Un tenant de démo est aussi un
--    tenant de test (is_test) : il hérite de tous les garde-fous de la 138.
--    Colonne PRIVÉE : aucun grant de colonne (voir 076), lue côté serveur.
-- 2. Rôle système demo_visitor : lecture seule (capabilities *.view), jamais
--    platform.*, jamais une action. Les comptes visiteurs sont éphémères
--    (demo_visitor_accounts.expires_at), un par visite.
-- 3. Tables de pilotage, RLS forcée sans policy, service role uniquement :
--    présentations (bail qui bloque la réinitialisation), réinitialisations,
--    demandes « Demander ma propre boutique » (avec consentement), compteurs
--    agrégés (jour × évènement, aucune donnée personnelle), messages simulés,
--    limites de fréquence.
-- 4. RPC atomiques : demo_rate_hit, demo_count_event, demo_start_presentation,
--    demo_begin_reset / demo_finish_reset. Toutes refusent ('demo_disabled')
--    tant qu'aucun tenant is_demo n'existe : en production elles ne font rien.
--
-- Additive et rejouable. Rollback :
--   drop function if exists public.demo_finish_reset(uuid, text, text, uuid, uuid);
--   drop function if exists public.demo_begin_reset(text, text, boolean);
--   drop function if exists public.demo_start_presentation(uuid, text, integer);
--   drop function if exists public.demo_count_event(text);
--   drop function if exists public.demo_rate_hit(text, integer, integer);
--   drop table if exists public.demo_rate_hits, public.demo_simulated_messages,
--     public.demo_event_counts, public.demo_requests, public.demo_resets,
--     public.demo_presentations, public.demo_visitor_accounts;
--   delete from public.admin_roles where code = 'demo_visitor';
--   alter table public.tenants drop constraint if exists tenants_demo_is_test;
--   alter table public.tenants drop column if exists is_demo;

begin;

-- ─── 1. tenants.is_demo ──────────────────────────────────────────────────────
alter table public.tenants
  add column if not exists is_demo boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_demo_is_test') then
    alter table public.tenants
      add constraint tenants_demo_is_test check (not is_demo or is_test);
  end if;
end $$;

comment on column public.tenants.is_demo is
  'Tenant de démonstration (167). Toujours is_test. Démo active seulement si le déploiement '
  'a aussi LEPEFY_DEPLOYMENT_KIND=demo (lib/demo/demoEnvironment.ts). Privée : jamais exposée au navigateur.';

-- ─── 2. Rôle demo_visitor ────────────────────────────────────────────────────
insert into public.admin_roles (code, name, description, scope, is_system, active)
values ('demo_visitor', 'Visiteur de la démo', 'Visite en lecture seule de l’environnement de démonstration. Aucune action.', 'tenant', true, true)
on conflict (code) do update set name = excluded.name, description = excluded.description, scope = 'tenant', is_system = true, active = true;

-- Liste miroir de DEMO_VISITOR_PERMISSIONS (lib/demo/visitorPermissions.ts, test de parité).
delete from public.admin_role_permissions
where role_id = (select id from public.admin_roles where code = 'demo_visitor');

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_roles r
join public.admin_permissions p on p.key in (
  'orders.view', 'catalog.view', 'customers.view', 'campaigns.view', 'reviews.view', 'shipping.view',
  'events.view', 'event_reservations.view', 'event_payments.view',
  'suppliers.view', 'purchases.view', 'inventory.view', 'treasury.view', 'ai_usage.view'
)
where r.code = 'demo_visitor'
on conflict do nothing;

-- ─── 3. Tables de pilotage ───────────────────────────────────────────────────
create table if not exists public.demo_visitor_accounts (
  user_id    uuid primary key references public.admin_users(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint demo_visitor_accounts_window check (expires_at > created_at and expires_at <= created_at + interval '12 hours')
);
create index if not exists demo_visitor_accounts_expires_idx on public.demo_visitor_accounts (expires_at);

create table if not exists public.demo_presentations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete set null,
  started_by  text not null check (char_length(started_by) between 1 and 200),
  label       text check (label is null or char_length(label) <= 120),
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ended_at    timestamptz,
  constraint demo_presentations_window check (expires_at > started_at and expires_at <= started_at + interval '8 hours')
);
create index if not exists demo_presentations_active_idx on public.demo_presentations (expires_at) where ended_at is null;

create table if not exists public.demo_resets (
  id            uuid primary key default gen_random_uuid(),
  scenario      text not null check (scenario ~ '^[a-z][a-z0-9-]{1,63}$'),
  requested_by  text not null check (char_length(requested_by) between 1 and 200),
  status        text not null default 'running' check (status in ('running', 'done', 'failed')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  old_tenant_id uuid,
  new_tenant_id uuid,
  detail        text check (detail is null or char_length(detail) <= 2000)
);
-- Une seule réinitialisation à la fois.
create unique index if not exists demo_resets_one_running on public.demo_resets ((true)) where status = 'running';

create table if not exists public.demo_requests (
  id              uuid primary key default gen_random_uuid(),
  business_name   text not null check (char_length(business_name) between 2 and 160),
  city            text check (city is null or char_length(city) <= 120),
  contact_email   text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone   text check (contact_phone is null or char_length(contact_phone) <= 40),
  message         text check (message is null or char_length(message) <= 1000),
  interests       text[] not null default '{}' check (interests <@ array['shop', 'events', 'orders', 'management', 'nala']),
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  consent_at      timestamptz not null default now(),
  status          text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  handled_note    text check (handled_note is null or char_length(handled_note) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint demo_requests_contact check (contact_email is not null or contact_phone is not null)
);
create index if not exists demo_requests_status_idx on public.demo_requests (status, created_at desc);

create table if not exists public.demo_event_counts (
  day       date not null,
  event_key text not null check (event_key ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  count     integer not null default 0 check (count >= 0),
  primary key (day, event_key)
);

create table if not exists public.demo_simulated_messages (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references public.tenants(id) on delete cascade,
  channel        text not null check (channel in ('email', 'whatsapp', 'n8n', 'shipping')),
  kind           text not null check (char_length(kind) between 1 and 120),
  recipient_hint text check (recipient_hint is null or char_length(recipient_hint) <= 120),
  subject        text check (subject is null or char_length(subject) <= 300),
  preview        text check (preview is null or char_length(preview) <= 2000),
  created_at     timestamptz not null default now()
);
create index if not exists demo_simulated_messages_recent_idx on public.demo_simulated_messages (tenant_id, created_at desc);

create table if not exists public.demo_rate_hits (
  bucket       text not null check (char_length(bucket) between 1 and 200),
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (bucket, window_start)
);

do $$
declare t text;
begin
  foreach t in array array['demo_visitor_accounts', 'demo_presentations', 'demo_resets', 'demo_requests',
                           'demo_event_counts', 'demo_simulated_messages', 'demo_rate_hits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- ─── 4. RPC ──────────────────────────────────────────────────────────────────
create or replace function public.demo_assert_enabled()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.tenants where is_demo and active) then
    raise exception 'demo_disabled';
  end if;
end;
$$;

-- true = autorisé. Fenêtre fixe de p_window_seconds ; purge des anciennes fenêtres.
create or replace function public.demo_rate_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  perform public.demo_assert_enabled();
  if p_bucket is null or p_limit < 1 or p_window_seconds < 1 then raise exception 'demo_rate_invalid'; end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.demo_rate_hits (bucket, window_start, count)
  values (left(p_bucket, 200), v_window, 1)
  on conflict (bucket, window_start) do update set count = public.demo_rate_hits.count + 1
  returning count into v_count;
  delete from public.demo_rate_hits where window_start < now() - interval '2 days';
  return v_count <= p_limit;
end;
$$;

create or replace function public.demo_count_event(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.demo_assert_enabled();
  insert into public.demo_event_counts (day, event_key, count)
  values ((now() at time zone 'Europe/Paris')::date, p_event, 1)
  on conflict (day, event_key) do update set count = public.demo_event_counts.count + 1;
end;
$$;

-- Démarre une présentation, ou prolonge celle en cours : une seule active.
create or replace function public.demo_start_presentation(p_tenant_id uuid, p_started_by text, p_minutes integer)
returns table (out_id uuid, out_expires_at timestamptz, out_extended boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.demo_presentations%rowtype;
  v_minutes integer := least(greatest(coalesce(p_minutes, 120), 15), 480);
begin
  perform public.demo_assert_enabled();
  perform pg_advisory_xact_lock(hashtext('demo_presentation'));
  select * into v_current from public.demo_presentations
  where ended_at is null and expires_at > now()
  order by started_at desc limit 1;
  if found then
    update public.demo_presentations
      set expires_at = least(now() + make_interval(mins => v_minutes), started_at + interval '8 hours')
      where id = v_current.id
      returning id, expires_at into out_id, out_expires_at;
    out_extended := true;
    return next;
    return;
  end if;
  insert into public.demo_presentations (tenant_id, started_by, expires_at)
  values (p_tenant_id, p_started_by, now() + make_interval(mins => v_minutes))
  returning id, expires_at into out_id, out_expires_at;
  out_extended := false;
  return next;
end;
$$;

-- Réservée au script de réinitialisation : refuse pendant une présentation
-- (sauf p_force) et pendant une autre réinitialisation.
create or replace function public.demo_begin_reset(p_scenario text, p_requested_by text, p_force boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.demo_assert_enabled();
  perform pg_advisory_xact_lock(hashtext('demo_reset'));
  if not coalesce(p_force, false) and exists (
    select 1 from public.demo_presentations where ended_at is null and expires_at > now()
  ) then
    raise exception 'demo_presentation_active';
  end if;
  -- Une réinitialisation bloquée depuis plus de 30 minutes est considérée échouée.
  update public.demo_resets set status = 'failed', finished_at = now(), detail = 'abandonnée (délai dépassé)'
  where status = 'running' and started_at < now() - interval '30 minutes';
  if exists (select 1 from public.demo_resets where status = 'running') then
    raise exception 'demo_reset_running';
  end if;
  insert into public.demo_resets (scenario, requested_by) values (p_scenario, p_requested_by) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.demo_finish_reset(p_id uuid, p_status text, p_detail text, p_old_tenant_id uuid, p_new_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('done', 'failed') then raise exception 'demo_reset_invalid_status'; end if;
  update public.demo_resets
    set status = p_status, finished_at = now(), detail = left(p_detail, 2000),
        old_tenant_id = p_old_tenant_id, new_tenant_id = p_new_tenant_id
    where id = p_id and status = 'running';
end;
$$;

revoke all on function public.demo_assert_enabled() from public, anon, authenticated;
revoke all on function public.demo_rate_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.demo_count_event(text) from public, anon, authenticated;
revoke all on function public.demo_start_presentation(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.demo_begin_reset(text, text, boolean) from public, anon, authenticated;
revoke all on function public.demo_finish_reset(uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.demo_assert_enabled() to service_role;
grant execute on function public.demo_rate_hit(text, integer, integer) to service_role;
grant execute on function public.demo_count_event(text) to service_role;
grant execute on function public.demo_start_presentation(uuid, text, integer) to service_role;
grant execute on function public.demo_begin_reset(text, text, boolean) to service_role;
grant execute on function public.demo_finish_reset(uuid, text, text, uuid, uuid) to service_role;

commit;
