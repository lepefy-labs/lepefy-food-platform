-- 144 — Tenant subscription lifecycle: payments ledger, real suspension,
-- per-module suspension and platform audit.
--
-- Until now a SaaS card payment (Stripe Payment Link, webhook metadata
-- type = saas_subscription) only moved the legacy tenants.subscription_paid_until
-- by +30 days, while the admin page read tenant_subscriptions (084): a paid
-- tenant kept seeing "expired". Nothing really suspended a tenant either
-- (status 'expired' only switched off Nala and reviews).
--
--   tenant_subscriptions
--     status            'active' | 'suspended'   (legacy 'expired' → 'suspended')
--     suspension_mode   'manual' (default) | 'automatic'
--     grace_days        automatic suspension N days after paid_until
--     suspended_at / suspension_reason
--   tenant_module_suspensions   platform switch for one module (shop, events…)
--   tenant_subscription_payments  one row per payment; a Stripe checkout
--                                 session is recorded once (retry-safe)
--   tenant_subscription_audit     every platform action, reason mandatory
--
-- Renewal rule (record_tenant_subscription_payment):
--   not suspended when paid → end of the month following the month of the
--                             current paid_until (arrears are covered first)
--   suspended when paid with arrears, or no paid_until → end of the month of
--                             the payment (months without service not charged)
--   (a manual suspension inside a period still paid extends normally).
-- Months end at 23:59:59 UTC, the convention of the existing rows.
--
-- Defaults are conservative: every tenant stays 'manual', so applying this
-- migration suspends nobody. Applying it twice is harmless. Service role only.

-- ── tenant_subscriptions ─────────────────────────────────────────────────────
alter table public.tenant_subscriptions
  add column if not exists suspension_mode text not null default 'manual',
  add column if not exists grace_days integer not null default 15,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspension_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_suspension_mode_check'
                 and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions
      add constraint tenant_subscriptions_suspension_mode_check check (suspension_mode in ('manual', 'automatic'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_grace_days_check'
                 and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions
      add constraint tenant_subscriptions_grace_days_check check (grace_days between 0 and 365);
  end if;
end $$;

alter table public.tenant_subscriptions drop constraint if exists tenant_subscriptions_status_check;
update public.tenant_subscriptions
set status = 'suspended',
    suspended_at = coalesce(suspended_at, now()),
    suspension_reason = coalesce(suspension_reason, 'Statut « expired » converti par la migration 144')
where status = 'expired';
alter table public.tenant_subscriptions
  add constraint tenant_subscriptions_status_check check (status in ('active', 'suspended'));

-- ── Module suspensions ───────────────────────────────────────────────────────
create table if not exists public.tenant_module_suspensions (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  module_key   text not null check (module_key in ('shop', 'events', 'digital_card', 'ai', 'reviews')),
  reason       text not null check (length(btrim(reason)) >= 3),
  suspended_by uuid references public.admin_users(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, module_key)
);

comment on table public.tenant_module_suspensions is
  'Suspension d''un module d''un tenant par la plateforme (indépendante du plan et de l''échéance). Réactivation = suppression via admin_update_tenant_subscription, tracée dans tenant_subscription_audit.';

-- ── Payments ledger ──────────────────────────────────────────────────────────
create table if not exists public.tenant_subscription_payments (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  source                      text not null check (source in ('stripe', 'bank_transfer')),
  amount_cents                integer not null check (amount_cents >= 0),
  currency                    text not null default 'EUR',
  paid_at                     timestamptz not null,
  paid_until_before           timestamptz,
  paid_until_after            timestamptz not null,
  was_suspended               boolean not null,
  stripe_checkout_session_id  text unique,
  note                        text,
  recorded_by                 uuid references public.admin_users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  check (source <> 'stripe' or stripe_checkout_session_id is not null)
);

create index if not exists idx_tenant_subscription_payments_tenant
  on public.tenant_subscription_payments(tenant_id, paid_at desc);

comment on table public.tenant_subscription_payments is
  'Paiements d''abonnement SaaS (carte Stripe ou virement enregistré par la plateforme). Append-only ; une session Stripe n''est enregistrée qu''une fois.';

-- ── Audit ────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_subscription_audit (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  action         text not null check (action in (
                   'payment_recorded', 'suspend', 'reactivate', 'set_paid_until', 'set_payment_link',
                   'set_suspension_policy', 'suspend_module', 'reactivate_module')),
  module_key     text,
  before_state   jsonb,
  after_state    jsonb,
  reason         text,
  actor_admin_id uuid references public.admin_users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_tenant_subscription_audit_tenant
  on public.tenant_subscription_audit(tenant_id, created_at desc);

alter table public.tenant_module_suspensions enable row level security;
alter table public.tenant_subscription_payments enable row level security;
alter table public.tenant_subscription_audit enable row level security;
revoke all on table public.tenant_module_suspensions from anon, authenticated;
revoke all on table public.tenant_subscription_payments from anon, authenticated;
revoke all on table public.tenant_subscription_audit from anon, authenticated;
grant select on table public.tenant_module_suspensions to service_role;
grant select on table public.tenant_subscription_payments to service_role;
grant select on table public.tenant_subscription_audit to service_role;
-- Writes only through the functions below (security definer); no DELETE on
-- the ledger or the audit.
revoke insert, update, delete on table public.tenant_module_suspensions from service_role;
revoke insert, update, delete on table public.tenant_subscription_payments from service_role;
revoke insert, update, delete on table public.tenant_subscription_audit from service_role;

-- ── Period helpers ───────────────────────────────────────────────────────────
create or replace function public.subscription_month_end(p_ts timestamptz)
returns timestamptz
language sql
immutable
as $$
  select (date_trunc('month', p_ts at time zone 'UTC') + interval '1 month' - interval '1 second') at time zone 'UTC'
$$;

create or replace function public.subscription_next_paid_until(
  p_paid_until timestamptz,
  p_paid_at timestamptz,
  p_was_suspended boolean
)
returns timestamptz
language sql
immutable
as $$
  select case
    when p_paid_until is null then public.subscription_month_end(p_paid_at)
    -- Suspended with arrears: the months without service are not charged.
    when p_was_suspended and p_paid_until < p_paid_at then public.subscription_month_end(p_paid_at)
    else public.subscription_month_end(public.subscription_month_end(p_paid_until) + interval '1 second')
  end
$$;

-- Effective suspension at a given instant: manual suspension already in force,
-- or automatic mode past paid_until + grace_days.
create or replace function public.tenant_subscription_suspended_at(
  p_status text,
  p_suspended_at timestamptz,
  p_mode text,
  p_paid_until timestamptz,
  p_grace_days integer,
  p_at timestamptz
)
returns boolean
language sql
immutable
as $$
  select (p_status = 'suspended' and coalesce(p_suspended_at, '-infinity'::timestamptz) <= p_at)
      or (p_mode = 'automatic' and p_paid_until is not null
          and p_at > p_paid_until + make_interval(days => coalesce(p_grace_days, 0)))
$$;

-- ── Record a payment (Stripe webhook or platform bank transfer) ──────────────
create or replace function public.record_tenant_subscription_payment(
  p_tenant_id uuid,
  p_source text,
  p_amount_cents integer,
  p_currency text,
  p_paid_at timestamptz,
  p_stripe_session_id text default null,
  p_note text default null,
  p_actor uuid default null
)
returns table (out_payment_id uuid, out_created boolean, out_paid_until timestamptz, out_was_suspended boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.tenant_subscriptions%rowtype;
  v_existing public.tenant_subscription_payments%rowtype;
  v_suspended boolean;
  v_new timestamptz;
  v_id uuid;
begin
  if p_source not in ('stripe', 'bank_transfer') then raise exception 'invalid_source'; end if;
  if p_source = 'stripe' and coalesce(btrim(p_stripe_session_id), '') = '' then raise exception 'stripe_session_required'; end if;
  if p_source = 'bank_transfer' and p_actor is null then raise exception 'actor_required'; end if;
  if p_amount_cents is null or p_amount_cents < 0 then raise exception 'invalid_amount'; end if;
  if p_paid_at is null or p_paid_at > now() + interval '1 day' then raise exception 'invalid_paid_at'; end if;

  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant_id for update;
  if not found then raise exception 'subscription_not_found'; end if;

  -- Checked after the row lock: a concurrent retry of the same session waits,
  -- then sees the first insert.
  if p_stripe_session_id is not null then
    select * into v_existing from public.tenant_subscription_payments where stripe_checkout_session_id = p_stripe_session_id;
    if found then
      return query select v_existing.id, false, v_existing.paid_until_after, v_existing.was_suspended;
      return;
    end if;
  end if;

  v_suspended := public.tenant_subscription_suspended_at(
    v_sub.status, v_sub.suspended_at, v_sub.suspension_mode, v_sub.paid_until, v_sub.grace_days, p_paid_at);
  v_new := public.subscription_next_paid_until(v_sub.paid_until, p_paid_at, v_suspended);

  insert into public.tenant_subscription_payments (
    tenant_id, source, amount_cents, currency, paid_at, paid_until_before, paid_until_after,
    was_suspended, stripe_checkout_session_id, note, recorded_by)
  values (
    p_tenant_id, p_source, p_amount_cents, coalesce(nullif(btrim(p_currency), ''), 'EUR'), p_paid_at,
    v_sub.paid_until, v_new, v_suspended, nullif(btrim(p_stripe_session_id), ''), nullif(btrim(p_note), ''), p_actor)
  returning id into v_id;

  update public.tenant_subscriptions
  set status = 'active', paid_until = v_new, suspended_at = null, suspension_reason = null, updated_at = now()
  where tenant_id = p_tenant_id;

  -- Legacy mirror (compatibility fallback of platformBilling.ts).
  update public.tenants
  set subscription_status = 'active', subscription_paid_until = v_new, updated_at = now()
  where id = p_tenant_id;

  insert into public.tenant_subscription_audit (tenant_id, action, before_state, after_state, reason, actor_admin_id)
  values (
    p_tenant_id, 'payment_recorded',
    jsonb_build_object('status', v_sub.status, 'paid_until', v_sub.paid_until, 'was_suspended', v_suspended),
    jsonb_build_object('status', 'active', 'paid_until', v_new, 'payment_id', v_id, 'source', p_source, 'amount_cents', p_amount_cents),
    nullif(btrim(p_note), ''), p_actor);

  return query select v_id, true, v_new, v_suspended;
end;
$$;

-- ── Platform actions ─────────────────────────────────────────────────────────
create or replace function public.admin_update_tenant_subscription(
  p_tenant_id uuid,
  p_action text,
  p_actor uuid,
  p_reason text,
  p_paid_until timestamptz default null,
  p_payment_link text default null,
  p_mode text default null,
  p_grace_days integer default null,
  p_module_key text default null
)
returns table (out_action text, out_tenant_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.tenant_subscriptions%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_before jsonb;
  v_after jsonb;
begin
  if p_actor is null then raise exception 'actor_required'; end if;
  if v_reason is null or length(v_reason) < 3 then raise exception 'reason_required'; end if;

  if p_action in ('suspend_module', 'reactivate_module') then
    if p_module_key is null or p_module_key not in ('shop', 'events', 'digital_card', 'ai', 'reviews') then
      raise exception 'invalid_module';
    end if;
    if not exists (select 1 from public.tenants where id = p_tenant_id) then raise exception 'tenant_not_found'; end if;
    if p_action = 'suspend_module' then
      if exists (select 1 from public.tenant_module_suspensions where tenant_id = p_tenant_id and module_key = p_module_key) then
        raise exception 'module_already_suspended';
      end if;
      insert into public.tenant_module_suspensions (tenant_id, module_key, reason, suspended_by)
      values (p_tenant_id, p_module_key, v_reason, p_actor);
    else
      delete from public.tenant_module_suspensions where tenant_id = p_tenant_id and module_key = p_module_key;
      if not found then raise exception 'module_not_suspended'; end if;
    end if;
    insert into public.tenant_subscription_audit (tenant_id, action, module_key, reason, actor_admin_id)
    values (p_tenant_id, p_action, p_module_key, v_reason, p_actor);
    return query select p_action, p_tenant_id;
    return;
  end if;

  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant_id for update;
  if not found then raise exception 'subscription_not_found'; end if;
  v_before := jsonb_build_object(
    'status', v_sub.status, 'paid_until', v_sub.paid_until, 'stripe_payment_link', v_sub.stripe_payment_link,
    'suspension_mode', v_sub.suspension_mode, 'grace_days', v_sub.grace_days);

  if p_action = 'suspend' then
    if v_sub.status = 'suspended' then raise exception 'already_suspended'; end if;
    update public.tenant_subscriptions
    set status = 'suspended', suspended_at = now(), suspension_reason = v_reason, updated_at = now()
    where tenant_id = p_tenant_id;
  elsif p_action = 'reactivate' then
    -- Reactivating while the automatic policy still says "overdue" would look
    -- active here and stay suspended everywhere: fix the date or the mode first.
    if public.tenant_subscription_suspended_at('active', null, v_sub.suspension_mode, v_sub.paid_until, v_sub.grace_days, now()) then
      raise exception 'reactivate_still_overdue';
    end if;
    update public.tenant_subscriptions
    set status = 'active', suspended_at = null, suspension_reason = null, updated_at = now()
    where tenant_id = p_tenant_id;
  elsif p_action = 'set_paid_until' then
    if p_paid_until is null then raise exception 'paid_until_required'; end if;
    update public.tenant_subscriptions set paid_until = p_paid_until, updated_at = now() where tenant_id = p_tenant_id;
    update public.tenants set subscription_paid_until = p_paid_until, updated_at = now() where id = p_tenant_id;
  elsif p_action = 'set_payment_link' then
    if p_payment_link is not null and p_payment_link !~ '^https://[^[:space:]]+$' then raise exception 'invalid_payment_link'; end if;
    update public.tenant_subscriptions set stripe_payment_link = p_payment_link, updated_at = now() where tenant_id = p_tenant_id;
  elsif p_action = 'set_suspension_policy' then
    if p_mode is null or p_mode not in ('manual', 'automatic') then raise exception 'invalid_mode'; end if;
    if p_grace_days is null or p_grace_days < 0 or p_grace_days > 365 then raise exception 'invalid_grace_days'; end if;
    update public.tenant_subscriptions set suspension_mode = p_mode, grace_days = p_grace_days, updated_at = now()
    where tenant_id = p_tenant_id;
  else
    raise exception 'invalid_action';
  end if;

  select jsonb_build_object(
    'status', s.status, 'paid_until', s.paid_until, 'stripe_payment_link', s.stripe_payment_link,
    'suspension_mode', s.suspension_mode, 'grace_days', s.grace_days)
  into v_after from public.tenant_subscriptions s where s.tenant_id = p_tenant_id;

  insert into public.tenant_subscription_audit (tenant_id, action, before_state, after_state, reason, actor_admin_id)
  values (p_tenant_id, p_action, v_before, v_after, v_reason, p_actor);

  return query select p_action, p_tenant_id;
end;
$$;

revoke all on function public.record_tenant_subscription_payment(uuid, text, integer, text, timestamptz, text, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_update_tenant_subscription(uuid, text, uuid, text, timestamptz, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_tenant_subscription_payment(uuid, text, integer, text, timestamptz, text, text, uuid) to service_role;
grant execute on function public.admin_update_tenant_subscription(uuid, text, uuid, text, timestamptz, text, text, integer, text) to service_role;
grant execute on function public.subscription_month_end(timestamptz) to service_role;
grant execute on function public.subscription_next_paid_until(timestamptz, timestamptz, boolean) to service_role;
grant execute on function public.tenant_subscription_suspended_at(text, timestamptz, text, timestamptz, integer, timestamptz) to service_role;
