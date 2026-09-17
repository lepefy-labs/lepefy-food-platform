-- ─── MIGRATION 115: RETRAIT / LIVRAISON — RÉSERVATIONS LOCATION MATÉRIEL ─────
-- Ajoute le choix retrait/livraison + adresse + suivi du supplément de
-- livraison sur rental_reservations et rental_reservation_requests (061).
-- Aucun changement RLS/grants requis : les deux tables sont déjà
-- service_role-only, les nouvelles colonnes héritent des grants de table.

alter table public.rental_reservations
  add column fulfillment_type       text not null default 'pickup' check (fulfillment_type in ('pickup','delivery')),
  add column delivery_street        text,
  add column delivery_house_number  text,
  add column delivery_city          text,
  add column delivery_postal_code   text,
  add column delivery_country       text,
  add column delivery_zone_id       uuid references public.rental_delivery_zones(id) on delete set null,
  add column delivery_fee_status    text not null default 'not_applicable'
                                     check (delivery_fee_status in ('not_applicable','pending_quote','quoted','paid')),
  add column delivery_fee_amount    numeric(10,2),
  add column delivery_fee_quoted_at timestamptz,
  add column delivery_fee_paid_at   timestamptz;

alter table public.rental_reservation_requests
  add column fulfillment_type      text not null default 'pickup' check (fulfillment_type in ('pickup','delivery')),
  add column delivery_street       text,
  add column delivery_house_number text,
  add column delivery_city         text,
  add column delivery_postal_code  text,
  add column delivery_country      text,
  add column delivery_zone_id      uuid references public.rental_delivery_zones(id) on delete set null,
  add column delivery_fee_amount   numeric(10,2);

comment on column public.rental_reservations.delivery_fee_status is
  'not_applicable = retrait boutique. pending_quote = livraison choisie, aucune zone précise ne correspond, '
  'supplément à évaluer par l''admin. quoted = supplément fixé (zone auto ou admin) et lien de paiement '
  'disponible. paid = admin a confirmé la réception du paiement du supplément.';
