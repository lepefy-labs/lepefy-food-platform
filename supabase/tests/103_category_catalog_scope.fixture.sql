-- Minimal pre-migration categories from two tenants; independent of commerce data.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  slug text not null,
  position integer not null default 0,
  unique (tenant_id, slug)
);
insert into public.categories (tenant_id, name, slug) values
('11111111-1111-4111-8111-111111111111', 'Existing A', 'existing'),
('22222222-2222-4222-8222-222222222222', 'Existing B', 'existing');
