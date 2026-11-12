-- 184: platform settings of the Studio (run after the 183 fixture, 183 and 184).
do $$
declare
  ta constant uuid := '10000000-0000-4000-8000-000000000001';
  v_limit integer;
begin
  select out_monthly_revisions into v_limit from public.studio_set_tenant_settings(ta, 120, 35.555, 45);
  if v_limit <> 120 then raise exception 'settings not saved'; end if;
  if (select monthly_budget_usd from public.studio_tenant_settings where tenant_id = ta) <> 35.56 then raise exception 'budget not rounded'; end if;
  -- Second call updates the same row.
  perform public.studio_set_tenant_settings(ta, 10, 5, 30);
  if (select count(*) from public.studio_tenant_settings where tenant_id = ta) <> 1 then raise exception 'duplicate settings row'; end if;
  if (select out_limit from public.studio_usage_summary(ta)) <> 10 then raise exception 'summary ignores settings'; end if;
  begin
    perform public.studio_set_tenant_settings(ta, -1, 5, 30);
    raise exception 'negative quota accepted';
  exception when others then if sqlerrm <> 'studio_invalid_request' then raise; end if; end;
  begin
    perform public.studio_set_tenant_settings(ta, 10, 5, 3);
    raise exception 'short retention accepted';
  exception when others then if sqlerrm <> 'studio_invalid_request' then raise; end if; end;
  begin
    perform public.studio_set_tenant_settings('99999999-9999-4999-8999-999999999999', 10, 5, 30);
    raise exception 'unknown tenant accepted';
  exception when others then if sqlerrm <> 'tenant_not_found' then raise; end if; end;
  if not exists (select 1 from public.audit_event_types where key = 'studio.settings.updated') then raise exception 'audit type missing'; end if;
end $$;

set role anon;
do $$ begin
  begin perform public.studio_set_tenant_settings('10000000-0000-4000-8000-000000000001', 1, 1, 30); raise exception 'anon ran 184';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
