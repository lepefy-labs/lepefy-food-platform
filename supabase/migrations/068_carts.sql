-- ─── MIGRATION 068: CARRELLO CROSS-DEVICE (CLIENTI AUTENTICATI) ─────────────
-- Carrello persistito lato server, solo per clienti autenticati — permette
-- la continuità cross-device. Il carrello guest resta esclusivamente in
-- localStorage (cartStore.ts), invariato. Salviamo solo product_id+quantity,
-- MAI prezzo/nome: rihydratati dal DB ad ogni lettura, stesso principio già
-- applicato in /api/checkout.

create table if not exists public.carts (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  customer_id uuid        not null references public.customers(id) on delete cascade,
  items       jsonb       not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, customer_id)
);

comment on column public.carts.items is
  'Array [{product_id, quantity}] — mai prezzo/nome, sempre riletti dal DB.';

alter table public.carts enable row level security;

-- customers.id == auth.uid() confermato in verifyOtp.ts (upsert customers
-- con id = data.session.user.id) e getSessionCustomer.ts (.eq('id', user.id)) :
-- stesso principio già in vigore in tutto il repo, nessuna divergenza trovata.
create policy "customer reads own cart"
  on public.carts for select
  to authenticated
  using (customer_id = auth.uid());

create policy "customer inserts own cart"
  on public.carts for insert
  to authenticated
  with check (customer_id = auth.uid());

create policy "customer updates own cart"
  on public.carts for update
  to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- RLS non basta di per sé (regola permanente) — GRANT espliciti necessari
-- anche per il ruolo authenticated, oltre a service_role usato dalle Route
-- Handler (createServiceClient bypassa comunque RLS, ma il grant resta
-- coerente con il pattern già in uso su checkout_sessions).
grant select, insert, update on public.carts to authenticated;
grant all on public.carts to service_role;
