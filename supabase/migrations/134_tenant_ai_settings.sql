-- MIGRATION 134: AI / NALA SETTINGS → tenant_feature_settings
--
-- Additive step of the AI consolidation (docs/TENANT_CONFIGURATION_ARCHITECTURE.md §3.9),
-- same approach as loyalty (130) and referral (132):
--   * 'ai' (catalog entry of 094, commercial semantics unchanged) gets one
--     operational row per tenant: capability flags + rate limits from
--     tenants.ai_image_generation, ai_description_generation, ai_semantic_search,
--     ai_rate_limit_public_per_minute, ai_rate_limit_public_per_day,
--     ai_rate_limit_admin_per_day. enabled = true for every tenant: there is no
--     global AI switch today (each capability has its own flag).
--   * tenants.chatbox_extra_context (private assistant context) moves to the
--     existing 'nala' row as config.extra_context; the Nala activation flag
--     (096) is never modified.
--   * guarded two-way triggers keep the legacy columns identical, so
--     check_ai_rate_limit (027) and code deployed before this migration stay
--     correct until the columns are dropped by a later migration;
--   * revokes the public 013/076 column grants on the AI flags and limits.
-- catalogue_search_threshold (015) is not an AI setting and is left untouched.
-- No column is dropped. Safe to re-run.

begin;

-- ─── 1. Config validation ─────────────────────────────────────────────────────
create or replace function public.is_valid_ai_config(p_config jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(p_config) <> 'object' then return false; end if;
  if p_config - array[
    'version', 'image_generation', 'description_generation', 'semantic_search',
    'rate_limit_public_per_minute', 'rate_limit_public_per_day', 'rate_limit_admin_per_day'
  ] <> '{}'::jsonb then return false; end if;
  if p_config ? 'version' and p_config->'version' <> '1'::jsonb then return false; end if;

  foreach k in array array['image_generation', 'description_generation', 'semantic_search'] loop
    v := p_config->k;
    if v is not null and jsonb_typeof(v) <> 'boolean' then return false; end if;
  end loop;

  -- Type check before cast: only integer literals of at most 7 digits.
  foreach k in array array['rate_limit_public_per_minute', 'rate_limit_public_per_day', 'rate_limit_admin_per_day'] loop
    v := p_config->k;
    if v is not null then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,7}$' then return false; end if;
      if (v #>> '{}')::int > 1000000 then return false; end if;
    end if;
  end loop;

  return true;
end
$$;

-- Nala config stays open for future keys; only extra_context is constrained.
create or replace function public.is_valid_nala_config(p_config jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v jsonb;
begin
  if jsonb_typeof(p_config) <> 'object' then return false; end if;
  v := p_config->'extra_context';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 20000 then return false; end if;
  end if;
  return true;
end
$$;

revoke all on function public.is_valid_ai_config(jsonb) from public, anon, authenticated;
revoke all on function public.is_valid_nala_config(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_ai_config(jsonb) to service_role;
grant execute on function public.is_valid_nala_config(jsonb) to service_role;

alter table public.tenant_feature_settings
  drop constraint if exists tenant_feature_settings_ai_config_check;
alter table public.tenant_feature_settings
  add constraint tenant_feature_settings_ai_config_check
  check (feature_key <> 'ai' or public.is_valid_ai_config(config));

alter table public.tenant_feature_settings
  drop constraint if exists tenant_feature_settings_nala_config_check;
alter table public.tenant_feature_settings
  add constraint tenant_feature_settings_nala_config_check
  check (feature_key <> 'nala' or public.is_valid_nala_config(config));

-- ─── 2. Backfill ──────────────────────────────────────────────────────────────
create or replace function public.ai_config_from_tenant(t public.tenants)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'version', 1,
    'image_generation', t.ai_image_generation,
    'description_generation', t.ai_description_generation,
    'semantic_search', t.ai_semantic_search,
    'rate_limit_public_per_minute', t.ai_rate_limit_public_per_minute,
    'rate_limit_public_per_day', t.ai_rate_limit_public_per_day,
    'rate_limit_admin_per_day', t.ai_rate_limit_admin_per_day
  );
$$;

revoke all on function public.ai_config_from_tenant(public.tenants) from public, anon, authenticated;

insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
select t.id, 'ai', true, public.ai_config_from_tenant(t)
from public.tenants t
on conflict (tenant_id, feature_key) do nothing;

-- Private assistant context: merged into the existing Nala row (activation
-- untouched); a tenant without a Nala row gets one that stays disabled, which
-- is what a missing row already meant (096).
insert into public.tenant_feature_settings as s (tenant_id, feature_key, enabled, config)
select t.id, 'nala', false, jsonb_build_object('extra_context', t.chatbox_extra_context)
from public.tenants t
where t.chatbox_extra_context is not null
on conflict (tenant_id, feature_key) do update
  set config = s.config || jsonb_build_object('extra_context', excluded.config->'extra_context'),
      updated_at = now()
  where s.config->'extra_context' is distinct from excluded.config->'extra_context';

-- ─── 3. Two-way sync (guarded: each side writes only when values differ) ─────
create or replace function public.sync_ai_settings_to_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c jsonb := new.config;
  v_image boolean := coalesce((c->>'image_generation')::boolean, false);
  v_description boolean := coalesce((c->>'description_generation')::boolean, false);
  v_semantic boolean := coalesce((c->>'semantic_search')::boolean, false);
  v_minute int := coalesce((c->>'rate_limit_public_per_minute')::int, 20);
  v_day int := coalesce((c->>'rate_limit_public_per_day')::int, 500);
  v_admin int := coalesce((c->>'rate_limit_admin_per_day')::int, 200);
begin
  update public.tenants t
  set ai_image_generation = v_image,
      ai_description_generation = v_description,
      ai_semantic_search = v_semantic,
      ai_rate_limit_public_per_minute = v_minute,
      ai_rate_limit_public_per_day = v_day,
      ai_rate_limit_admin_per_day = v_admin
  where t.id = new.tenant_id
    and (t.ai_image_generation, t.ai_description_generation, t.ai_semantic_search,
         t.ai_rate_limit_public_per_minute, t.ai_rate_limit_public_per_day, t.ai_rate_limit_admin_per_day)
        is distinct from (v_image, v_description, v_semantic, v_minute, v_day, v_admin);
  return new;
end
$$;

create or replace function public.sync_nala_context_to_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only rows that carry the key own the value (a Nala toggle without it
  -- must not erase the legacy column).
  if not (new.config ? 'extra_context') then return new; end if;
  update public.tenants t
  set chatbox_extra_context = new.config->>'extra_context'
  where t.id = new.tenant_id
    and t.chatbox_extra_context is distinct from (new.config->>'extra_context');
  return new;
end
$$;

create or replace function public.sync_tenant_ai_to_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb := public.ai_config_from_tenant(new);
begin
  insert into public.tenant_feature_settings as s (tenant_id, feature_key, enabled, config)
  values (new.id, 'ai', true, v_config)
  on conflict (tenant_id, feature_key) do update
    set config = s.config || (v_config - 'version'),
        updated_at = now()
  where (s.config || (v_config - 'version')) is distinct from s.config;

  -- Nala context: only when it actually changes (never create rows for the
  -- other AI columns or for an empty context on a new tenant).
  if tg_op = 'INSERT' then
    if new.chatbox_extra_context is null then return new; end if;
  elsif new.chatbox_extra_context is not distinct from old.chatbox_extra_context then
    return new;
  end if;
  insert into public.tenant_feature_settings as s (tenant_id, feature_key, enabled, config)
  values (new.id, 'nala', false, jsonb_build_object('extra_context', new.chatbox_extra_context))
  on conflict (tenant_id, feature_key) do update
    set config = s.config || jsonb_build_object('extra_context', new.chatbox_extra_context),
        updated_at = now()
  where coalesce(s.config->'extra_context', 'null'::jsonb)
        is distinct from coalesce(to_jsonb(new.chatbox_extra_context), 'null'::jsonb);
  return new;
end
$$;

revoke all on function public.sync_ai_settings_to_tenant() from public, anon, authenticated;
revoke all on function public.sync_nala_context_to_tenant() from public, anon, authenticated;
revoke all on function public.sync_tenant_ai_to_settings() from public, anon, authenticated;

drop trigger if exists tenant_feature_settings_ai_sync on public.tenant_feature_settings;
create trigger tenant_feature_settings_ai_sync
  after insert or update of config on public.tenant_feature_settings
  for each row when (new.feature_key = 'ai')
  execute function public.sync_ai_settings_to_tenant();

drop trigger if exists tenant_feature_settings_nala_context_sync on public.tenant_feature_settings;
create trigger tenant_feature_settings_nala_context_sync
  after insert or update of config on public.tenant_feature_settings
  for each row when (new.feature_key = 'nala')
  execute function public.sync_nala_context_to_tenant();

drop trigger if exists tenants_ai_settings_sync on public.tenants;
create trigger tenants_ai_settings_sync
  after insert or update of ai_image_generation, ai_description_generation, ai_semantic_search,
    ai_rate_limit_public_per_minute, ai_rate_limit_public_per_day, ai_rate_limit_admin_per_day,
    chatbox_extra_context on public.tenants
  for each row
  execute function public.sync_tenant_ai_to_settings();

-- ─── 4. Verification ──────────────────────────────────────────────────────────
do $$
declare
  tenant_count bigint;
  matching_count bigint;
  context_count bigint;
  context_matching bigint;
begin
  select count(*) into tenant_count from public.tenants;
  select count(*) into matching_count
  from public.tenants t
  join public.tenant_feature_settings s on s.tenant_id = t.id and s.feature_key = 'ai'
  where s.config = public.ai_config_from_tenant(t);
  if tenant_count <> matching_count then
    raise exception 'AI settings backfill mismatch: tenants=%, matching=%', tenant_count, matching_count;
  end if;

  select count(*) into context_count from public.tenants where chatbox_extra_context is not null;
  select count(*) into context_matching
  from public.tenants t
  join public.tenant_feature_settings s on s.tenant_id = t.id and s.feature_key = 'nala'
  where t.chatbox_extra_context is not null
    and s.config->>'extra_context' = t.chatbox_extra_context;
  if context_count <> context_matching then
    raise exception 'Nala extra context backfill mismatch: tenants=%, matching=%', context_count, context_matching;
  end if;
end
$$;

-- ─── 5. AI flags and limits are server-only (013/076 had granted them) ───────
revoke select (
  ai_image_generation, ai_description_generation, ai_semantic_search,
  ai_rate_limit_public_per_minute, ai_rate_limit_public_per_day
) on table public.tenants from anon, authenticated;

commit;
