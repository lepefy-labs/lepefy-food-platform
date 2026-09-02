create role anon;
create role authenticated;
create role service_role;
create table public.tenants(id uuid primary key);
create table public.customers(id uuid primary key);
create table public.ai_usage_log(id uuid primary key);
insert into public.tenants values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
