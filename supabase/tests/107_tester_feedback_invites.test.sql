begin;
do $$
declare
  campaign_a uuid;
  campaign_other uuid;
  invite_a uuid;
begin
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.tester_feedback_invites'::regclass) then raise exception 'Tester invites must force RLS'; end if;
  if has_table_privilege('anon', 'public.tester_feedback_invites', 'select')
     or has_table_privilege('authenticated', 'public.tester_feedback_invites', 'select')
     or has_table_privilege('authenticated', 'public.tester_feedback_invites', 'insert') then raise exception 'Browser roles must not access tester invites'; end if;
  if not has_table_privilege('service_role', 'public.tester_feedback_invites', 'select')
     or not has_table_privilege('service_role', 'public.tester_feedback_invites', 'insert') then raise exception 'Service role must manage tester invites'; end if;

  insert into public.tester_feedback_campaigns (tenant_id, name, headline, google_play_test_url)
  values ('11111111-1111-4111-8111-111111111111', 'Release A', 'Test A', 'https://play.google.com/store/apps/details?id=example') returning id into campaign_a;
  insert into public.tester_feedback_campaigns (tenant_id, name, headline)
  values ('22222222-2222-4222-8222-222222222222', 'Other', 'Test') returning id into campaign_other;
  insert into public.tester_feedback_invites (tenant_id, campaign_id, email)
  values ('11111111-1111-4111-8111-111111111111', campaign_a, 'tester@example.com') returning id into invite_a;

  begin
    insert into public.tester_feedback_invites (tenant_id, campaign_id, email) values ('11111111-1111-4111-8111-111111111111', campaign_a, 'tester@example.com');
    raise exception 'Duplicate campaign email accepted'; exception when unique_violation then null;
  end;
  begin
    insert into public.tester_feedback_invites (tenant_id, campaign_id, email) values ('22222222-2222-4222-8222-222222222222', campaign_a, 'cross@example.com');
    raise exception 'Cross-tenant campaign invite accepted'; exception when foreign_key_violation then null;
  end;
  begin
    insert into public.tester_feedback_entries (tenant_id, campaign_id, tester_invite_id, message) values ('22222222-2222-4222-8222-222222222222', campaign_other, invite_a, 'Cross tenant invite');
    raise exception 'Cross-tenant invite relationship accepted'; exception when foreign_key_violation then null;
  end;

  insert into public.tester_feedback_entries (tenant_id, campaign_id, tester_invite_id, message)
  values ('11111111-1111-4111-8111-111111111111', campaign_a, invite_a, 'Verified invite');
  update public.tester_feedback_invites set revoked_at = now(), delivery_status = 'revoked', invite_token_hash = null, session_token_hash = null where id = invite_a;
  if not exists (select 1 from public.tester_feedback_entries where tester_invite_id = invite_a) then raise exception 'Revocation must preserve historical feedback'; end if;

  begin
    insert into public.tester_feedback_campaigns (tenant_id, name, headline, google_play_test_url) values ('11111111-1111-4111-8111-111111111111', 'Bad URL', 'Test', 'http://play.google.com/test');
    raise exception 'Non-HTTPS Google Play URL accepted'; exception when check_violation then null;
  end;
end $$;
rollback;
