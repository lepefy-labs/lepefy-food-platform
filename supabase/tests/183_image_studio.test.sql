-- 183 Studio images: privileges, style versions, idempotent creation, quotas,
-- job claim (compare-and-set, expired locks), state machine, usages, cleanup.
do $$
declare
  ta constant uuid := '10000000-0000-4000-8000-000000000001';
  tb constant uuid := '10000000-0000-4000-8000-000000000002';
  admin_a constant uuid := '20000000-0000-4000-8000-000000000001';
  v_style uuid; v_style_b uuid; v_version integer;
  v_asset uuid; v_rev uuid; v_job uuid; v_created boolean;
  v_asset2 uuid; v_rev2 uuid; v_job2 uuid;
  v_token uuid; v_token2 uuid; v_count integer; v_text text;
  v_usage uuid; v_paths text[]; v_changed boolean;
  v_failed boolean;
begin
  -- Catalogue and seeds.
  if not exists (select 1 from public.admin_permissions where key = 'studio.use') then raise exception 'capability missing'; end if;
  if (select count(*) from public.admin_role_permissions where permission_key = 'studio.use') <> 2 then raise exception 'capability not granted to owner + tenant admin'; end if;
  if (select count(*) from public.audit_event_types where module = 'studio') <> 6 then raise exception 'audit types missing'; end if;
  if (select public from storage.buckets where id = 'studio-private') is distinct from false then raise exception 'bucket must be private'; end if;
  if (select count(*) from public.ai_routing_policy_models pm join public.ai_routing_policies p on p.id = pm.policy_id where p.consumer = 'studio') <> 4 then
    raise exception 'studio routing not seeded';
  end if;
  if exists (select 1 from public.ai_models where key like 'gemini-%-image' and (capabilities->>'chat')::boolean) then raise exception 'image model exposed to chat'; end if;

  -- Style: versions, optimistic check, immutability.
  select out_id, out_version into v_style, v_version from public.studio_publish_style(ta, '{"background":"warm"}'::jsonb, 'v1', admin_a, 0);
  if v_version <> 1 then raise exception 'first style must be v1'; end if;
  begin
    perform public.studio_publish_style(ta, '{"background":"x"}'::jsonb, null, admin_a, 0);
    raise exception 'stale style publish accepted';
  exception when others then if sqlerrm <> 'studio_style_changed' then raise; end if; end;
  begin
    update public.studio_style_versions set instructions = '{"background":"hack"}' where id = v_style;
    raise exception 'style edited in place';
  exception when others then if sqlerrm <> 'studio_style_immutable' then raise; end if; end;
  select out_id into v_style_b from public.studio_publish_style(tb, '{"background":"cool"}'::jsonb, null, null, null);

  -- Creation: path must be inside the tenant; prompt needs text; replay is idempotent.
  begin
    perform public.studio_create_asset(ta, 'photo', 'Ndolé', null, 'tenants/' || tb || '/assets/k1/source.jpg', 'image/jpeg', 800, 600, 1000, v_style, admin_a, 'key-photo-0001');
    raise exception 'foreign path accepted';
  exception when others then if sqlerrm <> 'studio_invalid_request' then raise; end if; end;
  begin
    perform public.studio_create_asset(ta, 'prompt', 'Vide', '  ', null, null, null, null, null, v_style, admin_a, 'key-prompt-empty');
    raise exception 'empty prompt accepted';
  exception when others then if sqlerrm <> 'studio_invalid_request' then raise; end if; end;
  begin
    perform public.studio_create_asset(ta, 'prompt', 'Style B', 'des bananes', null, null, null, null, null, v_style_b, admin_a, 'key-other-style');
    raise exception 'style of another tenant accepted';
  exception when others then if sqlerrm <> 'studio_style_changed' then raise; end if; end;

  select out_asset_id, out_revision_id, out_job_id, out_created into v_asset, v_rev, v_job, v_created
  from public.studio_create_asset(ta, 'photo', 'Ndolé', 'enlever le piment', 'tenants/' || ta || '/assets/k1/source.jpg', 'image/jpeg', 800, 600, 1000, v_style, admin_a, 'key-photo-0001');
  if not v_created then raise exception 'first create must report created'; end if;
  select out_asset_id, out_created into v_asset2, v_created
  from public.studio_create_asset(ta, 'photo', 'Ndolé', 'enlever le piment', 'tenants/' || ta || '/assets/k1/source.jpg', 'image/jpeg', 800, 600, 1000, v_style, admin_a, 'key-photo-0001');
  if v_created or v_asset2 <> v_asset then raise exception 'replay created a second asset'; end if;
  if (select ambiance_only from public.studio_assets where id = v_asset) then raise exception 'photo flagged ambiance'; end if;

  -- Quota: 2 per month, failed versions do not count.
  insert into public.studio_tenant_settings (tenant_id, monthly_revisions, monthly_budget_usd) values (ta, 2, 5);
  select out_asset_id, out_revision_id, out_job_id into v_asset2, v_rev2, v_job2
  from public.studio_create_asset(ta, 'prompt', 'Bananes', 'des bananes vertes', null, null, null, null, null, v_style, admin_a, 'key-prompt-0001');
  if not (select ambiance_only from public.studio_assets where id = v_asset2) then raise exception 'prompt image must be ambiance only'; end if;
  begin
    perform public.studio_create_asset(ta, 'prompt', 'Trop', 'encore une', null, null, null, null, null, v_style, admin_a, 'key-prompt-0002');
    raise exception 'quota not enforced';
  exception when others then if sqlerrm <> 'studio_quota_exceeded' then raise; end if; end;
  -- Tenant B is not affected by tenant A's quota.
  perform public.studio_create_asset(tb, 'prompt', 'B', 'image b', null, null, null, null, null, v_style_b, admin_a, 'key-b-000001');

  -- Claim: one worker gets the job, a second claim gets nothing.
  select out_claim_token into v_token from public.studio_claim_jobs(1, v_job, 120);
  if v_token is null then raise exception 'job not claimed'; end if;
  select count(*) into v_count from public.studio_claim_jobs(1, v_job, 120);
  if v_count <> 0 then raise exception 'job claimed twice'; end if;
  if public.studio_finish_revision(v_job, gen_random_uuid(), true, '{}'::jsonb, null, false) <> 'stale' then raise exception 'wrong token accepted'; end if;
  -- Retryable failure goes back to the queue with a delay.
  if public.studio_finish_revision(v_job, v_token, false, '{"cost_usd":"0.01"}'::jsonb, 'provider_timeout', true) <> 'retry' then raise exception 'retry expected'; end if;
  if (select status from public.studio_jobs where id = v_job) <> 'queued' then raise exception 'job not requeued'; end if;
  select count(*) into v_count from public.studio_claim_jobs(1, v_job, 120);
  if v_count <> 0 then raise exception 'backoff ignored'; end if;
  update public.studio_jobs set next_attempt_at = now() - interval '1 second' where id = v_job;
  select out_claim_token into v_token from public.studio_claim_jobs(1, v_job, 120);
  -- Expired lock (function killed): the job can be claimed again with a new token.
  update public.studio_jobs set locked_until = now() - interval '1 second' where id = v_job;
  select out_claim_token into v_token2 from public.studio_claim_jobs(1, v_job, 120);
  if v_token2 is null or v_token2 = v_token then raise exception 'expired lock not reclaimed'; end if;
  if public.studio_finish_revision(v_job, v_token, true, '{}'::jsonb, null, false) <> 'stale' then raise exception 'old worker could finish'; end if;
  if public.studio_finish_revision(v_job, v_token2, true,
       ('{"provider":"gemini","model":"m","storage_path":"tenants/x/assets/k1/rev-1.webp","width":1024,"height":1024,"bytes":5000,"sha256":"' || repeat('a', 64) || '","cost_usd":"0.039","latency_ms":9000}')::jsonb,
       null, false) <> 'succeeded' then raise exception 'success not recorded'; end if;
  if (select status from public.studio_assets where id = v_asset) <> 'review' then raise exception 'asset not in review'; end if;
  if (select cost_usd from public.studio_revisions where id = v_rev) <> 0.049 then raise exception 'cost not accumulated'; end if;

  -- Usage requires approval.
  begin
    perform public.studio_begin_usage(ta, v_asset, 'product', 'p1', 'Ndolé', null, admin_a, 'key-usage-0001');
    raise exception 'unapproved image published';
  exception when others then if sqlerrm <> 'studio_not_approved' then raise; end if; end;
  -- Tenant isolation.
  begin
    perform public.studio_decide_asset(tb, v_asset, 'approve', v_rev);
    raise exception 'other tenant approved';
  exception when others then if sqlerrm <> 'studio_not_found' then raise; end if; end;
  if public.studio_decide_asset(ta, v_asset, 'approve', v_rev) <> 'approved' then raise exception 'approve failed'; end if;

  select out_usage_id, out_created into v_usage, v_created from public.studio_begin_usage(ta, v_asset, 'product', 'p1', 'Ndolé', '{"x":0}'::jsonb, admin_a, 'key-usage-0001');
  select out_created into v_created from public.studio_begin_usage(ta, v_asset, 'product', 'p1', 'Ndolé', '{"x":0}'::jsonb, admin_a, 'key-usage-0001');
  if v_created then raise exception 'usage replay created a row'; end if;
  if public.studio_finish_usage(ta, v_usage, true, 'https://x/y.webp', array['a/b.webp']) <> 'active' then raise exception 'usage not active'; end if;
  begin
    perform public.studio_decide_asset(ta, v_asset, 'discard', null);
    raise exception 'used image discarded';
  exception when others then if sqlerrm <> 'studio_in_use' then raise; end if; end;

  -- Correction from an approved image (quota is full: refused), then raise the quota.
  begin
    perform public.studio_request_correction(ta, v_asset, v_rev, 'moins de sauce', v_style, admin_a, 'key-corr-0001');
    raise exception 'correction over quota';
  exception when others then if sqlerrm <> 'studio_quota_exceeded' then raise; end if; end;
  update public.studio_tenant_settings set monthly_revisions = 10 where tenant_id = ta;
  perform public.studio_request_correction(ta, v_asset, v_rev, 'moins de sauce', v_style, admin_a, 'key-corr-0001');
  if (select status from public.studio_assets where id = v_asset) <> 'processing' then raise exception 'correction must reopen review'; end if;
  begin
    perform public.studio_request_correction(ta, v_asset, v_rev, 'encore', v_style, admin_a, 'key-corr-0002');
    raise exception 'two pending corrections';
  exception when others then if sqlerrm not in ('studio_busy', 'studio_invalid_transition') then raise; end if; end;
  -- The failed correction keeps the previous proposal to review.
  select out_job_id, out_claim_token into v_job2, v_token from public.studio_claim_jobs(1, (select j.id from public.studio_jobs j join public.studio_revisions r on r.id = j.revision_id where r.request_key = 'key-corr-0001'), 120);
  perform public.studio_finish_revision(v_job2, v_token, false, '{}'::jsonb, 'safety_blocked', false);
  if (select status from public.studio_assets where id = v_asset) <> 'review' then raise exception 'failed correction lost the proposal'; end if;

  -- Ending a usage returns the paths once.
  select out_storage_paths, out_changed into v_paths, v_changed from public.studio_end_usage(ta, v_usage, 'removed', admin_a);
  if not v_changed or v_paths <> array['a/b.webp'] then raise exception 'end usage'; end if;
  select out_changed into v_changed from public.studio_end_usage(ta, v_usage, 'removed', admin_a);
  if v_changed then raise exception 'end usage not idempotent'; end if;

  -- First version failure without retry: asset failed, then « Réessayer ».
  select out_claim_token into v_token from public.studio_claim_jobs(1, v_job2, 120);
  select out_claim_token into v_token from public.studio_claim_jobs(1, (select id from public.studio_jobs where revision_id = v_rev2), 120);
  perform public.studio_finish_revision((select id from public.studio_jobs where revision_id = v_rev2), v_token, false, '{}'::jsonb, 'provider_error', false);
  if (select status from public.studio_assets where id = v_asset2) <> 'failed' then raise exception 'asset not failed'; end if;
  perform public.studio_retry_revision(ta, v_rev2);
  if (select status from public.studio_jobs where revision_id = v_rev2) <> 'queued' or (select status from public.studio_assets where id = v_asset2) <> 'processing' then
    raise exception 'retry not queued';
  end if;
  -- Exhausted job after a crash.
  update public.studio_jobs set status = 'running', attempts = max_attempts, locked_until = now() - interval '1 second' where revision_id = v_rev2;
  if public.studio_fail_exhausted_jobs() <> 1 then raise exception 'exhausted job not failed'; end if;
  if (select status from public.studio_revisions where id = v_rev2) <> 'failed' then raise exception 'revision not failed'; end if;

  -- Cleanup: discarded and old, never used.
  perform public.studio_decide_asset(ta, v_asset2, 'discard', null);
  update public.studio_assets set updated_at = now() - interval '8 days' where id = v_asset2;
  if not exists (select 1 from public.studio_cleanup_candidates(50) where out_asset_id = v_asset2) then raise exception 'cleanup candidate missing'; end if;
  if exists (select 1 from public.studio_cleanup_candidates(50) where out_asset_id = v_asset) then raise exception 'used asset proposed for cleanup'; end if;
  if not public.studio_mark_purged(ta, v_asset2) then raise exception 'purge not marked'; end if;
end $$;

-- Privileges: anon/authenticated read nothing, the service role only reads and runs RPCs.
set role anon;
do $$ begin
  begin perform 1 from public.studio_assets; raise exception 'anon read studio_assets';
  exception when insufficient_privilege then null; end;
  begin perform public.studio_claim_jobs(1); raise exception 'anon ran a studio RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
do $$ begin
  perform 1 from public.studio_assets;
  begin
    insert into public.studio_tenant_settings (tenant_id) values ('10000000-0000-4000-8000-000000000002');
    raise exception 'service role wrote a studio table directly';
  exception when insufficient_privilege then null; end;
  perform * from public.studio_usage_summary('10000000-0000-4000-8000-000000000001');
end $$;
reset role;
