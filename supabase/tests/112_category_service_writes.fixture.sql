-- Isolated CI database only; reproduce readable but non-writable categories.
drop table if exists public.categories cascade;
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  slug text not null,
  catalog_scope text not null default 'shop'
    check (catalog_scope in ('shop', 'gadgets')),
  unique (tenant_id, slug)
);
alter table public.categories enable row level security;
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
revoke all on table public.categories from public, anon, authenticated, service_role;
grant select on table public.categories to anon, authenticated, service_role;
create policy category_read on public.categories for select using (true);
insert into public.categories (tenant_id, name, slug) values
('11111111-1111-4111-8111-111111111111', 'Existing A', 'existing'),
('22222222-2222-4222-8222-222222222222', 'Existing B', 'existing');
do $$
begin
  if has_table_privilege('service_role', 'public.categories', 'INSERT')
     or has_table_privilege('service_role', 'public.categories', 'UPDATE') then
    raise exception 'Fixture must reproduce missing server write grants';
  end if;
end $$;
