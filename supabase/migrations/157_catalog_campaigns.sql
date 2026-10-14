-- Persistent, tenant-scoped catalogue campaigns. Requires 153 and 156.
-- Apply separately from the code deploy after reviewing production dependencies.
begin;

-- Composite key for the (tenant_id, product_id) FK below. Already created by 139
-- in production; guarded so 157 also applies on a database without 139 (CI).
do $$
begin
  if not exists (select 1 from pg_constraint c where c.conname = 'products_tenant_id_id_key') then
    alter table public.products add constraint products_tenant_id_id_key unique (tenant_id, id);
  end if;
end
$$;

create table public.catalog_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  description text,
  kind text not null check (kind in ('promotion','novelty','mixed')),
  status text not null default 'draft' check (status in ('draft','scheduled','running','suspended','ended')),
  discount_mode text check (discount_mode in ('percent','fixed','custom')),
  discount_value numeric(10,2),
  promo_starts_at timestamptz,
  promo_ends_at timestamptz,
  promo_until_sold_out boolean not null default false,
  novelty_starts_at timestamptz,
  novelty_ends_at timestamptz,
  starts_at_sort timestamptz generated always as (least(promo_starts_at,novelty_starts_at)) stored,
  version integer not null default 1 check (version > 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_tick_at timestamptz,
  last_error text,
  unique (tenant_id,id),
  check (promo_starts_at is null or promo_ends_at is null or promo_ends_at > promo_starts_at),
  check (novelty_starts_at is null or novelty_ends_at is null or novelty_ends_at > novelty_starts_at),
  check (kind = 'novelty' or (discount_mode is not null and (discount_mode = 'custom' or discount_value is not null))),
  check (discount_mode <> 'percent' or discount_value between 0.01 and 99.99),
  check (discount_mode <> 'fixed' or discount_value > 0),
  check (kind = 'promotion' or novelty_ends_at is not null)
);

create table public.catalog_campaign_products (
  tenant_id uuid not null,
  campaign_id uuid not null,
  product_id uuid not null,
  override_promo_price numeric(10,2) check (override_promo_price > 0),
  promo_state text not null default 'pending' check (promo_state in ('pending','applied','ended','conflict')),
  applied_regular_price numeric(10,2),
  applied_promo_price numeric(10,2),
  issue text,
  added_at timestamptz not null default now(),
  primary key (campaign_id,product_id),
  foreign key (tenant_id,campaign_id) references public.catalog_campaigns(tenant_id,id) on delete cascade,
  foreign key (tenant_id,product_id) references public.products(tenant_id,id) on delete restrict
);

create table public.catalog_campaign_requests (
  tenant_id uuid not null,
  campaign_id uuid not null,
  request_key uuid not null,
  action text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id,request_key),
  foreign key (tenant_id,campaign_id) references public.catalog_campaigns(tenant_id,id) on delete cascade
);

alter table public.products add column promo_campaign_id uuid;
alter table public.products add column manual_new_until timestamptz;
update public.products set manual_new_until = new_until where new_until is not null;
alter table public.products add constraint products_promo_campaign_tenant_fk
  foreign key (tenant_id,promo_campaign_id) references public.catalog_campaigns(tenant_id,id) on delete restrict;

create function public.catalog_product_manual_novelty_trigger()
returns trigger language plpgsql set search_path = public as $$
declare v_campaign_until timestamptz;
begin
  select max(c.novelty_ends_at) into v_campaign_until
  from public.catalog_campaign_products cp join public.catalog_campaigns c on c.id=cp.campaign_id
  where cp.tenant_id=new.tenant_id and cp.product_id=new.id
    and c.kind in ('novelty','mixed') and c.status='running'
    and (c.novelty_starts_at is null or c.novelty_starts_at<=now())
    and c.novelty_ends_at>now();
  new.new_until:=greatest(new.manual_new_until,v_campaign_until);
  return new;
end $$;
revoke all on function public.catalog_product_manual_novelty_trigger() from public,anon,authenticated,service_role;
create trigger catalog_product_manual_novelty before update of manual_new_until on public.products
  for each row execute function public.catalog_product_manual_novelty_trigger();

create index catalog_campaigns_list_idx on public.catalog_campaigns(tenant_id,status,created_at desc);
create index catalog_campaigns_schedule_idx on public.catalog_campaigns(status,promo_starts_at,promo_ends_at,novelty_starts_at,novelty_ends_at)
  where status in ('scheduled','running');
create index catalog_campaign_products_product_idx on public.catalog_campaign_products(tenant_id,product_id,campaign_id);
create index catalog_campaign_requests_created_idx on public.catalog_campaign_requests(created_at);

alter table public.catalog_campaigns enable row level security;
alter table public.catalog_campaigns force row level security;
alter table public.catalog_campaign_products enable row level security;
alter table public.catalog_campaign_products force row level security;
alter table public.catalog_campaign_requests enable row level security;
alter table public.catalog_campaign_requests force row level security;
revoke all on public.catalog_campaigns, public.catalog_campaign_products, public.catalog_campaign_requests from public, anon, authenticated;
grant select, insert, update, delete on public.catalog_campaigns, public.catalog_campaign_products to service_role;
grant select, insert on public.catalog_campaign_requests to service_role;

-- The application check is helpful UX; this trigger closes the race between
-- that check and publication. Only the atomic campaign writer sets the local
-- transaction marker while changing campaign-owned price columns.
create function public.catalog_campaign_price_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('lepefy.campaign_write',true)='on' then return new; end if;
  if old.price is distinct from new.price or old.compare_at_price is distinct from new.compare_at_price
    or old.promo_price is distinct from new.promo_price
    or old.promo_starts_at is distinct from new.promo_starts_at
    or old.promo_ends_at is distinct from new.promo_ends_at
    or old.promo_until_sold_out is distinct from new.promo_until_sold_out
    or old.promo_applied is distinct from new.promo_applied then
    if old.promo_campaign_id is not null or exists(
      select 1 from public.catalog_campaign_products cp
        join public.catalog_campaigns c on c.id=cp.campaign_id and c.tenant_id=old.tenant_id
      where cp.tenant_id=old.tenant_id and cp.product_id=old.id
        and c.kind in ('promotion','mixed') and c.status in ('scheduled','running')) then
      raise exception 'campaign_price_owned';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.catalog_campaign_price_guard() from public,anon,authenticated,service_role;
create trigger products_campaign_price_guard before update of price,compare_at_price,promo_price,
  promo_starts_at,promo_ends_at,promo_until_sold_out,promo_applied on public.products
  for each row execute function public.catalog_campaign_price_guard();

-- The exact same SQL expression is used by preview and the atomic writer.
create function public.catalog_campaign_price(p_regular numeric, p_mode text, p_value numeric, p_override numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when p_override is not null then round(p_override,2)
    when p_mode = 'percent' then round(p_regular * (1 - p_value / 100),2)
    when p_mode = 'fixed' then round(p_regular - p_value,2)
    else null end
$$;
revoke all on function public.catalog_campaign_price(numeric,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.catalog_campaign_price(numeric,text,numeric,numeric) to service_role;

create function public.catalog_campaign_create(p_tenant uuid,p_config jsonb,p_actor uuid,p_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_request record;
begin
  if p_key is null then raise exception 'request_key_required'; end if;
  -- Serialize retries even when the campaign row does not exist yet.
  perform 1 from public.tenants where id=p_tenant for update;
  if not found then raise exception 'tenant_not_found'; end if;
  select action,result into v_request from public.catalog_campaign_requests
    where tenant_id=p_tenant and request_key=p_key;
  if found then
    if v_request.action<>'create' then raise exception 'request_key_conflict'; end if;
    return (v_request.result->>'id')::uuid;
  end if;
  insert into public.catalog_campaigns(tenant_id,name,description,kind,discount_mode,discount_value,
    promo_starts_at,promo_ends_at,promo_until_sold_out,novelty_starts_at,novelty_ends_at,created_by)
  values(p_tenant,p_config->>'name',p_config->>'description',p_config->>'kind',p_config->>'discount_mode',
    (p_config->>'discount_value')::numeric,(p_config->>'promo_starts_at')::timestamptz,
    (p_config->>'promo_ends_at')::timestamptz,coalesce((p_config->>'promo_until_sold_out')::boolean,false),
    (p_config->>'novelty_starts_at')::timestamptz,(p_config->>'novelty_ends_at')::timestamptz,p_actor)
  returning id into v_id;
  insert into public.catalog_campaign_requests(tenant_id,campaign_id,request_key,action,result)
    values(p_tenant,v_id,p_key,'create',jsonb_build_object('id',v_id));
  return v_id;
end $$;
revoke all on function public.catalog_campaign_create(uuid,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.catalog_campaign_create(uuid,jsonb,uuid,uuid) to service_role;

-- Search/selection is materialized in the draft. A filter change cannot silently
-- change what the merchant already selected. No catalogue download in the browser.
create function public.catalog_campaign_select_products(
  p_tenant uuid, p_campaign uuid, p_ids uuid[] default null,
  p_query text default null, p_category uuid default null,
  p_active boolean default null, p_available boolean default null
) returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  perform 1 from public.catalog_campaigns c where c.id=p_campaign and c.tenant_id=p_tenant
    and c.status in ('draft','suspended') for update;
  if not found then raise exception 'campaign_not_editable'; end if;
  if p_ids is not null and cardinality(p_ids) > 1000 then raise exception 'too_many_product_ids'; end if;
  insert into public.catalog_campaign_products(tenant_id,campaign_id,product_id)
  select p_tenant,p_campaign,p.id from public.products p
    join public.catalog_campaigns c on c.id=p_campaign and c.tenant_id=p_tenant
  where p.tenant_id=p_tenant
    and (p_ids is null or p.id=any(p_ids))
    and (p_query is null or p.name ilike '%'||p_query||'%' or p.slug ilike '%'||p_query||'%' or p.barcode_value ilike '%'||p_query||'%')
    and (p_category is null or p.category_id=p_category)
    and (p_active is null or p.active=p_active)
    and (p_available is null or (p.stock >= greatest(p.min_order_quantity,1))=p_available)
    and (c.kind='novelty' or (
      p.promo_campaign_id is null and p.promo_price is null
      and (p.compare_at_price is null or p.compare_at_price<=p.price)
      and not exists(select 1 from public.catalog_campaign_products other_cp
        join public.catalog_campaigns other on other.id=other_cp.campaign_id
        where other_cp.tenant_id=p_tenant and other_cp.product_id=p.id
          and other.id<>p_campaign and other.kind in ('promotion','mixed')
          and other.status in ('scheduled','running')
          and tstzrange(coalesce(other.promo_starts_at,'-infinity'::timestamptz),
            coalesce(other.promo_ends_at,'infinity'::timestamptz),'[)')
            && tstzrange(coalesce(c.promo_starts_at,'-infinity'::timestamptz),
              coalesce(c.promo_ends_at,'infinity'::timestamptz),'[)'))))
  on conflict do nothing;
  get diagnostics v_count = row_count;
  update public.catalog_campaigns set version=version+1,updated_at=now() where id=p_campaign;
  return v_count;
end $$;
revoke all on function public.catalog_campaign_select_products(uuid,uuid,uuid[],text,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.catalog_campaign_select_products(uuid,uuid,uuid[],text,uuid,boolean,boolean) to service_role;

-- Search and select-all share the same availability predicate and filters.
create function public.catalog_campaign_search_products(
  p_tenant uuid,p_campaign uuid,p_query text,p_category uuid,p_active boolean,
  p_available boolean,p_page integer,p_size integer
) returns jsonb language sql stable security definer set search_path = public as $$
with campaign as (select id,kind,promo_starts_at,promo_ends_at,promo_until_sold_out
  from public.catalog_campaigns where tenant_id=p_tenant and id=p_campaign),
filtered as (
  select p.id,p.name,p.slug,p.barcode_value,p.price,p.compare_at_price,p.promo_price,
    p.promo_campaign_id,p.stock,p.min_order_quantity,p.active,p.category_id,p.image_url,
    exists(select 1 from public.catalog_campaign_products cp where cp.tenant_id=p_tenant
      and cp.campaign_id=p_campaign and cp.product_id=p.id) as selected,
    case when c.kind='novelty' then case when not p.active then 'warning'
      when p.stock<greatest(p.min_order_quantity,1) then 'warning' else 'eligible' end
      when p.promo_campaign_id is not null or p.promo_price is not null
        or p.compare_at_price>p.price then 'conflict'
      when exists(select 1 from public.catalog_campaign_products cp
        join public.catalog_campaigns other on other.id=cp.campaign_id
        where cp.tenant_id=p_tenant and cp.product_id=p.id and other.id<>p_campaign
          and other.kind in ('promotion','mixed') and other.status in ('scheduled','running')
          and tstzrange(coalesce(other.promo_starts_at,'-infinity'::timestamptz),
            coalesce(other.promo_ends_at,'infinity'::timestamptz),'[)')
            && tstzrange(coalesce(c.promo_starts_at,'-infinity'::timestamptz),
              coalesce(c.promo_ends_at,'infinity'::timestamptz),'[)')) then 'conflict'
      when not p.active or p.stock<greatest(p.min_order_quantity,1) then 'warning'
      else 'eligible' end as eligibility
  from campaign c join public.products p on p.tenant_id=p_tenant
  where (p_query is null or p.name ilike '%'||p_query||'%' or p.slug ilike '%'||p_query||'%'
    or p.barcode_value ilike '%'||p_query||'%')
    and (p_category is null or p.category_id=p_category)
    and (p_active is null or p.active=p_active)
    and (p_available is null or (p.stock>=greatest(p.min_order_quantity,1))=p_available)
), page as (select * from filtered order by name,id
  offset (greatest(p_page,1)-1)*least(greatest(p_size,1),100)
  limit least(greatest(p_size,1),100))
select jsonb_build_object('products',coalesce((select jsonb_agg(to_jsonb(page) order by page.name,page.id)
  from page),'[]'::jsonb),'total',(select count(*) from filtered),
  'page',greatest(p_page,1),'size',least(greatest(p_size,1),100))
$$;
revoke all on function public.catalog_campaign_search_products(uuid,uuid,text,uuid,boolean,boolean,integer,integer)
  from public,anon,authenticated;
grant execute on function public.catalog_campaign_search_products(uuid,uuid,text,uuid,boolean,boolean,integer,integer)
  to service_role;

create function public.catalog_campaign_remove_products(p_tenant uuid,p_campaign uuid,p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  perform 1 from public.catalog_campaigns where tenant_id=p_tenant and id=p_campaign
    and status in ('draft','suspended') for update;
  if not found then raise exception 'campaign_not_editable'; end if;
  delete from public.catalog_campaign_products where tenant_id=p_tenant and campaign_id=p_campaign
    and (p_ids is null or product_id=any(p_ids));
  get diagnostics v_count = row_count;
  update public.catalog_campaigns set version=version+1,updated_at=now() where id=p_campaign;
  return v_count;
end $$;
revoke all on function public.catalog_campaign_remove_products(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.catalog_campaign_remove_products(uuid,uuid,uuid[]) to service_role;

create function public.catalog_campaign_override_price(p_tenant uuid,p_campaign uuid,p_product uuid,p_price numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.catalog_campaigns where tenant_id=p_tenant and id=p_campaign
    and status in ('draft','suspended') and kind in ('promotion','mixed') for update;
  if not found then raise exception 'campaign_not_editable'; end if;
  if p_price is not null and p_price<=0 then raise exception 'invalid_discount'; end if;
  update public.catalog_campaign_products set override_promo_price=p_price
    where tenant_id=p_tenant and campaign_id=p_campaign and product_id=p_product;
  if not found then raise exception 'product_not_selected'; end if;
  update public.catalog_campaigns set version=version+1,updated_at=now() where id=p_campaign;
end $$;
revoke all on function public.catalog_campaign_override_price(uuid,uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.catalog_campaign_override_price(uuid,uuid,uuid,numeric) to service_role;

create function public.catalog_campaign_duplicate(p_tenant uuid,p_campaign uuid,p_actor uuid,p_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.catalog_campaigns%rowtype; v_id uuid; v_request record;
begin
  if p_key is null then raise exception 'request_key_required'; end if;
  select * into c from public.catalog_campaigns where tenant_id=p_tenant and id=p_campaign for update;
  if not found then raise exception 'campaign_not_found'; end if;
  select campaign_id,action,result into v_request from public.catalog_campaign_requests
    where tenant_id=p_tenant and request_key=p_key;
  if found then
    if v_request.campaign_id<>p_campaign or v_request.action<>'duplicate' then raise exception 'request_key_conflict'; end if;
    return (v_request.result->>'id')::uuid;
  end if;
  insert into public.catalog_campaigns(tenant_id,name,description,kind,discount_mode,discount_value,
    promo_starts_at,promo_ends_at,promo_until_sold_out,novelty_starts_at,novelty_ends_at,created_by)
  values(p_tenant,left(c.name||' — copie',160),c.description,c.kind,c.discount_mode,c.discount_value,
    c.promo_starts_at,c.promo_ends_at,c.promo_until_sold_out,c.novelty_starts_at,c.novelty_ends_at,p_actor)
  returning id into v_id;
  insert into public.catalog_campaign_products(tenant_id,campaign_id,product_id,override_promo_price)
    select p_tenant,v_id,cp.product_id,cp.override_promo_price
    from public.catalog_campaign_products cp where cp.campaign_id=p_campaign;
  insert into public.catalog_campaign_requests(tenant_id,campaign_id,request_key,action,result)
    values(p_tenant,p_campaign,p_key,'duplicate',jsonb_build_object('id',v_id));
  return v_id;
end $$;
revoke all on function public.catalog_campaign_duplicate(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.catalog_campaign_duplicate(uuid,uuid,uuid,uuid) to service_role;

-- Preview is read only. Publication repeats every check under row locks.
create function public.catalog_campaign_preview(p_tenant uuid,p_campaign uuid,p_page integer default 1,p_size integer default 100)
returns jsonb language sql stable security definer set search_path = public as $$
with c as (select * from public.catalog_campaigns where tenant_id=p_tenant and id=p_campaign),
rows as (
  select p.id,p.name,p.active,p.stock,p.min_order_quantity,
    case when p.promo_campaign_id=p_campaign then cp.applied_regular_price else p.price end as regular_price,
    public.catalog_campaign_price(case when p.promo_campaign_id=p_campaign then cp.applied_regular_price else p.price end,
      c.discount_mode,c.discount_value,cp.override_promo_price) as promo_price,
    case when c.kind='novelty' then null
      when p.promo_campaign_id is not null and p.promo_campaign_id<>p_campaign then 'campaign_conflict'
      when p.promo_campaign_id is null and (p.promo_price is not null or p.compare_at_price>p.price) then 'manual_promotion'
      when c.promo_until_sold_out and p.stock<greatest(p.min_order_quantity,1) then 'insufficient_stock'
      when public.catalog_campaign_price(case when p.promo_campaign_id=p_campaign then cp.applied_regular_price else p.price end,
        c.discount_mode,c.discount_value,cp.override_promo_price) is null
        or public.catalog_campaign_price(case when p.promo_campaign_id=p_campaign then cp.applied_regular_price else p.price end,
          c.discount_mode,c.discount_value,cp.override_promo_price)<=0
        or public.catalog_campaign_price(case when p.promo_campaign_id=p_campaign then cp.applied_regular_price else p.price end,
          c.discount_mode,c.discount_value,cp.override_promo_price)>=
          case when p.promo_campaign_id=p_campaign then cp.applied_regular_price else p.price end then 'invalid_discount'
      when exists (select 1 from public.catalog_campaign_products x join public.catalog_campaigns other on other.id=x.campaign_id
        where x.tenant_id=p_tenant and x.product_id=p.id and other.id<>c.id and other.kind in ('promotion','mixed')
          and other.status in ('scheduled','running')
          and tstzrange(coalesce(other.promo_starts_at,'-infinity'::timestamptz),coalesce(other.promo_ends_at,'infinity'::timestamptz),'[)')
              && tstzrange(coalesce(c.promo_starts_at,'-infinity'::timestamptz),coalesce(c.promo_ends_at,'infinity'::timestamptz),'[)')) then 'campaign_conflict'
      else null end as issue
  from c join public.catalog_campaign_products cp on cp.campaign_id=c.id
    join public.products p on p.id=cp.product_id and p.tenant_id=p_tenant
)
select coalesce((select jsonb_build_object('version',c.version,'status',c.status,'products',
  coalesce((select jsonb_agg(to_jsonb(page_rows) order by page_rows.name,page_rows.id)
    from (select * from rows order by name,id
      offset (greatest(p_page,1)-1)*least(greatest(p_size,1),100)
      limit least(greatest(p_size,1),100)) page_rows),'[]'::jsonb),
  'count',(select count(*) from rows),'blocked',(select count(*) from rows where issue is not null),
  'page',greatest(p_page,1),'size',least(greatest(p_size,1),100)) from c),'null'::jsonb)
$$;
revoke all on function public.catalog_campaign_preview(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.catalog_campaign_preview(uuid,uuid,integer,integer) to service_role;

-- Recompute the effective novelty from the independent manual source and all
-- currently active novelty campaigns. Called after every lifecycle transition.
create function public.catalog_campaign_refresh_novelty(p_tenant uuid,p_product uuid,p_now timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.products p set new_until=(
    select max(until_at) from (
      select p.manual_new_until as until_at where p.manual_new_until>p_now
      union all
      select c.novelty_ends_at from public.catalog_campaign_products cp
        join public.catalog_campaigns c on c.id=cp.campaign_id and c.tenant_id=p_tenant
      where cp.product_id=p_product and cp.tenant_id=p_tenant and c.kind in ('novelty','mixed')
        and c.status='running' and (c.novelty_starts_at is null or c.novelty_starts_at<=p_now)
        and c.novelty_ends_at>p_now
    ) sources
  ) where p.id=p_product and p.tenant_id=p_tenant
    and p.new_until is distinct from (
      select max(until_at) from (
        select p.manual_new_until as until_at where p.manual_new_until>p_now
        union all
        select c.novelty_ends_at from public.catalog_campaign_products cp
          join public.catalog_campaigns c on c.id=cp.campaign_id and c.tenant_id=p_tenant
        where cp.product_id=p_product and cp.tenant_id=p_tenant and c.kind in ('novelty','mixed')
          and c.status='running' and (c.novelty_starts_at is null or c.novelty_starts_at<=p_now)
          and c.novelty_ends_at>p_now
      ) sources
    );
end $$;
revoke all on function public.catalog_campaign_refresh_novelty(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.catalog_campaign_refresh_novelty(uuid,uuid,timestamptz) to service_role;

create function public.catalog_campaign_reconcile(p_tenant uuid,p_campaign uuid,p_now timestamptz,p_strict boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c public.catalog_campaigns%rowtype; r record; v_active boolean; v_price numeric; v_issue text;
  v_previous_write text:=current_setting('lepefy.campaign_write',true);
begin
  select * into c from public.catalog_campaigns where id=p_campaign and tenant_id=p_tenant;
  if not found then raise exception 'campaign_not_found'; end if;
  perform set_config('lepefy.campaign_write','on',true);
  v_active:=c.status='running' and c.kind in ('promotion','mixed')
    and (c.promo_starts_at is null or c.promo_starts_at<=p_now)
    and (c.promo_ends_at is null or c.promo_ends_at>p_now);
  for r in select p.id,p.price,p.compare_at_price,p.promo_price,p.promo_applied,p.promo_campaign_id,p.stock,p.min_order_quantity,
    cp.override_promo_price,cp.promo_state,cp.applied_regular_price,cp.applied_promo_price
    from public.catalog_campaign_products cp join public.products p on p.id=cp.product_id and p.tenant_id=p_tenant
    where cp.campaign_id=p_campaign order by p.id for update of p,cp loop
    if r.promo_state='applied' and (not v_active or
      (c.promo_until_sold_out and r.stock<greatest(r.min_order_quantity,1))) then
      if r.promo_campaign_id=p_campaign and r.price=r.applied_promo_price
        and r.promo_price=r.applied_promo_price and r.promo_applied
        and r.compare_at_price=r.applied_regular_price then
        update public.products set price=r.applied_regular_price,compare_at_price=null,
          promo_price=null,promo_starts_at=null,promo_ends_at=null,promo_until_sold_out=false,
          promo_applied=false,promo_campaign_id=null where id=r.id and tenant_id=p_tenant;
        update public.catalog_campaign_products set promo_state=case
          when c.status='suspended' then 'pending' else 'ended' end,
          issue=null where campaign_id=p_campaign and product_id=r.id;
      elsif r.promo_campaign_id is null and c.promo_until_sold_out
        and r.stock<greatest(r.min_order_quantity,1)
        and r.price=r.applied_regular_price and r.compare_at_price is null then
        -- The stock trigger already restored the original price atomically.
        update public.catalog_campaign_products set promo_state='ended',issue=null
          where campaign_id=p_campaign and product_id=r.id;
      else
        if p_strict then raise exception 'campaign_price_changed:%',r.id; end if;
        if r.promo_campaign_id=p_campaign then
          update public.products set promo_campaign_id=null,promo_applied=false,promo_price=null,
            promo_starts_at=null,promo_ends_at=null,promo_until_sold_out=false
            where id=r.id and tenant_id=p_tenant;
        end if;
        update public.catalog_campaign_products set promo_state='conflict',issue='price_changed'
          where campaign_id=p_campaign and product_id=r.id;
        update public.catalog_campaigns set last_error='price_changed' where id=p_campaign;
      end if;
    elsif v_active and r.promo_state='pending' then
      v_issue:=null;
      if r.promo_campaign_id is not null or r.promo_price is not null
        or r.compare_at_price>r.price then v_issue:='promotion_conflict'; end if;
      if c.promo_until_sold_out and r.stock<greatest(r.min_order_quantity,1) then v_issue:='insufficient_stock'; end if;
      v_price:=public.catalog_campaign_price(r.price,c.discount_mode,c.discount_value,r.override_promo_price);
      if v_price is null or v_price<=0 or v_price>=r.price then v_issue:='invalid_discount'; end if;
      if v_issue is not null then
        if p_strict then raise exception '%:%',v_issue,r.id; end if;
        update public.catalog_campaign_products set promo_state='conflict',issue=v_issue
          where campaign_id=p_campaign and product_id=r.id;
        update public.catalog_campaigns set last_error=v_issue where id=p_campaign;
      else
        update public.products set price=v_price,compare_at_price=r.price,promo_price=v_price,
          promo_starts_at=c.promo_starts_at,promo_ends_at=c.promo_ends_at,
          promo_until_sold_out=c.promo_until_sold_out,promo_applied=true,promo_campaign_id=p_campaign
          where id=r.id and tenant_id=p_tenant;
        update public.catalog_campaign_products set promo_state='applied',applied_regular_price=r.price,
          applied_promo_price=v_price,issue=null where campaign_id=p_campaign and product_id=r.id;
      end if;
    end if;
    if c.kind in ('novelty','mixed') then
      perform public.catalog_campaign_refresh_novelty(p_tenant,r.id,p_now);
    end if;
  end loop;
  perform set_config('lepefy.campaign_write',coalesce(v_previous_write,'off'),true);
end $$;
revoke all on function public.catalog_campaign_reconcile(uuid,uuid,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.catalog_campaign_reconcile(uuid,uuid,timestamptz,boolean) to service_role;

-- One transaction per action. The API supplies the authenticated tenant, an
-- expected revision and an idempotency key; no tenant is accepted from the UI.
create function public.catalog_campaign_action(
  p_tenant uuid,p_campaign uuid,p_action text,p_expected_version integer,p_key uuid,p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.catalog_campaigns%rowtype; r record; v_price numeric; v_result jsonb; v_count integer:=0;
  v_request record;
begin
  if p_key is null then raise exception 'request_key_required'; end if;
  select * into c from public.catalog_campaigns where tenant_id=p_tenant and id=p_campaign for update;
  if not found then raise exception 'campaign_not_found'; end if;
  select campaign_id,action,result into v_request from public.catalog_campaign_requests
    where tenant_id=p_tenant and request_key=p_key;
  if found then
    if v_request.campaign_id<>p_campaign or v_request.action<>p_action then raise exception 'request_key_conflict'; end if;
    return v_request.result;
  end if;
  if c.version<>p_expected_version then raise exception 'campaign_stale'; end if;
  if (p_action='publish' and c.status<>'draft') or (p_action='resume' and c.status<>'suspended')
     or (p_action='suspend' and c.status not in ('scheduled','running'))
     or (p_action='end' and c.status not in ('scheduled','running','suspended'))
     or p_action not in ('publish','resume','suspend','end') then raise exception 'campaign_invalid_transition'; end if;
  select count(*) into v_count from public.catalog_campaign_products where campaign_id=p_campaign;
  if v_count=0 then raise exception 'campaign_empty'; end if;
  if p_action in ('publish','resume') then
    if c.kind in ('promotion','mixed') and c.promo_ends_at is not null and c.promo_ends_at<=p_now then raise exception 'campaign_promo_expired'; end if;
    if c.kind in ('novelty','mixed') and c.novelty_ends_at<=p_now then raise exception 'campaign_novelty_expired'; end if;
    -- Lock every product before validation or writes; concurrent publications
    -- and product edits serialize on these rows.
    for r in select p.id,p.price,p.compare_at_price,p.promo_price,p.promo_campaign_id,p.stock,p.min_order_quantity,
      cp.override_promo_price,cp.promo_state
      from public.catalog_campaign_products cp join public.products p on p.id=cp.product_id and p.tenant_id=p_tenant
      where cp.campaign_id=p_campaign order by p.id for update of p,cp loop
      if c.kind in ('promotion','mixed') and r.promo_state<>'ended' then
        if r.promo_campaign_id is not null and r.promo_campaign_id<>p_campaign then raise exception 'campaign_conflict:%',r.id; end if;
        if r.promo_campaign_id is null and (r.promo_price is not null or r.compare_at_price>r.price) then raise exception 'manual_promotion:%',r.id; end if;
        if exists (select 1 from public.catalog_campaign_products x join public.catalog_campaigns other on other.id=x.campaign_id
          where x.tenant_id=p_tenant and x.product_id=r.id and other.id<>p_campaign and other.kind in ('promotion','mixed')
            and other.status in ('scheduled','running')
            and tstzrange(coalesce(other.promo_starts_at,'-infinity'::timestamptz),coalesce(other.promo_ends_at,'infinity'::timestamptz),'[)')
                && tstzrange(coalesce(c.promo_starts_at,'-infinity'::timestamptz),coalesce(c.promo_ends_at,'infinity'::timestamptz),'[)'))
          then raise exception 'campaign_conflict:%',r.id; end if;
        v_price:=public.catalog_campaign_price(r.price,c.discount_mode,c.discount_value,r.override_promo_price);
        if v_price is null or v_price<=0 or v_price>=r.price then raise exception 'invalid_discount:%',r.id; end if;
        if c.promo_until_sold_out and r.stock<greatest(r.min_order_quantity,1) then raise exception 'insufficient_stock:%',r.id; end if;
      end if;
    end loop;
    if p_action='resume' then
      update public.catalog_campaign_products set promo_state='pending',issue=null
        where campaign_id=p_campaign and promo_state='conflict';
    end if;
    update public.catalog_campaigns set status=case
      when (kind in ('promotion','mixed') and (promo_starts_at is null or promo_starts_at<=p_now))
        or (kind in ('novelty','mixed') and (novelty_starts_at is null or novelty_starts_at<=p_now))
      then 'running' else 'scheduled' end, version=version+1,updated_at=p_now,last_error=null where id=p_campaign;
  else
    update public.catalog_campaigns set status=case when p_action='end' then 'ended' else 'suspended' end,
      version=version+1,updated_at=p_now where id=p_campaign;
  end if;
  perform public.catalog_campaign_reconcile(p_tenant,p_campaign,p_now,p_action in ('publish','resume'));
  update public.catalog_campaigns set last_tick_at=p_now where id=p_campaign;
  v_result:=jsonb_build_object('id',p_campaign,'status',(select status from public.catalog_campaigns where id=p_campaign),
    'version',(select version from public.catalog_campaigns where id=p_campaign),'products',v_count);
  insert into public.catalog_campaign_requests(tenant_id,campaign_id,request_key,action,result)
    values(p_tenant,p_campaign,p_key,p_action,v_result);
  return v_result;
end $$;
revoke all on function public.catalog_campaign_action(uuid,uuid,text,integer,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.catalog_campaign_action(uuid,uuid,text,integer,uuid,timestamptz) to service_role;

-- Returns affected product IDs for the existing cache invalidation path.
create function public.catalog_campaign_tick(p_now timestamptz default now())
returns table(out_tenant_id uuid,out_product_id uuid,out_change text)
language plpgsql security definer set search_path = public as $$
declare c public.catalog_campaigns%rowtype; v_started boolean; v_finished boolean;
begin
  for c in select * from public.catalog_campaigns x where x.status in ('scheduled','running')
    and (x.last_error is not null
      or (x.status='scheduled' and ((x.kind in ('promotion','mixed') and x.promo_starts_at<=p_now
          and (x.last_tick_at is null or x.promo_starts_at>x.last_tick_at))
        or (x.kind in ('novelty','mixed') and x.novelty_starts_at<=p_now
          and (x.last_tick_at is null or x.novelty_starts_at>x.last_tick_at))))
      or (x.status='running' and ((x.kind='mixed' and x.promo_starts_at<=p_now
          and (x.last_tick_at is null or x.promo_starts_at>x.last_tick_at))
        or (x.kind in ('promotion','mixed') and x.promo_ends_at<=p_now
          and (x.last_tick_at is null or x.promo_ends_at>x.last_tick_at))
        or (x.kind in ('novelty','mixed') and x.novelty_ends_at<=p_now
          and (x.last_tick_at is null or x.novelty_ends_at>x.last_tick_at))
        or (x.kind='mixed' and x.novelty_starts_at<=p_now
          and (x.last_tick_at is null or x.novelty_starts_at>x.last_tick_at))
        or exists(select 1 from public.catalog_campaign_products cp
          join public.products p on p.tenant_id=cp.tenant_id and p.id=cp.product_id
          where cp.campaign_id=x.id and cp.promo_state='applied'
            and (p.promo_campaign_id is distinct from x.id
              or (x.promo_until_sold_out and p.stock<greatest(p.min_order_quantity,1)))))))
    order by x.id for update skip locked loop
    begin
    v_started:=(c.kind in ('promotion','mixed') and (c.promo_starts_at is null or c.promo_starts_at<=p_now))
      or (c.kind in ('novelty','mixed') and (c.novelty_starts_at is null or c.novelty_starts_at<=p_now));
    v_finished:=(c.kind='novelty' or (c.promo_ends_at is not null and c.promo_ends_at<=p_now))
      and (c.kind='promotion' or c.novelty_ends_at<=p_now);
    if v_finished and c.status<>'ended' then
      update public.catalog_campaigns set status='ended',version=version+1,updated_at=p_now where id=c.id;
    elsif v_started and c.status='scheduled' then
      update public.catalog_campaigns set status='running',version=version+1,updated_at=p_now where id=c.id;
    end if;
    perform public.catalog_campaign_reconcile(c.tenant_id,c.id,p_now,true);
    update public.catalog_campaigns set last_tick_at=p_now,last_error=null where id=c.id;
    return query select cp.tenant_id,cp.product_id,'campaign_changed'::text
      from public.catalog_campaign_products cp where cp.campaign_id=c.id;
    exception when others then
      -- Each campaign is a subtransaction: a failed start restores every
      -- product write and remains retryable without reporting partial success.
      update public.catalog_campaigns set last_error=left(sqlerrm,500) where id=c.id;
      return query select c.tenant_id,null::uuid,'campaign_error'::text;
    end;
  end loop;
end $$;
revoke all on function public.catalog_campaign_tick(timestamptz) from public,anon,authenticated;
grant execute on function public.catalog_campaign_tick(timestamptz) to service_role;

-- Extend the existing single scheduler RPC, preserving its result contract.
-- Campaign-owned price rows are excluded from the legacy transitions.
create or replace function public.apply_product_promotion_schedule(p_now timestamptz default now())
returns table (out_tenant_id uuid,out_product_id uuid,out_change text)
language plpgsql set search_path = public as $$
begin
  return query update public.products p set price=coalesce(p.compare_at_price,p.price),
    compare_at_price=null,promo_applied=false,promo_price=null,promo_starts_at=null,
    promo_ends_at=null,promo_until_sold_out=false
    where p.promo_campaign_id is null and p.promo_applied and p.promo_ends_at<=p_now
    returning p.tenant_id,p.id,'promo_ended'::text;
  return query update public.products p set promo_price=null,promo_starts_at=null,
    promo_ends_at=null,promo_until_sold_out=false
    where p.promo_campaign_id is null and not p.promo_applied and p.promo_price is not null
      and p.promo_ends_at<=p_now
    returning p.tenant_id,p.id,'promo_expired'::text;
  return query update public.products p set compare_at_price=p.price,price=p.promo_price,promo_applied=true
    where p.promo_campaign_id is null and not p.promo_applied and p.promo_price is not null
      and (p.promo_starts_at is null or p.promo_starts_at<=p_now)
      and (p.promo_ends_at is null or p.promo_ends_at>p_now)
      and p.promo_price<p.price and not (p.promo_until_sold_out and p.stock<greatest(coalesce(p.min_order_quantity,1),1))
    returning p.tenant_id,p.id,'promo_started'::text;
  return query update public.products p set manual_new_until=null
    where p.manual_new_until is not null and p.manual_new_until<=p_now
    returning p.tenant_id,p.id,'novelty_ended'::text;
  return query update public.products p set new_until=null
    where p.new_until is not null and p.new_until<=p_now
    returning p.tenant_id,p.id,'novelty_ended'::text;
  return query select t.out_tenant_id,t.out_product_id,t.out_change from public.catalog_campaign_tick(p_now) t;
end $$;

-- The existing stock trigger must release ownership when it restores a
-- campaign promotion. A restock cannot restart that product's promotion.
create or replace function public.end_sold_out_promotion()
returns trigger language plpgsql set search_path = public as $$
declare v_regular numeric; v_promo numeric;
begin
  if new.promo_applied and new.promo_until_sold_out
    and new.stock<greatest(coalesce(new.min_order_quantity,1),1) then
    if new.promo_campaign_id is not null then
      select cp.applied_regular_price,cp.applied_promo_price into v_regular,v_promo
        from public.catalog_campaign_products cp
        where cp.tenant_id=new.tenant_id and cp.campaign_id=new.promo_campaign_id and cp.product_id=new.id;
      if new.price is distinct from v_promo or new.promo_price is distinct from v_promo
        or new.compare_at_price is distinct from v_regular then
        -- Another writer changed the price: release ownership but never
        -- restore an obsolete snapshot over the newer value.
        new.promo_applied:=false;
        new.promo_price:=null;
        new.promo_starts_at:=null;
        new.promo_ends_at:=null;
        new.promo_until_sold_out:=false;
        new.promo_campaign_id:=null;
        return new;
      end if;
    end if;
    new.price:=coalesce(new.compare_at_price,new.price);
    new.compare_at_price:=null;
    new.promo_applied:=false;
    new.promo_price:=null;
    new.promo_starts_at:=null;
    new.promo_ends_at:=null;
    new.promo_until_sold_out:=false;
    new.promo_campaign_id:=null;
  end if;
  return new;
end $$;

insert into public.audit_event_types(key,module,category,default_severity,retention_class) values
  ('catalog.campaign.created','catalog','activity','info','business'),
  ('catalog.campaign.updated','catalog','activity','info','business'),
  ('catalog.campaign.products_changed','catalog','activity','info','business'),
  ('catalog.campaign.published','catalog','activity','info','business'),
  ('catalog.campaign.suspended','catalog','activity','info','business'),
  ('catalog.campaign.resumed','catalog','activity','info','business'),
  ('catalog.campaign.ended','catalog','activity','info','business')
on conflict(key) do nothing;

create function public.audit_catalog_campaigns_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_type text; v_row public.catalog_campaigns%rowtype;
begin
  v_row:=new;
  if tg_op='INSERT' then v_type:='catalog.campaign.created';
  elsif old.status is distinct from new.status then
    v_type:=case new.status when 'suspended' then 'catalog.campaign.suspended'
      when 'ended' then 'catalog.campaign.ended'
      when 'running' then case old.status when 'suspended' then 'catalog.campaign.resumed' else 'catalog.campaign.published' end
      when 'scheduled' then case old.status when 'suspended' then 'catalog.campaign.resumed' else 'catalog.campaign.published' end
      else 'catalog.campaign.updated' end;
  else v_type:='catalog.campaign.updated'; end if;
  perform public.audit_emit(false,v_row.tenant_id,v_type,'catalog_campaign',v_row.id::text,v_row.name,
    '[]'::jsonb,jsonb_build_object('status',v_row.status,'kind',v_row.kind,'version',v_row.version));
  return null;
end $$;
revoke all on function public.audit_catalog_campaigns_trigger() from public,anon,authenticated,service_role;
create trigger audit_catalog_campaigns after insert or update of name,description,kind,status,discount_mode,discount_value,
  promo_starts_at,promo_ends_at,promo_until_sold_out,novelty_starts_at,novelty_ends_at
  on public.catalog_campaigns for each row execute function public.audit_catalog_campaigns_trigger();

create function public.audit_catalog_campaign_products_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_row public.catalog_campaign_products%rowtype; v_name text;
begin
  if tg_op='DELETE' then v_row:=old; else v_row:=new; end if;
  select name into v_name from public.catalog_campaigns where id=v_row.campaign_id;
  perform public.audit_emit(false,v_row.tenant_id,'catalog.campaign.products_changed','catalog_campaign',
    v_row.campaign_id::text,v_name,'[]'::jsonb,jsonb_build_object('product_id',v_row.product_id,'operation',tg_op));
  return null;
end $$;
revoke all on function public.audit_catalog_campaign_products_trigger() from public,anon,authenticated,service_role;
create trigger audit_catalog_campaign_products after insert or delete or update of override_promo_price on public.catalog_campaign_products
  for each row execute function public.audit_catalog_campaign_products_trigger();

commit;
