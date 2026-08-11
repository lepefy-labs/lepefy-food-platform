-- ─── MIGRATION 059: PAIEMENTS VIA LIEN EXTERNE (PayPal / Revolut / autre) ────
-- Phase 1 — boutique uniquement. Même règle absolue que Stripe : aucune
-- commande n'est créée avant confirmation du paiement — sauf que cette
-- confirmation est manuelle (aucun webhook possible pour un simple lien),
-- déclenchée depuis /admin (bandeau "Paiements en attente").
--
-- checkout_sessions.payment_method distingue désormais le flux Stripe
-- (déjà en place, valeur par défaut inchangée) du flux external_link : la
-- session porte alors un snapshot du moyen de paiement choisi (type, label,
-- lien final déjà construit — cf. Task 3/CheckoutForm) pour ne dépendre
-- d'aucune requête supplémentaire à tenant_payment_methods au moment de la
-- confirmation admin.

alter table public.checkout_sessions
  add column if not exists payment_method text not null default 'stripe'
    check (payment_method in ('stripe', 'external_link')),
  add column if not exists external_payment_type  text,
  add column if not exists external_payment_label text,
  add column if not exists external_payment_link  text;

comment on column public.checkout_sessions.payment_method is
  'stripe (défaut, flux existant) ou external_link (Phase 1 — PayPal/Revolut/autre, confirmation manuelle admin).';
comment on column public.checkout_sessions.external_payment_type is
  'Snapshot de tenant_payment_methods.method au moment de la requête (ex. "paypal", "other") — null pour payment_method=stripe.';
comment on column public.checkout_sessions.external_payment_label is
  'Snapshot de tenant_payment_methods.label au moment de la requête — null pour payment_method=stripe.';
comment on column public.checkout_sessions.external_payment_link is
  'Lien final déjà construit (montant appendu pour PayPal) — null pour payment_method=stripe.';

-- ─── orders.payment_method — élargissement du CHECK existant ────────────────
-- Le CHECK d'origine (001_initial_schema.sql) n'autorisait que
-- ('stripe','satispay','cash') — 'in_store' est utilisé par le code
-- (api/checkout/route.ts) depuis longtemps sans jamais avoir été ajouté au
-- CHECK. On corrige cette dérive au passage et on ajoute 'external_link'.
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders
  add constraint orders_payment_method_check
    check (payment_method in ('stripe', 'satispay', 'cash', 'in_store', 'external_link'));

alter table public.orders
  add column if not exists external_payment_type  text,
  add column if not exists external_payment_label text;

comment on column public.orders.external_payment_type is
  'Snapshot du type de moyen de paiement externe (ex. "paypal") au moment de la confirmation — null si payment_method != external_link.';
comment on column public.orders.external_payment_label is
  'Snapshot du label du moyen de paiement externe au moment de la confirmation — conservé même si le tenant modifie/supprime le moyen de paiement ensuite.';

-- Aucune nouvelle grant nécessaire : checkout_sessions a déjà
-- "grant all ... to service_role" (006_checkout_sessions.sql), qui couvre
-- automatiquement les nouvelles colonnes ; orders n'a jamais eu besoin de
-- grant explicite (service_role bypasse RLS nativement côté Supabase).
