begin;
set local role service_role;
insert into public.categories (tenant_id, name, slug, catalog_scope)
values ('11111111-1111-4111-8111-111111111111', 'Goodies', 'goodies', 'gadgets');
update public.categories set name = 'Goodies Chloe Food'
where tenant_id = '11111111-1111-4111-8111-111111111111' and slug = 'goodies';
do $$
begin
  if (select name from public.categories where slug = 'goodies') <> 'Goodies Chloe Food' then
    raise exception 'Server category create/update did not succeed';
  end if;
  if (select name from public.categories where tenant_id = '22222222-2222-4222-8222-222222222222') <> 'Existing B' then
    raise exception 'Tenant-filtered write changed another tenant';
  end if;
end $$;
reset role;
do $$
declare
  customer_role text;
begin
  foreach customer_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(customer_role, 'public.categories', 'INSERT')
       or has_table_privilege(customer_role, 'public.categories', 'UPDATE')
       or has_table_privilege(customer_role, 'public.categories', 'DELETE') then
      raise exception 'Customer write access widened: %', customer_role;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.categories', 'DELETE') then
    raise exception 'Migration granted unrelated DELETE access';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.categories'::regclass) then
    raise exception 'Migration disabled RLS';
  end if;
  if (select count(*) from public.categories) <> 3 then
    raise exception 'Migration changed or seeded category data';
  end if;
end $$;
rollback;
