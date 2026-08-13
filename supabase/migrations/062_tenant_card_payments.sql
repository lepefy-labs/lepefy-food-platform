-- ─── MIGRATION 062: PAIEMENT CARTE À MONTANT LIBRE — DIGITAL CARD (/card) ────
-- Nouveau moyen de paiement `card` pour tenant_payment_methods : ouvre un
-- checkout Stripe Elements intégré dans /card, montant saisi librement par
-- le client (pas de panier/produit derrière — paiement "montant libre" via
-- QR code affiché en boutique). Domaine indépendant de orders/checkout_sessions/
-- event_reservation_requests, même principe de séparation par module déjà en
-- usage (052_events_module.sql, 059_external_payment_links.sql, 061_rental_reservation_requests.sql).
-- Aucun Stripe Connect (comme pour le shop) : PaymentIntent créé sur le compte
-- plateforme Lepefy (STRIPE_SECRET_KEY), reversement au tenant manuel.

-- Étend la CHECK constraint existante (030_tenant_payment_methods.sql) pour
-- accepter 'card'.
alter table public.tenant_payment_methods
  drop constraint if exists tenant_payment_methods_method_check;
alter table public.tenant_payment_methods
  add constraint tenant_payment_methods_method_check
  check (method in ('satispay','bank_transfer','cash','paypal','other','card'));

create table if not exists public.tenant_card_payments (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  amount                    numeric(10,2) not null,
  currency                  text not null default 'eur',
  customer_name             text,
  customer_email            text,
  stripe_payment_intent_id  text unique,
  status                    text not null default 'pending' check (status in ('pending','paid')),
  created_at                timestamptz not null default now(),
  paid_at                   timestamptz
);

create index idx_tenant_card_payments_tenant on public.tenant_card_payments(tenant_id);

comment on table public.tenant_card_payments is
  'Paiements par carte à montant libre initiés depuis /card (scan QR en boutique). '
  'Domaine indépendant de orders/checkout_sessions — voir api/card/quick-pay et '
  'le branch card_quick_payment du webhook Stripe.';

alter table public.tenant_card_payments enable row level security;

-- Aucune policy select publique : lecture/écriture réservées à service_role
-- (création via api/card/quick-pay, mise à jour via le webhook Stripe).
-- RLS seule ne suffit pas pour service_role (bypassrls) — GRANT explicite
-- requis, même pattern que 042_customers_service_role_grant.sql.
grant select, insert, update on public.tenant_card_payments to service_role;
