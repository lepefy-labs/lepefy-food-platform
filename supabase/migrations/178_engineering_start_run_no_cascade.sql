-- Engineering Hub: a retried commit no longer deletes the failed run synchronously.
--
-- Additive and re-runnable. NOT applied automatically: the Platform Owner runs it.
--
-- Before: `engineering_start_run` met a `failed` run with the same run_key (`<sha>:<mode>`) and
-- deleted its files/modules/excluded rows, cascading to every symbol, relation, document and
-- chunk in one statement. On a ~2,300-file snapshot that exceeds the ~8 s statement timeout,
-- so every retry of a failed commit answered 500 `database_error` until the run aged out.
--
-- Now: the failed run keeps its rows, its key is retired with a cheap UPDATE
-- (`<key>#failed-<id>`) and a fresh run is inserted under the original key. The retired run is
-- removed later by `engineering_purge` (failed runs older than 7 days), off the request path.

begin;

create or replace function public.engineering_start_run(
  p_repo text, p_branch text, p_sha text, p_mode text, p_run_key text, p_trigger text default 'manual'
) returns public.engineering_index_runs
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_repo public.engineering_repositories; v_run public.engineering_index_runs;
begin
  select * into v_repo from public.engineering_repositories where slug = p_repo for update;
  if not found then raise exception 'engineering_repository_unknown'; end if;

  -- A run abandoned for more than 30 minutes cannot block the next one.
  update public.engineering_index_runs
     set status = 'failed', error_code = 'timeout', finished_at = now()
   where repository_id = v_repo.id and status = 'running' and started_at < now() - interval '30 minutes';

  select * into v_run from public.engineering_index_runs where repository_id = v_repo.id and run_key = p_run_key;
  if found then
    if v_run.status <> 'failed' then
      return v_run;
    end if;
    if exists (select 1 from public.engineering_index_runs where repository_id = v_repo.id and status = 'running') then
      raise exception 'engineering_run_in_progress';
    end if;
    -- Retire the failed attempt instead of deleting its rows (see header).
    update public.engineering_index_runs
       set run_key = left(p_run_key, 70) || '#failed-' || id::text
     where id = v_run.id;
  elsif exists (select 1 from public.engineering_index_runs where repository_id = v_repo.id and status = 'running') then
    raise exception 'engineering_run_in_progress';
  end if;

  insert into public.engineering_index_runs (repository_id, branch, commit_sha, mode, run_key, trigger)
  values (v_repo.id, p_branch, p_sha, p_mode, p_run_key, p_trigger)
  returning * into v_run;
  return v_run;
end $$;

-- `create or replace` keeps the grants of 175; restated so the migration is self-contained.
revoke all on function public.engineering_start_run(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.engineering_start_run(text, text, text, text, text, text) to service_role;

commit;

-- ─── Rollback (manual): re-run the `engineering_start_run` definition of migration 175. ───
