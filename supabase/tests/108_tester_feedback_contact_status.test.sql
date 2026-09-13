begin;
do $$
declare
  campaign_id uuid;
  invite_id uuid;
  current_status text;
  current_phone text;
begin
  insert into public.tester_feedback_campaigns (tenant_id, name, headline)
  values ('11111111-1111-4111-8111-111111111111', 'Contact status test', 'Test')
  returning id into campaign_id;

  insert into public.tester_feedback_invites (tenant_id, campaign_id, email)
  values ('11111111-1111-4111-8111-111111111111', campaign_id, 'contact-status@example.com')
  returning id into invite_id;

  select installation_status, phone into current_status, current_phone
  from public.tester_feedback_invites where id = invite_id;

  if current_status <> 'unknown' then
    raise exception 'Default installation status must be unknown';
  end if;
  if current_phone is not null then
    raise exception 'Phone must default to null';
  end if;

  update public.tester_feedback_invites
  set phone = '+33 6 12 34 56 78', installation_status = 'installed'
  where id = invite_id;

  if not exists (
    select 1 from public.tester_feedback_invites
    where id = invite_id
      and phone = '+33 6 12 34 56 78'
      and installation_status = 'installed'
  ) then
    raise exception 'Valid tester contact metadata was not stored';
  end if;

  update public.tester_feedback_invites set installation_status = 'problem' where id = invite_id;

  begin
    update public.tester_feedback_invites set installation_status = 'invalid' where id = invite_id;
    raise exception 'Invalid installation status accepted';
  exception when check_violation then null;
  end;

  begin
    update public.tester_feedback_invites set phone = '  +33 6 12 34 56 78  ' where id = invite_id;
    raise exception 'Untrimmed phone accepted';
  exception when check_violation then null;
  end;

  begin
    update public.tester_feedback_invites set phone = '123' where id = invite_id;
    raise exception 'Too-short phone accepted';
  exception when check_violation then null;
  end;
end $$;
rollback;
