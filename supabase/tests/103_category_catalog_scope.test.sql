begin;
do $$
begin
  if (select count(*) from public.categories where catalog_scope = 'shop') <> 2 then
    raise exception 'Existing categories must all default to shop';
  end if;

  insert into public.categories (tenant_id, name, slug)
  values ('11111111-1111-4111-8111-111111111111', 'New default', 'new-default');
  if (select catalog_scope from public.categories where slug = 'new-default') <> 'shop' then
    raise exception 'New categories must default to shop';
  end if;

  update public.categories set catalog_scope = 'gadgets'
  where tenant_id = '11111111-1111-4111-8111-111111111111' and slug = 'existing';
  if (select catalog_scope from public.categories where tenant_id = '22222222-2222-4222-8222-222222222222') <> 'shop' then
    raise exception 'Another tenant category changed';
  end if;

  begin
    update public.categories set catalog_scope = 'invalid';
    raise exception 'Unsupported scope accepted';
  exception when check_violation then null;
  end;
  begin
    update public.categories set catalog_scope = null;
    raise exception 'Null scope accepted';
  exception when not_null_violation then null;
  end;
end $$;
rollback;
