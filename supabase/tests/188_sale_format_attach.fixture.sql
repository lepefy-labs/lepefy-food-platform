-- Runs after the 187 chain (153 fixture … 187 migration): adds what 188 reads
-- (165 `add_on_position`) and the products to attach.
alter table public.products add column if not exists add_on_position integer;

insert into public.products (id, tenant_id, category_id, name, slug, price, compare_at_price, stock, storage_type,
                             weight_grams, min_order_quantity, order_quantity_step, featured, add_on_position) values
  ('a0000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', null,
   'Ndole carton de 10', 'ndole-carton-10', 25.00, 30.00, 40, 'frozen', 5000, 2, 2, true, 3),
  ('a0000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', null,
   'Ndole lot vide', 'ndole-lot-vide', 9.50, null, 0, 'dry', 1500, 1, 1, false, null);
