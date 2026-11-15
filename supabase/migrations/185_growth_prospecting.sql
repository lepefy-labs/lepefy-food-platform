-- Growth prospecting (platform owner only): evidence-backed dossiers imported
-- from the growth CLI, the contacts made with each shop and a suppression list.
-- Holds business names, addresses and public phone numbers: RLS forced, no
-- policy, service role only, never exposed to a tenant. docs/GROWTH_PROSPECTING.md

create table if not exists public.growth_prospects (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,119}$'),
  name text not null check (length(name) between 1 and 300),
  city text not null check (length(city) between 1 and 200),
  country text not null check (country ~ '^[A-Z]{2}$'),
  segment text not null check (length(segment) between 1 and 100),
  status text not null check (status in ('pronta', 'da_coltivare', 'non_qualificata')),
  separate_segment boolean not null default false,
  fit_score integer not null check (fit_score between 0 and 100),
  priority text check (priority in ('A', 'B', 'C')),
  entry_kind text not null check (entry_kind in ('introduction', 'visit', 'event', 'inbound', 'written_channel', 'none')),
  entry_verified boolean not null,
  -- The dossier as validated by the growth engine, and the evaluation recomputed on import.
  dossier jsonb not null check (jsonb_typeof(dossier) = 'object'),
  evaluation jsonb not null check (jsonb_typeof(evaluation) = 'object'),
  identity_keys text[] not null default '{}',
  runs text[] not null default '{}',
  first_seen date not null,
  last_seen date not null,
  -- Sales fields: written only by the admin page, never by an import.
  sales_stage text not null default 'da_contattare'
    check (sales_stage in ('da_contattare', 'contattato', 'in_conversazione', 'demo', 'cliente', 'perso')),
  next_action_at timestamptz,
  last_contact_at timestamptz,
  do_not_contact boolean not null default false,
  do_not_contact_reason text check (do_not_contact_reason is null or length(do_not_contact_reason) <= 500),
  message_draft text check (message_draft is null or length(message_draft) <= 2000),
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_prospects_suppression_reason check (not do_not_contact or length(btrim(coalesce(do_not_contact_reason, ''))) > 0)
);

create index if not exists growth_prospects_worklist_idx on public.growth_prospects (status, sales_stage, next_action_at)
  where do_not_contact = false;

-- Append-only log of the contacts made (the message actually sent is kept as sent).
create table if not exists public.growth_prospect_touches (
  id uuid primary key default gen_random_uuid(),
  prospect_id text not null references public.growth_prospects(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  channel text not null check (channel in ('visita', 'telefono', 'whatsapp', 'email', 'instagram', 'modulo', 'presentazione', 'altro')),
  outcome text not null check (outcome in ('contattato', 'introduzione', 'risposta', 'demo', 'rifiuto', 'nessuna_risposta', 'tenant_pagante')),
  reason text check (reason is null or length(reason) <= 500),
  note text check (note is null or length(note) <= 2000),
  message_text text check (message_text is null or length(message_text) <= 2000),
  request_key uuid unique,
  created_at timestamptz not null default now(),
  constraint growth_touches_refusal_reason check (outcome <> 'rifiuto' or length(btrim(coalesce(reason, ''))) > 0)
);

create index if not exists growth_prospect_touches_prospect_idx on public.growth_prospect_touches (prospect_id, occurred_at desc);
create index if not exists growth_prospect_touches_channel_day_idx on public.growth_prospect_touches (channel, occurred_at);

-- A shop that said no is never proposed again, whatever name it reappears under (strong identity keys only).
create table if not exists public.growth_suppressions (
  identity_key text primary key check (identity_key ~ '^(dom|fb|ig|tel|vat):'),
  prospect_id text references public.growth_prospects(id) on delete set null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now()
);

create or replace function public.growth_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists growth_prospects_updated_at on public.growth_prospects;
create trigger growth_prospects_updated_at before update on public.growth_prospects
  for each row execute function public.growth_set_updated_at();

create or replace function public.growth_touches_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'growth_touch_append_only';
end;
$$;

drop trigger if exists growth_prospect_touches_append_only on public.growth_prospect_touches;
create trigger growth_prospect_touches_append_only before update or delete on public.growth_prospect_touches
  for each row execute function public.growth_touches_append_only();

do $$
declare t text;
begin
  foreach t in array array['growth_prospects', 'growth_prospect_touches', 'growth_suppressions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end;
$$;

grant select, insert, update on public.growth_prospects to service_role;
grant select, insert on public.growth_prospect_touches to service_role;
grant select, insert, delete on public.growth_suppressions to service_role;

revoke all on function public.growth_set_updated_at() from public, anon, authenticated;
revoke all on function public.growth_touches_append_only() from public, anon, authenticated;
