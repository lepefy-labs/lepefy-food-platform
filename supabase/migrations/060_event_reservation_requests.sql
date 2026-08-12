-- ─── MIGRATION 060: PAIEMENTS VIA LIEN EXTERNE — ÉVÉNEMENTIEL (BILLETTERIE) ──
-- Phase 2 — même règle absolue que Stripe/Phase 1 shop : aucune réservation
-- créée au clic, seulement une demande en attente de confirmation manuelle
-- admin (aucun webhook possible pour un simple lien PayPal/Revolut).
--
-- Contrairement au shop (checkout_sessions déjà existante, étendue en Phase
-- 1), le module événementiel n'a pas de table de session : le PaymentIntent
-- Stripe porte directement toutes les données de réservation dans ses
-- metadata. external_link n'a pas de PaymentIntent → nouvelle table dédiée,
-- décision prise avec Robertin de ne PAS introduire une table générique
-- partagée shop/événementiel/location (chaque module reste géré séparément).

create table if not exists public.event_reservation_requests (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  event_id               uuid not null references public.events(id) on delete cascade,
  items                  jsonb not null,
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
  reservation_id         uuid references public.event_reservations(id)
);

create index idx_event_reservation_requests_event  on public.event_reservation_requests(event_id);
create index idx_event_reservation_requests_tenant on public.event_reservation_requests(tenant_id);

comment on table public.event_reservation_requests is
  'Demandes de paiement via lien externe (PayPal/Revolut/autre) pour la billetterie événementiel. '
  'Aucune réservation event_reservations n''existe tant que status != confirmed — voir '
  'createEventReservationFromRequest et api/admin/evenementiel/reservation-requests/[id]/confirm-payment.';

-- Même écart de sécurité assumé que pour le reste du module Événementiel
-- (052_events_module.sql) : aucun INSERT/UPDATE direct accordé à
-- `authenticated` — toutes les écritures passent par service_role côté
-- serveur (api/events/[id]/checkout-external-link, confirmation admin).
grant all on public.event_reservation_requests to service_role;

-- ─── event_reservations.stripe_payment_intent_id — NOT NULL à assouplir ─────
-- La contrainte d'origine (052_events_module.sql) supposait qu'une réservation
-- ne pouvait naître que d'un paiement Stripe. Une réservation confirmée
-- depuis external_link n'a pas de PaymentIntent : la colonne doit accepter
-- NULL pour ce cas (l'UNIQUE existant reste valide — Postgres n'impose
-- jamais l'unicité entre plusieurs valeurs NULL).
alter table public.event_reservations alter column stripe_payment_intent_id drop not null;

comment on column public.event_reservations.stripe_payment_intent_id is
  'PaymentIntent Stripe d''origine — null pour une réservation confirmée via paiement par lien externe (Phase 2).';
