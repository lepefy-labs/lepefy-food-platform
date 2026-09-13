-- Read-only, tenant-scoped catalogue ranking. Callable by the server service role
-- only: sales data never cross the public API boundary.
create index if not exists idx_catalog_orders_paid_recent
  on public.orders (tenant_id, created_at desc, id)
  where payment_status = 'paid' and is_test = false
    and status not in ('cancelled', 'stock_conflict');

create index if not exists idx_catalog_order_items_order
  on public.order_items (order_id, product_id) include (quantity);

create or replace function public.catalog_ranked_product_ids(
  p_tenant_id uuid,
  p_category_id uuid default null,
  p_query text default '',
  p_sort text default 'recommended',
  p_day date default current_date,
  p_offset integer default 0,
  p_limit integer default 24
)
returns table (product_id uuid, total_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible as (
    select p.id, p.category_id, p.position, p.featured, p.created_at,
           p.price, p.compare_at_price, p.stock
    from public.products p
    join public.categories c on c.id = p.category_id
      and c.tenant_id = p_tenant_id and c.catalog_scope = 'shop'
    where p.tenant_id = p_tenant_id and p.active = true
      and (p_category_id is null or p.category_id = p_category_id)
      and (coalesce(btrim(p_query), '') = ''
        or p.name ilike '%' || left(btrim(p_query), 100) || '%')
  ),
  recent_sales as (
    select oi.product_id, sum(oi.quantity)::numeric as units
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
      and oi.tenant_id = p_tenant_id
    where o.tenant_id = p_tenant_id
      and p_sort in ('recommended', 'bestsellers')
      and o.payment_status = 'paid' and o.is_test = false
      and o.status not in ('cancelled', 'stock_conflict')
      -- Completed UTC days avoid mid-session reordering when orders arrive.
      and o.created_at >= (p_day - 30)::timestamp at time zone 'UTC'
      and o.created_at < p_day::timestamp at time zone 'UTC'
    group by oi.product_id
  ),
  scored as (
    select e.*, coalesce(s.units, 0) as units,
      least(35::numeric, 10 * ln(1 + coalesce(s.units, 0)))
      + case when e.position < 9999
          then 25 * (1 - least(100, greatest(0, e.position))::numeric / 100)
          else 0 end
      + case when e.featured then 10 else 0 end
      + case when e.created_at >= p_day - 14
          then 15 * (1 - greatest(0, (p_day - e.created_at::date))::numeric / 14)
          else 0 end
      + case when e.compare_at_price > e.price and e.price > 0
          then least(10::numeric, 40 * (e.compare_at_price - e.price) / e.compare_at_price)
          else 0 end
      + case when e.stock > 0 then 10 else 0 end as score
    from eligible e left join recent_sales s on s.product_id = e.id
  ),
  diverse as (
    select *,
      row_number() over (partition by category_id order by score desc, position, id) as category_rank
    from scored
  ),
  ranked as (
    select id, stock, row_number() over (
      order by
        case when stock > 0 then 0 else 1 end,
        case when p_sort = 'bestsellers' then units end desc nulls last,
        case when p_sort = 'newest' then created_at end desc nulls last,
        case when p_sort = 'price_asc' then price end asc nulls last,
        case when p_sort = 'price_desc' then price end desc nulls last,
        case when p_sort = 'recommended'
          then score - least(8::numeric, 2 * (category_rank - 1)) end desc nulls last,
        position asc, id asc
    ) as rank_no
    from diverse
  ),
  -- One daily rotating discovery candidate per 20 results, drawn from the
  -- next 96 eligible ranked products. The first 19 retain commercial priority.
  discovery as (
    select id, row_number() over (order by md5(id::text || p_day::text || p_tenant_id::text)) as slot_no
    from ranked
    where p_sort = 'recommended' and stock > 0 and rank_no between 25 and 120
    order by md5(id::text || p_day::text || p_tenant_id::text)
    limit 6
  ),
  baseline as (
    select r.id, row_number() over (order by r.rank_no) as base_no
    from ranked r
    where not exists (select 1 from discovery d where d.id = r.id)
  ),
  ordered as (
    select id, base_no + (base_no - 1) / 19 as slot from baseline
    union all
    select id, slot_no * 20 as slot from discovery
  ),
  result as (
    select id, count(*) over () as total
    from ordered
    order by slot, id
    offset greatest(0, p_offset)
    limit least(2400, greatest(1, p_limit))
  )
  select id, total from result;
$$;

revoke all on function public.catalog_ranked_product_ids(uuid, uuid, text, text, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.catalog_ranked_product_ids(uuid, uuid, text, text, date, integer, integer)
  to service_role;
