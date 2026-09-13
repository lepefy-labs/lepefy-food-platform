begin;
do $$
declare
  campaign_a uuid;
  campaign_b uuid;
  campaign_other uuid;
  entry_a uuid;
begin
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.tester_feedback_entries'::regclass) then
    raise exception 'Feedback entries must force RLS';
  end if;
  if has_table_privilege('anon', 'public.tester_feedback_entries', 'select')
     or has_table_privilege('anon', 'public.tester_feedback_entries', 'insert')
     or has_table_privilege('authenticated', 'public.tester_feedback_campaigns', 'select') then
    raise exception 'Browser roles must not access feedback tables directly';
  end if;

  insert into public.tester_feedback_campaigns (tenant_id, name, headline)
  values ('11111111-1111-4111-8111-111111111111', 'Release A', 'Test A') returning id into campaign_a;
  insert into public.tester_feedback_campaigns (tenant_id, name, headline)
  values ('11111111-1111-4111-8111-111111111111', 'Release B', 'Test B') returning id into campaign_b;
  insert into public.tester_feedback_campaigns (tenant_id, name, headline)
  values ('22222222-2222-4222-8222-222222222222', 'Other tenant', 'Test') returning id into campaign_other;

  perform public.set_tester_feedback_campaign_active(campaign_a, true);
  perform public.set_tester_feedback_campaign_active(campaign_b, true);
  if (select count(*) from public.tester_feedback_campaigns where tenant_id = '11111111-1111-4111-8111-111111111111' and active) <> 1 then
    raise exception 'Only one campaign may be active per tenant';
  end if;
  if (select active from public.tester_feedback_campaigns where id = campaign_a)
     or (select closed_at from public.tester_feedback_campaigns where id = campaign_a) is null then
    raise exception 'Previous campaign must be safely closed';
  end if;

  insert into public.tester_feedback_entries (
    tenant_id, campaign_id, message, contact_allowed, contact_email, context
  ) values (
    '11111111-1111-4111-8111-111111111111', campaign_b, 'Useful feedback', false, null, '{"pathname":"/feedback"}'
  ) returning id into entry_a;

  begin
    insert into public.tester_feedback_entries (tenant_id, campaign_id, message)
    values ('22222222-2222-4222-8222-222222222222', campaign_b, 'Cross tenant');
    raise exception 'Cross-tenant campaign relationship accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.tester_feedback_entries (tenant_id, campaign_id, message, reaction)
    values ('11111111-1111-4111-8111-111111111111', campaign_b, 'Bad enum', 'angry');
    raise exception 'Invalid reaction accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.tester_feedback_entries (tenant_id, campaign_id, message, contact_allowed, contact_email)
    values ('11111111-1111-4111-8111-111111111111', campaign_b, 'No consent', false, 'private@example.com');
    raise exception 'Email without consent accepted';
  exception when check_violation then null;
  end;

  perform public.set_tester_feedback_campaign_active(campaign_b, false);
  if not exists (select 1 from public.tester_feedback_entries where id = entry_a) then
    raise exception 'Closing a campaign must preserve its feedback';
  end if;
end $$;
rollback;
