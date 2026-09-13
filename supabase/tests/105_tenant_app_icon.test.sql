begin;
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tenants'
      and column_name = 'app_icon_url' and is_nullable = 'YES' and data_type = 'text'
  ) then raise exception 'app_icon_url must be a nullable text column'; end if;

  if (select app_icon_url from public.tenants where id = '11111111-1111-4111-8111-111111111111') is not null
    then raise exception 'Existing tenants must not be backfilled'; end if;
  if (select logo_url from public.tenants where id = '11111111-1111-4111-8111-111111111111') <> 'https://cdn.example.com/logo.png'
    then raise exception 'Existing logo_url was modified'; end if;

  if not has_column_privilege('anon', 'public.tenants', 'app_icon_url', 'select')
     or not has_column_privilege('authenticated', 'public.tenants', 'app_icon_url', 'select')
    then raise exception 'Public branding roles need column-level app_icon_url SELECT'; end if;
  if has_table_privilege('anon', 'public.tenants', 'select')
     or has_table_privilege('authenticated', 'public.tenants', 'select')
    then raise exception 'Table-level SELECT must remain revoked'; end if;
  if has_column_privilege('anon', 'public.tenants', 'packlink_api_key', 'select')
     or has_column_privilege('authenticated', 'public.tenants', 'packlink_api_key', 'select')
    then raise exception 'Private tenant columns must remain unreadable'; end if;
end $$;
rollback;
