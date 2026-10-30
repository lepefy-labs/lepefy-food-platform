-- MIGRATION 175: LEPEFY ENGINEERING HUB, index schema (docs/engineering/ARCHITECTURE.md)
--
-- Additive and re-runnable. Internal technical index of the Git repository
-- (files, symbols, relations, documents, search chunks), one immutable
-- snapshot per index run, atomic activation, retention and rollback.
--
-- NOT done here (on purpose):
--   * NO tenant access of any kind: RLS forced without policies, every grant is
--     explicit and goes to service_role only (like migrations 163 and 174).
--   * NO membership is assigned to the new `engineering_member` role and the
--     platform layout is not relaxed: the Hub is Platform Owner only until a
--     separately approved change.
--   * NO AI route, no API client, no metrics table (migration 176).
--   * NO payment, order, checkout or tenant table is touched.

begin;

create extension if not exists pg_trgm;

-- ─── 1. Capabilities and platform role (seed only, no assignment) ────────────
insert into public.admin_permissions (key, module, label, description, risk_level, position) values
  ('engineering.view',   'Plateforme · Engineering', 'Consulter l''Engineering Hub', 'Lire l''index technique, les modules et le code indexé.', 'sensitive', 300),
  ('engineering.ai.use', 'Plateforme · Engineering', 'Interroger l''Engineering AI', 'Poser des questions à l''assistant technique (quand il est activé).', 'sensitive', 301),
  ('engineering.manage', 'Plateforme · Engineering', 'Gérer l''index technique', 'Lancer une synchronisation, revoir la documentation technique.', 'critical', 302),
  ('engineering.admin',  'Plateforme · Engineering', 'Administrer l''Engineering Hub', 'Jetons d''intégration, budgets et limites.', 'critical', 303)
on conflict (key) do update set
  module = excluded.module, label = excluded.label, description = excluded.description,
  risk_level = excluded.risk_level, position = excluded.position, active = true;

insert into public.admin_roles (code, name, description, scope, is_system)
values ('engineering_member', 'Équipe IT', 'Membre de l''équipe technique : accès en lecture à l''Engineering Hub.', 'platform', true)
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_roles r
join public.admin_permissions p on p.key in ('engineering.view', 'engineering.ai.use')
where r.code = 'engineering_member'
on conflict do nothing;

-- ─── 2. Repositories and runs ────────────────────────────────────────────────
create table if not exists public.engineering_repositories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  github_owner text not null,
  github_repo text not null,
  default_branch text not null default 'main',
  active_run_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.engineering_index_runs (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.engineering_repositories(id) on delete cascade,
  branch text not null,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  -- full: every blob re-sent; incremental: blobs already stored are reused.
  mode text not null default 'incremental' check (mode in ('full', 'incremental')),
  -- Idempotency key chosen by the caller (e.g. '<sha>:<mode>').
  run_key text not null check (length(run_key) between 3 and 120),
  trigger text not null default 'manual' check (trigger in ('manual', 'push', 'schedule', 'pull_request')),
  status text not null default 'running' check (status in ('running', 'staged', 'active', 'failed', 'superseded')),
  file_count integer, symbol_count integer, relation_count integer,
  document_count integer, chunk_count integer, excluded_count integer,
  files_checksum text,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{2,60}$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  activated_at timestamptz,
  unique (repository_id, run_key)
);
create index if not exists idx_engineering_runs_repo_status on public.engineering_index_runs(repository_id, status, started_at desc);
-- One run being written per repository at a time.
create unique index if not exists idx_engineering_runs_one_running
  on public.engineering_index_runs(repository_id) where status = 'running';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'engineering_repositories_active_run_fk') then
    alter table public.engineering_repositories
      add constraint engineering_repositories_active_run_fk
      foreign key (active_run_id) references public.engineering_index_runs(id) on delete set null;
  end if;
end $$;

create table if not exists public.engineering_activation_log (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.engineering_repositories(id) on delete cascade,
  action text not null check (action in ('activate', 'rollback')),
  from_run_id uuid,
  to_run_id uuid,
  actor text not null,
  created_at timestamptz not null default now()
);

-- ─── 3. Content-addressed blobs (shared by runs) ─────────────────────────────
create table if not exists public.engineering_blobs (
  repository_id uuid not null references public.engineering_repositories(id) on delete cascade,
  blob_sha text not null check (blob_sha ~ '^[0-9a-f]{40}$'),
  content text not null,
  size_bytes integer not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  primary key (repository_id, blob_sha)
);

-- ─── 4. Snapshot tables (all scoped by run_id) ───────────────────────────────
create table if not exists public.engineering_files (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.engineering_index_runs(id) on delete cascade,
  repository_id uuid not null,
  path text not null check (length(path) between 1 and 500),
  kind text not null check (kind in ('source', 'test', 'api_route', 'page', 'component', 'migration', 'sql', 'doc', 'config', 'ci', 'script', 'other')),
  language text not null check (language in ('typescript', 'javascript', 'sql', 'markdown', 'yaml', 'json', 'other')),
  blob_sha text not null,
  size_bytes integer not null check (size_bytes >= 0),
  line_count integer not null check (line_count >= 0),
  module_key text,
  unique (run_id, path),
  foreign key (repository_id, blob_sha) references public.engineering_blobs(repository_id, blob_sha)
);
create index if not exists idx_engineering_files_module on public.engineering_files(run_id, module_key);
create index if not exists idx_engineering_files_blob on public.engineering_files(repository_id, blob_sha);
create index if not exists idx_engineering_files_path_trgm on public.engineering_files using gin (path gin_trgm_ops);

create table if not exists public.engineering_symbols (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.engineering_index_runs(id) on delete cascade,
  file_id uuid not null references public.engineering_files(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  kind text not null check (kind in ('function', 'class', 'interface', 'type', 'enum', 'const', 'component', 'hook', 'route_handler', 'test', 'table', 'view', 'sql_function', 'trigger', 'policy', 'index')),
  exported boolean not null default false,
  signature text check (signature is null or length(signature) <= 600),
  start_line integer not null check (start_line >= 1),
  end_line integer not null check (end_line >= start_line),
  content_hash text not null,
  parent_name text
);
create index if not exists idx_engineering_symbols_name on public.engineering_symbols(run_id, lower(name));
create index if not exists idx_engineering_symbols_file on public.engineering_symbols(file_id);
create index if not exists idx_engineering_symbols_name_trgm on public.engineering_symbols using gin (name gin_trgm_ops);

-- Only demonstrated relations: every row carries the file and line that prove it.
create table if not exists public.engineering_relations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.engineering_index_runs(id) on delete cascade,
  from_file_id uuid not null references public.engineering_files(id) on delete cascade,
  to_file_id uuid references public.engineering_files(id) on delete cascade,
  kind text not null check (kind in ('imports', 'tests', 'calls_rpc', 'uses_table', 'calls_api', 'handles_route', 'defines_object', 'documents')),
  target_ref text,
  evidence_line integer check (evidence_line is null or evidence_line >= 1),
  check (to_file_id is not null or target_ref is not null)
);
create index if not exists idx_engineering_relations_from on public.engineering_relations(run_id, from_file_id, kind);
create index if not exists idx_engineering_relations_to on public.engineering_relations(run_id, to_file_id, kind);
create index if not exists idx_engineering_relations_ref on public.engineering_relations(run_id, kind, lower(target_ref));

create table if not exists public.engineering_documents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.engineering_index_runs(id) on delete cascade,
  file_id uuid not null references public.engineering_files(id) on delete cascade,
  doc_key text not null,
  title text not null,
  module_key text,
  category text,
  review_status text not null default 'indexed' check (review_status in ('inventoried', 'indexed', 'partial', 'verified', 'to_review')),
  verified_sha text check (verified_sha is null or verified_sha ~ '^[0-9a-f]{7,40}$'),
  owner text,
  verified_on date,
  monitored_files text[] not null default '{}',
  unique (run_id, doc_key)
);

create table if not exists public.engineering_chunks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.engineering_index_runs(id) on delete cascade,
  file_id uuid not null references public.engineering_files(id) on delete cascade,
  symbol_id uuid references public.engineering_symbols(id) on delete cascade,
  document_id uuid references public.engineering_documents(id) on delete cascade,
  kind text not null check (kind in ('doc_section', 'symbol', 'sql_object', 'file_header')),
  title text not null,
  body text not null check (length(body) <= 4000),
  start_line integer not null check (start_line >= 1),
  end_line integer not null check (end_line >= start_line),
  -- 'simple': identifiers are not stemmed. The French/English copy is prose only.
  search tsvector generated always as (
    setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('simple', body), 'B')
  ) stored
);
create index if not exists idx_engineering_chunks_search on public.engineering_chunks using gin (search);
create index if not exists idx_engineering_chunks_file on public.engineering_chunks(run_id, file_id);

create table if not exists public.engineering_modules (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.engineering_index_runs(id) on delete cascade,
  module_key text not null check (module_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  category text not null,
  summary text not null,
  path_globs text[] not null,
  position integer not null default 0,
  unique (run_id, module_key)
);

-- Files left out of the index: path and rule only, NEVER the matched value.
create table if not exists public.engineering_excluded_files (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.engineering_index_runs(id) on delete cascade,
  path text not null check (length(path) between 1 and 500),
  reason_code text not null check (reason_code ~ '^[a-z0-9_]{2,60}$'),
  unique (run_id, path)
);

-- Human review of a technical document (append-only).
create table if not exists public.engineering_document_reviews (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.engineering_repositories(id) on delete cascade,
  doc_key text not null,
  reviewer_id uuid references public.admin_users(id),
  status text not null check (status in ('verified', 'to_review', 'partial')),
  verified_sha text not null check (verified_sha ~ '^[0-9a-f]{7,40}$'),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists idx_engineering_reviews_doc on public.engineering_document_reviews(repository_id, doc_key, created_at desc);

-- ─── 5. Guards: a run is writable only while it is `running` ─────────────────
create or replace function public.engineering_assert_run_open()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_status text;
begin
  select status into v_status from public.engineering_index_runs where id = new.run_id;
  if v_status is distinct from 'running' then
    raise exception 'engineering_run_closed';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['engineering_files', 'engineering_symbols', 'engineering_relations', 'engineering_documents',
                           'engineering_chunks', 'engineering_modules', 'engineering_excluded_files'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_run_open', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.engineering_assert_run_open()', t || '_run_open', t);
  end loop;
end $$;

create or replace function public.engineering_reject_change()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'engineering_append_only';
end $$;

drop trigger if exists engineering_reviews_append_only on public.engineering_document_reviews;
create trigger engineering_reviews_append_only before update or delete on public.engineering_document_reviews
  for each row execute function public.engineering_reject_change();
drop trigger if exists engineering_activation_log_append_only on public.engineering_activation_log;
create trigger engineering_activation_log_append_only before update or delete on public.engineering_activation_log
  for each row execute function public.engineering_reject_change();

-- ─── 6. RPC (security definer, service role only) ────────────────────────────
-- Start (or resume) a run. Idempotent per (repository, run_key): a staged or
-- active run is returned as is; a failed one is reopened with its rows cleared.
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
    if v_run.status = 'failed' then
      if exists (select 1 from public.engineering_index_runs where repository_id = v_repo.id and status = 'running') then
        raise exception 'engineering_run_in_progress';
      end if;
      delete from public.engineering_files where run_id = v_run.id;
      delete from public.engineering_modules where run_id = v_run.id;
      delete from public.engineering_excluded_files where run_id = v_run.id;
      update public.engineering_index_runs
         set status = 'running', error_code = null, finished_at = null, started_at = now(),
             file_count = null, symbol_count = null, relation_count = null, document_count = null,
             chunk_count = null, excluded_count = null, files_checksum = null
       where id = v_run.id returning * into v_run;
    end if;
    return v_run;
  end if;

  if exists (select 1 from public.engineering_index_runs where repository_id = v_repo.id and status = 'running') then
    raise exception 'engineering_run_in_progress';
  end if;
  insert into public.engineering_index_runs (repository_id, branch, commit_sha, mode, run_key, trigger)
  values (v_repo.id, p_branch, p_sha, p_mode, p_run_key, p_trigger)
  returning * into v_run;
  return v_run;
end $$;

create or replace function public.engineering_missing_blobs(p_repo uuid, p_shas text[])
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(s), '{}')
  from (select distinct unnest(p_shas) as s) x
  where not exists (select 1 from public.engineering_blobs b where b.repository_id = p_repo and b.blob_sha = x.s);
$$;

-- Close the writing phase: the manifest sent by the indexer must match what
-- was stored (counts and checksum), otherwise the run is failed, never staged.
create or replace function public.engineering_finalize_run(p_run uuid, p_manifest jsonb)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text; v_files int; v_symbols int; v_relations int; v_documents int; v_chunks int; v_excluded int; v_checksum text;
begin
  select status into v_status from public.engineering_index_runs where id = p_run for update;
  if not found then raise exception 'engineering_run_unknown'; end if;
  if v_status <> 'running' then raise exception 'engineering_run_closed'; end if;

  select count(*), md5(coalesce(string_agg(path || ' ' || blob_sha, E'\n' order by path collate "C"), ''))
    into v_files, v_checksum from public.engineering_files where run_id = p_run;
  select count(*) into v_symbols from public.engineering_symbols where run_id = p_run;
  select count(*) into v_relations from public.engineering_relations where run_id = p_run;
  select count(*) into v_documents from public.engineering_documents where run_id = p_run;
  select count(*) into v_chunks from public.engineering_chunks where run_id = p_run;
  select count(*) into v_excluded from public.engineering_excluded_files where run_id = p_run;

  if v_files = 0
     or v_files <> (p_manifest->>'files')::int or v_symbols <> (p_manifest->>'symbols')::int
     or v_relations <> (p_manifest->>'relations')::int or v_documents <> (p_manifest->>'documents')::int
     or v_chunks <> (p_manifest->>'chunks')::int or v_excluded <> (p_manifest->>'excluded')::int
     or v_checksum <> (p_manifest->>'checksum') then
    update public.engineering_index_runs set status = 'failed', error_code = 'manifest_mismatch', finished_at = now() where id = p_run;
    return 'failed';
  end if;

  update public.engineering_index_runs
     set status = 'staged', finished_at = now(), file_count = v_files, symbol_count = v_symbols,
         relation_count = v_relations, document_count = v_documents, chunk_count = v_chunks,
         excluded_count = v_excluded, files_checksum = v_checksum
   where id = p_run;
  return 'staged';
end $$;

create or replace function public.engineering_fail_run(p_run uuid, p_code text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.engineering_index_runs
     set status = 'failed', error_code = case when p_code ~ '^[a-z0-9_]{2,60}$' then p_code else 'unknown' end, finished_at = now()
   where id = p_run and status = 'running';
$$;

-- Atomic switch of the snapshot read by the Hub. Returns the previous active run.
create or replace function public.engineering_activate_run(p_run uuid, p_actor text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.engineering_index_runs; v_repo public.engineering_repositories; v_prev uuid;
begin
  select * into v_run from public.engineering_index_runs where id = p_run;
  if not found then raise exception 'engineering_run_unknown'; end if;
  select * into v_repo from public.engineering_repositories where id = v_run.repository_id for update;
  select * into v_run from public.engineering_index_runs where id = p_run for update;
  if v_run.status <> 'staged' then raise exception 'engineering_run_not_staged'; end if;
  if v_run.branch <> v_repo.default_branch then raise exception 'engineering_branch_not_activatable'; end if;
  v_prev := v_repo.active_run_id;
  if v_prev is not null then
    update public.engineering_index_runs set status = 'superseded' where id = v_prev and status = 'active';
  end if;
  update public.engineering_index_runs set status = 'active', activated_at = now() where id = p_run;
  update public.engineering_repositories set active_run_id = p_run where id = v_repo.id;
  insert into public.engineering_activation_log (repository_id, action, from_run_id, to_run_id, actor)
  values (v_repo.id, 'activate', v_prev, p_run, coalesce(nullif(left(p_actor, 120), ''), 'unknown'));
  return v_prev;
end $$;

-- Back to the most recently active superseded run still retained.
create or replace function public.engineering_rollback(p_repo text, p_actor text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_repo public.engineering_repositories; v_target uuid; v_prev uuid;
begin
  select * into v_repo from public.engineering_repositories where slug = p_repo for update;
  if not found then raise exception 'engineering_repository_unknown'; end if;
  select id into v_target from public.engineering_index_runs
   where repository_id = v_repo.id and status = 'superseded'
   order by activated_at desc nulls last limit 1;
  if v_target is null then raise exception 'engineering_no_rollback_target'; end if;
  v_prev := v_repo.active_run_id;
  if v_prev is not null then
    update public.engineering_index_runs set status = 'superseded' where id = v_prev and status = 'active';
  end if;
  update public.engineering_index_runs set status = 'active', activated_at = now() where id = v_target;
  update public.engineering_repositories set active_run_id = v_target where id = v_repo.id;
  insert into public.engineering_activation_log (repository_id, action, from_run_id, to_run_id, actor)
  values (v_repo.id, 'rollback', v_prev, v_target, coalesce(nullif(left(p_actor, 120), ''), 'unknown'));
  return v_target;
end $$;

-- Retention: keep the active run, the newest `p_keep` superseded runs and the
-- last failures; drop the rest, then blobs no file references (older than 1 day,
-- so a blob uploaded for a run still being written is never removed).
create or replace function public.engineering_purge(p_repo uuid, p_keep integer default 3)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_runs int; v_blobs int;
begin
  with doomed as (
    select id from (
      select id, row_number() over (order by coalesce(activated_at, started_at) desc) as rn
      from public.engineering_index_runs where repository_id = p_repo and status = 'superseded'
    ) s where s.rn > greatest(p_keep, 1)
    union
    select id from public.engineering_index_runs
     where repository_id = p_repo and status in ('failed', 'staged') and started_at < now() - interval '7 days'
  ), del as (
    delete from public.engineering_index_runs r using doomed d where r.id = d.id returning r.id
  ) select count(*) into v_runs from del;

  with del as (
    delete from public.engineering_blobs b
     where b.repository_id = p_repo and b.created_at < now() - interval '1 day'
       and not exists (select 1 from public.engineering_files f where f.repository_id = b.repository_id and f.blob_sha = b.blob_sha)
     returning 1
  ) select count(*) into v_blobs from del;
  return jsonb_build_object('runs_deleted', v_runs, 'blobs_deleted', v_blobs);
end $$;

-- ─── 7. Privileges: service role only, nothing for tenants or browsers ───────
alter table public.engineering_repositories enable row level security;
alter table public.engineering_repositories force row level security;
alter table public.engineering_index_runs enable row level security;
alter table public.engineering_index_runs force row level security;
alter table public.engineering_activation_log enable row level security;
alter table public.engineering_activation_log force row level security;
alter table public.engineering_blobs enable row level security;
alter table public.engineering_blobs force row level security;
alter table public.engineering_files enable row level security;
alter table public.engineering_files force row level security;
alter table public.engineering_symbols enable row level security;
alter table public.engineering_symbols force row level security;
alter table public.engineering_relations enable row level security;
alter table public.engineering_relations force row level security;
alter table public.engineering_documents enable row level security;
alter table public.engineering_documents force row level security;
alter table public.engineering_chunks enable row level security;
alter table public.engineering_chunks force row level security;
alter table public.engineering_modules enable row level security;
alter table public.engineering_modules force row level security;
alter table public.engineering_excluded_files enable row level security;
alter table public.engineering_excluded_files force row level security;
alter table public.engineering_document_reviews enable row level security;
alter table public.engineering_document_reviews force row level security;

revoke all on public.engineering_repositories, public.engineering_index_runs, public.engineering_activation_log,
  public.engineering_blobs, public.engineering_files, public.engineering_symbols, public.engineering_relations,
  public.engineering_documents, public.engineering_chunks, public.engineering_modules,
  public.engineering_excluded_files, public.engineering_document_reviews
  from public, anon, authenticated, service_role;

grant select on public.engineering_repositories, public.engineering_index_runs, public.engineering_activation_log,
  public.engineering_blobs, public.engineering_files, public.engineering_symbols, public.engineering_relations,
  public.engineering_documents, public.engineering_chunks, public.engineering_modules,
  public.engineering_excluded_files, public.engineering_document_reviews to service_role;
-- Writes: snapshot rows are insert/update only (deletes happen through engineering_purge).
grant insert, update on public.engineering_files, public.engineering_symbols, public.engineering_relations,
  public.engineering_documents, public.engineering_chunks, public.engineering_modules,
  public.engineering_excluded_files to service_role;
grant insert on public.engineering_blobs, public.engineering_document_reviews to service_role;
grant insert, update on public.engineering_repositories to service_role;

revoke all on function public.engineering_assert_run_open(), public.engineering_reject_change(),
  public.engineering_start_run(text, text, text, text, text, text),
  public.engineering_missing_blobs(uuid, text[]), public.engineering_finalize_run(uuid, jsonb),
  public.engineering_fail_run(uuid, text), public.engineering_activate_run(uuid, text),
  public.engineering_rollback(text, text), public.engineering_purge(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.engineering_start_run(text, text, text, text, text, text),
  public.engineering_missing_blobs(uuid, text[]), public.engineering_finalize_run(uuid, jsonb),
  public.engineering_fail_run(uuid, text), public.engineering_activate_run(uuid, text),
  public.engineering_rollback(text, text), public.engineering_purge(uuid, integer)
  to service_role;

-- ─── 8. The one repository ───────────────────────────────────────────────────
insert into public.engineering_repositories (slug, github_owner, github_repo, default_branch)
values ('lepefy-food-platform', 'lepefy-labs', 'lepefy-food-platform', 'main')
on conflict (slug) do nothing;

commit;

-- ─── Rollback (manual, destroys the technical index only) ────────────────────
-- begin;
-- drop table if exists public.engineering_document_reviews, public.engineering_excluded_files,
--   public.engineering_modules, public.engineering_chunks, public.engineering_documents,
--   public.engineering_relations, public.engineering_symbols, public.engineering_files,
--   public.engineering_blobs, public.engineering_activation_log cascade;
-- alter table public.engineering_repositories drop constraint if exists engineering_repositories_active_run_fk;
-- drop table if exists public.engineering_index_runs, public.engineering_repositories cascade;
-- drop function if exists public.engineering_assert_run_open(), public.engineering_reject_change(),
--   public.engineering_start_run(text, text, text, text, text, text), public.engineering_missing_blobs(uuid, text[]),
--   public.engineering_finalize_run(uuid, jsonb), public.engineering_fail_run(uuid, text),
--   public.engineering_activate_run(uuid, text), public.engineering_rollback(text, text),
--   public.engineering_purge(uuid, integer);
-- delete from public.admin_role_permissions where permission_key like 'engineering.%';
-- delete from public.admin_roles where code = 'engineering_member';
-- delete from public.admin_permissions where key like 'engineering.%';
-- commit;
