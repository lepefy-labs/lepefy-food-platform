-- 109_tenant_crm_foundation.sql
-- Tenant CRM foundation: independent customer identity, safe normalization,
-- CRM read models, notes/tags/segments, campaign recipient snapshots and events.
-- Additive and ID-preserving: existing customers and all referencing UUIDs stay unchanged.

begin;

-- Customer identity is now a business entity. Existing ids are retained and
-- linked to their former Auth identity through auth_user_id.
alter table public.customers
  add column if not exists auth_user_id uuid,
  add column if not exists normalized_email text,
  add column if not exists normalized_phone text,
  add column if not exists search_document tsvector generated always as (
    to_tsvector('simple', coalesce(full_name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(loyalty_card_number, ''))
  ) stored,
  add column if not exists source text not null default 'signup',
  add column if not exists updated_at timestamptz not null default now();

alter table public.customers alter column email drop not null;

update public.customers
set auth_user_id = id
where auth_user_id is null
  and exists (select 1 from auth.users u where u.id = customers.id);

alter table public.customers drop constraint if exists customers_id_fkey;
alter table public.customers drop constraint if exists customers_auth_user_id_fkey;
alter table public.customers
  add constraint customers_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete set null;

alter table public.customers drop constraint if exists customers_source_check;
alter table public.customers
  add constraint customers_source_check check (
    source in ('signup','guest_checkout','admin','in_store','event','import','other')
  );
alter table public.customers drop constraint if exists customers_contact_check;
alter table public.customers
  add constraint customers_contact_check check (
    email is not null or phone is not null or full_name is not null
  ) not valid;

create unique index if not exists customers_id_tenant_unique
  on public.customers (id, tenant_id);
create unique index if not exists customers_tenant_auth_user_unique
  on public.customers (tenant_id, auth_user_id) where auth_user_id is not null;
create index if not exists customers_tenant_created_idx
  on public.customers (tenant_id, created_at desc, id);
create index if not exists customers_search_document_idx on public.customers using gin (search_document);

create or replace function public.crm_normalize_email(value text)
returns text language sql immutable parallel safe as $$
  select nullif(lower(btrim(value)), '')
$$;

create or replace function public.crm_normalize_phone(value text)
returns text language plpgsql immutable parallel safe as $$
declare
  cleaned text;
begin
  if value is null or btrim(value) = '' or value ~ '[[:alpha:]]' then return null; end if;
  cleaned := regexp_replace(btrim(value), '[^0-9+]', '', 'g');
  if cleaned ~ '^00[0-9]+$' then cleaned := '+' || substring(cleaned from 3); end if;
  if cleaned !~ '^\+?[0-9]{6,15}$' then return null; end if;
  return cleaned;
end;
$$;

-- Backfill only identities that are unambiguous inside a tenant. Historical
-- collisions are preserved and left NULL for manual review; no row is merged.
with candidates as (
  select id, tenant_id, public.crm_normalize_email(email) value
  from public.customers
), unique_values as (
  select tenant_id, value from candidates where value is not null
  group by tenant_id, value having count(*) = 1
)
update public.customers c
set normalized_email = v.value
from candidates v
join unique_values u on u.tenant_id = v.tenant_id and u.value = v.value
where c.id = v.id;

with candidates as (
  select id, tenant_id, public.crm_normalize_phone(phone) value
  from public.customers
), unique_values as (
  select tenant_id, value from candidates where value is not null
  group by tenant_id, value having count(*) = 1
)
update public.customers c
set normalized_phone = v.value
from candidates v
join unique_values u on u.tenant_id = v.tenant_id and u.value = v.value
where c.id = v.id;

create unique index if not exists customers_tenant_normalized_email_unique
  on public.customers (tenant_id, normalized_email) where normalized_email is not null;
create unique index if not exists customers_tenant_normalized_phone_unique
  on public.customers (tenant_id, normalized_phone) where normalized_phone is not null;

create or replace function public.normalize_customer_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  new.email := nullif(btrim(new.email), '');
  new.phone := nullif(btrim(new.phone), '');
  new.full_name := nullif(btrim(new.full_name), '');
  new.normalized_email := public.crm_normalize_email(new.email);
  new.normalized_phone := public.crm_normalize_phone(new.phone);
  if new.normalized_email is not null
     and (tg_op = 'INSERT' or new.email is distinct from old.email)
     and exists (
       select 1 from public.customers c
       where c.tenant_id = new.tenant_id and c.id <> new.id
         and public.crm_normalize_email(c.email) = new.normalized_email
     ) then
    raise exception using errcode = '23505', message = 'customer_email_collision';
  end if;
  if new.normalized_phone is not null
     and (tg_op = 'INSERT' or new.phone is distinct from old.phone)
     and exists (
       select 1 from public.customers c
       where c.tenant_id = new.tenant_id and c.id <> new.id
         and public.crm_normalize_phone(c.phone) = new.normalized_phone
     ) then
    raise exception using errcode = '23505', message = 'customer_phone_collision';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists customers_normalize_identity on public.customers;
create trigger customers_normalize_identity
before insert or update of email, phone, full_name on public.customers
for each row execute function public.normalize_customer_identity();

-- Auth-aware RLS now resolves through auth_user_id rather than the customer PK.
drop policy if exists customers_select_own on public.customers;
drop policy if exists customers_insert_own on public.customers;
drop policy if exists customers_update_own on public.customers;
create policy customers_select_own on public.customers for select using (auth_user_id = auth.uid());
create policy customers_insert_own on public.customers for insert with check (auth_user_id = auth.uid());
create policy customers_update_own on public.customers for update using (auth_user_id = auth.uid());

drop policy if exists addresses_select_own on public.addresses;
drop policy if exists addresses_insert_own on public.addresses;
drop policy if exists addresses_update_own on public.addresses;
drop policy if exists addresses_delete_own on public.addresses;
create policy addresses_select_own on public.addresses for select using (
  exists (select 1 from public.customers c where c.id = customer_id and c.tenant_id = addresses.tenant_id and c.auth_user_id = auth.uid())
);
create policy addresses_insert_own on public.addresses for insert with check (
  exists (select 1 from public.customers c where c.id = customer_id and c.tenant_id = addresses.tenant_id and c.auth_user_id = auth.uid())
);
create policy addresses_update_own on public.addresses for update using (
  exists (select 1 from public.customers c where c.id = customer_id and c.tenant_id = addresses.tenant_id and c.auth_user_id = auth.uid())
);
create policy addresses_delete_own on public.addresses for delete using (
  exists (select 1 from public.customers c where c.id = customer_id and c.tenant_id = addresses.tenant_id and c.auth_user_id = auth.uid())
);

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders for select using (
  exists (select 1 from public.customers c where c.id = customer_id and c.tenant_id = orders.tenant_id and c.auth_user_id = auth.uid())
);
drop policy if exists order_items_select_via_order on public.order_items;
create policy order_items_select_via_order on public.order_items for select using (
  exists (
    select 1 from public.orders o
    join public.customers c on c.id = o.customer_id and c.tenant_id = o.tenant_id
    where o.id = order_items.order_id and c.auth_user_id = auth.uid()
  )
);
drop policy if exists user_consents_select_own on public.user_consents;
drop policy if exists user_consents_insert_own on public.user_consents;
create policy user_consents_select_own on public.user_consents for select using (
  exists (select 1 from public.customers c where c.id = user_id and c.tenant_id = user_consents.tenant_id and c.auth_user_id = auth.uid())
);
create policy user_consents_insert_own on public.user_consents for insert with check (
  exists (select 1 from public.customers c where c.id = user_id and c.tenant_id = user_consents.tenant_id and c.auth_user_id = auth.uid())
);

-- Real event reservations can now be associated with the same CRM entity.
alter table public.event_reservations add column if not exists customer_id uuid;
alter table public.event_reservations drop constraint if exists event_reservations_customer_tenant_fkey;
alter table public.event_reservations add constraint event_reservations_customer_tenant_fkey
  foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete set null (customer_id);
create index if not exists event_reservations_customer_idx
  on public.event_reservations (tenant_id, customer_id, created_at desc) where customer_id is not null;

create table if not exists public.customer_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  event_type text not null check (event_type in (
    'customer_created','account_linked','order_completed','product_purchased','category_purchased',
    'loyalty_points_earned','loyalty_points_redeemed','in_store_purchase','event_reserved',
    'event_attended','marketing_consent_granted','marketing_consent_revoked'
  )),
  source text not null,
  entity_type text,
  entity_id uuid,
  event_key text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete cascade
);
create index if not exists customer_events_timeline_idx on public.customer_events (tenant_id, customer_id, occurred_at desc, id);
alter table public.customer_events
  add constraint customer_events_event_key_unique unique (tenant_id, event_key);

create table if not exists public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  author_admin_id uuid not null references public.admin_users(id),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete cascade
);
create index if not exists customer_notes_timeline_idx on public.customer_notes (tenant_id, customer_id, created_at desc);

create table if not exists public.customer_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text,
  created_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create unique index if not exists customer_tags_name_unique on public.customer_tags (tenant_id, lower(btrim(name)));

create table if not exists public.customer_tag_assignments (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  tag_id uuid not null,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  primary key (customer_id, tag_id),
  foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete cascade,
  foreign key (tag_id, tenant_id) references public.customer_tags(id, tenant_id) on delete cascade
);
create index if not exists customer_tag_assignments_tenant_tag_idx on public.customer_tag_assignments (tenant_id, tag_id, customer_id);

create table if not exists public.customer_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text,
  kind text not null default 'custom' check (kind in ('system','custom')),
  system_key text,
  definition_json jsonb not null default '{"operator":"and","conditions":[]}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, name)
);
create index if not exists customer_segments_active_idx on public.customer_segments (tenant_id, active, updated_at desc);
create unique index if not exists customer_segments_system_key_unique
  on public.customer_segments (tenant_id, system_key) where system_key is not null;

create or replace function public.seed_tenant_crm_segments(target_tenant_id uuid)
returns void language sql set search_path = public as $$
  insert into public.customer_segments (tenant_id, name, description, kind, system_key)
  values
    (target_tenant_id, 'Tous les clients', 'Audience CRM complète.', 'system', 'all'),
    (target_tenant_id, 'Nouveaux', 'Nouveaux profils et premiers acheteurs.', 'system', 'new'),
    (target_tenant_id, 'Actifs', 'Dernier achat dans les 90 jours.', 'system', 'active'),
    (target_tenant_id, 'Fidèles', 'Clients fidèles ou potentiellement fidèles.', 'system', 'loyal'),
    (target_tenant_id, 'VIP', 'Meilleure récence, fréquence et valeur.', 'system', 'vip'),
    (target_tenant_id, 'À risque', 'Clients réguliers dont l’activité ralentit.', 'system', 'at_risk'),
    (target_tenant_id, 'Inactifs', 'Clients en hibernation ou perdus.', 'system', 'inactive'),
    (target_tenant_id, 'Achat unique', 'Un seul achat complété.', 'system', 'one_time'),
    (target_tenant_id, 'Fidélité', 'Solde fidélité positif.', 'system', 'loyalty'),
    (target_tenant_id, 'Marketing autorisé', 'Consentement marketing courant accordé.', 'system', 'marketing'),
    (target_tenant_id, 'Participants événements', 'Au moins une réservation événement confirmée.', 'system', 'events')
  on conflict do nothing
$$;

select public.seed_tenant_crm_segments(id) from public.tenants;

create or replace function public.seed_crm_segments_for_new_tenant()
returns trigger language plpgsql set search_path = public as $$
begin perform public.seed_tenant_crm_segments(new.id); return new; end
$$;
drop trigger if exists tenants_seed_crm_segments on public.tenants;
create trigger tenants_seed_crm_segments after insert on public.tenants
for each row execute function public.seed_crm_segments_for_new_tenant();

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft','scheduled','processing','completed','cancelled','failed')),
  channel text not null check (channel in ('email','sms','whatsapp','push')),
  segment_id uuid,
  subject text,
  content text not null default '',
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (segment_id, tenant_id) references public.customer_segments(id, tenant_id) on delete set null (segment_id)
);
create index if not exists marketing_campaigns_tenant_idx on public.marketing_campaigns (tenant_id, created_at desc);

create table if not exists public.marketing_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null,
  customer_id uuid,
  channel_target text not null,
  consent_granted boolean not null,
  consent_recorded_at timestamptz,
  status text not null default 'pending' check (status in ('pending','processing','sent','delivered','opened','clicked','converted','skipped','failed')),
  idempotency_key text not null,
  provider_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  converted_at timestamptz,
  conversion_order_id uuid references public.orders(id) on delete set null,
  conversion_revenue numeric(12,2),
  last_error text,
  created_at timestamptz not null default now(),
  unique (campaign_id, customer_id),
  unique (tenant_id, idempotency_key),
  unique (id, tenant_id),
  foreign key (campaign_id, tenant_id) references public.marketing_campaigns(id, tenant_id) on delete cascade,
  foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete set null (customer_id)
);
create index if not exists marketing_campaign_recipients_status_idx on public.marketing_campaign_recipients (tenant_id, campaign_id, status);

create table if not exists public.marketing_campaign_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null,
  recipient_id uuid,
  event_type text not null check (event_type in ('queued','sent','delivered','opened','clicked','converted','failed','skipped')),
  provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, tenant_id) references public.marketing_campaigns(id, tenant_id) on delete cascade,
  foreign key (recipient_id, tenant_id) references public.marketing_campaign_recipients(id, tenant_id) on delete cascade
);
alter table public.marketing_campaign_events
  add constraint marketing_campaign_events_provider_unique unique (tenant_id, provider_event_id);
create index if not exists marketing_campaign_events_timeline_idx on public.marketing_campaign_events (tenant_id, campaign_id, occurred_at desc);

-- All CRM tables are server-only. Tenant isolation is enforced in every API
-- and reinforced by composite tenant/customer foreign keys.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'customer_events','customer_notes','customer_tags','customer_tag_assignments',
    'customer_segments','marketing_campaigns','marketing_campaign_recipients','marketing_campaign_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end $$;

-- Event streams are append-only even for the application service role.
revoke update, delete on public.customer_events, public.marketing_campaign_events from service_role;

-- Latest consent is the authority. Presence of an email never implies consent.
create or replace view public.customer_current_marketing_consent as
with decisions as (
  select uc.id, uc.tenant_id, coalesce(uc.user_id, o.customer_id) as customer_id,
    uc.granted, uc.source, uc.created_at
  from public.user_consents uc
  left join public.orders o on o.id = uc.order_id and o.tenant_id = uc.tenant_id
  where uc.consent_type = 'marketing'
)
select distinct on (tenant_id, customer_id)
  tenant_id, customer_id, granted, source, created_at
from decisions where customer_id is not null
order by tenant_id, customer_id, created_at desc, id desc;

create or replace view public.customer_crm_stats as
with order_stats as (
  select tenant_id, customer_id,
    count(*) filter (where status <> 'cancelled')::int as orders_count,
    count(*) filter (where payment_status = 'paid' and status <> 'cancelled')::int as completed_orders_count,
    coalesce(sum(total) filter (where payment_status = 'paid' and status <> 'cancelled'), 0)::numeric(12,2) as online_spend,
    min(created_at) filter (where payment_status = 'paid' and status <> 'cancelled') as first_order_at,
    max(created_at) filter (where payment_status = 'paid' and status <> 'cancelled') as last_order_at
  from public.orders where customer_id is not null group by tenant_id, customer_id
), store_stats as (
  select tenant_id, customer_id, coalesce(sum(amount), 0)::numeric(12,2) as in_store_spend,
    max(created_at) as last_in_store_at
  from public.loyalty_manual_purchases where customer_id is not null group by tenant_id, customer_id
), point_stats as (
  select tenant_id, customer_id,
    coalesce(sum(amount) filter (where status in ('CONFIRMED','REVERSED')), 0)::int as loyalty_points_balance,
    max(created_at) as last_points_at
  from public.points_ledger group by tenant_id, customer_id
), event_stats as (
  select tenant_id, customer_id, count(*)::int as event_reservations_count, max(created_at) as last_event_at
  from public.event_reservations where customer_id is not null and status = 'confirmed' group by tenant_id, customer_id
)
select c.tenant_id, c.id as customer_id,
  coalesce(o.orders_count, 0) as orders_count,
  coalesce(o.completed_orders_count, 0) as completed_orders_count,
  (coalesce(o.online_spend, 0) + coalesce(s.in_store_spend, 0))::numeric(12,2) as lifetime_value,
  case when coalesce(o.completed_orders_count, 0) > 0 then (o.online_spend / o.completed_orders_count)::numeric(12,2) else 0::numeric end as average_order_value,
  o.first_order_at, o.last_order_at,
  case when o.last_order_at is null then null else greatest(0, current_date - o.last_order_at::date) end as days_since_last_order,
  coalesce(o.online_spend, 0)::numeric(12,2) as online_spend,
  coalesce(s.in_store_spend, 0)::numeric(12,2) as in_store_spend,
  coalesce(p.loyalty_points_balance, 0) as loyalty_points_balance,
  greatest(c.created_at, coalesce(o.last_order_at, c.created_at), coalesce(s.last_in_store_at, c.created_at), coalesce(p.last_points_at, c.created_at), coalesce(e.last_event_at, c.created_at)) as last_activity_at,
  coalesce(e.event_reservations_count, 0) as event_reservations_count,
  coalesce((select sum(oi.quantity)::int from public.order_items oi join public.orders oo on oo.id = oi.order_id
    where oo.tenant_id = c.tenant_id and oo.customer_id = c.id and oo.payment_status = 'paid' and oo.status <> 'cancelled'), 0) as products_count,
  (select oi.product_id from public.order_items oi join public.orders oo on oo.id = oi.order_id
    where oo.tenant_id = c.tenant_id and oo.customer_id = c.id and oo.payment_status = 'paid' and oo.status <> 'cancelled' and oi.product_id is not null
    group by oi.product_id order by sum(oi.quantity) desc, sum(oi.subtotal) desc, oi.product_id limit 1) as favorite_product_id,
  (select p2.category_id from public.order_items oi join public.orders oo on oo.id = oi.order_id join public.products p2 on p2.id = oi.product_id
    where oo.tenant_id = c.tenant_id and oo.customer_id = c.id and oo.payment_status = 'paid' and oo.status <> 'cancelled' and p2.category_id is not null
    group by p2.category_id order by sum(oi.quantity) desc, sum(oi.subtotal) desc, p2.category_id limit 1) as favorite_category_id
from public.customers c
left join order_stats o on o.tenant_id = c.tenant_id and o.customer_id = c.id
left join store_stats s on s.tenant_id = c.tenant_id and s.customer_id = c.id
left join point_stats p on p.tenant_id = c.tenant_id and p.customer_id = c.id
left join event_stats e on e.tenant_id = c.tenant_id and e.customer_id = c.id;

create or replace view public.customer_crm_overview as
select c.id, c.tenant_id, c.auth_user_id, c.email, c.normalized_email, c.full_name,
  c.phone, c.normalized_phone, c.source, c.loyalty_card_number, c.created_at, c.updated_at,
  c.search_document,
  s.orders_count, s.completed_orders_count, s.lifetime_value, s.average_order_value,
  s.first_order_at, s.last_order_at, s.days_since_last_order, s.online_spend,
  s.in_store_spend, s.loyalty_points_balance, s.last_activity_at, s.event_reservations_count,
  s.products_count, s.favorite_product_id, s.favorite_category_id,
  coalesce(mc.granted, false) as marketing_consent,
  mc.created_at as marketing_consent_at,
  mc.source as marketing_consent_source,
  case
    when s.completed_orders_count >= 8 and s.lifetime_value >= 500 and coalesce(s.days_since_last_order, 99999) <= 45 then 'champion'
    when s.completed_orders_count >= 4 and coalesce(s.days_since_last_order, 99999) <= 90 then 'loyal'
    when s.completed_orders_count between 1 and 3 and coalesce(s.days_since_last_order, 99999) <= 90 then 'potential_loyalist'
    when s.completed_orders_count <= 1 and c.created_at >= now() - interval '30 days' then 'new'
    when s.completed_orders_count >= 1 and coalesce(s.days_since_last_order, 99999) between 91 and 180 then 'at_risk'
    when s.completed_orders_count >= 1 and coalesce(s.days_since_last_order, 99999) between 181 and 365 then 'hibernating'
    when s.completed_orders_count >= 1 and coalesce(s.days_since_last_order, 99999) > 365 then 'lost'
    else 'hibernating'
  end as rfm_segment,
  case when s.days_since_last_order is null then 1 when s.days_since_last_order <= 30 then 5 when s.days_since_last_order <= 60 then 4 when s.days_since_last_order <= 120 then 3 when s.days_since_last_order <= 240 then 2 else 1 end as recency_score,
  case when s.completed_orders_count >= 8 then 5 when s.completed_orders_count >= 5 then 4 when s.completed_orders_count >= 3 then 3 when s.completed_orders_count >= 2 then 2 else 1 end as frequency_score,
  case when s.lifetime_value >= 500 then 5 when s.lifetime_value >= 250 then 4 when s.lifetime_value >= 100 then 3 when s.lifetime_value >= 40 then 2 else 1 end as monetary_score
from public.customers c
join public.customer_crm_stats s on s.tenant_id = c.tenant_id and s.customer_id = c.id
left join public.customer_current_marketing_consent mc on mc.tenant_id = c.tenant_id and mc.customer_id = c.id;

revoke all on public.customer_current_marketing_consent, public.customer_crm_stats, public.customer_crm_overview from anon, authenticated;
grant select on public.customer_current_marketing_consent, public.customer_crm_stats, public.customer_crm_overview to service_role;
revoke all on function public.seed_tenant_crm_segments(uuid) from public;
grant execute on function public.seed_tenant_crm_segments(uuid) to service_role;

-- CRM capabilities are assigned only to protected full-admin roles.
insert into public.admin_permissions (key, module, label, description, risk_level, position) values
  ('customers.view', 'CRM', 'Consulter les clients', 'Consulter Customer 360, les segments et les statistiques clients du tenant.', 'standard', 88),
  ('customers.manage', 'CRM', 'Gérer les clients', 'Créer et modifier les profils, notes et tags clients.', 'sensitive', 89),
  ('segments.manage', 'CRM', 'Gérer les segments', 'Créer, modifier et prévisualiser les segments dynamiques.', 'sensitive', 90),
  ('campaigns.view', 'CRM · Campagnes', 'Consulter les campagnes', 'Consulter les campagnes et leurs métriques disponibles.', 'standard', 91),
  ('campaigns.manage', 'CRM · Campagnes', 'Gérer les campagnes', 'Créer et transmettre des campagnes consenties au provider configuré.', 'critical', 92)
on conflict (key) do update set module=excluded.module, label=excluded.label, description=excluded.description,
  risk_level=excluded.risk_level, position=excluded.position, active=true;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p.key from public.admin_roles r cross join public.admin_permissions p
where r.code in ('platform_owner','tenant_admin')
  and p.key in ('customers.view','customers.manage','segments.manage','campaigns.view','campaigns.manage')
on conflict do nothing;

commit;
