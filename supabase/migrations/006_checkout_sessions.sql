-- checkout_sessions: dati ordine temporanei in attesa di pagamento Stripe.
-- Creati da /api/checkout, letti e cancellati dal webhook payment_intent.succeeded.
-- Evita ordini fantasma: nulla finisce in orders fino a pagamento confermato.

create table if not exists public.checkout_sessions (
  id               uuid        primary key default gen_random_uuid(),
  tenant_id        uuid        not null references public.tenants(id) on delete cascade,
  email            text        not null,
  full_name        text,
  phone            text,
  fulfillment_type text        not null check (fulfillment_type in ('delivery', 'pickup')),
  shipping_address jsonb,
  shipping_details jsonb,
  shipping_total   numeric(10, 2) not null default 0,
  items            jsonb       not null,
  created_at       timestamptz not null default now()
);

-- Pulizia automatica delle sessioni orfane (pagamento mai completato) dopo 24h.
-- Se si usa pg_cron: SELECT cron.schedule('cleanup-checkout-sessions', '0 * * * *',
--   $$DELETE FROM public.checkout_sessions WHERE created_at < now() - interval '24 hours'$$);

comment on table public.checkout_sessions is
  'Sessioni di checkout temporanee. Eliminate dal webhook Stripe dopo creazione ordine.';

grant all on public.checkout_sessions to service_role;
