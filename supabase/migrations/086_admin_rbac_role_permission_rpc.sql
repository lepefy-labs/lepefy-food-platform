-- MIGRATION 086: ATOMIC ROLE PERMISSION REPLACEMENT
-- Used only by service-role protected Platform Owner APIs.

create or replace function public.replace_admin_role_permissions(
  p_role_id uuid,
  p_permission_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.admin_roles
    where id = p_role_id and is_system = true
  ) then
    raise exception 'system_role_locked';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_permission_keys, array[]::text[])) as requested(key)
    left join public.admin_permissions permission on permission.key = requested.key and permission.active = true
    where permission.key is null or requested.key like 'platform.%'
  ) then
    raise exception 'invalid_permission';
  end if;

  delete from public.admin_role_permissions where role_id = p_role_id;

  insert into public.admin_role_permissions (role_id, permission_key)
  select p_role_id, key
  from unnest(coalesce(p_permission_keys, array[]::text[])) as key
  on conflict do nothing;

  update public.admin_roles set updated_at = now() where id = p_role_id;
end;
$$;

revoke all on function public.replace_admin_role_permissions(uuid, text[]) from public, anon, authenticated;
grant execute on function public.replace_admin_role_permissions(uuid, text[]) to service_role;
