-- MIGRATION 174: LEPEFY HELP CENTER (docs/HELP_CENTER.md)
--
-- Additive and re-runnable. Platform-owned knowledge base (articles shared by
-- every tenant, optional tenant-specific articles), immutable published
-- revisions, context associations, minimised aggregate metrics.
--
-- NOT done here (on purpose, needs the requester's explicit approval):
--   * NO platform_plan_features row: the 'help_center' entitlement is NOT given
--     to the Base plan (nor to any tenant). Until then the module is inert in
--     production. Activation script: docs/HELP_CENTER.md §Rollout.
--   * NO Stripe product, NO change to subscriptions or payments.
--   * 'help_center_advanced' is registered inactive and attached to no plan.
--
-- Access model: RLS forced without policies, every grant explicit, service
-- role only (like migration 163). Tenants read exclusively through the
-- projection RPCs below, which return published content only.

begin;

-- ─── 1. Catalogue of commercial features (entitlement, NOT the release flag) ──
insert into public.platform_features (key, name, description, category, active, billable, position)
values
  ('help_center', 'Centre d''aide', 'Guides contextuels et recherche dans l''admin. Inclus dans le plan Base (non facturable pour le moment).', 'operations', true, false, 210),
  ('help_center_advanced', 'Centre d''aide avancé', 'Niveau avancé du Centre d''aide (réservé, non commercialisé).', 'operations', false, true, 211)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  billable = excluded.billable,
  position = excluded.position,
  updated_at = now();
-- `active` is deliberately not overwritten on conflict: a platform decision stays.

-- ─── 2. Capability ────────────────────────────────────────────────────────────
insert into public.admin_permissions (key, module, label, description, risk_level, position) values
  ('help.view', 'Administration · Aide', 'Consulter le Centre d''aide', 'Lire les guides et rechercher dans l''aide de l''admin.', 'standard', 190)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  risk_level = excluded.risk_level,
  position = excluded.position,
  active = true;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_roles r
cross join public.admin_permissions p
where r.code in ('platform_owner', 'tenant_admin')
  and p.key = 'help.view'
on conflict do nothing;

-- ─── 3. Articles ──────────────────────────────────────────────────────────────
create table if not exists public.help_articles (
  id uuid primary key default gen_random_uuid(),
  -- null = shared by every tenant (platform content); set = this tenant only.
  tenant_id uuid references public.tenants(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  module text not null check (module ~ '^[a-z0-9_-]{2,40}$'),
  min_level text not null default 'standard' check (min_level in ('standard', 'advanced')),
  required_permission text check (required_permission is null or required_permission ~ '^[a-z_]+\.[a-z_]+$'),
  required_flag text check (required_flag is null or required_flag ~ '^[a-z0-9_]{2,60}$'),
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  -- Version of the working copy (incremented at each publication).
  version integer not null default 1 check (version >= 1),
  -- Version served to tenants (null = never published).
  published_version integer,
  position integer not null default 100,
  last_editor_id uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists help_articles_slug_unique
  on public.help_articles (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
create index if not exists help_articles_status_idx on public.help_articles (status, module);

-- Working copy, one row per language. Never served to tenants.
create table if not exists public.help_article_translations (
  article_id uuid not null references public.help_articles(id) on delete cascade,
  locale text not null check (locale in ('fr', 'it', 'en')),
  title text not null check (length(title) between 1 and 160),
  summary text not null default '' check (length(summary) <= 400),
  -- Structured blocks validated by the application (lib/helpCenter/blocks.ts).
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array' and pg_column_size(blocks) <= 60000),
  search_text text not null default '' check (length(search_text) <= 20000),
  updated_at timestamptz not null default now(),
  primary key (article_id, locale)
);

-- Immutable published snapshots (one row per article × version × language).
create table if not exists public.help_article_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.help_articles(id) on delete cascade,
  locale text not null check (locale in ('fr', 'it', 'en')),
  version integer not null check (version >= 1),
  title text not null,
  summary text not null default '',
  blocks jsonb not null,
  search_text text not null default '',
  note text check (note is null or length(note) <= 300),
  published_by uuid,
  created_at timestamptz not null default now(),
  search_document tsvector generated always as (
    setweight(to_tsvector('french'::regconfig, coalesce(title, '')), 'A')
    || setweight(to_tsvector('french'::regconfig, coalesce(summary, '')), 'B')
    || setweight(to_tsvector('french'::regconfig, coalesce(search_text, '')), 'C')
  ) stored,
  unique (article_id, locale, version)
);
create index if not exists help_article_revisions_search_idx on public.help_article_revisions using gin (search_document);

create or replace function public.help_revision_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'help_revision_immutable';
end $$;

drop trigger if exists help_article_revisions_immutable on public.help_article_revisions;
create trigger help_article_revisions_immutable
  before update on public.help_article_revisions
  for each row execute function public.help_revision_immutable();
-- DELETE is allowed only through the article cascade (no direct grant to the API roles).

-- Where an article is offered. Route patterns never contain ids or query strings.
create table if not exists public.help_article_contexts (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.help_articles(id) on delete cascade,
  route_pattern text not null check (route_pattern ~ '^/admin(/[a-zA-Z0-9._~\[\]-]+)*(/\*)?$' and length(route_pattern) <= 200),
  action text check (action is null or action ~ '^[a-z_]{2,40}$'),
  priority integer not null default 100 check (priority between 0 and 1000)
);
create unique index if not exists help_article_contexts_unique
  on public.help_article_contexts (article_id, route_pattern, coalesce(action, ''));
create index if not exists help_article_contexts_route_idx on public.help_article_contexts (route_pattern);

-- ─── 4. Metrics: aggregates only (no visitor, order, customer or payment data) ─
create table if not exists public.help_article_daily (
  day date not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  article_id uuid not null references public.help_articles(id) on delete cascade,
  event text not null check (event in ('view', 'helpful', 'not_helpful', 'support_opened')),
  total integer not null default 0 check (total >= 0),
  primary key (day, tenant_id, article_id, event)
);

create table if not exists public.help_search_daily (
  day date not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- '' for a search that found something; the normalised term only when empty.
  term text not null default '' check (length(term) <= 60),
  empty boolean not null default false,
  total integer not null default 0 check (total >= 0),
  primary key (day, tenant_id, term, empty)
);

-- ─── 5. Privileges: RLS forced without policy, service role only ──────────────
alter table public.help_articles enable row level security;
alter table public.help_article_translations enable row level security;
alter table public.help_article_revisions enable row level security;
alter table public.help_article_contexts enable row level security;
alter table public.help_article_daily enable row level security;
alter table public.help_search_daily enable row level security;
alter table public.help_articles force row level security;
alter table public.help_article_translations force row level security;
alter table public.help_article_revisions force row level security;
alter table public.help_article_contexts force row level security;
alter table public.help_article_daily force row level security;
alter table public.help_search_daily force row level security;

revoke all on public.help_articles, public.help_article_translations, public.help_article_revisions,
  public.help_article_contexts, public.help_article_daily, public.help_search_daily
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on public.help_articles to service_role;
grant select, insert, update, delete on public.help_article_translations to service_role;
grant select, insert on public.help_article_revisions to service_role;
grant select, insert, update, delete on public.help_article_contexts to service_role;
grant select on public.help_article_daily to service_role;
grant select on public.help_search_daily to service_role;

-- ─── 6. Editorial workflow (mirrored in lib/helpCenter/rules.ts, parity-tested) ─
create or replace function public.help_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('draft', 'review'), ('draft', 'archived'),
    ('review', 'draft'), ('review', 'published'), ('review', 'archived'),
    ('published', 'published'), ('published', 'archived'),
    ('archived', 'draft')
  );
$$;

-- Moves an article through the workflow. Publishing (review/published →
-- published) snapshots every translation as an immutable revision and serves
-- it to tenants; it needs the French title and content.
create or replace function public.help_set_status(p_article_id uuid, p_to text, p_expected text, p_actor uuid, p_note text default null)
returns table (out_status text, out_version integer, out_published_version integer)
language plpgsql security definer set search_path = public as $$
declare
  a public.help_articles%rowtype;
  next_version integer;
begin
  select * into a from public.help_articles where id = p_article_id for update;
  if not found then raise exception 'help_article_not_found'; end if;
  if p_expected is not null and a.status <> p_expected then raise exception 'help_status_conflict'; end if;
  if not public.help_transition_allowed(a.status, p_to) then raise exception 'help_transition_forbidden'; end if;

  if p_to = 'published' then
    if not exists (select 1 from public.help_article_translations where article_id = a.id and locale = 'fr' and jsonb_array_length(blocks) > 0) then
      raise exception 'help_missing_french_content';
    end if;
    -- Never reuse a version number, even after an archive cleared published_version.
    select coalesce(max(version), 0) + 1 into next_version from public.help_article_revisions where article_id = a.id;
    insert into public.help_article_revisions (article_id, locale, version, title, summary, blocks, search_text, note, published_by)
    select t.article_id, t.locale, next_version, t.title, t.summary, t.blocks, t.search_text, left(p_note, 300), p_actor
    from public.help_article_translations t
    where t.article_id = a.id and jsonb_array_length(t.blocks) > 0;
    update public.help_articles
      set status = 'published', version = next_version, published_version = next_version,
          reviewed_by = p_actor, reviewed_at = now(), published_at = now(), updated_at = now()
      where id = a.id;
  else
    -- Leaving « published » (archive) stops serving the article; the revisions stay.
    update public.help_articles
      set status = p_to, last_editor_id = p_actor, updated_at = now(),
          published_version = case when p_to = 'archived' then null else published_version end
      where id = a.id;
  end if;

  return query select h.status, h.version, h.published_version from public.help_articles h where h.id = a.id;
end $$;

-- Restores a past revision into the working copy (does not publish).
create or replace function public.help_restore_revision(p_article_id uuid, p_version integer, p_actor uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare restored integer;
begin
  if not exists (select 1 from public.help_articles where id = p_article_id) then raise exception 'help_article_not_found'; end if;
  insert into public.help_article_translations (article_id, locale, title, summary, blocks, search_text, updated_at)
  select r.article_id, r.locale, r.title, r.summary, r.blocks, r.search_text, now()
  from public.help_article_revisions r
  where r.article_id = p_article_id and r.version = p_version
  on conflict (article_id, locale) do update set
    title = excluded.title, summary = excluded.summary, blocks = excluded.blocks,
    search_text = excluded.search_text, updated_at = now();
  get diagnostics restored = row_count;
  if restored = 0 then raise exception 'help_revision_not_found'; end if;
  update public.help_articles
    set last_editor_id = p_actor, updated_at = now(),
        status = case when status = 'published' then status else 'draft' end
    where id = p_article_id;
  return restored;
end $$;

-- ─── 7. Tenant projections: published content only, tenant-scoped ─────────────
-- Level (standard/advanced) is filtered here; capability and flag filters are
-- applied by the server (they depend on the caller). Never returns drafts.
create or replace function public.help_tenant_articles(p_tenant_id uuid, p_locale text, p_level text, p_slug text default null)
returns table (
  article_id uuid, slug text, module text, min_level text, required_permission text, required_flag text,
  sort_position integer, version integer, updated_at timestamptz, locale_used text, title text, summary text, blocks jsonb
)
language sql stable security definer set search_path = public as $$
  select a.id, a.slug, a.module, a.min_level, a.required_permission, a.required_flag,
         a.position, a.published_version, a.published_at, r.locale, r.title, r.summary, r.blocks
  from public.help_articles a
  join lateral (
    select * from public.help_article_revisions r
    where r.article_id = a.id and r.version = a.published_version and r.locale in (p_locale, 'fr')
    order by (r.locale = p_locale) desc
    limit 1
  ) r on true
  where a.status = 'published'
    and a.published_version is not null
    and (a.tenant_id is null or a.tenant_id = p_tenant_id)
    and (a.min_level = 'standard' or p_level = 'advanced')
    and (p_slug is null or a.slug = p_slug);
$$;

create or replace function public.help_tenant_search(p_tenant_id uuid, p_locale text, p_level text, p_query text, p_limit integer default 20)
returns table (article_id uuid, slug text, module text, required_permission text, required_flag text, locale_used text, title text, summary text, rank real)
language sql stable security definer set search_path = public as $$
  with q as (select websearch_to_tsquery('french'::regconfig, left(coalesce(p_query, ''), 80)) as tsq)
  select a.id, a.slug, a.module, a.required_permission, a.required_flag, r.locale, r.title, r.summary,
         ts_rank(r.search_document, q.tsq)
  from q, public.help_articles a
  join lateral (
    select * from public.help_article_revisions r
    where r.article_id = a.id and r.version = a.published_version and r.locale in (p_locale, 'fr')
    order by (r.locale = p_locale) desc
    limit 1
  ) r on true
  where a.status = 'published' and a.published_version is not null
    and (a.tenant_id is null or a.tenant_id = p_tenant_id)
    and (a.min_level = 'standard' or p_level = 'advanced')
    and r.search_document @@ q.tsq
  order by 9 desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- Associations of published articles to route patterns (matching is done in TS).
create or replace function public.help_tenant_contexts(p_tenant_id uuid)
returns table (article_id uuid, route_pattern text, action text, priority integer)
language sql stable security definer set search_path = public as $$
  select c.article_id, c.route_pattern, c.action, c.priority
  from public.help_article_contexts c
  join public.help_articles a on a.id = c.article_id
  where a.status = 'published' and a.published_version is not null
    and (a.tenant_id is null or a.tenant_id = p_tenant_id);
$$;

-- ─── 8. Metrics writers (idempotent counters, unknown ids are ignored) ────────
create or replace function public.help_record_event(p_tenant_id uuid, p_article_id uuid, p_event text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_event not in ('view', 'helpful', 'not_helpful', 'support_opened') then return false; end if;
  if not exists (
    select 1 from public.help_articles
    where id = p_article_id and status = 'published' and (tenant_id is null or tenant_id = p_tenant_id)
  ) then return false; end if;
  insert into public.help_article_daily (day, tenant_id, article_id, event, total)
  values ((now() at time zone 'Europe/Paris')::date, p_tenant_id, p_article_id, p_event, 1)
  on conflict (day, tenant_id, article_id, event) do update set total = help_article_daily.total + 1;
  return true;
end $$;

create or replace function public.help_record_search(p_tenant_id uuid, p_term text, p_empty boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare t text := case when p_empty then left(coalesce(p_term, ''), 60) else '' end;
begin
  if not exists (select 1 from public.tenants where id = p_tenant_id) then return false; end if;
  insert into public.help_search_daily (day, tenant_id, term, empty, total)
  values ((now() at time zone 'Europe/Paris')::date, p_tenant_id, t, coalesce(p_empty, false), 1)
  on conflict (day, tenant_id, term, empty) do update set total = help_search_daily.total + 1;
  return true;
end $$;

-- Retention: counters older than 180 days (called opportunistically by the app).
create or replace function public.help_purge_metrics()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; m integer;
begin
  delete from public.help_article_daily where day < (now() at time zone 'Europe/Paris')::date - 180;
  get diagnostics n = row_count;
  delete from public.help_search_daily where day < (now() at time zone 'Europe/Paris')::date - 180;
  get diagnostics m = row_count;
  return n + m;
end $$;

revoke all on function public.help_transition_allowed(text, text) from public, anon, authenticated;
revoke all on function public.help_set_status(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.help_restore_revision(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.help_tenant_articles(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.help_tenant_search(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.help_tenant_contexts(uuid) from public, anon, authenticated;
revoke all on function public.help_record_event(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.help_record_search(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.help_purge_metrics() from public, anon, authenticated;
grant execute on function public.help_transition_allowed(text, text) to service_role;
grant execute on function public.help_set_status(uuid, text, text, uuid, text) to service_role;
grant execute on function public.help_restore_revision(uuid, integer, uuid) to service_role;
grant execute on function public.help_tenant_articles(uuid, text, text, text) to service_role;
grant execute on function public.help_tenant_search(uuid, text, text, text, integer) to service_role;
grant execute on function public.help_tenant_contexts(uuid) to service_role;
grant execute on function public.help_record_event(uuid, uuid, text) to service_role;
grant execute on function public.help_record_search(uuid, text, boolean) to service_role;
grant execute on function public.help_purge_metrics() to service_role;

commit;

-- ─── ROLLBACK (manual, in a transaction; no other table depends on these) ─────
-- begin;
-- drop function if exists public.help_purge_metrics(), public.help_record_search(uuid, text, boolean),
--   public.help_record_event(uuid, uuid, text), public.help_tenant_contexts(uuid),
--   public.help_tenant_search(uuid, text, text, text, integer), public.help_tenant_articles(uuid, text, text, text),
--   public.help_restore_revision(uuid, integer, uuid), public.help_set_status(uuid, text, text, uuid, text),
--   public.help_transition_allowed(text, text), public.help_revision_immutable();
-- drop table if exists public.help_search_daily, public.help_article_daily, public.help_article_contexts,
--   public.help_article_revisions, public.help_article_translations, public.help_articles;
-- delete from public.admin_role_permissions where permission_key = 'help.view';
-- delete from public.admin_permissions where key = 'help.view';
-- delete from public.platform_features where key in ('help_center', 'help_center_advanced');
-- commit;
