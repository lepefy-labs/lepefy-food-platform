-- Isolated CI Postgres only. No production data.
begin;
do $$
declare t text; a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); n integer;
begin
  foreach t in array array['platform_prospects','platform_prospect_runs','platform_prospect_cache','platform_prospect_gates'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.'||t)::regclass) then raise exception 'RLS absent: %',t; end if;
    if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'SELECT')
      or has_table_privilege('authenticated','public.'||t,'INSERT') then raise exception 'Browser access: %',t; end if;
    if not has_table_privilege('service_role','public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Service unavailable: %',t; end if;
  end loop;
  if has_function_privilege('authenticated','public.claim_platform_prospect_gate(text,uuid,integer)','EXECUTE') then raise exception 'Browser RPC access'; end if;
  if not public.claim_platform_prospect_gate('test',a,180) then raise exception 'First claim failed'; end if;
  if public.claim_platform_prospect_gate('test',b,180) then raise exception 'Concurrent claim allowed'; end if;
  perform public.release_platform_prospect_gate('test',b);
  if public.claim_platform_prospect_gate('test',b,180) then raise exception 'Wrong token released lease'; end if;
  perform public.release_platform_prospect_gate('test',a);
  if not public.claim_platform_prospect_gate('test',b,180) then raise exception 'Lease not released'; end if;
  insert into public.platform_prospects(business_name,siret,discovery_source,fit_score,status)
    values ('Fixture','12345678900001','test',80,'qualified');
  begin
    insert into public.platform_prospects(business_name,siret,discovery_source) values ('Duplicate','12345678900001','test');
    raise exception 'SIRET duplicate allowed';
  exception when unique_violation then null; end;
  update public.platform_prospects set do_not_contact=true, suppression_reason='Fixture opt-out' where siret='12345678900001';
  if not exists(select 1 from public.platform_prospects where siret='12345678900001' and suppressed_at is not null) then raise exception 'Suppression timestamp absent'; end if;
  select count(*) into n from public.platform_prospects where do_not_contact=false and fit_score >= 65 and status in ('discovered','enriched','qualified');
  if n <> 0 then raise exception 'Suppressed prospect selected'; end if;
  insert into public.platform_prospect_runs(kind,signature) values ('discovery','fixture');
  begin
    insert into public.platform_prospect_runs(kind,signature) values ('discovery','fixture');
    raise exception 'Duplicate active run allowed';
  exception when unique_violation then null; end;
end;
$$;
rollback;
