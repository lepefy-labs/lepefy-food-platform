-- Runs after the 130 chain (130 fixture -> 094 -> 096 -> 129 -> 130 seed -> 130):
-- the minimal loyalty tables of 040/047 and the original in-store points RPC
-- that still reads tenants.purchase_points_rate.
create table public.customers (id uuid primary key, tenant_id uuid not null references public.tenants(id));
create table public.admin_users (id uuid primary key);
create table public.loyalty_manual_purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  customer_id uuid not null references public.customers(id),
  staff_admin_id uuid not null references public.admin_users(id),
  amount numeric(10,2) not null check (amount > 0),
  points_awarded integer not null,
  created_at timestamptz not null default now()
);
create table public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  customer_id uuid not null references public.customers(id),
  amount integer not null,
  status text not null,
  transaction_type text not null,
  manual_purchase_id uuid references public.loyalty_manual_purchases(id),
  created_at timestamptz not null default now()
);

create or replace function process_manual_purchase_points_atomic(
  p_tenant_id uuid, p_customer_id uuid, p_staff_admin_id uuid, p_amount numeric
) returns table(points_awarded integer, new_confirmed_balance integer) as $$
declare
  v_rate numeric; v_points integer; v_manual_purchase_id uuid; v_balance integer;
begin
  select purchase_points_rate into v_rate from tenants where id = p_tenant_id;
  if v_rate is null then raise exception 'tenant % non trovato', p_tenant_id; end if;
  v_points := round(p_amount * v_rate);
  insert into loyalty_manual_purchases (tenant_id, customer_id, staff_admin_id, amount, points_awarded)
  values (p_tenant_id, p_customer_id, p_staff_admin_id, p_amount, v_points) returning id into v_manual_purchase_id;
  insert into points_ledger (tenant_id, customer_id, amount, status, transaction_type, manual_purchase_id)
  values (p_tenant_id, p_customer_id, v_points, 'CONFIRMED', 'IN_STORE_PURCHASE_EARNED', v_manual_purchase_id);
  select coalesce(sum(amount) filter (where status in ('CONFIRMED', 'REVERSED')), 0) into v_balance
  from points_ledger where tenant_id = p_tenant_id and customer_id = p_customer_id;
  return query select v_points, v_balance;
end;
$$ language plpgsql;
grant execute on function process_manual_purchase_points_atomic to service_role;

insert into public.customers (id, tenant_id) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222');
insert into public.admin_users (id) values ('cccccccc-0000-4000-8000-00000000000c');

-- Existing points history that must survive the cleanup untouched.
select * from process_manual_purchase_points_atomic(
  '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-00000000000a',
  'cccccccc-0000-4000-8000-00000000000c', 10);

create table public._fixture_ledger_before as select * from public.points_ledger;
create table public._fixture_loyalty_before as
select tenant_id, enabled, config from public.tenant_feature_settings where feature_key = 'loyalty';
