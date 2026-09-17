-- MIGRATION 113: VERIFIED SERVICE REVIEWS V1
-- Additive, tenant-scoped review foundation. Reviews remain operationally disabled
-- until tenant_feature_settings.reviews.enabled is explicitly enabled.

begin;

insert into public.platform_features (key, name, description, category, active, billable, position)
values ('reviews', 'Avis vérifiés', 'Avis de service issus de commandes payées et terminées.', 'growth', true, true, 60)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  billable = excluded.billable,
  position = excluded.position,
  updated_at = now();

insert into public.platform_plan_features (plan_id, feature_key, label, position)
select id, 'reviews', 'Avis vérifiés', 60
from public.platform_plans
where code = 'food-platform'
on conflict (plan_id, feature_key) do update set
  label = excluded.label,
  position = excluded.position;

insert into public.admin_permissions (key, module, label, description, risk_level, position) values
  ('reviews.view', 'Boutique · Avis', 'Voir les avis', 'Consulter les avis clients vérifiés et leurs indicateurs.', 'standard', 91),
  ('reviews.moderate', 'Boutique · Avis', 'Modérer les avis', 'Publier, rejeter, masquer ou restaurer un avis avec motif audité.', 'sensitive', 92),
  ('reviews.manage', 'Boutique · Avis', 'Configurer les avis', 'Activer et configurer la collecte, l’affichage public et la liste de vigilance.', 'sensitive', 93)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  risk_level = excluded.risk_level,
  position = excluded.position,
  active = true;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_roles r
cross join public.admin_permissions p
where r.code in ('platform_owner', 'tenant_admin')
  and p.key in ('reviews.view', 'reviews.moderate', 'reviews.manage')
on conflict do nothing;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  review_type text not null default 'service' check (review_type = 'service'),
  rating smallint not null check (rating between 1 and 5),
  body text,
  reviewer_display_name text,
  verified_purchase boolean not null default true check (verified_purchase),
  status text not null default 'pending_moderation' check (status in ('pending_moderation','published','rejected','hidden')),
  moderation_flags text[] not null default '{}'::text[],
  moderation_reason_code text,
  moderation_reason_text text,
  submitted_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_id, review_type),
  unique (id, tenant_id)
);
create index if not exists reviews_tenant_status_submitted_idx on public.reviews (tenant_id, status, submitted_at desc);
create index if not exists reviews_tenant_published_idx on public.reviews (tenant_id, published_at desc) where status = 'published';
create index if not exists reviews_customer_idx on public.reviews (tenant_id, customer_id, submitted_at desc) where customer_id is not null;

create table if not exists public.review_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  email text not null,
  full_name text,
  review_type text not null default 'service' check (review_type = 'service'),
  eligible_at timestamptz not null,
  reminder_at timestamptz not null,
  expires_at timestamptz not null,
  sent_at timestamptz,
  reminder_sent_at timestamptz,
  completed_at timestamptz,
  processing_started_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_id, review_type),
  unique (id, tenant_id)
);
create index if not exists review_invites_due_idx on public.review_invites (eligible_at, reminder_at)
  where completed_at is null;
create index if not exists review_invites_tenant_order_idx on public.review_invites (tenant_id, order_id);

create table if not exists public.review_invite_tokens (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.review_invites(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  purpose text not null check (purpose in ('initial','reminder')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (invite_id, tenant_id) references public.review_invites(id, tenant_id) on delete cascade
);
create index if not exists review_invite_tokens_lookup_idx on public.review_invite_tokens (tenant_id, token_hash, expires_at)
  where consumed_at is null;

create table if not exists public.review_moderation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  review_id uuid not null,
  actor_type text not null check (actor_type in ('customer','admin','system')),
  actor_user_id uuid references public.admin_users(id) on delete set null,
  action text not null,
  previous_status text,
  next_status text,
  reason_code text,
  reason_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (review_id, tenant_id) references public.reviews(id, tenant_id) on delete cascade
);
create index if not exists review_moderation_events_review_idx on public.review_moderation_events (tenant_id, review_id, created_at desc);

create or replace function public.validate_review_invite()
returns trigger language plpgsql set search_path = public as $$
declare
  purchase public.orders%rowtype;
  customer_tenant uuid;
begin
  select * into purchase from public.orders
  where id = new.order_id and tenant_id = new.tenant_id;
  if not found then raise exception 'review_invite_order_not_found'; end if;
  if new.customer_id is not null then
    select tenant_id into customer_tenant from public.customers where id = new.customer_id;
    if customer_tenant is distinct from new.tenant_id then raise exception 'review_invite_customer_mismatch'; end if;
  end if;
  if new.reminder_at < new.eligible_at or new.expires_at <= new.eligible_at then
    raise exception 'review_invite_timing_invalid';
  end if;
  return new;
end
$$;

drop trigger if exists review_invites_validate on public.review_invites;
create trigger review_invites_validate before insert or update of tenant_id, order_id, customer_id, eligible_at, reminder_at, expires_at on public.review_invites
for each row execute function public.validate_review_invite();

alter table public.reviews enable row level security;
alter table public.reviews force row level security;
alter table public.review_invites enable row level security;
alter table public.review_invites force row level security;
alter table public.review_invite_tokens enable row level security;
alter table public.review_invite_tokens force row level security;
alter table public.review_moderation_events enable row level security;
alter table public.review_moderation_events force row level security;

revoke all on table public.reviews from public, anon, authenticated;
revoke all on table public.review_invites from public, anon, authenticated;
revoke all on table public.review_invite_tokens from public, anon, authenticated;
revoke all on table public.review_moderation_events from public, anon, authenticated;
grant select, insert, update on table public.reviews to service_role;
grant select, insert, update, delete on table public.review_invites to service_role;
grant select, insert, update, delete on table public.review_invite_tokens to service_role;
grant select, insert on table public.review_moderation_events to service_role;

create or replace function public.validate_review_purchase()
returns trigger language plpgsql set search_path = public as $$
declare
  purchase public.orders%rowtype;
begin
  select * into purchase from public.orders
  where id = new.order_id and tenant_id = new.tenant_id;
  if not found then raise exception 'review_order_not_found'; end if;
  if purchase.status <> 'delivered' or purchase.payment_status <> 'paid' then
    raise exception 'review_order_not_eligible';
  end if;
  if new.customer_id is not null and purchase.customer_id is distinct from new.customer_id then
    raise exception 'review_customer_mismatch';
  end if;
  return new;
end
$$;

drop trigger if exists reviews_validate_purchase on public.reviews;
create trigger reviews_validate_purchase before insert on public.reviews
for each row execute function public.validate_review_purchase();

create or replace function public.protect_review_content()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.order_id is distinct from old.order_id
     or new.customer_id is distinct from old.customer_id
     or new.review_type is distinct from old.review_type
     or new.rating is distinct from old.rating
     or new.body is distinct from old.body
     or new.reviewer_display_name is distinct from old.reviewer_display_name
     or new.verified_purchase is distinct from old.verified_purchase
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'review_customer_content_immutable';
  end if;
  if (new.status is distinct from old.status
      or new.moderation_reason_code is distinct from old.moderation_reason_code
      or new.moderation_reason_text is distinct from old.moderation_reason_text
      or new.published_at is distinct from old.published_at)
     and coalesce(current_setting('app.review_moderation_rpc', true), '') <> '1' then
    raise exception 'review_moderation_requires_rpc';
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists reviews_protect_content on public.reviews;
create trigger reviews_protect_content before update on public.reviews
for each row execute function public.protect_review_content();

create or replace function public.audit_review_submission()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into public.review_moderation_events(
    tenant_id, review_id, actor_type, action, next_status, metadata
  ) values (
    new.tenant_id, new.id, 'customer', 'submitted', new.status,
    jsonb_build_object('flags', to_jsonb(new.moderation_flags), 'verified_purchase', true)
  );
  return new;
end
$$;

drop trigger if exists reviews_audit_submission on public.reviews;
create trigger reviews_audit_submission after insert on public.reviews
for each row execute function public.audit_review_submission();

create or replace function public.moderate_review(
  p_tenant_id uuid,
  p_review_id uuid,
  p_action text,
  p_reason_code text,
  p_reason_text text,
  p_actor_user_id uuid
) returns public.reviews
language plpgsql security definer set search_path = public as $$
declare
  current_review public.reviews%rowtype;
  previous_status_value text;
  next_status text;
  next_published_at timestamptz;
begin
  if p_action not in ('publish','reject','hide','restore') then raise exception 'review_moderation_action_invalid'; end if;
  if p_action in ('reject','hide') and coalesce(btrim(p_reason_code), '') = '' then raise exception 'review_moderation_reason_required'; end if;
  if p_reason_code is not null and p_reason_code not in ('spam','personal_data','abuse','threats','hate','illegal','irrelevant','duplicate','other') then
    raise exception 'review_moderation_reason_invalid';
  end if;

  select * into current_review from public.reviews
  where id = p_review_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'review_not_found'; end if;
  previous_status_value := current_review.status;

  if p_action = 'publish' then
    if current_review.status not in ('pending_moderation','rejected') then raise exception 'review_transition_invalid'; end if;
    next_status := 'published'; next_published_at := coalesce(current_review.published_at, now());
  elsif p_action = 'reject' then
    if current_review.status not in ('pending_moderation','published') then raise exception 'review_transition_invalid'; end if;
    next_status := 'rejected'; next_published_at := null;
  elsif p_action = 'hide' then
    if current_review.status <> 'published' then raise exception 'review_transition_invalid'; end if;
    next_status := 'hidden'; next_published_at := current_review.published_at;
  else
    if current_review.status not in ('hidden','rejected') then raise exception 'review_transition_invalid'; end if;
    next_status := 'published'; next_published_at := coalesce(current_review.published_at, now());
  end if;

  perform set_config('app.review_moderation_rpc', '1', true);
  update public.reviews set
    status = next_status,
    moderation_reason_code = p_reason_code,
    moderation_reason_text = nullif(btrim(p_reason_text), ''),
    published_at = next_published_at
  where id = p_review_id and tenant_id = p_tenant_id
  returning * into current_review;

  insert into public.review_moderation_events(
    tenant_id, review_id, actor_type, actor_user_id, action,
    previous_status, next_status, reason_code, reason_text
  ) values (
    p_tenant_id, p_review_id, 'admin', p_actor_user_id, p_action,
    previous_status_value, next_status, p_reason_code, nullif(btrim(p_reason_text), '')
  );

  return current_review;
end
$$;
revoke all on function public.moderate_review(uuid,uuid,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.moderate_review(uuid,uuid,text,text,text,uuid) to service_role;

create or replace function public.claim_review_invite_delivery(p_invite_id uuid)
returns table(invite_id uuid, tenant_id uuid, delivery_kind text)
language plpgsql security definer set search_path = public as $$
declare
  invitation public.review_invites%rowtype;
  kind text;
begin
  select * into invitation from public.review_invites where id = p_invite_id for update;
  if not found or invitation.completed_at is not null or invitation.expires_at <= now() then return; end if;
  if invitation.processing_started_at is not null and invitation.processing_started_at > now() - interval '15 minutes' then return; end if;

  if invitation.sent_at is null and invitation.eligible_at <= now() then kind := 'initial';
  elsif invitation.sent_at is not null and invitation.reminder_sent_at is null and invitation.reminder_at <= now() then kind := 'reminder';
  else return;
  end if;

  update public.review_invites set
    processing_started_at = now(),
    attempt_count = attempt_count + 1,
    last_attempt_at = now(),
    last_error = null,
    updated_at = now()
  where id = p_invite_id;

  return query select invitation.id, invitation.tenant_id, kind;
end
$$;
revoke all on function public.claim_review_invite_delivery(uuid) from public, anon, authenticated;
grant execute on function public.claim_review_invite_delivery(uuid) to service_role;

create or replace view public.tenant_review_stats as
select tenant_id,
       count(*)::bigint as published_count,
       round(avg(rating)::numeric, 2) as average_rating,
       count(*) filter (where rating = 5)::bigint as rating_5,
       count(*) filter (where rating = 4)::bigint as rating_4,
       count(*) filter (where rating = 3)::bigint as rating_3,
       count(*) filter (where rating = 2)::bigint as rating_2,
       count(*) filter (where rating = 1)::bigint as rating_1
from public.reviews
where status = 'published'
group by tenant_id;
revoke all on table public.tenant_review_stats from public, anon, authenticated;
grant select on table public.tenant_review_stats to service_role;

-- Extend the CRM event taxonomy without changing existing rows.
alter table public.customer_events drop constraint if exists customer_events_event_type_check;
alter table public.customer_events add constraint customer_events_event_type_check check (event_type in (
  'customer_created','account_linked','order_completed','product_purchased','category_purchased',
  'loyalty_points_earned','loyalty_points_redeemed','in_store_purchase','event_reserved',
  'event_attended','marketing_consent_granted','marketing_consent_revoked',
  'review_submitted','review_published'
));

commit;
