-- 183 — Studio images (docs/IMAGE_STUDIO.md)
--
-- Bibliothèque d'images privée par tenant, indépendante des produits et des
-- modules : on crée une image (depuis une photo ou une idée), on la révise,
-- puis on l'utilise sur une destination (produit, slide, module). Le module est
-- derrière le flag de release `image_studio` (tenant_feature_flags, aucune
-- ligne = éteint) et la capability `studio.use`.
--
-- Règles :
-- * RLS forcée sans policy, aucun privilège pour anon/authenticated ; le
--   service role ne garde que la lecture : chaque écriture passe par une RPC
--   security definer ci-dessous (machine à états, quotas, idempotence).
-- * Le tenant est toujours passé par le serveur (getTenant()), jamais par le
--   navigateur ; chaque RPC le vérifie contre la ligne visée.
-- * Fichiers : bucket privé `studio-private` (original, révisions). Une image
--   n'est publique qu'après « Confirmer et publier » : une copie dédiée par
--   destination est écrite dans le bucket public `assets`.
-- * Additive et réversible : rollback en fin de fichier.

begin;

-- ─── 1. Style de la boutique (versionné, immuable) ───────────────────────────
create table if not exists public.studio_style_versions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  version       integer not null check (version > 0),
  status        text not null default 'active' check (status in ('active', 'retired')),
  instructions  jsonb not null check (jsonb_typeof(instructions) = 'object' and octet_length(instructions::text) <= 16000),
  note          text check (note is null or length(note) <= 500),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (tenant_id, version),
  unique (tenant_id, id)
);
create unique index if not exists studio_style_versions_one_active
  on public.studio_style_versions (tenant_id) where status = 'active';

-- Immuable : seule la bascule active → retired est permise.
create or replace function public.studio_style_versions_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'studio_style_immutable'; end if;
  if new.instructions is distinct from old.instructions or new.version <> old.version
     or new.tenant_id <> old.tenant_id or new.created_at <> old.created_at
     or not (old.status = 'active' and new.status = 'retired') then
    raise exception 'studio_style_immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists studio_style_versions_guard on public.studio_style_versions;
create trigger studio_style_versions_guard before update or delete on public.studio_style_versions
  for each row execute function public.studio_style_versions_guard();

-- ─── 2. Limites par tenant (aucune ligne = valeurs par défaut) ────────────────
create table if not exists public.studio_tenant_settings (
  tenant_id               uuid primary key references public.tenants(id) on delete cascade,
  monthly_revisions       integer not null default 60 check (monthly_revisions between 0 and 5000),
  monthly_budget_usd      numeric(10,2) not null default 20 check (monthly_budget_usd >= 0 and monthly_budget_usd <= 10000),
  draft_retention_days    integer not null default 30 check (draft_retention_days between 7 and 365),
  updated_at              timestamptz not null default now()
);

-- ─── 3. Images ───────────────────────────────────────────────────────────────
create table if not exists public.studio_assets (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  origin                text not null check (origin in ('photo', 'prompt')),
  title                 text not null check (length(btrim(title)) between 1 and 120),
  status                text not null default 'processing'
                          check (status in ('processing', 'review', 'approved', 'failed', 'discarded', 'archived')),
  request_text          text check (request_text is null or length(request_text) <= 1000),
  source_path           text check (source_path is null or length(source_path) <= 300),
  source_mime           text check (source_mime is null or source_mime in ('image/jpeg', 'image/png', 'image/webp')),
  source_width          integer check (source_width is null or source_width > 0),
  source_height         integer check (source_height is null or source_height > 0),
  source_bytes          integer check (source_bytes is null or source_bytes > 0),
  current_revision_no   integer not null default 0 check (current_revision_no >= 0),
  approved_revision_id  uuid,
  -- Créée sans photo : image d'ambiance, jamais présentée comme un produit réel.
  ambiance_only         boolean not null default false,
  created_by            uuid not null,
  request_key           text not null check (length(request_key) between 8 and 100),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  last_used_at          timestamptz,
  purged_at             timestamptz,
  unique (tenant_id, request_key),
  unique (tenant_id, id),
  check ((origin = 'photo') = (source_path is not null) or purged_at is not null),
  check (ambiance_only = (origin = 'prompt'))
);
create index if not exists studio_assets_tenant_status_idx on public.studio_assets (tenant_id, status, updated_at desc);

-- ─── 4. Versions proposées ───────────────────────────────────────────────────
create table if not exists public.studio_revisions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  asset_id           uuid not null,
  revision_no        integer not null check (revision_no > 0),
  base_revision_id   uuid,
  request_text       text check (request_text is null or length(request_text) <= 1000),
  final_prompt       text check (final_prompt is null or length(final_prompt) <= 8000),
  style_version_id   uuid not null,
  style_version      integer not null,
  status             text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'discarded')),
  provider           text check (provider is null or length(provider) <= 60),
  model              text check (model is null or length(model) <= 120),
  storage_path       text check (storage_path is null or length(storage_path) <= 300),
  width              integer,
  height             integer,
  bytes              integer,
  sha256             text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  cost_usd           numeric(10,4) not null default 0 check (cost_usd >= 0),
  latency_ms         integer,
  error_code         text check (error_code is null or error_code ~ '^[a-z0-9_]{1,60}$'),
  request_key        text not null check (length(request_key) between 8 and 100),
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  unique (asset_id, revision_no),
  unique (tenant_id, id),
  unique (tenant_id, request_key),
  foreign key (tenant_id, asset_id) references public.studio_assets (tenant_id, id) on delete cascade,
  foreign key (tenant_id, style_version_id) references public.studio_style_versions (tenant_id, id),
  foreign key (tenant_id, base_revision_id) references public.studio_revisions (tenant_id, id)
);
create index if not exists studio_revisions_month_idx on public.studio_revisions (tenant_id, created_at);

alter table public.studio_assets drop constraint if exists studio_assets_approved_revision_fk;
alter table public.studio_assets add constraint studio_assets_approved_revision_fk
  foreign key (tenant_id, approved_revision_id) references public.studio_revisions (tenant_id, id);

-- ─── 5. Travaux (file durable) ───────────────────────────────────────────────
create table if not exists public.studio_jobs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  asset_id          uuid not null,
  revision_id       uuid not null unique,
  status            text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts          integer not null default 0 check (attempts >= 0),
  max_attempts      integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at   timestamptz not null default now(),
  locked_until      timestamptz,
  claim_token       uuid,
  last_error_code   text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,60}$'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (tenant_id, revision_id) references public.studio_revisions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, asset_id) references public.studio_assets (tenant_id, id) on delete cascade
);
create index if not exists studio_jobs_due_idx on public.studio_jobs (status, next_attempt_at);

-- ─── 6. Utilisations (une copie publique par destination) ────────────────────
create table if not exists public.studio_usages (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  asset_id          uuid not null,
  revision_id       uuid not null,
  destination_key   text not null check (destination_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  target_id         text not null check (length(target_id) between 1 and 100),
  target_label      text check (target_label is null or length(target_label) <= 200),
  status            text not null default 'publishing' check (status in ('publishing', 'active', 'removed', 'failed')),
  public_url        text check (public_url is null or length(public_url) <= 1000),
  storage_paths     text[] not null default '{}',
  crop              jsonb check (crop is null or jsonb_typeof(crop) = 'object'),
  request_key       text not null check (length(request_key) between 8 and 100),
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  removed_at        timestamptz,
  removed_by        uuid,
  removal_reason    text check (removal_reason is null or removal_reason in ('removed', 'replaced', 'target_changed', 'failed')),
  unique (tenant_id, request_key),
  foreign key (tenant_id, asset_id) references public.studio_assets (tenant_id, id) on delete cascade,
  foreign key (tenant_id, revision_id) references public.studio_revisions (tenant_id, id)
);
create index if not exists studio_usages_asset_idx on public.studio_usages (tenant_id, asset_id, status);
create index if not exists studio_usages_target_idx on public.studio_usages (tenant_id, destination_key, target_id) where status = 'active';

-- ─── 7. RLS et privilèges ────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['studio_style_versions', 'studio_tenant_settings', 'studio_assets', 'studio_revisions', 'studio_jobs', 'studio_usages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
end $$;

-- ─── 8. Stockage privé ───────────────────────────────────────────────────────
-- Aucune policy storage : téléversement par URL signée émise par la route
-- autorisée, lecture par URL signée de courte durée.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-private', 'studio-private', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ─── 9. Quotas (miroir de lib/studio/rules.ts) ───────────────────────────────
-- Mois civil à Paris. Les versions en échec ne comptent pas ; le coût compte toujours.
create or replace function public.studio_quota_check(p_tenant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_limit integer := 60;
  v_budget numeric := 20;
  v_used integer;
  v_cost numeric;
  v_month timestamptz := (date_trunc('month', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
begin
  select monthly_revisions, monthly_budget_usd into v_limit, v_budget
  from public.studio_tenant_settings where tenant_id = p_tenant_id;
  v_limit := coalesce(v_limit, 60);
  v_budget := coalesce(v_budget, 20);
  select count(*) filter (where status <> 'failed'), coalesce(sum(cost_usd), 0)
    into v_used, v_cost
  from public.studio_revisions where tenant_id = p_tenant_id and created_at >= v_month;
  if v_used >= v_limit then raise exception 'studio_quota_exceeded'; end if;
  if v_cost >= v_budget then raise exception 'studio_budget_exceeded'; end if;
end;
$$;

create or replace function public.studio_usage_summary(p_tenant_id uuid)
returns table (out_used integer, out_limit integer, out_cost_usd numeric, out_budget_usd numeric)
language sql stable security definer set search_path = public as $$
  with month as (
    select (date_trunc('month', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris' as start
  ), settings as (
    select coalesce((select monthly_revisions from public.studio_tenant_settings where tenant_id = p_tenant_id), 60) as lim,
           coalesce((select monthly_budget_usd from public.studio_tenant_settings where tenant_id = p_tenant_id), 20) as budget
  )
  select (count(*) filter (where r.status <> 'failed'))::integer, s.lim, coalesce(sum(r.cost_usd), 0), s.budget
  from settings s
  left join public.studio_revisions r on r.tenant_id = p_tenant_id and r.created_at >= (select start from month)
  group by s.lim, s.budget;
$$;

-- ─── 10. Style ───────────────────────────────────────────────────────────────
create or replace function public.studio_publish_style(
  p_tenant_id uuid, p_instructions jsonb, p_note text, p_admin_id uuid, p_expected_version integer
)
returns table (out_id uuid, out_version integer)
language plpgsql security definer set search_path = public as $$
declare
  v_current integer;
  v_id uuid;
begin
  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;
  select coalesce(max(version), 0) into v_current from public.studio_style_versions where tenant_id = p_tenant_id;
  if p_expected_version is not null and p_expected_version <> v_current then raise exception 'studio_style_changed'; end if;
  update public.studio_style_versions set status = 'retired' where tenant_id = p_tenant_id and status = 'active';
  insert into public.studio_style_versions (tenant_id, version, status, instructions, note, created_by)
  values (p_tenant_id, v_current + 1, 'active', p_instructions, nullif(btrim(p_note), ''), p_admin_id)
  returning id into v_id;
  return query select v_id, v_current + 1;
end;
$$;

-- ─── 11. Création d'une image + première version ─────────────────────────────
create or replace function public.studio_create_asset(
  p_tenant_id uuid, p_origin text, p_title text, p_request_text text,
  p_source_path text, p_source_mime text, p_source_width integer, p_source_height integer, p_source_bytes integer,
  p_style_version_id uuid, p_admin_id uuid, p_request_key text
)
returns table (out_asset_id uuid, out_revision_id uuid, out_job_id uuid, out_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_asset uuid;
  v_revision uuid;
  v_job uuid;
  v_style integer;
begin
  -- Rejeu de la même requête : même résultat, rien de nouveau.
  select a.id into v_asset from public.studio_assets a where a.tenant_id = p_tenant_id and a.request_key = p_request_key;
  if v_asset is not null then
    select r.id into v_revision from public.studio_revisions r where r.asset_id = v_asset and r.revision_no = 1;
    select j.id into v_job from public.studio_jobs j where j.revision_id = v_revision;
    return query select v_asset, v_revision, v_job, false;
    return;
  end if;
  if p_origin not in ('photo', 'prompt') then raise exception 'studio_invalid_request'; end if;
  if p_origin = 'photo' and p_source_path is null then raise exception 'studio_invalid_request'; end if;
  if p_origin = 'prompt' and (p_request_text is null or length(btrim(p_request_text)) < 3) then raise exception 'studio_invalid_request'; end if;
  if p_source_path is not null and p_source_path not like 'tenants/' || p_tenant_id::text || '/assets/%' then
    raise exception 'studio_invalid_request';
  end if;
  select version into v_style from public.studio_style_versions
  where tenant_id = p_tenant_id and id = p_style_version_id and status = 'active';
  if v_style is null then raise exception 'studio_style_changed'; end if;

  -- Sérialise les créations d'un tenant pour un quota exact.
  perform pg_advisory_xact_lock(hashtextextended('studio:' || p_tenant_id::text, 0));
  perform public.studio_quota_check(p_tenant_id);

  insert into public.studio_assets (tenant_id, origin, title, status, request_text, source_path, source_mime,
    source_width, source_height, source_bytes, current_revision_no, ambiance_only, created_by, request_key)
  values (p_tenant_id, p_origin, btrim(p_title), 'processing', nullif(btrim(p_request_text), ''), p_source_path, p_source_mime,
    p_source_width, p_source_height, p_source_bytes, 1, p_origin = 'prompt', p_admin_id, p_request_key)
  returning id into v_asset;
  insert into public.studio_revisions (tenant_id, asset_id, revision_no, request_text, style_version_id, style_version,
    status, request_key, created_by)
  values (p_tenant_id, v_asset, 1, nullif(btrim(p_request_text), ''), p_style_version_id, v_style, 'pending', p_request_key, p_admin_id)
  returning id into v_revision;
  insert into public.studio_jobs (tenant_id, asset_id, revision_id) values (p_tenant_id, v_asset, v_revision)
  returning id into v_job;
  return query select v_asset, v_revision, v_job, true;
end;
$$;

-- ─── 12. Correction (nouvelle version à partir d'une version réussie) ────────
create or replace function public.studio_request_correction(
  p_tenant_id uuid, p_asset_id uuid, p_base_revision_id uuid, p_request_text text,
  p_style_version_id uuid, p_admin_id uuid, p_request_key text
)
returns table (out_revision_id uuid, out_job_id uuid, out_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.studio_assets%rowtype;
  v_revision uuid;
  v_job uuid;
  v_style integer;
  v_no integer;
begin
  select r.id into v_revision from public.studio_revisions r where r.tenant_id = p_tenant_id and r.request_key = p_request_key;
  if v_revision is not null then
    select j.id into v_job from public.studio_jobs j where j.revision_id = v_revision;
    return query select v_revision, v_job, false;
    return;
  end if;
  if p_request_text is null or length(btrim(p_request_text)) < 3 or length(p_request_text) > 1000 then
    raise exception 'studio_invalid_request';
  end if;
  select * into v_asset from public.studio_assets where tenant_id = p_tenant_id and id = p_asset_id for update;
  if not found then raise exception 'studio_not_found'; end if;
  if v_asset.status not in ('review', 'failed', 'approved') then raise exception 'studio_invalid_transition'; end if;
  if exists (select 1 from public.studio_revisions where asset_id = p_asset_id and status = 'pending') then
    raise exception 'studio_busy';
  end if;
  perform 1 from public.studio_revisions
  where tenant_id = p_tenant_id and asset_id = p_asset_id and id = p_base_revision_id and status = 'succeeded';
  if not found then raise exception 'studio_invalid_request'; end if;
  select version into v_style from public.studio_style_versions
  where tenant_id = p_tenant_id and id = p_style_version_id and status = 'active';
  if v_style is null then raise exception 'studio_style_changed'; end if;

  perform pg_advisory_xact_lock(hashtextextended('studio:' || p_tenant_id::text, 0));
  perform public.studio_quota_check(p_tenant_id);

  v_no := v_asset.current_revision_no + 1;
  insert into public.studio_revisions (tenant_id, asset_id, revision_no, base_revision_id, request_text,
    style_version_id, style_version, status, request_key, created_by)
  values (p_tenant_id, p_asset_id, v_no, p_base_revision_id, btrim(p_request_text), p_style_version_id, v_style,
    'pending', p_request_key, p_admin_id)
  returning id into v_revision;
  insert into public.studio_jobs (tenant_id, asset_id, revision_id) values (p_tenant_id, p_asset_id, v_revision)
  returning id into v_job;
  -- Une image approuvée revient « à valider » : la nouvelle version doit être revue.
  update public.studio_assets set status = 'processing', current_revision_no = v_no, updated_at = now()
  where id = p_asset_id;
  return query select v_revision, v_job, true;
end;
$$;

-- ─── 13. Réessayer une version en échec (aucun quota : rien n'a été produit) ─
create or replace function public.studio_retry_revision(p_tenant_id uuid, p_revision_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rev public.studio_revisions%rowtype;
  v_job uuid;
begin
  select * into v_rev from public.studio_revisions where tenant_id = p_tenant_id and id = p_revision_id for update;
  if not found then raise exception 'studio_not_found'; end if;
  if v_rev.status = 'pending' then
    select id into v_job from public.studio_jobs where revision_id = p_revision_id;
    return v_job;
  end if;
  if v_rev.status <> 'failed' then raise exception 'studio_invalid_transition'; end if;
  perform 1 from public.studio_assets where id = v_rev.asset_id and status not in ('discarded', 'archived') for update;
  if not found then raise exception 'studio_invalid_transition'; end if;
  update public.studio_revisions set status = 'pending', error_code = null, completed_at = null where id = p_revision_id;
  update public.studio_jobs set status = 'queued', attempts = 0, next_attempt_at = now(), locked_until = null,
    claim_token = null, last_error_code = null, updated_at = now()
  where revision_id = p_revision_id returning id into v_job;
  update public.studio_assets set status = 'processing', updated_at = now() where id = v_rev.asset_id;
  return v_job;
end;
$$;

-- ─── 14. Travaux : réservation et fin ────────────────────────────────────────
-- Réserve les travaux dus (ou un travail précis) : file, puis travaux « running »
-- dont le verrou a expiré (fonction interrompue). Compare-and-set via SKIP LOCKED.
create or replace function public.studio_claim_jobs(p_limit integer, p_job_id uuid default null, p_lock_seconds integer default 180)
returns table (out_job_id uuid, out_claim_token uuid, out_tenant_id uuid, out_asset_id uuid, out_revision_id uuid, out_attempt integer)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select j.id from public.studio_jobs j
    where (p_job_id is null or j.id = p_job_id)
      and j.attempts < j.max_attempts
      and ((j.status = 'queued' and j.next_attempt_at <= now())
        or (j.status = 'running' and j.locked_until < now()))
    order by j.next_attempt_at
    limit greatest(1, least(coalesce(p_limit, 1), 10))
    for update skip locked
  ), claimed as (
    update public.studio_jobs j
    set status = 'running', attempts = j.attempts + 1, claim_token = gen_random_uuid(),
        locked_until = now() + make_interval(secs => greatest(30, least(p_lock_seconds, 900))), updated_at = now()
    from due where j.id = due.id
    returning j.id, j.claim_token, j.tenant_id, j.asset_id, j.revision_id, j.attempts
  )
  select * from claimed;
end;
$$;

-- Travaux bloqués au-delà du nombre d'essais : la version passe en échec.
create or replace function public.studio_fail_exhausted_jobs()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer := 0; v_job record;
begin
  for v_job in
    select id, tenant_id, revision_id from public.studio_jobs
    where status = 'running' and locked_until < now() and attempts >= max_attempts
    for update skip locked
  loop
    perform public.studio_finish_revision(v_job.id, null, false, '{}'::jsonb, 'worker_interrupted', false, true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.studio_finish_revision(
  p_job_id uuid, p_claim_token uuid, p_success boolean, p_result jsonb, p_error_code text, p_retryable boolean,
  p_force boolean default false
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_job public.studio_jobs%rowtype;
  v_asset_status text;
  v_has_success boolean;
begin
  select * into v_job from public.studio_jobs where id = p_job_id for update;
  if not found then raise exception 'studio_not_found'; end if;
  if not p_force and (v_job.status <> 'running' or v_job.claim_token is distinct from p_claim_token) then
    return 'stale';
  end if;

  if p_success then
    update public.studio_revisions set status = 'succeeded',
      final_prompt = left(p_result->>'final_prompt', 8000),
      provider = left(p_result->>'provider', 60), model = left(p_result->>'model', 120),
      storage_path = p_result->>'storage_path', width = (p_result->>'width')::integer, height = (p_result->>'height')::integer,
      bytes = (p_result->>'bytes')::integer, sha256 = p_result->>'sha256',
      cost_usd = cost_usd + coalesce((p_result->>'cost_usd')::numeric, 0), latency_ms = (p_result->>'latency_ms')::integer,
      error_code = null, completed_at = now()
    where id = v_job.revision_id and status = 'pending';
    update public.studio_jobs set status = 'succeeded', claim_token = null, locked_until = null, updated_at = now()
    where id = p_job_id;
    update public.studio_assets set status = 'review', updated_at = now()
    where id = v_job.asset_id and status = 'processing';
    return 'succeeded';
  end if;

  -- Coût éventuellement engagé avant l'échec (réponse refusée par nos contrôles).
  update public.studio_revisions set cost_usd = cost_usd + coalesce((p_result->>'cost_usd')::numeric, 0),
    provider = coalesce(left(p_result->>'provider', 60), provider), model = coalesce(left(p_result->>'model', 120), model)
  where id = v_job.revision_id;

  if p_retryable and v_job.attempts < v_job.max_attempts then
    update public.studio_jobs set status = 'queued', claim_token = null, locked_until = null,
      last_error_code = p_error_code,
      next_attempt_at = now() + make_interval(secs => 30 * power(2, v_job.attempts - 1)::integer), updated_at = now()
    where id = p_job_id;
    return 'retry';
  end if;

  update public.studio_jobs set status = 'failed', claim_token = null, locked_until = null,
    last_error_code = p_error_code, updated_at = now()
  where id = p_job_id;
  update public.studio_revisions set status = 'failed', error_code = coalesce(p_error_code, 'provider_error'), completed_at = now()
  where id = v_job.revision_id and status = 'pending';
  select exists (select 1 from public.studio_revisions where asset_id = v_job.asset_id and status = 'succeeded') into v_has_success;
  select status into v_asset_status from public.studio_assets where id = v_job.asset_id;
  if v_asset_status = 'processing' then
    -- Une correction ratée laisse la proposition précédente à valider.
    update public.studio_assets set status = case when v_has_success then 'review' else 'failed' end, updated_at = now()
    where id = v_job.asset_id;
  end if;
  return 'failed';
end;
$$;

-- ─── 15. Décision sur une image ──────────────────────────────────────────────
create or replace function public.studio_decide_asset(
  p_tenant_id uuid, p_asset_id uuid, p_action text, p_revision_id uuid, p_title text default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.studio_assets%rowtype;
  v_active integer;
begin
  select * into v_asset from public.studio_assets where tenant_id = p_tenant_id and id = p_asset_id for update;
  if not found or v_asset.purged_at is not null then raise exception 'studio_not_found'; end if;
  select count(*) into v_active from public.studio_usages where asset_id = p_asset_id and status in ('active', 'publishing');

  if p_action = 'approve' then
    if v_asset.status not in ('review', 'approved') then raise exception 'studio_invalid_transition'; end if;
    perform 1 from public.studio_revisions
    where tenant_id = p_tenant_id and asset_id = p_asset_id and id = p_revision_id and status = 'succeeded';
    if not found then raise exception 'studio_invalid_request'; end if;
    update public.studio_assets set status = 'approved', approved_revision_id = p_revision_id, updated_at = now() where id = p_asset_id;
  elsif p_action = 'discard' then
    if v_active > 0 then raise exception 'studio_in_use'; end if;
    if v_asset.status = 'processing' then raise exception 'studio_busy'; end if;
    update public.studio_assets set status = 'discarded', updated_at = now() where id = p_asset_id;
  elsif p_action = 'archive' then
    if v_asset.status <> 'approved' then raise exception 'studio_invalid_transition'; end if;
    update public.studio_assets set status = 'archived', updated_at = now() where id = p_asset_id;
  elsif p_action = 'restore' then
    if v_asset.status not in ('archived', 'discarded') then raise exception 'studio_invalid_transition'; end if;
    update public.studio_assets
    set status = case when approved_revision_id is not null then 'approved'
                      when exists (select 1 from public.studio_revisions r where r.asset_id = p_asset_id and r.status = 'succeeded') then 'review'
                      else 'failed' end,
        updated_at = now()
    where id = p_asset_id;
  elsif p_action = 'rename' then
    if p_title is null or length(btrim(p_title)) not between 1 and 120 then raise exception 'studio_invalid_request'; end if;
    update public.studio_assets set title = btrim(p_title), updated_at = now() where id = p_asset_id;
  else
    raise exception 'studio_invalid_request';
  end if;
  return (select status from public.studio_assets where id = p_asset_id);
end;
$$;

-- ─── 16. Utilisations ────────────────────────────────────────────────────────
-- Début de publication : réserve la ligne (idempotente) ; l'image doit être approuvée.
create or replace function public.studio_begin_usage(
  p_tenant_id uuid, p_asset_id uuid, p_destination_key text, p_target_id text, p_target_label text,
  p_crop jsonb, p_admin_id uuid, p_request_key text
)
returns table (out_usage_id uuid, out_revision_id uuid, out_status text, out_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_usage public.studio_usages%rowtype;
  v_asset public.studio_assets%rowtype;
  v_id uuid;
begin
  select * into v_usage from public.studio_usages where tenant_id = p_tenant_id and request_key = p_request_key;
  if found then
    return query select v_usage.id, v_usage.revision_id, v_usage.status, false;
    return;
  end if;
  select * into v_asset from public.studio_assets where tenant_id = p_tenant_id and id = p_asset_id for update;
  if not found or v_asset.purged_at is not null then raise exception 'studio_not_found'; end if;
  if v_asset.status <> 'approved' or v_asset.approved_revision_id is null then raise exception 'studio_not_approved'; end if;
  insert into public.studio_usages (tenant_id, asset_id, revision_id, destination_key, target_id, target_label, status,
    crop, request_key, created_by)
  values (p_tenant_id, p_asset_id, v_asset.approved_revision_id, p_destination_key, p_target_id, left(p_target_label, 200),
    'publishing', p_crop, p_request_key, p_admin_id)
  returning id into v_id;
  return query select v_id, v_asset.approved_revision_id, 'publishing'::text, true;
end;
$$;

create or replace function public.studio_finish_usage(
  p_tenant_id uuid, p_usage_id uuid, p_success boolean, p_public_url text, p_storage_paths text[]
)
returns text
language plpgsql security definer set search_path = public as $$
declare v_usage public.studio_usages%rowtype;
begin
  select * into v_usage from public.studio_usages where tenant_id = p_tenant_id and id = p_usage_id for update;
  if not found then raise exception 'studio_not_found'; end if;
  if v_usage.status <> 'publishing' then return v_usage.status; end if;
  if p_success then
    -- La même destination n'a qu'une image Studio active à la fois (sauf les galeries).
    update public.studio_usages set status = 'active', public_url = p_public_url,
      storage_paths = coalesce(p_storage_paths, '{}'), updated_at = now()
    where id = p_usage_id;
    update public.studio_assets set last_used_at = now(), updated_at = now() where id = v_usage.asset_id;
    return 'active';
  end if;
  update public.studio_usages set status = 'failed', removal_reason = 'failed', removed_at = now(), updated_at = now()
  where id = p_usage_id;
  return 'failed';
end;
$$;

create or replace function public.studio_end_usage(p_tenant_id uuid, p_usage_id uuid, p_reason text, p_admin_id uuid)
returns table (out_storage_paths text[], out_changed boolean)
language plpgsql security definer set search_path = public as $$
declare v_usage public.studio_usages%rowtype;
begin
  if p_reason not in ('removed', 'replaced', 'target_changed') then raise exception 'studio_invalid_request'; end if;
  select * into v_usage from public.studio_usages where tenant_id = p_tenant_id and id = p_usage_id for update;
  if not found then raise exception 'studio_not_found'; end if;
  if v_usage.status <> 'active' then
    return query select v_usage.storage_paths, false;
    return;
  end if;
  update public.studio_usages set status = 'removed', removal_reason = p_reason, removed_at = now(),
    removed_by = p_admin_id, updated_at = now()
  where id = p_usage_id;
  return query select v_usage.storage_paths, true;
end;
$$;

-- ─── 17. Nettoyage des brouillons ────────────────────────────────────────────
-- Images jamais utilisées, non approuvées (ou écartées), inactives depuis la
-- durée de rétention du tenant. Les fichiers privés sont supprimés par le
-- serveur, puis la ligne est marquée (jamais supprimée : historique et coûts).
create or replace function public.studio_cleanup_candidates(p_limit integer)
returns table (out_tenant_id uuid, out_asset_id uuid, out_paths text[])
language sql stable security definer set search_path = public as $$
  select a.tenant_id, a.id,
         array_remove(array_append(coalesce(array_agg(r.storage_path) filter (where r.storage_path is not null), '{}'), a.source_path), null)
  from public.studio_assets a
  left join public.studio_tenant_settings s on s.tenant_id = a.tenant_id
  left join public.studio_revisions r on r.asset_id = a.id
  where a.purged_at is null
    and a.status in ('review', 'failed', 'discarded')
    and a.updated_at < now() - make_interval(days => case when a.status = 'discarded' then 7 else coalesce(s.draft_retention_days, 30) end)
    and not exists (select 1 from public.studio_usages u where u.asset_id = a.id and u.status in ('active', 'publishing'))
    and not exists (select 1 from public.studio_jobs j where j.asset_id = a.id and j.status in ('queued', 'running'))
  group by a.tenant_id, a.id, a.source_path
  order by a.tenant_id, a.id
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create or replace function public.studio_mark_purged(p_tenant_id uuid, p_asset_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.studio_usages where asset_id = p_asset_id and status in ('active', 'publishing')) then
    return false;
  end if;
  update public.studio_revisions set storage_path = null where tenant_id = p_tenant_id and asset_id = p_asset_id;
  update public.studio_assets set purged_at = now(), status = 'discarded', source_path = null, updated_at = now()
  where tenant_id = p_tenant_id and id = p_asset_id and purged_at is null;
  return found;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'studio_quota_check(uuid)', 'studio_usage_summary(uuid)',
    'studio_publish_style(uuid, jsonb, text, uuid, integer)',
    'studio_create_asset(uuid, text, text, text, text, text, integer, integer, integer, uuid, uuid, text)',
    'studio_request_correction(uuid, uuid, uuid, text, uuid, uuid, text)',
    'studio_retry_revision(uuid, uuid)',
    'studio_claim_jobs(integer, uuid, integer)', 'studio_fail_exhausted_jobs()',
    'studio_finish_revision(uuid, uuid, boolean, jsonb, text, boolean, boolean)',
    'studio_decide_asset(uuid, uuid, text, uuid, text)',
    'studio_begin_usage(uuid, uuid, text, text, text, jsonb, uuid, text)',
    'studio_finish_usage(uuid, uuid, boolean, text, text[])',
    'studio_end_usage(uuid, uuid, text, uuid)',
    'studio_cleanup_candidates(integer)', 'studio_mark_purged(uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.studio_style_versions_guard() from public, anon, authenticated;

-- ─── 18. Capability, Journal d'activité, routage IA ──────────────────────────
insert into public.admin_permissions (key, module, label, description, risk_level, position) values
  ('studio.use', 'Contenu · Studio images', 'Utiliser le Studio images',
   'Créer des images depuis une photo ou une idée, les réviser et les approuver. Publier sur une destination demande aussi le droit de cette destination.',
   'standard', 195)
on conflict (key) do update set
  module = excluded.module, label = excluded.label, description = excluded.description,
  risk_level = excluded.risk_level, position = excluded.position, active = true;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, 'studio.use' from public.admin_roles r where r.code in ('platform_owner', 'tenant_admin')
on conflict do nothing;

insert into public.audit_event_types (key, module, category, default_severity, retention_class) values
  ('studio.asset.created', 'studio', 'activity', 'info', 'business'),
  ('studio.asset.approved', 'studio', 'activity', 'info', 'business'),
  ('studio.asset.discarded', 'studio', 'activity', 'info', 'business'),
  ('studio.usage.published', 'studio', 'activity', 'notice', 'business'),
  ('studio.usage.removed', 'studio', 'activity', 'notice', 'business'),
  ('studio.style.published', 'studio', 'activity', 'notice', 'business')
on conflict (key) do nothing;

-- Modèles d'images : routage par AI Core (priorité = ordre d'essai). Les
-- modèles d'images n'ont ni `chat` ni `structured_output` : le routeur de
-- Nala les ignore. `timeout_ms` n'est pas lu par le Studio (délai propre).
insert into public.ai_providers (key, name, provider_type, credential_ref)
values ('gemini', 'Google Gemini', 'gemini', 'GEMINI_API_KEY')
on conflict (key) do nothing;

insert into public.ai_models (provider_id, key, provider_model_id, display_name, capabilities, cost_class, config)
select p.id, m.key, m.model_id, m.label, m.caps::jsonb, m.cost_class, '{}'::jsonb
from public.ai_providers p
cross join (values
  ('gemini-2-5-flash-image', 'gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', '{"chat":false,"structured_output":false,"image_edit":true,"image_generation":true}', 'economy'),
  ('gemini-3-1-flash-image', 'gemini-3.1-flash-image-preview', 'Gemini 3.1 Flash Image', '{"chat":false,"structured_output":false,"image_edit":true,"image_generation":true}', 'balanced'),
  ('gemini-3-pro-image', 'gemini-3-pro-image-preview', 'Gemini 3 Pro Image', '{"chat":false,"structured_output":false,"image_edit":true,"image_generation":true}', 'precision')
) as m(key, model_id, label, caps, cost_class)
where p.key = 'gemini'
on conflict (key) do nothing;

-- Tarifs par image (1K) relevés sur la page tarifaire Google (09/2026), à
-- revérifier avant tout changement de politique ; 2.5 Flash Image existe déjà (027).
insert into public.ai_pricing (provider, model, input_price_per_million, output_price_per_million, image_price_flat) values
  ('gemini', 'gemini-3.1-flash-image-preview', 0.50, null, 0.067),
  ('gemini', 'gemini-3-pro-image-preview', 2.00, null, 0.134)
on conflict (provider, model) do nothing;

insert into public.ai_routing_policies (consumer, capability) values
  ('studio', 'photo_edit'), ('studio', 'prompt_generate')
on conflict (consumer, capability) do nothing;

-- Choix initial prudent (le moins cher, déjà utilisé par Lepefy) ; le défaut
-- définitif est fixé après le benchmark mesuré (docs/IMAGE_STUDIO.md §8).
insert into public.ai_routing_policy_models (policy_id, model_id, priority, timeout_ms)
select pol.id, m.id, x.priority, 18000
from public.ai_routing_policies pol
join (values ('gemini-2-5-flash-image', 1), ('gemini-3-1-flash-image', 2)) as x(model_key, priority) on true
join public.ai_models m on m.key = x.model_key
where pol.consumer = 'studio'
on conflict do nothing;

commit;

-- ─── Rollback (seulement si jamais utilisée) ─────────────────────────────────
-- begin;
-- delete from public.ai_routing_policies where consumer = 'studio';
-- delete from public.ai_pricing where model in ('gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview');
-- delete from public.ai_models where key in ('gemini-2-5-flash-image', 'gemini-3-1-flash-image', 'gemini-3-pro-image');
-- drop function if exists public.studio_mark_purged(uuid, uuid), public.studio_cleanup_candidates(integer),
--   public.studio_end_usage(uuid, uuid, text, uuid), public.studio_finish_usage(uuid, uuid, boolean, text, text[]),
--   public.studio_begin_usage(uuid, uuid, text, text, text, jsonb, uuid, text), public.studio_decide_asset(uuid, uuid, text, uuid, text),
--   public.studio_finish_revision(uuid, uuid, boolean, jsonb, text, boolean, boolean), public.studio_fail_exhausted_jobs(),
--   public.studio_claim_jobs(integer, uuid, integer), public.studio_retry_revision(uuid, uuid),
--   public.studio_request_correction(uuid, uuid, uuid, text, uuid, uuid, text),
--   public.studio_create_asset(uuid, text, text, text, text, text, integer, integer, integer, uuid, uuid, text),
--   public.studio_publish_style(uuid, jsonb, text, uuid, integer), public.studio_usage_summary(uuid), public.studio_quota_check(uuid);
-- drop table if exists public.studio_usages, public.studio_jobs;
-- alter table public.studio_assets drop constraint if exists studio_assets_approved_revision_fk;
-- drop table if exists public.studio_revisions, public.studio_assets, public.studio_tenant_settings, public.studio_style_versions;
-- drop function if exists public.studio_style_versions_guard();
-- delete from public.admin_role_permissions where permission_key = 'studio.use';
-- delete from public.admin_permissions where key = 'studio.use';
-- -- audit_event_types studio.* restent (référencés par audit_events, append-only).
-- -- Bucket : vider studio-private depuis le dashboard Storage, puis
-- -- delete from storage.buckets where id = 'studio-private';
-- delete from public.tenant_feature_flags where flag_key = 'image_studio';
-- commit;
