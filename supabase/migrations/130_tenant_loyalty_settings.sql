-- MIGRATION 130: LOYALTY SETTINGS → tenant_feature_settings
--
-- Step 1 of the loyalty consolidation (docs/TENANT_CONFIGURATION_ARCHITECTURE.md §4):
--   * registers the included, non-billable module 'loyalty';
--   * backfills one row per tenant from tenants.loyalty_enabled,
--     purchase_points_rate and points_to_currency_rate (count + value check);
--   * keeps both representations identical with guarded two-way triggers, so
--     legacy readers (process_manual_purchase_points_atomic, cached tenant
--     rows, code deployed before this migration) stay correct;
--   * revokes the public column grants of 076 on those three columns.
-- No column is dropped. Points already in points_ledger are never touched.
-- referral_signup_bonus_points belongs to the referral domain and stays put.
--
-- Safe to re-run. Preserves every tenant's current activation.

begin;

-- ─── 1. Catalog (included, non-billable: behavior unchanged for every tenant) ─
insert into public.platform_features (key, name, description, category, active, billable, position)
values (
  'loyalty',
  'Programme fidélité',
  'Points fidélité sur les commandes livrées et les achats en boutique. Module inclus, non facturable.',
  'growth',
  true,
  false,
  210
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  billable = excluded.billable,
  position = excluded.position,
  updated_at = now();

-- ─── 2. Config validation (mirrors numeric(10,4) of the legacy columns) ──────
create or replace function public.is_valid_loyalty_config(p_config jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select jsonb_typeof(p_config) = 'object'
    and p_config - array['version', 'purchase_points_rate', 'points_to_currency_rate'] = '{}'::jsonb
    and (not p_config ? 'version' or p_config->'version' = '1'::jsonb)
    and coalesce((
      select bool_and(
        case
          when jsonb_typeof(p_config->k) = 'number'
            then (p_config->>k)::numeric between 0 and 999999.9999
             and (p_config->>k)::numeric = round((p_config->>k)::numeric, 4)
          else false
        end
      )
      from unnest(array['purchase_points_rate', 'points_to_currency_rate']) as k
      where p_config ? k
    ), true);
$$;

revoke all on function public.is_valid_loyalty_config(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_loyalty_config(jsonb) to service_role;

alter table public.tenant_feature_settings
  drop constraint if exists tenant_feature_settings_loyalty_config_check;
alter table public.tenant_feature_settings
  add constraint tenant_feature_settings_loyalty_config_check
  check (feature_key <> 'loyalty' or public.is_valid_loyalty_config(config));

-- ─── 3. Backfill every tenant (activation and rates preserved verbatim) ───────
insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
select id, 'loyalty', loyalty_enabled,
  jsonb_build_object(
    'version', 1,
    'purchase_points_rate', purchase_points_rate,
    'points_to_currency_rate', points_to_currency_rate
  )
from public.tenants
on conflict (tenant_id, feature_key) do nothing;

-- ─── 4. Two-way sync (guarded: each side writes only when values differ) ─────
create or replace function public.sync_loyalty_settings_to_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric := coalesce((new.config->>'purchase_points_rate')::numeric, 1.0);
  v_currency numeric := coalesce((new.config->>'points_to_currency_rate')::numeric, 0.01);
begin
  update public.tenants t
  set loyalty_enabled = new.enabled,
      purchase_points_rate = v_rate,
      points_to_currency_rate = v_currency
  where t.id = new.tenant_id
    and (t.loyalty_enabled, t.purchase_points_rate, t.points_to_currency_rate)
        is distinct from (new.enabled, v_rate, v_currency);
  return new;
end
$$;

create or replace function public.sync_tenant_loyalty_to_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_feature_settings as s (tenant_id, feature_key, enabled, config)
  values (
    new.id, 'loyalty', new.loyalty_enabled,
    jsonb_build_object(
      'version', 1,
      'purchase_points_rate', new.purchase_points_rate,
      'points_to_currency_rate', new.points_to_currency_rate
    )
  )
  on conflict (tenant_id, feature_key) do update
    set enabled = excluded.enabled,
        config = s.config || jsonb_build_object(
          'purchase_points_rate', new.purchase_points_rate,
          'points_to_currency_rate', new.points_to_currency_rate
        ),
        updated_at = now()
  where (s.enabled,
         coalesce((s.config->>'purchase_points_rate')::numeric, 1.0),
         coalesce((s.config->>'points_to_currency_rate')::numeric, 0.01))
        is distinct from (new.loyalty_enabled, new.purchase_points_rate, new.points_to_currency_rate);
  return new;
end
$$;

revoke all on function public.sync_loyalty_settings_to_tenant() from public, anon, authenticated;
revoke all on function public.sync_tenant_loyalty_to_settings() from public, anon, authenticated;

drop trigger if exists tenant_feature_settings_loyalty_sync on public.tenant_feature_settings;
create trigger tenant_feature_settings_loyalty_sync
  after insert or update of enabled, config on public.tenant_feature_settings
  for each row when (new.feature_key = 'loyalty')
  execute function public.sync_loyalty_settings_to_tenant();

drop trigger if exists tenants_loyalty_settings_sync on public.tenants;
create trigger tenants_loyalty_settings_sync
  after insert or update of loyalty_enabled, purchase_points_rate, points_to_currency_rate on public.tenants
  for each row
  execute function public.sync_tenant_loyalty_to_settings();

-- ─── 5. Verification: one identical row per tenant ───────────────────────────
do $$
declare
  tenant_count bigint;
  matching_count bigint;
begin
  select count(*) into tenant_count from public.tenants;
  select count(*) into matching_count
  from public.tenants t
  join public.tenant_feature_settings s on s.tenant_id = t.id and s.feature_key = 'loyalty'
  where s.enabled = t.loyalty_enabled
    and coalesce((s.config->>'purchase_points_rate')::numeric, 1.0) = t.purchase_points_rate
    and coalesce((s.config->>'points_to_currency_rate')::numeric, 0.01) = t.points_to_currency_rate;
  if tenant_count <> matching_count then
    raise exception 'Loyalty settings backfill mismatch: tenants=%, matching=%', tenant_count, matching_count;
  end if;
end
$$;

-- ─── 6. Loyalty values are server-only (076 had granted them publicly) ───────
revoke select (loyalty_enabled, purchase_points_rate, points_to_currency_rate)
  on table public.tenants from anon, authenticated;

commit;
