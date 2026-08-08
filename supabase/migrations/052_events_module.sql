-- ─── MIGRATION 052: MODULE ÉVÉNEMENTIEL (BBQ + SERVICES TRAITEUR/LOCATION) ───
-- Module 100% multi-tenant : deux flags d'activation indépendants sur
-- `tenants` (events_enabled, services_enabled), aucune donnée seedée pour un
-- tenant en particulier — chaque tenant active/configure depuis /admin.
--
-- Écart assumé vs le squelette RLS/GRANT initialement proposé pour ce module :
-- dans ce projet, AUCUNE table admin n'accorde d'INSERT/UPDATE direct à
-- `authenticated` — toutes les écritures (y compris les réservations créées
-- par le webhook Stripe, ou les devis créés par l'API publique) passent par
-- le service client côté serveur (`createServiceClient()`), jamais par le
-- client browser avec RLS (voir 050_shipping_country_rules.sql,
-- 045_tenant_hero_slides.sql : lecture publique via policy, écriture
-- service_role uniquement). Ce fichier suit ce pattern réel plutôt que le
-- squelette "GRANT INSERT ... TO authenticated" du brief — plus sûr (un
-- client ne peut jamais insérer une réservation avec status='confirmed'
-- sans être passé par la confirmation de paiement Stripe côté serveur).

-- ══════════════════════════════════════════════════════════════
-- FLAGS TENANT — activation indépendante du module Événements / Services
-- ══════════════════════════════════════════════════════════════
alter table tenants add column if not exists events_enabled boolean not null default false;
alter table tenants add column if not exists services_enabled boolean not null default false;

-- ══════════════════════════════════════════════════════════════
-- ÉVÉNEMENTS (soirées barbecue) — datés, formules multiples, QR redemption
-- ══════════════════════════════════════════════════════════════
create table events (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  slug                text not null,
  title               text not null,
  description         text,
  date_start          timestamptz not null,
  location            text,
  capacity_total      integer not null check (capacity_total >= 0),
  capacity_remaining  integer not null check (capacity_remaining >= 0),
  status              text not null default 'draft' check (status in ('draft','published','closed','cancelled')),
  banner_image_url    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, slug)
);

create index idx_events_tenant_status on events(tenant_id, status);
create index idx_events_tenant_date on events(tenant_id, date_start);

create trigger events_updated_at before update on events
  for each row execute function update_updated_at();

-- Formules par événement (ex. "Formule Repas" 10€, "Formule Repas + Bière" 15€)
create table event_ticket_types (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  event_id    uuid not null references events(id) on delete cascade,
  label       text not null,
  description text,
  price       numeric(10,2) not null check (price >= 0),
  sort_order  integer not null default 0,
  active      boolean not null default true
);

create index idx_event_ticket_types_event on event_ticket_types(event_id);

-- Réservation (créée UNIQUEMENT après confirmation de paiement webhook,
-- jamais avant — voir api/webhooks/stripe/route.ts)
create table event_reservations (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  event_id                  uuid not null references events(id) on delete cascade,
  customer_name             text not null,
  customer_email            text not null,
  customer_phone            text,
  stripe_payment_intent_id  text not null unique,
  amount_paid               numeric(10,2) not null,
  qr_token                  text not null unique,
  quantity_total            integer not null check (quantity_total > 0),
  quantity_remaining        integer not null check (quantity_remaining >= 0),
  status                    text not null default 'confirmed' check (status in ('confirmed','cancelled','refunded')),
  created_at                timestamptz not null default now()
);

create index idx_event_reservations_event on event_reservations(event_id);
create index idx_event_reservations_tenant on event_reservations(tenant_id);

-- Détail des formules choisies dans la réservation
create table event_reservation_items (
  id                uuid primary key default gen_random_uuid(),
  reservation_id    uuid not null references event_reservations(id) on delete cascade,
  ticket_type_id    uuid not null references event_ticket_types(id),
  quantity          integer not null check (quantity > 0),
  unit_price        numeric(10,2) not null
);

create index idx_event_reservation_items_reservation on event_reservation_items(reservation_id);

-- Journal de chaque scan — trace qui/quand/combien
create table event_reservation_redemptions (
  id                  uuid primary key default gen_random_uuid(),
  reservation_id      uuid not null references event_reservations(id) on delete cascade,
  redeemed_by         uuid references admin_users(id),
  quantity_redeemed   integer not null check (quantity_redeemed > 0),
  redeemed_at         timestamptz not null default now()
);

create index idx_event_reservation_redemptions_reservation on event_reservation_redemptions(reservation_id);

-- RPC atomique : décrément de capacité événement au moment du paiement confirmé
create or replace function reserve_event_capacity(p_event_id uuid, p_quantity integer)
returns table(success boolean, remaining integer)
language plpgsql
as $$
declare
  v_remaining integer;
begin
  update events
  set capacity_remaining = capacity_remaining - p_quantity, updated_at = now()
  where id = p_event_id and capacity_remaining >= p_quantity
  returning capacity_remaining into v_remaining;

  if v_remaining is null then
    return query select false, (select capacity_remaining from events where id = p_event_id);
  else
    return query select true, v_remaining;
  end if;
end;
$$;

-- RPC atomique : restauration de capacité (refund admin)
create or replace function restore_event_capacity(p_event_id uuid, p_quantity integer)
returns void
language plpgsql
as $$
begin
  update events
  set capacity_remaining = least(capacity_total, capacity_remaining + p_quantity), updated_at = now()
  where id = p_event_id;
end;
$$;

-- RPC atomique : redemption QR anti-réutilisation, décrément partiel admis
create or replace function redeem_event_reservation(p_qr_token text, p_quantity integer, p_admin_id uuid)
returns table(success boolean, remaining integer, reason text)
language plpgsql
as $$
declare
  v_remaining       integer;
  v_reservation_id  uuid;
begin
  update event_reservations
  set quantity_remaining = quantity_remaining - p_quantity
  where qr_token = p_qr_token and quantity_remaining >= p_quantity and status = 'confirmed'
  returning id, quantity_remaining into v_reservation_id, v_remaining;

  if v_remaining is null then
    return query select false, 0, 'quantité insuffisante, code épuisé ou invalide';
  else
    insert into event_reservation_redemptions (reservation_id, redeemed_by, quantity_redeemed)
    values (v_reservation_id, p_admin_id, p_quantity);
    return query select true, v_remaining, 'ok';
  end if;
end;
$$;

-- ══════════════════════════════════════════════════════════════
-- SERVICES — Traiteur (devis) / Location Matériel (catalogue payant)
-- ══════════════════════════════════════════════════════════════
create table service_offerings (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  slug              text not null,
  type              text not null check (type in ('traiteur','location_materiel','autre')),
  title             text not null,
  description       text,
  cta_type          text not null check (cta_type in ('devis','reservation')),
  cover_image_url   text,
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, slug)
);

create index idx_service_offerings_tenant on service_offerings(tenant_id);

create trigger service_offerings_updated_at before update on service_offerings
  for each row execute function update_updated_at();

-- Demandes de devis (services avec cta_type = 'devis', ex. Traiteur)
create table service_inquiries (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  service_offering_id   uuid not null references service_offerings(id) on delete cascade,
  customer_name         text not null,
  customer_email        text not null,
  customer_phone        text,
  date_souhaitee        date,
  nombre_invites        integer,
  message               text,
  status                text not null default 'nouveau' check (status in ('nouveau','contacte','clos')),
  created_at            timestamptz not null default now()
);

create index idx_service_inquiries_tenant_status on service_inquiries(tenant_id, status);

-- Articles louables (catalogue Location Matériel)
create table rental_items (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  service_offering_id   uuid not null references service_offerings(id) on delete cascade,
  name                  text not null,
  category              text,
  price_per_unit        numeric(10,2) not null check (price_per_unit >= 0),
  stock_quantity        integer not null default 0 check (stock_quantity >= 0),
  image_url             text,
  active                boolean not null default true,
  sort_order            integer not null default 0
);

create index idx_rental_items_service on rental_items(service_offering_id);

-- Réservation multi-article payante (services avec cta_type = 'reservation')
create table rental_reservations (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  service_offering_id       uuid not null references service_offerings(id) on delete cascade,
  customer_name             text not null,
  customer_email            text not null,
  customer_phone            text,
  pickup_date               date not null,
  stripe_payment_intent_id  text not null unique,
  amount_paid               numeric(10,2) not null,
  status                    text not null default 'confirmed' check (status in ('confirmed','cancelled','refunded')),
  created_at                timestamptz not null default now()
);

create index idx_rental_reservations_service on rental_reservations(service_offering_id);
create index idx_rental_reservations_tenant on rental_reservations(tenant_id);

create table rental_reservation_items (
  id                uuid primary key default gen_random_uuid(),
  reservation_id    uuid not null references rental_reservations(id) on delete cascade,
  rental_item_id    uuid not null references rental_items(id),
  quantity          integer not null check (quantity > 0),
  unit_price        numeric(10,2) not null
);

create index idx_rental_reservation_items_reservation on rental_reservation_items(reservation_id);

-- RPC atomique : décrément de stock article louable (même pattern que reserve_event_capacity)
create or replace function reserve_rental_stock(p_rental_item_id uuid, p_quantity integer)
returns table(success boolean, remaining integer)
language plpgsql
as $$
declare
  v_remaining integer;
begin
  update rental_items
  set stock_quantity = stock_quantity - p_quantity
  where id = p_rental_item_id and stock_quantity >= p_quantity
  returning stock_quantity into v_remaining;

  if v_remaining is null then
    return query select false, (select stock_quantity from rental_items where id = p_rental_item_id);
  else
    return query select true, v_remaining;
  end if;
end;
$$;

-- RPC atomique : restauration de stock (refund admin)
create or replace function restore_rental_stock(p_rental_item_id uuid, p_quantity integer)
returns void
language plpgsql
as $$
begin
  update rental_items
  set stock_quantity = stock_quantity + p_quantity
  where id = p_rental_item_id;
end;
$$;

-- ══════════════════════════════════════════════════════════════
-- GALERIE — photos des événements passés
-- ══════════════════════════════════════════════════════════════
create table event_gallery_photos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  event_id      uuid references events(id) on delete set null,
  image_url     text not null,
  caption       text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index idx_event_gallery_photos_tenant on event_gallery_photos(tenant_id, sort_order);

-- ══════════════════════════════════════════════════════════════
-- RLS + GRANT — pattern identique à 045/050 : lecture publique via policy,
-- toute écriture réservée à service_role (routes /api/admin/... et
-- /api/webhooks/stripe via requireAdmin() + createServiceClient()).
-- ══════════════════════════════════════════════════════════════
alter table events enable row level security;
alter table event_ticket_types enable row level security;
alter table event_reservations enable row level security;
alter table event_reservation_items enable row level security;
alter table event_reservation_redemptions enable row level security;
alter table service_offerings enable row level security;
alter table service_inquiries enable row level security;
alter table rental_items enable row level security;
alter table rental_reservations enable row level security;
alter table rental_reservation_items enable row level security;
alter table event_gallery_photos enable row level security;

create policy "events_select_public"
  on events for select using (status = 'published');

create policy "event_ticket_types_select_public"
  on event_ticket_types for select using (active = true);

create policy "service_offerings_select_public"
  on service_offerings for select using (active = true);

create policy "rental_items_select_public"
  on rental_items for select using (active = true);

create policy "event_gallery_photos_select_public"
  on event_gallery_photos for select using (true);

-- Aucune policy publique sur event_reservations, event_reservation_items,
-- event_reservation_redemptions, service_inquiries, rental_reservations,
-- rental_reservation_items : ce sont des données de commande/contact,
-- accessibles uniquement via service_role — même principe que `orders` /
-- `checkout_sessions` (voir 002_rls_policies.sql, 037_checkout_sessions_customer_id.sql).

-- GRANTs explicites obligatoires (RLS seule ne suffit pas — pattern répété
-- dans tout le projet, voir 050_shipping_country_rules.sql).
grant select on events, event_ticket_types, service_offerings, rental_items, event_gallery_photos
  to anon, authenticated;

grant all on events, event_ticket_types, event_reservations, event_reservation_items,
  event_reservation_redemptions, service_offerings, service_inquiries, rental_items,
  rental_reservations, rental_reservation_items, event_gallery_photos
  to service_role;
