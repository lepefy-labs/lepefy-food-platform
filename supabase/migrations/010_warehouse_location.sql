-- Adds warehouse location + alternate name to products.
-- These fields are then denormalized into order_items at checkout time
-- so picking lists stay accurate even if the product is later renamed.

alter table products
  add column if not exists warehouse_location text default null,
  add column if not exists name_alt           text default null;

comment on column products.warehouse_location is
  'Shelf / aisle code used to sort picking lists (e.g. "A-03", "FRIGO-2")';

comment on column products.name_alt is
  'Secondary name or transliteration shown on picking lists to avoid mix-ups '
  '(e.g. original ethnic script, brand alias)';

-- Denormalize the same two fields into order_items so that
-- existing orders keep the correct location even after a product update.
alter table order_items
  add column if not exists warehouse_location text default null,
  add column if not exists name_alt           text default null;

comment on column order_items.warehouse_location is
  'Snapshot of products.warehouse_location at the time of order placement';

comment on column order_items.name_alt is
  'Snapshot of products.name_alt at the time of order placement';
