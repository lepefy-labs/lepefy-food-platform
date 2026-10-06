-- MIGRATION 147: WHATSAPP BUSINESS PLATFORM (canale multi-tenant, docs/WHATSAPP_BUSINESS_PLATFORM.md)
--
-- Additiva, reversibile, senza backfill. Nessuna tabella esistente viene
-- modificata: tenants.whatsapp_number (link wa.me, migration 017) resta
-- intatto e indipendente dal canale Cloud API.
--
--   1. tenant_whatsapp_channels  numero WhatsApp Business di un tenant
--                                (phone_number_id -> tenant_id, unico per provider).
--                                Nessun token in tabella: solo il NOME di una
--                                variabile d'ambiente server (access_token_env),
--                                stesso pattern dei provider AI Core.
--   2. whatsapp_conversations    una per (canale, wa_id del cliente).
--   3. whatsapp_messages         storico minimo, idempotente su provider_message_id.
--   4. whatsapp_automation_rules regole deterministiche configurabili per tenant.
--   5. whatsapp_handoffs         passaggi a operatore (uno aperto per conversazione).
--   6. whatsapp_audit_events     audit append-only (pausa/ripresa/invio umano...).
--   7. RPC service-role: ingest idempotente, claim dell'elaborazione asincrona,
--      stato messaggi monotono, purge di retention.
--   8. Capability RBAC whatsapp.view / whatsapp.reply / whatsapp.manage.
--
-- Isolamento: RLS attiva e forzata senza policy, nessun grant ad anon /
-- authenticated. Tutto passa da route server (service role) che risolvono il
-- tenant lato server: dal deployment per l'admin, da phone_number_id per il
-- webhook Meta. Ogni riferimento tra tabelle è una FK composita (tenant_id, id).
--
-- Il modulo è dietro al flag di rilascio `whatsapp_business` (tenant_feature_flags,
-- riga assente = spento): nessuna riga flag è creata qui.
--
-- Rollback (nessun dato di altri moduli coinvolto):
--   begin;
--   drop function if exists public.ingest_whatsapp_inbound_message(uuid, text, text, text, text, text, jsonb, timestamptz);
--   drop function if exists public.claim_whatsapp_inbound_messages(integer, uuid[], integer, integer);
--   drop function if exists public.apply_whatsapp_message_status(uuid, text, text, timestamptz, text, text);
--   drop function if exists public.purge_expired_whatsapp_data(integer, integer);
--   drop table if exists public.whatsapp_audit_events, public.whatsapp_handoffs, public.whatsapp_messages,
--     public.whatsapp_automation_rules, public.whatsapp_conversations, public.tenant_whatsapp_channels;
--   drop function if exists public.whatsapp_touch_updated_at(), public.whatsapp_conversation_customer_tenant_check();
--   delete from public.admin_role_permissions where permission_key in ('whatsapp.view','whatsapp.reply','whatsapp.manage');
--   delete from public.admin_permissions where key in ('whatsapp.view','whatsapp.reply','whatsapp.manage');
--   delete from public.tenant_feature_flags where flag_key = 'whatsapp_business';
--   commit;
--
-- Rejouable sans effet de bord.

begin;

create or replace function public.whatsapp_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─── 1. Canali ───────────────────────────────────────────────────────────────
create table if not exists public.tenant_whatsapp_channels (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  provider              text not null default 'meta_cloud' check (provider in ('meta_cloud')),
  environment           text not null default 'test' check (environment in ('test', 'production')),
  waba_id               text not null check (waba_id ~ '^[0-9]{5,32}$'),
  phone_number_id       text not null check (phone_number_id ~ '^[0-9]{5,32}$'),
  display_phone_number  text check (display_phone_number is null or char_length(display_phone_number) <= 32),
  verified_name         text check (verified_name is null or char_length(verified_name) <= 120),
  status                text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  automation_enabled    boolean not null default false,
  ai_enabled            boolean not null default false,
  human_handoff_enabled boolean not null default true,
  default_language      text not null default 'fr' check (default_language ~ '^[a-z]{2}$'),
  timezone              text not null default 'Europe/Paris' check (char_length(timezone) between 3 and 64),
  auto_resume_minutes   integer check (auto_resume_minutes is null or auto_resume_minutes between 15 and 10080),
  access_token_env      text check (access_token_env is null or access_token_env ~ '^META_WHATSAPP_[A-Z0-9_]{1,64}_TOKEN$'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint tenant_whatsapp_channels_tenant_id_id_key unique (tenant_id, id),
  constraint tenant_whatsapp_channels_provider_phone_key unique (provider, phone_number_id)
);

comment on table public.tenant_whatsapp_channels is
  'WhatsApp Business number of a tenant. The webhook resolves the tenant ONLY from (provider, phone_number_id), never from the customer number nor from a client-supplied tenant id. Service role only.';
comment on column public.tenant_whatsapp_channels.access_token_env is
  'NAME of the server environment variable holding the Meta access token for this channel (META_WHATSAPP_<X>_TOKEN). Null = platform system-user token META_WHATSAPP_SYSTEM_USER_TOKEN. The token itself is never stored in the database.';
comment on column public.tenant_whatsapp_channels.status is
  'pending: wired for tests (messages stored, no automation). active: automation allowed when automation_enabled. disabled: webhook events ignored.';
comment on column public.tenant_whatsapp_channels.auto_resume_minutes is
  'Optional automatic resume of automation after a human handoff (null = manual resume only).';

-- Un solo canale non disattivato per tenant: l'admin e l'invio umano non devono indovinare il numero.
create unique index if not exists tenant_whatsapp_channels_one_live_per_tenant
  on public.tenant_whatsapp_channels (tenant_id) where status <> 'disabled';

drop trigger if exists tenant_whatsapp_channels_touch on public.tenant_whatsapp_channels;
create trigger tenant_whatsapp_channels_touch before update on public.tenant_whatsapp_channels
  for each row execute function public.whatsapp_touch_updated_at();

-- ─── 2. Conversazioni ────────────────────────────────────────────────────────
create table if not exists public.whatsapp_conversations (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  channel_id            uuid not null,
  customer_id           uuid references public.customers(id) on delete set null,
  wa_id                 text not null check (wa_id ~ '^[0-9]{6,20}$'),
  customer_phone        text not null check (customer_phone ~ '^\+[0-9]{6,20}$'),
  customer_name         text check (customer_name is null or char_length(customer_name) <= 120),
  status                text not null default 'open'
                          check (status in ('open', 'automated', 'waiting_human', 'human', 'closed')),
  automation_status     text not null default 'active' check (automation_status in ('active', 'paused')),
  assigned_to           uuid references public.admin_users(id) on delete set null,
  detected_language     text check (detected_language is null or detected_language ~ '^[a-z]{2}$'),
  nala_conversation_id  uuid,
  unread_count          integer not null default 0 check (unread_count >= 0),
  last_message_at       timestamptz not null default now(),
  last_inbound_at       timestamptz,
  human_handoff_at      timestamptz,
  automation_resume_at  timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint whatsapp_conversations_tenant_id_id_key unique (tenant_id, id),
  constraint whatsapp_conversations_tenant_id_channel_key unique (tenant_id, id, channel_id),
  constraint whatsapp_conversations_channel_contact_key unique (channel_id, wa_id),
  constraint whatsapp_conversations_channel_fkey foreign key (tenant_id, channel_id)
    references public.tenant_whatsapp_channels (tenant_id, id) on delete cascade,
  constraint whatsapp_conversations_phone_matches_wa_id check (customer_phone = '+' || wa_id),
  constraint whatsapp_conversations_paused_consistency check (
    automation_status = 'paused' or automation_resume_at is null
  )
);

comment on table public.whatsapp_conversations is
  'One conversation per (tenant channel, customer wa_id). automation_status=paused while a human handles it: automation never replies then. Service role only.';
comment on column public.whatsapp_conversations.last_inbound_at is
  'Timestamp of the last customer message: free-form replies are only allowed within 24 h of it (Meta customer service window).';
comment on column public.whatsapp_conversations.nala_conversation_id is
  'Current AI Core conversation (ai_conversations, consumer nala_whatsapp). Expires with the AI Core TTL; a new one is opened transparently.';

create index if not exists whatsapp_conversations_tenant_recent_idx
  on public.whatsapp_conversations (tenant_id, last_message_at desc);
create index if not exists whatsapp_conversations_tenant_status_idx
  on public.whatsapp_conversations (tenant_id, status, last_message_at desc);
create index if not exists whatsapp_conversations_customer_idx
  on public.whatsapp_conversations (customer_id) where customer_id is not null;
create index if not exists whatsapp_conversations_resume_idx
  on public.whatsapp_conversations (automation_resume_at)
  where automation_status = 'paused' and automation_resume_at is not null;

-- Un cliente collegato deve appartenere allo stesso tenant (customers non ha una chiave composita).
create or replace function public.whatsapp_conversation_customer_tenant_check()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.customer_id is not null and not exists (
    select 1 from public.customers c where c.id = new.customer_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'whatsapp_customer_tenant_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_conversations_customer_tenant on public.whatsapp_conversations;
create trigger whatsapp_conversations_customer_tenant before insert or update of customer_id, tenant_id
  on public.whatsapp_conversations
  for each row execute function public.whatsapp_conversation_customer_tenant_check();

drop trigger if exists whatsapp_conversations_touch on public.whatsapp_conversations;
create trigger whatsapp_conversations_touch before update on public.whatsapp_conversations
  for each row execute function public.whatsapp_touch_updated_at();

-- ─── 3. Messaggi ─────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_messages (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  conversation_id       uuid not null,
  channel_id            uuid not null,
  provider_message_id   text check (provider_message_id is null or char_length(provider_message_id) between 8 and 200),
  direction             text not null check (direction in ('inbound', 'outbound')),
  author_type           text not null check (author_type in ('customer', 'automation', 'nala', 'agent', 'system')),
  author_admin_id       uuid references public.admin_users(id) on delete set null,
  message_type          text not null check (message_type ~ '^[a-z_]{2,32}$'),
  body                  text check (body is null or char_length(body) <= 4096),
  status                text not null check (status in ('received', 'pending', 'sent', 'delivered', 'read', 'failed')),
  processing_status     text check (processing_status is null or processing_status in ('pending', 'processing', 'done', 'skipped', 'failed')),
  processing_attempts   smallint not null default 0 check (processing_attempts between 0 and 10),
  processing_started_at timestamptz,
  processing_result     text check (processing_result is null or char_length(processing_result) <= 64),
  error_code            text check (error_code is null or char_length(error_code) <= 32),
  error_title           text check (error_title is null or char_length(error_title) <= 200),
  metadata              jsonb not null default '{}'::jsonb
                          check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  provider_timestamp    timestamptz,
  sent_at               timestamptz,
  delivered_at          timestamptz,
  read_at               timestamptz,
  failed_at             timestamptz,
  created_at            timestamptz not null default now(),
  constraint whatsapp_messages_conversation_fkey foreign key (tenant_id, conversation_id, channel_id)
    references public.whatsapp_conversations (tenant_id, id, channel_id) on delete cascade,
  constraint whatsapp_messages_author_direction check ((direction = 'inbound') = (author_type = 'customer')),
  constraint whatsapp_messages_inbound_shape check (
    (direction = 'inbound' and processing_status is not null and provider_message_id is not null and status = 'received')
    or (direction = 'outbound' and processing_status is null and status <> 'received')
  ),
  constraint whatsapp_messages_agent_author check (author_type = 'agent' or author_admin_id is null)
);

comment on table public.whatsapp_messages is
  'Minimal WhatsApp message history. provider_message_id (wamid) is unique per channel: a webhook retried by Meta never creates a second row. Raw webhook payloads are never stored; metadata keeps only small technical fields (media id/mime, reply context, rule code). Service role only.';
comment on column public.whatsapp_messages.processing_status is
  'Inbound only: asynchronous automation pipeline state (pending -> processing -> done | skipped | failed).';

create unique index if not exists whatsapp_messages_channel_provider_id_key
  on public.whatsapp_messages (channel_id, provider_message_id) where provider_message_id is not null;
create index if not exists whatsapp_messages_conversation_idx
  on public.whatsapp_messages (conversation_id, created_at);
create index if not exists whatsapp_messages_tenant_created_idx
  on public.whatsapp_messages (tenant_id, created_at);
create index if not exists whatsapp_messages_processing_idx
  on public.whatsapp_messages (created_at) where processing_status in ('pending', 'processing');

-- ─── 4. Regole di automazione ────────────────────────────────────────────────
create table if not exists public.whatsapp_automation_rules (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  code           text not null check (code in (
                   'greeting', 'opening_hours', 'location', 'shipping', 'order_status',
                   'tracking', 'catalog', 'product_availability', 'human_handoff')),
  enabled        boolean not null default true,
  priority       integer not null default 100 check (priority between 0 and 1000),
  configuration  jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(configuration) = 'object' and pg_column_size(configuration) <= 4096),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint whatsapp_automation_rules_tenant_code_key unique (tenant_id, code)
);

comment on table public.whatsapp_automation_rules is
  'Per-tenant overrides of the deterministic WhatsApp rules (code catalogue in lib/whatsapp/automation/rules.ts). Missing row = code default. configuration holds only texts/options, never business data duplicated from tenants/shipping/catalogue.';

drop trigger if exists whatsapp_automation_rules_touch on public.whatsapp_automation_rules;
create trigger whatsapp_automation_rules_touch before update on public.whatsapp_automation_rules
  for each row execute function public.whatsapp_touch_updated_at();

-- ─── 5. Handoff a operatore ──────────────────────────────────────────────────
create table if not exists public.whatsapp_handoffs (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  conversation_id       uuid not null,
  reason                text not null check (reason in (
                          'customer_request', 'complaint', 'payment_issue', 'order_not_received',
                          'automation_error', 'low_confidence', 'unsupported_intent', 'agent_takeover', 'media_message')),
  trigger_message_id    uuid references public.whatsapp_messages(id) on delete set null,
  requested_at          timestamptz not null default now(),
  assigned_to           uuid references public.admin_users(id) on delete set null,
  accepted_at           timestamptz,
  resolved_at           timestamptz,
  resolved_by           uuid references public.admin_users(id) on delete set null,
  resolution            text check (resolution is null or resolution in ('resumed', 'closed', 'auto_resumed')),
  resume_automation_at  timestamptz,
  metadata              jsonb not null default '{}'::jsonb
                          check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048),
  created_at            timestamptz not null default now(),
  constraint whatsapp_handoffs_conversation_fkey foreign key (tenant_id, conversation_id)
    references public.whatsapp_conversations (tenant_id, id) on delete cascade,
  constraint whatsapp_handoffs_resolution_consistency check ((resolved_at is null) = (resolution is null))
);

create unique index if not exists whatsapp_handoffs_one_open_per_conversation
  on public.whatsapp_handoffs (conversation_id) where resolved_at is null;
create index if not exists whatsapp_handoffs_tenant_open_idx
  on public.whatsapp_handoffs (tenant_id, requested_at desc) where resolved_at is null;

-- ─── 6. Audit ────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_audit_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  conversation_id  uuid,
  event_type       text not null check (event_type ~ '^[a-z_]{3,48}$'),
  actor_type       text not null check (actor_type in ('system', 'admin', 'customer')),
  actor_admin_id   uuid references public.admin_users(id) on delete set null,
  detail           jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2048),
  created_at       timestamptz not null default now(),
  constraint whatsapp_audit_events_conversation_fkey foreign key (tenant_id, conversation_id)
    references public.whatsapp_conversations (tenant_id, id) on delete cascade
);

comment on table public.whatsapp_audit_events is
  'Append-only audit of WhatsApp operations (handoff, pause/resume, human send, settings). detail never contains message bodies or phone numbers.';

create index if not exists whatsapp_audit_events_tenant_idx
  on public.whatsapp_audit_events (tenant_id, created_at desc);
create index if not exists whatsapp_audit_events_conversation_idx
  on public.whatsapp_audit_events (conversation_id, created_at desc) where conversation_id is not null;

-- ─── RLS e grant ─────────────────────────────────────────────────────────────
alter table public.tenant_whatsapp_channels enable row level security;
alter table public.tenant_whatsapp_channels force row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_conversations force row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_messages force row level security;
alter table public.whatsapp_automation_rules enable row level security;
alter table public.whatsapp_automation_rules force row level security;
alter table public.whatsapp_handoffs enable row level security;
alter table public.whatsapp_handoffs force row level security;
alter table public.whatsapp_audit_events enable row level security;
alter table public.whatsapp_audit_events force row level security;

revoke all on table public.tenant_whatsapp_channels, public.whatsapp_conversations, public.whatsapp_messages,
  public.whatsapp_automation_rules, public.whatsapp_handoffs, public.whatsapp_audit_events
  from public, anon, authenticated;

-- Canali: mai cancellati (status = disabled). Conversazioni/messaggi: delete per
-- cancellazione GDPR e retention. Audit: append-only (cascade con la conversazione).
grant select, insert, update on table public.tenant_whatsapp_channels to service_role;
grant select, insert, update, delete on table public.whatsapp_conversations to service_role;
grant select, insert, update, delete on table public.whatsapp_messages to service_role;
grant select, insert, update on table public.whatsapp_automation_rules to service_role;
grant select, insert, update on table public.whatsapp_handoffs to service_role;
grant select, insert on table public.whatsapp_audit_events to service_role;

revoke all on function public.whatsapp_touch_updated_at() from public, anon, authenticated;
revoke all on function public.whatsapp_conversation_customer_tenant_check() from public, anon, authenticated;

-- ─── 7. RPC ──────────────────────────────────────────────────────────────────

-- Ingest idempotente di un messaggio in arrivo. Il tenant deriva dal canale
-- (risolto a monte da phone_number_id), mai da un parametro del chiamante.
create or replace function public.ingest_whatsapp_inbound_message(
  p_channel_id uuid,
  p_wa_id text,
  p_customer_name text,
  p_provider_message_id text,
  p_message_type text,
  p_body text,
  p_metadata jsonb,
  p_provider_timestamp timestamptz
)
returns table (
  out_message_id uuid,
  out_conversation_id uuid,
  out_tenant_id uuid,
  out_created boolean,
  out_conversation_created boolean
)
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_tenant_id uuid;
  v_conversation_id uuid;
  v_conversation_created boolean;
  v_message_id uuid;
  v_received_at timestamptz := least(coalesce(p_provider_timestamp, now()), now());
begin
  select ch.tenant_id into v_tenant_id
  from public.tenant_whatsapp_channels ch
  where ch.id = p_channel_id and ch.status <> 'disabled';
  if v_tenant_id is null then
    raise exception 'whatsapp_channel_unavailable';
  end if;

  -- Retry Meta: il messaggio esiste già, nessun effetto.
  select m.id, m.conversation_id into v_message_id, v_conversation_id
  from public.whatsapp_messages m
  where m.channel_id = p_channel_id and m.provider_message_id = p_provider_message_id;
  if v_message_id is not null then
    return query select v_message_id, v_conversation_id, v_tenant_id, false, false;
    return;
  end if;

  insert into public.whatsapp_conversations as c (tenant_id, channel_id, wa_id, customer_phone, customer_name, last_message_at, last_inbound_at)
  values (v_tenant_id, p_channel_id, p_wa_id, '+' || p_wa_id, nullif(left(btrim(coalesce(p_customer_name, '')), 120), ''), v_received_at, v_received_at)
  on conflict (channel_id, wa_id) do update
    set customer_name = coalesce(excluded.customer_name, c.customer_name)
  returning c.id, (xmax = 0) into v_conversation_id, v_conversation_created;

  insert into public.whatsapp_messages (
    tenant_id, conversation_id, channel_id, provider_message_id, direction, author_type,
    message_type, body, status, processing_status, metadata, provider_timestamp
  )
  values (
    v_tenant_id, v_conversation_id, p_channel_id, p_provider_message_id, 'inbound', 'customer',
    p_message_type, left(p_body, 4096), 'received', 'pending', coalesce(p_metadata, '{}'::jsonb), p_provider_timestamp
  )
  on conflict (channel_id, provider_message_id) where provider_message_id is not null do nothing
  returning id into v_message_id;

  if v_message_id is null then
    -- Corsa tra due consegne simultanee dello stesso evento.
    select m.id into v_message_id
    from public.whatsapp_messages m
    where m.channel_id = p_channel_id and m.provider_message_id = p_provider_message_id;
    return query select v_message_id, v_conversation_id, v_tenant_id, false, false;
    return;
  end if;

  update public.whatsapp_conversations c
  set last_message_at = greatest(c.last_message_at, v_received_at),
      last_inbound_at = greatest(coalesce(c.last_inbound_at, v_received_at), v_received_at),
      unread_count = c.unread_count + 1,
      status = case when c.status = 'closed' then 'open' else c.status end
  where c.id = v_conversation_id;

  return query select v_message_id, v_conversation_id, v_tenant_id, true, v_conversation_created;
end;
$$;

-- Claim atomico dei messaggi da elaborare (webhook inline, n8n o sweep).
-- p_message_ids null = sweep: messaggi pending più vecchi di p_min_age_seconds
-- oppure processing bloccati da più di 120 s. Massimo 3 tentativi.
create or replace function public.claim_whatsapp_inbound_messages(
  p_limit integer,
  p_message_ids uuid[] default null,
  p_min_age_seconds integer default 0,
  p_max_attempts integer default 3
)
returns table (out_message_id uuid, out_tenant_id uuid)
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  -- Tentativi esauriti: fallimento definitivo, visibile in admin.
  update public.whatsapp_messages m
  set processing_status = 'failed', processing_result = 'attempts_exhausted'
  where m.processing_status in ('pending', 'processing')
    and m.processing_attempts >= p_max_attempts
    and (m.processing_status = 'pending' or m.processing_started_at < now() - interval '120 seconds')
    and (p_message_ids is null or m.id = any(p_message_ids));

  return query
  with candidates as (
    select m.id
    from public.whatsapp_messages m
    where m.direction = 'inbound'
      and m.processing_attempts < p_max_attempts
      and (
        (m.processing_status = 'pending'
          and (p_message_ids is not null or m.created_at <= now() - make_interval(secs => greatest(p_min_age_seconds, 0))))
        or (m.processing_status = 'processing' and m.processing_started_at < now() - interval '120 seconds')
      )
      and (p_message_ids is null or m.id = any(p_message_ids))
    order by m.created_at
    limit greatest(least(p_limit, 100), 1)
    for update skip locked
  )
  update public.whatsapp_messages m
  set processing_status = 'processing',
      processing_attempts = m.processing_attempts + 1,
      processing_started_at = now()
  from candidates
  where m.id = candidates.id
  returning m.id, m.tenant_id;
end;
$$;

-- Stato di consegna monotono (sent < delivered < read). failed vale solo prima
-- della consegna. I timestamp restano idempotenti (primo valore conservato).
create or replace function public.apply_whatsapp_message_status(
  p_channel_id uuid,
  p_provider_message_id text,
  p_status text,
  p_at timestamptz,
  p_error_code text,
  p_error_title text
)
returns table (out_message_id uuid, out_tenant_id uuid, out_applied boolean)
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_row public.whatsapp_messages%rowtype;
  v_rank integer;
  v_new_rank integer;
  v_at timestamptz := coalesce(p_at, now());
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'whatsapp_invalid_status';
  end if;

  select * into v_row
  from public.whatsapp_messages m
  where m.channel_id = p_channel_id and m.provider_message_id = p_provider_message_id and m.direction = 'outbound'
  for update;
  if not found then
    return;
  end if;

  v_rank := case v_row.status when 'pending' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else -1 end;
  v_new_rank := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else -1 end;

  if p_status = 'failed' then
    if v_row.status in ('delivered', 'read', 'failed') then
      return query select v_row.id, v_row.tenant_id, false;
      return;
    end if;
    update public.whatsapp_messages
    set status = 'failed', failed_at = coalesce(failed_at, v_at),
        error_code = left(p_error_code, 32), error_title = left(p_error_title, 200)
    where id = v_row.id;
    return query select v_row.id, v_row.tenant_id, true;
    return;
  end if;

  update public.whatsapp_messages
  set status = case when v_new_rank > v_rank and v_row.status <> 'failed' then p_status else status end,
      sent_at = coalesce(sent_at, v_at),
      delivered_at = case when v_new_rank >= 2 then coalesce(delivered_at, v_at) else delivered_at end,
      read_at = case when v_new_rank >= 3 then coalesce(read_at, v_at) else read_at end
  where id = v_row.id;
  return query select v_row.id, v_row.tenant_id, (v_new_rank > v_rank and v_row.status <> 'failed');
end;
$$;

-- Retention (docs/WHATSAPP_BUSINESS_PLATFORM.md § Privacy): contenuto dei
-- messaggi 180 giorni, conversazioni inattive 365 giorni (cascade su messaggi,
-- handoff e audit della conversazione). Minimi imposti per evitare purge accidentali.
create or replace function public.purge_expired_whatsapp_data(
  p_message_retention_days integer default 180,
  p_conversation_retention_days integer default 365
)
returns table (out_deleted_messages bigint, out_deleted_conversations bigint)
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_messages bigint;
  v_conversations bigint;
begin
  if p_message_retention_days < 30 or p_conversation_retention_days < p_message_retention_days then
    raise exception 'whatsapp_invalid_retention';
  end if;

  delete from public.whatsapp_messages m
  where m.created_at < now() - make_interval(days => p_message_retention_days)
    and (m.processing_status is null or m.processing_status not in ('pending', 'processing'));
  get diagnostics v_messages = row_count;

  delete from public.whatsapp_conversations c
  where c.last_message_at < now() - make_interval(days => p_conversation_retention_days);
  get diagnostics v_conversations = row_count;

  return query select v_messages, v_conversations;
end;
$$;

revoke all on function public.ingest_whatsapp_inbound_message(uuid, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_whatsapp_inbound_messages(integer, uuid[], integer, integer) from public, anon, authenticated;
revoke all on function public.apply_whatsapp_message_status(uuid, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.purge_expired_whatsapp_data(integer, integer) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_inbound_message(uuid, text, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.claim_whatsapp_inbound_messages(integer, uuid[], integer, integer) to service_role;
grant execute on function public.apply_whatsapp_message_status(uuid, text, text, timestamptz, text, text) to service_role;
grant execute on function public.purge_expired_whatsapp_data(integer, integer) to service_role;

-- ─── 8. Capability RBAC ──────────────────────────────────────────────────────
insert into public.admin_permissions (key, module, label, description, risk_level, position) values
  ('whatsapp.view', 'Canaux · WhatsApp', 'Voir les conversations WhatsApp', 'Consulter le canal WhatsApp, les conversations et l’historique des messages.', 'standard', 500),
  ('whatsapp.reply', 'Canaux · WhatsApp', 'Répondre sur WhatsApp', 'Envoyer des messages depuis le numéro de la boutique, reprendre ou rendre la main à l’automatisation.', 'sensitive', 501),
  ('whatsapp.manage', 'Canaux · WhatsApp', 'Configurer WhatsApp', 'Activer l’automatisation, Nala, le passage à un opérateur et modifier les réponses automatiques.', 'sensitive', 502)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  risk_level = excluded.risk_level,
  position = excluded.position;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, pk.key
from public.admin_roles r
cross join (values ('whatsapp.view'), ('whatsapp.reply'), ('whatsapp.manage')) as pk(key)
where r.code in ('platform_owner', 'tenant_admin')
on conflict do nothing;

commit;
