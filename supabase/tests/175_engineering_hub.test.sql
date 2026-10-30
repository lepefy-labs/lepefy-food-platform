-- 175: Engineering Hub — seed (no assignment, no tenant role), idempotent runs, manifest check,
-- append-only guards, atomic activation, rollback, retention, privileges.
do $$
declare
  v_repo uuid;
  v_run public.engineering_index_runs;
  v_run2 public.engineering_index_runs;
  v_run3 public.engineering_index_runs;
  v_file uuid;
  v_sha1 text := repeat('a', 40);
  v_sha2 text := repeat('b', 40);
  v_commit1 text := repeat('1', 40);
  v_commit2 text := repeat('2', 40);
  v_commit3 text := repeat('3', 40);
  v_checksum text;
  v_status text;
  v_prev uuid;
  v_n integer;
begin
  -- Seed: role and permissions exist, only view/ai.use are mapped, and only to the IT role.
  if (select count(*) from public.admin_permissions where key like 'engineering.%') <> 4 then raise exception 'permissions missing'; end if;
  if not exists (select 1 from public.admin_roles where code = 'engineering_member' and scope = 'platform') then raise exception 'IT role missing'; end if;
  if (select count(*) from public.admin_role_permissions where permission_key like 'engineering.%') <> 2 then raise exception 'unexpected permission mapping'; end if;
  if exists (select 1 from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
        where rp.permission_key like 'engineering.%' and r.code <> 'engineering_member') then raise exception 'engineering permission leaked to another role'; end if;

  select id into v_repo from public.engineering_repositories where slug = 'lepefy-food-platform';
  if v_repo is null then raise exception 'repository not seeded'; end if;

  -- Idempotent start.
  v_run := public.engineering_start_run('lepefy-food-platform', 'main', v_commit1, 'incremental', v_commit1 || ':incremental', 'manual');
  v_run2 := public.engineering_start_run('lepefy-food-platform', 'main', v_commit1, 'incremental', v_commit1 || ':incremental', 'manual');
  if v_run.id <> v_run2.id then raise exception 'start is not idempotent'; end if;
  begin
    perform public.engineering_start_run('lepefy-food-platform', 'main', v_commit2, 'incremental', v_commit2 || ':incremental', 'manual');
    raise exception 'two running runs allowed';
  exception when others then
    if sqlerrm <> 'engineering_run_in_progress' then raise; end if;
  end;

  -- Blobs: missing detection.
  insert into public.engineering_blobs (repository_id, blob_sha, content, size_bytes) values (v_repo, v_sha1, 'export const a = 1;', 19);
  if public.engineering_missing_blobs(v_repo, array[v_sha1, v_sha2]) <> array[v_sha2] then raise exception 'missing blobs wrong'; end if;
  insert into public.engineering_blobs (repository_id, blob_sha, content, size_bytes) values (v_repo, v_sha2, 'select 1;', 9);

  insert into public.engineering_files (run_id, repository_id, path, kind, language, blob_sha, size_bytes, line_count)
    values (v_run.id, v_repo, 'src/a.ts', 'source', 'typescript', v_sha1, 19, 1) returning id into v_file;
  insert into public.engineering_symbols (run_id, file_id, name, kind, exported, start_line, end_line, content_hash)
    values (v_run.id, v_file, 'a', 'const', true, 1, 1, 'h');
  insert into public.engineering_chunks (run_id, file_id, kind, title, body, start_line, end_line)
    values (v_run.id, v_file, 'symbol', 'a', 'const a', 1, 1);
  if not exists (select 1 from public.engineering_chunks where search @@ to_tsquery('simple', 'a')) then raise exception 'chunk search not generated'; end if;

  -- Manifest mismatch fails the run and it is never staged or activatable.
  v_checksum := md5('src/a.ts ' || v_sha1);
  v_status := public.engineering_finalize_run(v_run.id, jsonb_build_object('files', 2, 'symbols', 1, 'relations', 0, 'documents', 0, 'chunks', 1, 'excluded', 0, 'checksum', v_checksum));
  if v_status <> 'failed' then raise exception 'mismatch not detected'; end if;
  begin
    perform public.engineering_activate_run(v_run.id, 'test');
    raise exception 'failed run activated';
  exception when others then
    if sqlerrm <> 'engineering_run_not_staged' then raise; end if;
  end;
  -- A closed run rejects writes.
  begin
    insert into public.engineering_files (run_id, repository_id, path, kind, language, blob_sha, size_bytes, line_count)
      values (v_run.id, v_repo, 'src/b.ts', 'source', 'typescript', v_sha2, 9, 1);
    raise exception 'closed run accepted a write';
  exception when others then
    if sqlerrm <> 'engineering_run_closed' then raise; end if;
  end;

  -- Retry of the failed run: reopened, rows cleared, then a correct manifest stages it.
  v_run := public.engineering_start_run('lepefy-food-platform', 'main', v_commit1, 'incremental', v_commit1 || ':incremental', 'manual');
  if v_run.status <> 'running' then raise exception 'failed run not reopened'; end if;
  if (select count(*) from public.engineering_files where run_id = v_run.id) <> 0 then raise exception 'rows not cleared on retry'; end if;
  insert into public.engineering_files (run_id, repository_id, path, kind, language, blob_sha, size_bytes, line_count)
    values (v_run.id, v_repo, 'src/a.ts', 'source', 'typescript', v_sha1, 19, 1);
  insert into public.engineering_excluded_files (run_id, path, reason_code) values (v_run.id, '.env.local', 'denied_path');
  v_status := public.engineering_finalize_run(v_run.id, jsonb_build_object('files', 1, 'symbols', 0, 'relations', 0, 'documents', 0, 'chunks', 0, 'excluded', 1, 'checksum', v_checksum));
  if v_status <> 'staged' then raise exception 'valid manifest not staged'; end if;
  -- Staged, not active: the Hub must still read nothing.
  if (select active_run_id from public.engineering_repositories where id = v_repo) is not null then raise exception 'staged run visible as active'; end if;

  v_prev := public.engineering_activate_run(v_run.id, 'test');
  if v_prev is not null then raise exception 'first activation has a previous run'; end if;
  if (select active_run_id from public.engineering_repositories where id = v_repo) <> v_run.id then raise exception 'activation did not switch'; end if;

  -- Second run: staging does not disturb the active one; activation supersedes it.
  v_run2 := public.engineering_start_run('lepefy-food-platform', 'main', v_commit2, 'full', v_commit2 || ':full', 'push');
  insert into public.engineering_files (run_id, repository_id, path, kind, language, blob_sha, size_bytes, line_count)
    values (v_run2.id, v_repo, 'src/a.ts', 'source', 'typescript', v_sha1, 19, 1);
  v_status := public.engineering_finalize_run(v_run2.id, jsonb_build_object('files', 1, 'symbols', 0, 'relations', 0, 'documents', 0, 'chunks', 0, 'excluded', 0, 'checksum', v_checksum));
  if v_status <> 'staged' then raise exception 'second run not staged'; end if;
  if (select active_run_id from public.engineering_repositories where id = v_repo) <> v_run.id then raise exception 'staging changed the active run'; end if;
  perform public.engineering_activate_run(v_run2.id, 'test');
  if (select status from public.engineering_index_runs where id = v_run.id) <> 'superseded' then raise exception 'old run not superseded'; end if;

  -- A failed run never replaces the active one.
  v_run3 := public.engineering_start_run('lepefy-food-platform', 'main', v_commit3, 'incremental', v_commit3 || ':incremental', 'schedule');
  perform public.engineering_fail_run(v_run3.id, 'parse_error');
  if (select active_run_id from public.engineering_repositories where id = v_repo) <> v_run2.id then raise exception 'failed run changed the active one'; end if;
  if (select error_code from public.engineering_index_runs where id = v_run3.id) <> 'parse_error' then raise exception 'error code lost'; end if;

  -- Non-default branches can be staged but not activated.
  v_run3 := public.engineering_start_run('lepefy-food-platform', 'feature-x', v_commit3, 'incremental', v_commit3 || ':pr', 'pull_request');
  insert into public.engineering_files (run_id, repository_id, path, kind, language, blob_sha, size_bytes, line_count)
    values (v_run3.id, v_repo, 'src/a.ts', 'source', 'typescript', v_sha1, 19, 1);
  perform public.engineering_finalize_run(v_run3.id, jsonb_build_object('files', 1, 'symbols', 0, 'relations', 0, 'documents', 0, 'chunks', 0, 'excluded', 0, 'checksum', v_checksum));
  begin
    perform public.engineering_activate_run(v_run3.id, 'test');
    raise exception 'feature branch activated';
  exception when others then
    if sqlerrm <> 'engineering_branch_not_activatable' then raise; end if;
  end;

  -- Rollback returns to the previous snapshot and is logged.
  if public.engineering_rollback('lepefy-food-platform', 'test') <> v_run.id then raise exception 'rollback target wrong'; end if;
  if (select active_run_id from public.engineering_repositories where id = v_repo) <> v_run.id then raise exception 'rollback pointer wrong'; end if;
  if (select count(*) from public.engineering_activation_log where repository_id = v_repo) <> 3 then raise exception 'activation log incomplete'; end if;

  -- Retention keeps the active run; referenced blobs stay, orphan blobs go.
  update public.engineering_blobs set created_at = now() - interval '3 days';
  perform public.engineering_purge(v_repo, 1);
  select count(*) into v_n from public.engineering_index_runs where status = 'active';
  if v_n <> 1 then raise exception 'purge removed the active run'; end if;
  if (select count(*) from public.engineering_blobs where blob_sha = v_sha1) <> 1 then raise exception 'purge removed a referenced blob'; end if;
  if (select count(*) from public.engineering_blobs where blob_sha = v_sha2) <> 0 then raise exception 'purge kept an orphan blob'; end if;

  -- Append-only tables.
  insert into public.engineering_document_reviews (repository_id, doc_key, status, verified_sha) values (v_repo, 'help-center', 'verified', v_commit1);
  begin
    update public.engineering_document_reviews set status = 'to_review';
    raise exception 'review rewritten';
  exception when others then
    if sqlerrm <> 'engineering_append_only' then raise; end if;
  end;
  begin
    delete from public.engineering_activation_log;
    raise exception 'log deleted';
  exception when others then
    if sqlerrm <> 'engineering_append_only' then raise; end if;
  end;
end $$;

-- Privileges: nothing for anon or authenticated (tables and RPC); the service role cannot delete or rewrite directly.
set role anon;
do $$ begin
  perform 1 from public.engineering_files;
  raise exception 'anon can read files';
exception when insufficient_privilege then null;
end $$;
reset role;
set role authenticated;
do $$ begin
  perform 1 from public.engineering_blobs;
  raise exception 'authenticated can read blobs';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.engineering_activate_run(gen_random_uuid(), 'x');
  raise exception 'authenticated can activate a run';
exception when insufficient_privilege then null;
end $$;
reset role;
set role service_role;
do $$ begin
  delete from public.engineering_files;
  raise exception 'service_role can delete snapshot rows directly';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.engineering_document_reviews set note = 'x';
  raise exception 'service_role can update reviews';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform 1 from public.engineering_repositories;
  perform public.engineering_missing_blobs((select id from public.engineering_repositories limit 1), array[repeat('c', 40)]);
end $$;
reset role;
