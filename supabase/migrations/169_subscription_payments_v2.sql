-- 169 — Subscription payments v2: PayPal, payment references, retry-safe
-- platform records, Stripe event id, legacy mirror on suspend/reactivate,
-- a subscription row for every tenant. Additive; applying it twice is harmless.
--
--   tenant_subscription_payments
--     source             'stripe' | 'bank_transfer' | 'paypal'
--     external_reference bank / PayPal transaction reference; one payment per
--                        (tenant, source, reference): the same transfer can
--                        never be recorded twice
--     request_key        idempotency key of a platform form submission: a
--                        double click or an HTTP retry returns the same payment
--     stripe_event_id    Stripe event that confirmed the payment (trace only;
--                        the checkout session stays the dedup key)
--   record_tenant_subscription_payment  same rule and return shape, three new
--                        parameters with defaults (callers of 144 keep working)
--   admin_update_tenant_subscription    suspend / reactivate also keep the
--                        legacy tenants.subscription_status in step
--   tenants AFTER INSERT  creates the tenant_subscriptions row (default active
--                        plan, no due date, manual mode: nobody is suspended),
--                        plus a backfill for tenants that have none
--   platform_billing_settings.paypal_url  Lepefy's PayPal link for tenants
--
-- No existing payment, due date or status is changed.

-- ── Payments ledger ──────────────────────────────────────────────────────────
alter table public.tenant_subscription_payments
  add column if not exists external_reference text,
  add column if not exists request_key text,
  add column if not exists stripe_event_id text;

alter table public.tenant_subscription_payments drop constraint if exists tenant_subscription_payments_source_check;
alter table public.tenant_subscription_payments
  add constraint tenant_subscription_payments_source_check check (source in ('stripe', 'bank_transfer', 'paypal'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscription_payments_reference_check'
                 and conrelid = 'public.tenant_subscription_payments'::regclass) then
    alter table public.tenant_subscription_payments
      add constraint tenant_subscription_payments_reference_check
      check (external_reference is null or length(btrim(external_reference)) between 3 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscription_payments_request_key_check'
                 and conrelid = 'public.tenant_subscription_payments'::regclass) then
    alter table public.tenant_subscription_payments
      add constraint tenant_subscription_payments_request_key_check
      check (request_key is null or length(request_key) between 8 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscription_payments_paypal_reference_check'
                 and conrelid = 'public.tenant_subscription_payments'::regclass) then
    alter table public.tenant_subscription_payments
      add constraint tenant_subscription_payments_paypal_reference_check
      check (source <> 'paypal' or external_reference is not null);
  end if;
end $$;

create unique index if not exists uq_tenant_subscription_payments_reference
  on public.tenant_subscription_payments (tenant_id, source, lower(btrim(external_reference)))
  where external_reference is not null;
create unique index if not exists uq_tenant_subscription_payments_request_key
  on public.tenant_subscription_payments (tenant_id, request_key)
  where request_key is not null;

comment on column public.tenant_subscription_payments.external_reference is
  'Référence du virement ou n° de transaction PayPal : un même paiement ne peut être enregistré deux fois pour un tenant.';
comment on column public.tenant_subscription_payments.request_key is
  'Clé d''idempotence d''un enregistrement depuis la console : un double envoi renvoie le même paiement.';

-- ── Record a payment ─────────────────────────────────────────────────────────
drop function if exists public.record_tenant_subscription_payment(uuid, text, integer, text, timestamptz, text, text, uuid);

create or replace function public.record_tenant_subscription_payment(
  p_tenant_id uuid,
  p_source text,
  p_amount_cents integer,
  p_currency text,
  p_paid_at timestamptz,
  p_stripe_session_id text default null,
  p_note text default null,
  p_actor uuid default null,
  p_external_reference text default null,
  p_request_key text default null,
  p_stripe_event_id text default null
)
returns table (out_payment_id uuid, out_created boolean, out_paid_until timestamptz, out_was_suspended boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.tenant_subscriptions%rowtype;
  v_existing public.tenant_subscription_payments%rowtype;
  v_reference text := nullif(btrim(p_external_reference), '');
  v_request_key text := nullif(btrim(p_request_key), '');
  v_suspended boolean;
  v_new timestamptz;
  v_id uuid;
begin
  if p_source not in ('stripe', 'bank_transfer', 'paypal') then raise exception 'invalid_source'; end if;
  if p_source = 'stripe' and coalesce(btrim(p_stripe_session_id), '') = '' then raise exception 'stripe_session_required'; end if;
  if p_source in ('bank_transfer', 'paypal') and p_actor is null then raise exception 'actor_required'; end if;
  if p_source = 'paypal' and v_reference is null then raise exception 'reference_required'; end if;
  if v_reference is not null and length(v_reference) not between 3 and 120 then raise exception 'invalid_reference'; end if;
  if v_request_key is not null and length(v_request_key) not between 8 and 80 then raise exception 'invalid_request_key'; end if;
  if p_amount_cents is null or p_amount_cents < 0 then raise exception 'invalid_amount'; end if;
  if p_paid_at is null or p_paid_at > now() + interval '1 day' then raise exception 'invalid_paid_at'; end if;

  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant_id for update;
  if not found then raise exception 'subscription_not_found'; end if;

  -- Checked after the row lock: a concurrent retry waits, then sees the first insert.
  if p_stripe_session_id is not null then
    select * into v_existing from public.tenant_subscription_payments where stripe_checkout_session_id = p_stripe_session_id;
    if found then
      return query select v_existing.id, false, v_existing.paid_until_after, v_existing.was_suspended;
      return;
    end if;
  end if;
  if v_request_key is not null then
    select * into v_existing from public.tenant_subscription_payments where tenant_id = p_tenant_id and request_key = v_request_key;
    if found then
      return query select v_existing.id, false, v_existing.paid_until_after, v_existing.was_suspended;
      return;
    end if;
  end if;
  if v_reference is not null and exists (
    select 1 from public.tenant_subscription_payments
    where tenant_id = p_tenant_id and source = p_source and lower(btrim(external_reference)) = lower(v_reference)
  ) then
    raise exception 'duplicate_external_reference';
  end if;

  v_suspended := public.tenant_subscription_suspended_at(
    v_sub.status, v_sub.suspended_at, v_sub.suspension_mode, v_sub.paid_until, v_sub.grace_days, p_paid_at);
  v_new := public.subscription_next_paid_until(v_sub.paid_until, p_paid_at, v_suspended);

  insert into public.tenant_subscription_payments (
    tenant_id, source, amount_cents, currency, paid_at, paid_until_before, paid_until_after,
    was_suspended, stripe_checkout_session_id, note, recorded_by, external_reference, request_key, stripe_event_id)
  values (
    p_tenant_id, p_source, p_amount_cents, coalesce(nullif(btrim(p_currency), ''), 'EUR'), p_paid_at,
    v_sub.paid_until, v_new, v_suspended, nullif(btrim(p_stripe_session_id), ''), nullif(btrim(p_note), ''), p_actor,
    v_reference, v_request_key, nullif(btrim(p_stripe_event_id), ''))
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
    jsonb_build_object('status', 'active', 'paid_until', v_new, 'payment_id', v_id, 'source', p_source,
                       'amount_cents', p_amount_cents, 'external_reference', v_reference),
    nullif(btrim(p_note), ''), p_actor);

  return query select v_id, true, v_new, v_suspended;
end;
$$;

-- ── Platform actions (144 + legacy mirror on suspend / reactivate) ───────────
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
    update public.tenants set subscription_status = 'expired', updated_at = now() where id = p_tenant_id;
  elsif p_action = 'reactivate' then
    -- Reactivating while the automatic policy still says "overdue" would look
    -- active here and stay suspended everywhere: fix the date or the mode first.
    if public.tenant_subscription_suspended_at('active', null, v_sub.suspension_mode, v_sub.paid_until, v_sub.grace_days, now()) then
      raise exception 'reactivate_still_overdue';
    end if;
    update public.tenant_subscriptions
    set status = 'active', suspended_at = null, suspension_reason = null, updated_at = now()
    where tenant_id = p_tenant_id;
    update public.tenants set subscription_status = 'active', updated_at = now() where id = p_tenant_id;
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

-- ── A subscription row for every tenant ──────────────────────────────────────
-- Default plan: 'food-platform' when active, otherwise the oldest active plan.
-- No due date and manual mode: a new tenant is never suspended by this row.
create or replace function public.default_platform_plan_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.platform_plans
  where active
  order by (code = 'food-platform') desc, created_at asc
  limit 1
$$;

create or replace function public.ensure_tenant_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan uuid := public.default_platform_plan_id();
begin
  if v_plan is not null then
    insert into public.tenant_subscriptions (tenant_id, plan_id, status, paid_until)
    values (new.id, v_plan, 'active', null)
    on conflict (tenant_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_ensure_subscription on public.tenants;
create trigger tenants_ensure_subscription
  after insert on public.tenants
  for each row execute function public.ensure_tenant_subscription();

insert into public.tenant_subscriptions (tenant_id, plan_id, status, paid_until)
select t.id, public.default_platform_plan_id(), 'active', null
from public.tenants t
where public.default_platform_plan_id() is not null
  and not exists (select 1 from public.tenant_subscriptions s where s.tenant_id = t.id);

-- ── Lepefy PayPal link ───────────────────────────────────────────────────────
alter table public.platform_billing_settings add column if not exists paypal_url text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_billing_settings_paypal_url_check'
                 and conrelid = 'public.platform_billing_settings'::regclass) then
    alter table public.platform_billing_settings
      add constraint platform_billing_settings_paypal_url_check check (paypal_url is null or paypal_url ~ '^https://[^[:space:]]+$');
  end if;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke all on function public.record_tenant_subscription_payment(uuid, text, integer, text, timestamptz, text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_tenant_subscription_payment(uuid, text, integer, text, timestamptz, text, text, uuid, text, text, text) to service_role;
revoke all on function public.admin_update_tenant_subscription(uuid, text, uuid, text, timestamptz, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.admin_update_tenant_subscription(uuid, text, uuid, text, timestamptz, text, text, integer, text) to service_role;
revoke all on function public.default_platform_plan_id() from public, anon, authenticated;
revoke all on function public.ensure_tenant_subscription() from public, anon, authenticated;
grant execute on function public.default_platform_plan_id() to service_role;
