-- Permet de propager le customer_id (session authentifiée) de
-- /api/checkout jusqu'à la création de la commande dans le webhook Stripe
-- (payment_intent.succeeded), où l'order est réellement créé pour le flux
-- par carte. Nullable : le parcours guest existant n'est pas affecté.

alter table public.checkout_sessions
  add column if not exists customer_id uuid references public.customers(id) on delete set null;
