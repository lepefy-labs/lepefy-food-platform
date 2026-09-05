-- Existing categories remain in the normal catalogue. No tenant data is seeded.
begin;
alter table public.categories
  add column catalog_scope text not null default 'shop'
  constraint categories_catalog_scope_check check (catalog_scope in ('shop', 'gadgets'));
comment on column public.categories.catalog_scope is
  'Storefront merchandising scope: shop (Catalogue) or gadgets (Goodies). Products share the existing commerce engine.';
commit;

-- Rollback only after reverting the application that reads this column:
-- alter table public.categories drop column catalog_scope;
