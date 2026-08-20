-- Fixture minimale per eseguire 070_cart_versioning.test.sql su un PostgreSQL
-- vuoto, senza Supabase. Riproduce SOLO le colonne effettivamente toccate dalla
-- funzione apply_cart_mutations (products.tenant_id/active/stock e la tabella
-- carts di 068_carts.sql), non l'intero schema del progetto.
--
-- La tabella carts è creata QUI nella sua forma pre-070 (senza version e senza
-- applied_mutation_ids) e popolata con un carrello: è così che si verifica che
-- la migration sia realmente retrocompatibile con i dati esistenti.

\set ON_ERROR_STOP on

drop table if exists public.carts;
drop table if exists public.products;

create table public.products (
  id        uuid primary key,
  tenant_id uuid not null,
  stock     int  not null default 0,
  active    boolean not null default true
);

-- Forma esatta di 068_carts.sql, prima della migration 070.
create table public.carts (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null,
  customer_id uuid        not null,
  items       jsonb       not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, customer_id)
);

insert into public.products (id, tenant_id, stock, active) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, true),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',  7, true),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',  5, false),
  ('dddddddd-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',  8, true);

-- Carrello "storico", creato prima della migration 070.
insert into public.carts (tenant_id, customer_id, items) values (
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '[{"product_id": "dddddddd-0000-0000-0000-000000000004", "quantity": 3}]'::jsonb
);

-- service_role non esiste su un postgres locale: la migration fa GRANT su
-- questo ruolo, quindi lo si crea per poter eseguire il file così com'è.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end;
$$;
