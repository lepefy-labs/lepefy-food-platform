alter table order_items
  add column if not exists storage_type text
    check (storage_type in ('dry', 'fresh', 'frozen'));

comment on column order_items.storage_type is
  'Tipo conservazione al momento dell''ordine. '
  'Copiato da products.storage_type per evitare join costose.';
