-- MIGRATION 182: STATISTIQUES — CANAL « EN BOUTIQUE » (PAIEMENTS /card)
--
-- Lecture seule, additive. Remplace admin_sales_statistics (181, même
-- signature, même retour jsonb) en ajoutant la clé in_store : paiements
-- tenant_card_payments payés de la période (nombre, montant, série par bucket,
-- heatmap). Toutes les clés de 181 sont inchangées : les commandes restent la
-- seule source des commandes, du panier moyen, des catégories et des produits.
--
-- Un paiement /card compte si status = 'paid' ; la période porte sur
-- created_at (comme le registre Admin → Paiements carte). La table n'a pas
-- d'indicateur de test : un paiement de test réel en production est compté.
--
-- Ajoute un index (tenant_id, created_at desc) sur tenant_card_payments.
--
-- Rollback : réappliquer 181_admin_sales_statistics.sql, puis
--   drop index if exists public.idx_tenant_card_payments_tenant_created;

begin;

-- Lecture de la période des paiements /card (Statistiques et registre « Paiements carte »).
create index if not exists idx_tenant_card_payments_tenant_created
  on public.tenant_card_payments (tenant_id, created_at desc);

create or replace function public.admin_sales_statistics(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text default 'day',
  p_time_zone text default 'Europe/Paris'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_tenant_id is null or p_from is null or p_to is null or p_to <= p_from
     or p_to - p_from > interval '1100 days'
     or p_bucket is null or p_bucket not in ('day', 'week', 'month')
     or p_time_zone is null or not exists (select 1 from pg_timezone_names where name = p_time_zone) then
    raise exception 'invalid_statistics_range';
  end if;

  with counted as (
    select
      o.id,
      o.total::numeric as total,
      o.created_at,
      o.fulfillment_type,
      coalesce(o.payment_method, 'unknown') as payment_method,
      case when o.fulfillment_type = 'delivery' then upper(nullif(o.shipping_address->>'country', '')) end as country,
      coalesce(o.customer_id::text, 'email:' || lower(nullif(trim(o.email), ''))) as customer_key,
      o.created_at at time zone p_time_zone as local_at
    from public.orders o
    where o.tenant_id = p_tenant_id
      and o.created_at >= p_from
      and o.created_at < p_to
      and o.is_test = false
      and o.payment_status = 'paid'
      and o.status <> 'cancelled'
  ),
  first_orders as (
    -- First counted order ever of each customer of the period (any date).
    select c.customer_key, min(o.created_at) as first_at
    from (select distinct customer_key from counted where customer_key is not null) c
    join public.orders o
      on o.tenant_id = p_tenant_id
     and coalesce(o.customer_id::text, 'email:' || lower(nullif(trim(o.email), ''))) = c.customer_key
     and o.is_test = false and o.payment_status = 'paid' and o.status <> 'cancelled'
    group by c.customer_key
  ),
  card_paid as (
    -- Paiements /card (montant libre en boutique) : canal séparé, jamais mêlé aux commandes.
    select cp.amount::numeric as amount, cp.created_at at time zone p_time_zone as local_at
    from public.tenant_card_payments cp
    where cp.tenant_id = p_tenant_id
      and cp.status = 'paid'
      and cp.created_at >= p_from
      and cp.created_at < p_to
  ),
  items as (
    select
      oi.product_id,
      oi.name,
      oi.quantity,
      oi.subtotal::numeric as subtotal,
      p.name as product_name,
      cat.id as category_id,
      cat.name as category_name
    from public.order_items oi
    join counted c on c.id = oi.order_id
    left join public.products p on p.id = oi.product_id and p.tenant_id = p_tenant_id
    left join public.categories cat on cat.id = p.category_id and cat.tenant_id = p_tenant_id
    where oi.tenant_id = p_tenant_id
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'orders', count(*),
        'revenue', coalesce(sum(total), 0),
        'customers', count(distinct customer_key),
        'new_customers', (select count(*) from first_orders f where f.first_at >= p_from),
        'returning_customers', (select count(*) from first_orders f where f.first_at < p_from),
        'units', (select coalesce(sum(quantity), 0) from items)
      ) from counted
    ),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', to_char(bucket, 'YYYY-MM-DD'), 'orders', orders, 'revenue', revenue) order by bucket)
      from (
        select date_trunc(p_bucket, local_at)::date as bucket, count(*) as orders, sum(total) as revenue
        from counted group by 1
      ) s
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', category_id, 'name', category_name, 'revenue', revenue, 'units', units) order by revenue desc, category_name)
      from (
        select category_id, category_name, sum(subtotal) as revenue, sum(quantity) as units
        from items group by category_id, category_name
      ) s
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('id', product_id, 'name', name, 'revenue', revenue, 'units', units, 'orders', orders) order by revenue desc, units desc, name)
      from (
        select product_id, coalesce(max(product_name), max(name)) as name, sum(subtotal) as revenue, sum(quantity) as units, count(*) as orders
        from items group by product_id, case when product_id is null then name end
        order by sum(subtotal) desc, sum(quantity) desc
        limit 20
      ) s
    ), '[]'::jsonb),
    'fulfillment', coalesce((
      select jsonb_agg(jsonb_build_object('key', fulfillment_type, 'orders', orders, 'revenue', revenue) order by orders desc)
      from (select fulfillment_type, count(*) as orders, sum(total) as revenue from counted group by 1) s
    ), '[]'::jsonb),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object('key', payment_method, 'orders', orders, 'revenue', revenue) order by revenue desc)
      from (select payment_method, count(*) as orders, sum(total) as revenue from counted group by 1) s
    ), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(jsonb_build_object('key', country, 'orders', orders, 'revenue', revenue) order by revenue desc)
      from (select country, count(*) as orders, sum(total) as revenue from counted where fulfillment_type = 'delivery' group by 1) s
    ), '[]'::jsonb),
    'heatmap', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', weekday, 'slot', slot, 'orders', orders) order by weekday, slot)
      from (
        select extract(isodow from local_at)::int as weekday, (extract(hour from local_at)::int / 4) as slot, count(*) as orders
        from counted group by 1, 2
      ) s
    ), '[]'::jsonb),
    'in_store', jsonb_build_object(
      'payments', (select count(*) from card_paid),
      'revenue', (select coalesce(sum(amount), 0) from card_paid),
      'series', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', to_char(bucket, 'YYYY-MM-DD'), 'payments', payments, 'revenue', revenue) order by bucket)
        from (
          select date_trunc(p_bucket, local_at)::date as bucket, count(*) as payments, sum(amount) as revenue
          from card_paid group by 1
        ) s
      ), '[]'::jsonb),
      'heatmap', coalesce((
        select jsonb_agg(jsonb_build_object('weekday', weekday, 'slot', slot, 'payments', payments) order by weekday, slot)
        from (
          select extract(isodow from local_at)::int as weekday, (extract(hour from local_at)::int / 4) as slot, count(*) as payments
          from card_paid group by 1, 2
        ) s
      ), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_sales_statistics(uuid, timestamptz, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.admin_sales_statistics(uuid, timestamptz, timestamptz, text, text) to service_role;

comment on function public.admin_sales_statistics(uuid, timestamptz, timestamptz, text, text) is
  'Statistiques de vente agrégées d''un tenant sur [p_from, p_to) : totaux, série par bucket, catégories, top 20 produits, modes, paiements, pays, heatmap des commandes ; in_store = paiements /card payés (totaux, série, heatmap). Service role uniquement.';

commit;
