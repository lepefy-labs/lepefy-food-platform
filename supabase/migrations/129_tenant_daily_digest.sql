-- MIGRATION 129: DAILY ORDER DIGEST (08:00 operational briefing)
--
-- Additive and opt-in. No order, payment or shipment row is read or written here.
--
-- Configuration lives in the generic operational layer created by 096
-- (tenant_feature_settings), NOT in new tenants.daily_digest_* columns:
--   * one row per (tenant_id, 'daily_order_digest');
--   * enabled = operational activation (a missing row means disabled);
--   * config  = versioned JSONB validated below and by the application.
-- Recipients stay relational (tenant_notification_recipients.notify_daily_digest)
-- and the execution ledger stays in its own table (tenant_daily_digest_runs).
--
-- Safe to re-run. Never enables a tenant by itself.

begin;

-- ─── 1. Catalog registration (non-billable operational module) ───────────────
-- platform_features is the canonical catalog referenced by the FK of
-- tenant_feature_settings. billable = false and NO platform_plan_features /
-- tenant_feature_overrides rows: the digest is included in the platform, it is
-- not purchasable, not part of any plan and not resolved via hasTenantFeature().
insert into public.platform_features (key, name, description, category, active, billable, position)
values (
  'daily_order_digest',
  'Rapport des commandes à 08h',
  'Briefing opérationnel quotidien des commandes à traiter. Module inclus, non facturable.',
  'operations',
  true,
  false,
  200
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  billable = excluded.billable,
  position = excluded.position,
  updated_at = now();

comment on table public.platform_features is
  'Canonical catalog of platform capabilities. billable = true rows are commercial capabilities granted by plans and tenant overrides; billable = false rows are included operational modules registered only so tenant_feature_settings can reference them (never implicitly granted by a plan).';

-- ─── 2. Config validation (defence in depth; the app validates IANA zones) ───
create or replace function public.is_valid_daily_digest_config(p_config jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select jsonb_typeof(p_config) = 'object'
    and p_config - array[
      'version', 'timezone', 'include_empty', 'prepare_hours', 'pickup_hours',
      'payment_verification_hours', 'tracking_stale_hours'
    ] = '{}'::jsonb
    and (not p_config ? 'version' or p_config->'version' = '1'::jsonb)
    and (not p_config ? 'timezone' or (
      jsonb_typeof(p_config->'timezone') = 'string'
      and length(p_config->>'timezone') between 1 and 64
    ))
    and (not p_config ? 'include_empty' or jsonb_typeof(p_config->'include_empty') = 'boolean')
    and coalesce((
      -- CASE guarantees the cast only runs on an integer literal.
      select bool_and(
        case
          when jsonb_typeof(p_config->k) = 'number' and (p_config->>k) ~ '^[0-9]{1,4}$'
            then (p_config->>k)::int between (case when k = 'tracking_stale_hours' then 24 else 1 end) and 336
          else false
        end
      )
      from unnest(array['prepare_hours', 'pickup_hours', 'payment_verification_hours', 'tracking_stale_hours']) as k
      where p_config ? k
    ), true);
$$;

-- The CHECK below runs with the writer's privileges: only server-side writers.
revoke all on function public.is_valid_daily_digest_config(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_daily_digest_config(jsonb) to service_role;

alter table public.tenant_feature_settings
  drop constraint if exists tenant_feature_settings_daily_digest_config_check;
alter table public.tenant_feature_settings
  add constraint tenant_feature_settings_daily_digest_config_check
  check (feature_key <> 'daily_order_digest' or public.is_valid_daily_digest_config(config));

-- ─── 3. Legacy backfill (only where an earlier 129 draft added tenants columns) ─
-- The first draft of this migration stored settings in tenants.daily_digest_*.
-- It was never applied to production, but any environment that did apply it is
-- migrated here without data loss. Legacy columns are left in place (no drop in
-- this phase); a later migration removes them after verification.
do $$
declare
  legacy_columns int;
  legacy_count bigint;
  migrated_count bigint;
begin
  select count(*) into legacy_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'tenants'
    and column_name in (
      'daily_digest_enabled', 'daily_digest_timezone', 'daily_digest_include_empty',
      'daily_digest_prepare_hours', 'daily_digest_pickup_hours',
      'daily_digest_payment_hours', 'daily_digest_shipping_hours'
    );

  if legacy_columns = 0 then
    return;
  end if;
  if legacy_columns <> 7 then
    raise exception 'Partial legacy daily_digest_* columns on tenants (%/7): manual review required', legacy_columns;
  end if;

  execute $sql$
    insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
    select id, 'daily_order_digest', daily_digest_enabled,
      jsonb_build_object(
        'version', 1,
        'timezone', daily_digest_timezone,
        'include_empty', daily_digest_include_empty,
        'prepare_hours', daily_digest_prepare_hours,
        'pickup_hours', daily_digest_pickup_hours,
        'payment_verification_hours', daily_digest_payment_hours,
        'tracking_stale_hours', daily_digest_shipping_hours
      )
    from public.tenants
    where daily_digest_enabled
       or daily_digest_timezone <> 'Europe/Rome'
       or daily_digest_include_empty
       or daily_digest_prepare_hours <> 24
       or daily_digest_pickup_hours <> 48
       or daily_digest_payment_hours <> 48
       or daily_digest_shipping_hours <> 72
    on conflict (tenant_id, feature_key) do nothing
  $sql$;

  -- Every customized legacy row must now have a settings row.
  execute $sql$
    select count(*) from public.tenants
    where daily_digest_enabled or daily_digest_timezone <> 'Europe/Rome' or daily_digest_include_empty
       or daily_digest_prepare_hours <> 24 or daily_digest_pickup_hours <> 48
       or daily_digest_payment_hours <> 48 or daily_digest_shipping_hours <> 72
  $sql$ into legacy_count;
  execute $sql$
    select count(*) from public.tenants t
    join public.tenant_feature_settings s
      on s.tenant_id = t.id and s.feature_key = 'daily_order_digest'
    where t.daily_digest_enabled or t.daily_digest_timezone <> 'Europe/Rome' or t.daily_digest_include_empty
       or t.daily_digest_prepare_hours <> 24 or t.daily_digest_pickup_hours <> 48
       or t.daily_digest_payment_hours <> 48 or t.daily_digest_shipping_hours <> 72
  $sql$ into migrated_count;
  if legacy_count <> migrated_count then
    raise exception 'Daily digest legacy backfill mismatch: legacy=%, migrated=%', legacy_count, migrated_count;
  end if;

  -- Keep legacy values server-only while they still exist.
  revoke select (
    daily_digest_enabled, daily_digest_timezone, daily_digest_include_empty,
    daily_digest_prepare_hours, daily_digest_pickup_hours,
    daily_digest_payment_hours, daily_digest_shipping_hours
  ) on table public.tenants from anon, authenticated;
end
$$;

-- ─── 4. Recipient opt-in (relational, default off) ────────────────────────────
alter table public.tenant_notification_recipients
  add column if not exists notify_daily_digest boolean not null default false;

-- ─── 5. Idempotent execution ledger + claim RPC (server-side only) ────────────
create table if not exists public.tenant_daily_digest_runs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  local_date date not null,
  status text not null check (status in ('processing','accepted','failed','skipped')),
  claimed_at timestamptz not null default now(),
  accepted_at timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  error_code text,
  primary key (tenant_id, local_date)
);

comment on table public.tenant_daily_digest_runs is
  'One row per tenant and tenant-local day. Server-only idempotency ledger of the 08:00 digest; accepted = n8n acknowledged, not inbox delivery.';

alter table public.tenant_daily_digest_runs enable row level security;
revoke all on table public.tenant_daily_digest_runs from public, anon, authenticated;
grant select, insert, update on table public.tenant_daily_digest_runs to service_role;

create or replace function public.claim_tenant_daily_digest(p_tenant uuid, p_date date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into public.tenant_daily_digest_runs(tenant_id, local_date, status, claimed_at)
  values (p_tenant, p_date, 'processing', now())
  on conflict (tenant_id, local_date) do update
    set status = 'processing', claimed_at = now(), error_code = null
  where public.tenant_daily_digest_runs.status = 'failed'
     or (public.tenant_daily_digest_runs.status = 'processing'
         and public.tenant_daily_digest_runs.claimed_at < now() - interval '30 minutes');
  get diagnostics n = row_count;
  return n = 1;
end
$$;

revoke all on function public.claim_tenant_daily_digest(uuid, date) from public, anon, authenticated;
grant execute on function public.claim_tenant_daily_digest(uuid, date) to service_role;

commit;
