-- MIGRATION 098: NALA CONVERSION ATTRIBUTION V1
-- Additive, service-role-only product attribution. Raw conversation purge keeps conversion facts.

insert into public.platform_features (key, name, description, category, active, billable, position)
values (
  'nala_conversion_attribution',
  'Nala Conversion Attribution',
  'Product-level assisted cart, checkout and purchase attribution for Nala.',
  'ai',
  true,
  true,
  70
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  billable = excluded.billable,
  position = excluded.position,
  updated_at = now();

insert into public.platform_plan_features (plan_id, feature_key, label, position)
select id, 'nala_conversion_attribution', 'Nala Conversion Attribution', 70
from public.platform_plans
where code = 'food-platform'
on conflict (plan_id, feature_key) do update set
  label = excluded.label,
  position = excluded.position;

create table if not exists public.nala_checkout_attributions (
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  nala_session_id uuid references public.nala_sessions(id) on delete set null,
  nala_interaction_id uuid references public.nala_interactions(id) on delete set null,
  attribution_model text not null,
  attributed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (checkout_session_id, product_id),
  check (char_length(attribution_model) <= 50)
);

create table if not exists public.nala_conversion_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nala_session_id uuid references public.nala_sessions(id) on delete set null,
  nala_interaction_id uuid references public.nala_interactions(id) on delete set null,
  event_type text not null check (event_type in ('add_to_cart', 'checkout_started', 'purchase_completed')),
  product_id uuid not null,
  checkout_session_id uuid,
  order_id uuid,
  quantity integer check (quantity is null or quantity > 0),
  unit_price numeric(12,2) check (unit_price is null or unit_price >= 0),
  assisted_value numeric(12,2) check (assisted_value is null or assisted_value >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  attribution_model text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  check (char_length(attribution_model) <= 50),
  check (char_length(idempotency_key) <= 160),
  check (
    (event_type = 'purchase_completed' and order_id is not null and checkout_session_id is not null and assisted_value is not null)
    or (event_type = 'checkout_started' and checkout_session_id is not null and order_id is null and assisted_value is null)
    or (event_type = 'add_to_cart' and checkout_session_id is null and order_id is null and assisted_value is null)
  )
);

comment on table public.nala_checkout_attributions is
  'Minimized product-level Nala lineage attached to a recoverable checkout; last qualifying touch wins per product.';
comment on table public.nala_conversion_events is
  'Durable conversion facts. Raw Nala retention sets session/interaction references NULL but preserves product, order and assisted value.';
comment on column public.nala_conversion_events.assisted_value is
  'Gross value of the final assisted order item, before order-level discounts and shipping.';

create index if not exists nala_checkout_attributions_tenant_session_idx
  on public.nala_checkout_attributions (tenant_id, checkout_session_id);
create index if not exists nala_conversion_events_tenant_occurred_idx
  on public.nala_conversion_events (tenant_id, occurred_at desc);
create index if not exists nala_conversion_events_tenant_type_occurred_idx
  on public.nala_conversion_events (tenant_id, event_type, occurred_at desc);
create index if not exists nala_conversion_events_tenant_product_occurred_idx
  on public.nala_conversion_events (tenant_id, product_id, occurred_at desc);
create index if not exists nala_conversion_events_order_idx
  on public.nala_conversion_events (order_id) where order_id is not null;

alter table public.nala_checkout_attributions enable row level security;
alter table public.nala_conversion_events enable row level security;

revoke all on table public.nala_checkout_attributions from public, anon, authenticated;
revoke all on table public.nala_conversion_events from public, anon, authenticated;
grant select, insert, update, delete on public.nala_checkout_attributions to service_role;
grant select, insert, update, delete on public.nala_conversion_events to service_role;

create or replace function public.record_nala_purchase_attribution(
  p_checkout_session_id uuid,
  p_order_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if not exists (
    select 1
    from public.checkout_sessions checkout
    join public.orders purchase
      on purchase.id = p_order_id
     and purchase.tenant_id = checkout.tenant_id
     and purchase.payment_status = 'paid'
    where checkout.id = p_checkout_session_id
      and checkout.order_id = p_order_id
  ) then
    return 0;
  end if;

  insert into public.nala_conversion_events (
    tenant_id,
    nala_session_id,
    nala_interaction_id,
    event_type,
    product_id,
    checkout_session_id,
    order_id,
    quantity,
    unit_price,
    assisted_value,
    currency,
    attribution_model,
    idempotency_key,
    occurred_at
  )
  select
    purchase.tenant_id,
    attribution.nala_session_id,
    attribution.nala_interaction_id,
    'purchase_completed',
    item.product_id,
    p_checkout_session_id,
    purchase.id,
    sum(item.quantity)::integer,
    case when sum(item.quantity) > 0 then round(sum(item.subtotal) / sum(item.quantity), 2) else null end,
    round(sum(item.subtotal), 2),
    upper(coalesce(tenant.currency, 'EUR')),
    attribution.attribution_model,
    'purchase:' || purchase.id::text || ':' || item.product_id::text,
    coalesce(purchase.updated_at, purchase.created_at, now())
  from public.orders purchase
  join public.tenants tenant on tenant.id = purchase.tenant_id
  join public.order_items item
    on item.order_id = purchase.id
   and item.tenant_id = purchase.tenant_id
   and item.product_id is not null
  join public.nala_checkout_attributions attribution
    on attribution.checkout_session_id = p_checkout_session_id
   and attribution.tenant_id = purchase.tenant_id
   and attribution.product_id = item.product_id
  where purchase.id = p_order_id
    and purchase.payment_status = 'paid'
  group by
    purchase.tenant_id,
    attribution.nala_session_id,
    attribution.nala_interaction_id,
    item.product_id,
    purchase.id,
    tenant.currency,
    attribution.attribution_model,
    purchase.updated_at,
    purchase.created_at
  on conflict (tenant_id, idempotency_key) do update set
    quantity = excluded.quantity,
    unit_price = excluded.unit_price,
    assisted_value = excluded.assisted_value,
    currency = excluded.currency,
    occurred_at = excluded.occurred_at;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

comment on function public.record_nala_purchase_attribution(uuid, uuid) is
  'Idempotently records gross assisted item value from final paid order_items; rejects cross-tenant or unlinked checkout/order pairs.';
revoke all on function public.record_nala_purchase_attribution(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_nala_purchase_attribution(uuid, uuid) to service_role;
