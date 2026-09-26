-- MIGRATION 131: LOYALTY LEGACY CLEANUP (phase 5 of the loyalty consolidation)
--
-- DESTRUCTIVE: drops tenants.loyalty_enabled, purchase_points_rate and
-- points_to_currency_rate. tenant_feature_settings('loyalty') (migration 130)
-- becomes the only source of truth.
--
-- Preconditions (enforced below; the migration aborts otherwise):
--   * migration 130 applied: 'loyalty' registered;
--   * every tenant has a loyalty settings row identical to its legacy columns.
-- Deployment order: deploy the application commit that no longer reads the
-- legacy columns FIRST, then apply this migration. Code deployed before that
-- commit selects tenants.loyalty_enabled explicitly and would fail afterwards.
--
-- Rollback (restores the pre-131 schema from the settings rows, which hold the
-- same values):
--   alter table public.tenants
--     add column loyalty_enabled boolean not null default false,
--     add column purchase_points_rate numeric(10,4) not null default 1.0,
--     add column points_to_currency_rate numeric(10,4) not null default 0.01;
--   update public.tenants t set loyalty_enabled = s.enabled,
--     purchase_points_rate = coalesce((s.config->>'purchase_points_rate')::numeric, 1.0),
--     points_to_currency_rate = coalesce((s.config->>'points_to_currency_rate')::numeric, 0.01)
--   from public.tenant_feature_settings s where s.tenant_id = t.id and s.feature_key = 'loyalty';
--   then re-apply 047 §10 and the triggers of 130.
--
-- Safe to re-run: every step is guarded.

begin;

-- ─── 1. Preconditions ─────────────────────────────────────────────────────────
do $$
declare
  legacy_columns int;
  tenant_count bigint;
  matching_count bigint;
begin
  if not exists (select 1 from public.platform_features where key = 'loyalty') then
    raise exception 'Migration 130 must be applied before 131 (loyalty feature missing)';
  end if;

  select count(*) into legacy_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'tenants'
    and column_name in ('loyalty_enabled', 'purchase_points_rate', 'points_to_currency_rate');

  select count(*) into tenant_count from public.tenants;

  if legacy_columns = 3 then
    execute $sql$
      select count(*)
      from public.tenants t
      join public.tenant_feature_settings s on s.tenant_id = t.id and s.feature_key = 'loyalty'
      where s.enabled = t.loyalty_enabled
        and coalesce((s.config->>'purchase_points_rate')::numeric, 1.0) = t.purchase_points_rate
        and coalesce((s.config->>'points_to_currency_rate')::numeric, 0.01) = t.points_to_currency_rate
    $sql$ into matching_count;
    if matching_count <> tenant_count then
      raise exception 'Loyalty settings differ from legacy columns (tenants=%, matching=%): aborting before any drop',
        tenant_count, matching_count;
    end if;
  elsif legacy_columns <> 0 then
    raise exception 'Partial legacy loyalty columns (%/3): manual review required', legacy_columns;
  end if;

  select count(*) into matching_count
  from public.tenant_feature_settings
  where feature_key = 'loyalty';
  if matching_count <> tenant_count then
    raise exception 'Every tenant needs a loyalty settings row (tenants=%, rows=%)', tenant_count, matching_count;
  end if;
end
$$;

-- ─── 2. In-store points read the settings row (same signature and behavior) ──
-- Previously: select purchase_points_rate from tenants (047 §10).
create or replace function process_manual_purchase_points_atomic(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_staff_admin_id uuid,
  p_amount numeric
) returns table(points_awarded integer, new_confirmed_balance integer) as $$
declare
  v_rate               numeric;
  v_points             integer;
  v_manual_purchase_id uuid;
  v_balance            integer;
begin
  select coalesce((s.config->>'purchase_points_rate')::numeric, 1.0)
    into v_rate
  from public.tenants t
  join public.tenant_feature_settings s on s.tenant_id = t.id and s.feature_key = 'loyalty'
  where t.id = p_tenant_id;
  if v_rate is null then
    raise exception 'tenant % non trovato o senza impostazioni loyalty', p_tenant_id;
  end if;

  v_points := round(p_amount * v_rate);

  insert into loyalty_manual_purchases (
    tenant_id, customer_id, staff_admin_id, amount, points_awarded
  ) values (
    p_tenant_id, p_customer_id, p_staff_admin_id, p_amount, v_points
  ) returning id into v_manual_purchase_id;

  insert into points_ledger (
    tenant_id, customer_id, amount, status, transaction_type, manual_purchase_id
  ) values (
    p_tenant_id, p_customer_id, v_points, 'CONFIRMED', 'IN_STORE_PURCHASE_EARNED', v_manual_purchase_id
  );

  select coalesce(sum(amount) filter (where status in ('CONFIRMED', 'REVERSED')), 0)
    into v_balance
  from points_ledger
  where tenant_id = p_tenant_id and customer_id = p_customer_id;

  return query select v_points, v_balance;
end;
$$ language plpgsql;

grant execute on function process_manual_purchase_points_atomic(uuid, uuid, uuid, numeric) to service_role;

-- ─── 3. Remove the 130 mirror ─────────────────────────────────────────────────
drop trigger if exists tenant_feature_settings_loyalty_sync on public.tenant_feature_settings;
drop trigger if exists tenants_loyalty_settings_sync on public.tenants;
drop function if exists public.sync_loyalty_settings_to_tenant();
drop function if exists public.sync_tenant_loyalty_to_settings();

-- ─── 4. Drop the legacy columns ───────────────────────────────────────────────
-- New tenants get no automatic row any more: a missing row means disabled.
alter table public.tenants
  drop column if exists loyalty_enabled,
  drop column if exists purchase_points_rate,
  drop column if exists points_to_currency_rate;

commit;
