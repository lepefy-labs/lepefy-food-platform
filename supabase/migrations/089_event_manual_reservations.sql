-- ─── MIGRATION 089: RÉSERVATIONS ÉVÉNEMENT CRÉÉES EN MAGASIN ──────────────
-- Ajoute une provenance explicite aux réservations afin de distinguer les
-- paiements Stripe, les paiements externes confirmés manuellement et les
-- réservations encaissées directement en magasin par un admin.

alter table public.event_reservations
  add column if not exists source text,
  add column if not exists payment_method text,
  add column if not exists created_by_admin_id uuid references public.admin_users(id) on delete set null;

-- Backfill déterministe de l'historique existant. Avant cette migration, un
-- PaymentIntent non NULL identifiait Stripe ; NULL identifiait les réservations
-- créées après confirmation d'un lien de paiement externe.
update public.event_reservations
set source = case
  when stripe_payment_intent_id is null then 'external_link'
  else 'online'
end
where source is null;

update public.event_reservations
set payment_method = case
  when stripe_payment_intent_id is null then 'external_link'
  else 'stripe'
end
where payment_method is null;

alter table public.event_reservations
  alter column source set default 'online',
  alter column source set not null,
  alter column payment_method set default 'stripe',
  alter column payment_method set not null;

alter table public.event_reservations
  drop constraint if exists event_reservations_source_check,
  add constraint event_reservations_source_check
    check (source in ('online', 'external_link', 'admin_in_store'));

alter table public.event_reservations
  drop constraint if exists event_reservations_payment_method_check,
  add constraint event_reservations_payment_method_check
    check (payment_method in ('stripe', 'external_link', 'in_store'));

create index if not exists idx_event_reservations_tenant_source
  on public.event_reservations(tenant_id, source);

comment on column public.event_reservations.source is
  'Origine de la réservation : online (Stripe), external_link ou admin_in_store.';
comment on column public.event_reservations.payment_method is
  'Mode de paiement ayant confirmé la réservation : stripe, external_link ou in_store.';
comment on column public.event_reservations.created_by_admin_id is
  'Admin ayant créé la réservation en magasin ; NULL pour les flux client.';
