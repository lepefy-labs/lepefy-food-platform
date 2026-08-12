-- ─── MIGRATION 061: PAIEMENTS VIA LIEN EXTERNE — LOCATION MATÉRIEL ───────────
-- Phase 3 — dernier des trois modules (shop Phase 1, billetterie Phase 2,
-- location ici), même règle absolue : aucune réservation créée au clic,
-- seulement une demande en attente de confirmation manuelle admin.
--
-- Même décision qu'en Phase 2 : table dédiée au module plutôt qu'une table
-- générique partagée shop/événementiel/location.

create table if not exists public.rental_reservation_requests (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  service_offering_id    uuid not null references public.service_offerings(id) on delete cascade,
  items                  jsonb not null,
  pickup_date            date not null,
  customer_name          text not null,
  customer_email         text not null,
  customer_phone         text,
  amount                 numeric(10,2) not null,
  currency               text not null default 'eur',
  payment_method_type    text not null,
  payment_method_label   text not null,
  payment_link           text not null,
  status                 text not null default 'pending' check (status in ('pending','confirmed','stock_conflict')),
  created_at             timestamptz not null default now(),
  confirmed_at           timestamptz,
  reservation_id         uuid references public.rental_reservations(id)
);

create index idx_rental_reservation_requests_service on public.rental_reservation_requests(service_offering_id);
create index idx_rental_reservation_requests_tenant  on public.rental_reservation_requests(tenant_id);

comment on table public.rental_reservation_requests is
  'Demandes de paiement via lien externe (PayPal/Revolut/autre) pour la location matériel. '
  'Aucune réservation rental_reservations n''existe tant que status != confirmed — voir '
  'createRentalReservationFromRequest et api/admin/evenementiel/rental-reservation-requests/[id]/confirm-payment.';

-- Même écart de sécurité assumé que pour le reste du module Événementiel
-- (052_events_module.sql, repris identique en Phase 2/060) : aucun
-- INSERT/UPDATE direct accordé à `authenticated` — toutes les écritures
-- passent par service_role côté serveur.
grant all on public.rental_reservation_requests to service_role;

-- ─── rental_reservations.stripe_payment_intent_id — même problème qu'en
-- Phase 2 sur event_reservations (052_events_module.sql : NOT NULL UNIQUE,
-- supposait qu'une réservation ne pouvait naître que d'un paiement Stripe).
-- Même correction : assouplir en NULL, l'UNIQUE reste valide (Postgres
-- n'impose jamais l'unicité entre plusieurs valeurs NULL).
alter table public.rental_reservations alter column stripe_payment_intent_id drop not null;

comment on column public.rental_reservations.stripe_payment_intent_id is
  'PaymentIntent Stripe d''origine — null pour une réservation confirmée via paiement par lien externe (Phase 3).';
