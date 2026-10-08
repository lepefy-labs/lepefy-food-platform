-- MIGRATION 149: IMPORT DI CATALOGHI WHATSAPP ESTERNI (console platform)
--
-- Documentazione: docs/WHATSAPP_EXTERNAL_CATALOG_IMPORT.md
--
-- Principi:
-- * Additiva. Nessun prodotto o tenant esistente viene modificato dalla migration.
--   La funzione è usata solo dal platform owner (/admin/platform/catalogues-whatsapp)
--   e solo verso tenant con il feature flag di rilascio `external_catalog_import`.
-- * Fonte separata dal prodotto: il catalogo esterno vive in tabelle proprie;
--   `products` cambia solo tramite `external_catalog_apply_item`, campo per campo,
--   con audit (valore prima/dopo) nella stessa transazione.
-- * Isolamento tenant nel DB: ogni riferimento fra entità passa da FK composite
--   (tenant_id, id) — un item non può essere collegato a un prodotto di un altro tenant.
-- * Dati interni: RLS attiva e forzata SENZA policy, nessun privilegio per
--   anon/authenticated; accesso solo service_role. Audit append-only.
-- * RPC RETURNS TABLE con colonne out_*; scritture idempotenti con request_key
--   univoca per tenant; errori `raise exception '<code>'` mappati in francese lato app.
-- * Consenso del venditore: senza `consent_status = 'granted'` la lettura è
--   possibile, l'applicazione ai prodotti è rifiutata (`consent_required`).
--
-- Rollback (solo se mai usata in produzione): in fondo al file.

begin;

-- ─── 0. Prerequisito: chiave composita su products (già creata dalla 139) ────
do $$
begin
  if not exists (select 1 from pg_constraint c where c.conname = 'products_tenant_id_id_key') then
    alter table public.products add constraint products_tenant_id_id_key unique (tenant_id, id);
  end if;
end
$$;

-- ─── 1. Sorgenti: un catalogo WhatsApp di un venditore → un tenant di destinazione ───
create table if not exists public.external_catalog_sources (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  provider             text not null default 'green_api' check (provider in ('green_api')),
  label                text not null check (length(btrim(label)) between 1 and 200),
  source_url           text not null check (source_url ~ '^https://wa\.me/c/[0-9]{6,20}$'),
  seller_chat_id       text not null check (seller_chat_id ~ '^[0-9]{6,20}@c\.us$'),
  default_discount_pct numeric(5,2) not null default 0 check (default_discount_pct >= 0 and default_discount_pct <= 90),
  consent_status       text not null default 'missing' check (consent_status in ('missing', 'granted', 'revoked')),
  consent_note         text check (consent_note is null or length(consent_note) <= 2000),
  consent_recorded_at  timestamptz,
  consent_recorded_by  uuid references public.admin_users(id) on delete set null,
  status               text not null default 'active' check (status in ('active', 'archived')),
  last_fetched_at      timestamptz,
  last_fetch_status    text check (last_fetch_status is null or last_fetch_status in ('success', 'empty', 'failed')),
  last_fetch_error     text check (last_fetch_error is null or length(last_fetch_error) <= 500),
  last_fetch_truncated boolean not null default false,
  created_by           uuid references public.admin_users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint external_catalog_sources_tenant_id_id_key unique (tenant_id, id),
  constraint external_catalog_sources_tenant_seller_key unique (tenant_id, provider, seller_chat_id),
  constraint external_catalog_sources_consent_ck check (
    consent_status = 'missing' or (consent_recorded_at is not null)
  )
);

comment on table public.external_catalog_sources is
  'Catalogo WhatsApp Business di un venditore esterno, letto per un tenant di destinazione (console platform). Nessun token: le credenziali del provider sono solo variabili d''ambiente.';

-- ─── 2. Prodotti letti dalla sorgente ────────────────────────────────────────
create table if not exists public.external_catalog_items (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  source_id           uuid not null,
  provider_product_id text not null check (length(provider_product_id) between 1 and 200),
  raw                 jsonb not null,
  normalized          jsonb not null,
  content_hash        text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  displayed_price     numeric(12,2) check (displayed_price is null or displayed_price > 0),
  sale_price          numeric(12,2) check (sale_price is null or sale_price > 0),
  currency            text check (currency is null or currency ~ '^[A-Z]{3}$'),
  previous_price      numeric(12,2),
  price_changed_at    timestamptz,
  status              text not null default 'new' check (status in ('new', 'changed', 'linked', 'dismissed', 'unavailable')),
  linked_product_id   uuid,
  applied_hash        text check (applied_hash is null or applied_hash ~ '^[a-f0-9]{64}$'),
  applied_at          timestamptz,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  missing_since       timestamptz,
  updated_at          timestamptz not null default now(),
  constraint external_catalog_items_tenant_id_id_key unique (tenant_id, id),
  constraint external_catalog_items_source_product_key unique (source_id, provider_product_id),
  constraint external_catalog_items_source_fk foreign key (tenant_id, source_id)
    references public.external_catalog_sources (tenant_id, id) on delete cascade,
  constraint external_catalog_items_product_fk foreign key (tenant_id, linked_product_id)
    references public.products (tenant_id, id) on delete set null (linked_product_id)
);

create index if not exists external_catalog_items_source_status_idx
  on public.external_catalog_items (source_id, status);
create index if not exists external_catalog_items_linked_product_idx
  on public.external_catalog_items (tenant_id, linked_product_id) where linked_product_id is not null;

comment on table public.external_catalog_items is
  'Prodotto del catalogo esterno: raw del provider, normalizzazione Lepefy e stato di revisione. Mai una fonte diretta dello storefront.';

-- ─── 3. Audit append-only delle decisioni ────────────────────────────────────
create table if not exists public.external_catalog_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  item_id     uuid,
  source_id   uuid not null,
  product_id  uuid,
  action      text not null check (action in ('fetched', 'created', 'updated', 'linked', 'images_applied', 'dismissed', 'restored')),
  fields      jsonb not null default '{}'::jsonb,
  actor_id    uuid references public.admin_users(id) on delete set null,
  request_key text,
  created_at  timestamptz not null default now(),
  constraint external_catalog_events_source_fk foreign key (tenant_id, source_id)
    references public.external_catalog_sources (tenant_id, id) on delete cascade,
  constraint external_catalog_events_item_fk foreign key (tenant_id, item_id)
    references public.external_catalog_items (tenant_id, id) on delete cascade
);

create unique index if not exists external_catalog_events_tenant_request_key_idx
  on public.external_catalog_events (tenant_id, request_key) where request_key is not null;
create index if not exists external_catalog_events_item_idx
  on public.external_catalog_events (item_id, created_at desc);

-- ─── 4. Privilegi: solo service_role, audit append-only ─────────────────────
alter table public.external_catalog_sources enable row level security;
alter table public.external_catalog_sources force row level security;
alter table public.external_catalog_items enable row level security;
alter table public.external_catalog_items force row level security;
alter table public.external_catalog_events enable row level security;
alter table public.external_catalog_events force row level security;

revoke all on public.external_catalog_sources, public.external_catalog_items, public.external_catalog_events
  from public, anon, authenticated;
revoke all on public.external_catalog_sources, public.external_catalog_items, public.external_catalog_events
  from service_role;
grant select, insert, update on public.external_catalog_sources to service_role;
grant select, insert, update on public.external_catalog_items to service_role;
grant select, insert on public.external_catalog_events to service_role;

-- ─── 5. Helper ───────────────────────────────────────────────────────────────
create or replace function public.external_catalog_text(p_data jsonb, p_key text, p_max integer)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value text := nullif(btrim(p_data->>p_key), '');
begin
  if v_value is not null and length(v_value) > p_max then
    raise exception 'field_too_long:%', p_key;
  end if;
  return v_value;
end;
$$;

create or replace function public.external_catalog_int(p_data jsonb, p_key text, p_min integer, p_max integer)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_raw text := nullif(btrim(p_data->>p_key), '');
  v_value integer;
begin
  if v_raw is null then return null; end if;
  if v_raw !~ '^[0-9]{1,9}$' then raise exception 'invalid_integer:%', p_key; end if;
  v_value := v_raw::integer;
  if v_value < p_min or v_value > p_max then raise exception 'out_of_range:%', p_key; end if;
  return v_value;
end;
$$;

-- Slug univoco per tenant, stessa forma dello slug del catalogo admin.
create or replace function public.external_catalog_unique_slug(p_tenant_id uuid, p_name text)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_base text;
  v_slug text;
  v_n    integer := 1;
begin
  v_base := lower(translate(p_name,
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy'));
  v_base := regexp_replace(v_base, '[^a-z0-9\s-]', '', 'g');
  v_base := regexp_replace(btrim(v_base), '\s+', '-', 'g');
  v_base := regexp_replace(v_base, '-+', '-', 'g');
  v_base := btrim(v_base, '-');
  if v_base = '' then v_base := 'produit'; end if;
  v_base := left(v_base, 80);
  v_slug := v_base;
  while exists (select 1 from public.products p where p.tenant_id = p_tenant_id and p.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;

-- ─── 6. Registrazione di una lettura ─────────────────────────────────────────
-- p_items: [{ provider_product_id, raw, normalized, content_hash, displayed_price, sale_price, currency }]
-- Stato dopo la lettura:
--   dismissed resta dismissed; collegato → linked se il contenuto applicato è
--   invariato, altrimenti changed; non collegato → new.
--   Assenti dalla lettura → unavailable, SOLO se la lettura è completa (non troncata).
create or replace function public.external_catalog_record_fetch(
  p_tenant_id uuid,
  p_source_id uuid,
  p_items jsonb,
  p_fetched_at timestamptz,
  p_truncated boolean,
  p_actor uuid
)
returns table (out_new integer, out_changed integer, out_unchanged integer, out_unavailable integer)
language plpgsql
set search_path = public
as $$
declare
  v_source   public.external_catalog_sources%rowtype;
  v_item     jsonb;
  v_existing public.external_catalog_items%rowtype;
  v_pid      text;
  v_hash     text;
  v_price    numeric(12,2);
  v_status   text;
  v_new      integer := 0;
  v_changed  integer := 0;
  v_same     integer := 0;
  v_gone     integer := 0;
  v_seen     text[] := array[]::text[];
begin
  select s.* into v_source
  from public.external_catalog_sources s
  where s.id = p_source_id and s.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'source_not_found'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'items_must_be_array'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'too_many_items'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_pid := public.external_catalog_text(v_item, 'provider_product_id', 200);
    v_hash := v_item->>'content_hash';
    if v_pid is null then raise exception 'provider_product_id_required'; end if;
    if v_hash is null or v_hash !~ '^[a-f0-9]{64}$' then raise exception 'content_hash_invalid'; end if;
    if v_pid = any(v_seen) then continue; end if;
    v_seen := v_seen || v_pid;
    v_price := nullif(v_item->>'displayed_price', '')::numeric(12,2);

    select i.* into v_existing
    from public.external_catalog_items i
    where i.source_id = p_source_id and i.provider_product_id = v_pid
    for update;

    if not found then
      insert into public.external_catalog_items (
        tenant_id, source_id, provider_product_id, raw, normalized, content_hash,
        displayed_price, sale_price, currency, status, first_seen_at, last_seen_at
      ) values (
        p_tenant_id, p_source_id, v_pid, coalesce(v_item->'raw', '{}'::jsonb), coalesce(v_item->'normalized', '{}'::jsonb), v_hash,
        v_price, nullif(v_item->>'sale_price', '')::numeric(12,2), nullif(v_item->>'currency', ''), 'new', p_fetched_at, p_fetched_at
      );
      v_new := v_new + 1;
      continue;
    end if;

    v_status := case
      when v_existing.status = 'dismissed' then 'dismissed'
      when v_existing.linked_product_id is not null then
        case when v_existing.applied_hash = v_hash then 'linked' else 'changed' end
      else 'new'
    end;
    if v_existing.content_hash = v_hash and v_existing.status = v_status then
      v_same := v_same + 1;
    else
      v_changed := v_changed + 1;
    end if;

    update public.external_catalog_items i set
      raw              = coalesce(v_item->'raw', i.raw),
      normalized       = coalesce(v_item->'normalized', i.normalized),
      content_hash     = v_hash,
      previous_price   = case when v_price is distinct from i.displayed_price then i.displayed_price else i.previous_price end,
      price_changed_at = case when v_price is distinct from i.displayed_price then p_fetched_at else i.price_changed_at end,
      displayed_price  = v_price,
      sale_price       = nullif(v_item->>'sale_price', '')::numeric(12,2),
      currency         = nullif(v_item->>'currency', ''),
      status           = v_status,
      last_seen_at     = p_fetched_at,
      missing_since    = null,
      updated_at       = now()
    where i.id = v_existing.id;
  end loop;

  if not coalesce(p_truncated, false) then
    with gone as (
      update public.external_catalog_items i set
        status = 'unavailable',
        missing_since = coalesce(i.missing_since, p_fetched_at),
        updated_at = now()
      where i.source_id = p_source_id
        and i.tenant_id = p_tenant_id
        and i.status not in ('dismissed', 'unavailable')
        and not (i.provider_product_id = any(v_seen))
      returning 1
    )
    select count(*) into v_gone from gone;
  end if;

  update public.external_catalog_sources s set
    last_fetched_at = p_fetched_at,
    last_fetch_status = case when cardinality(v_seen) = 0 then 'empty' else 'success' end,
    last_fetch_error = null,
    last_fetch_truncated = coalesce(p_truncated, false),
    updated_at = now()
  where s.id = p_source_id;

  insert into public.external_catalog_events (tenant_id, source_id, action, fields, actor_id)
  values (p_tenant_id, p_source_id, 'fetched',
    jsonb_build_object('new', v_new, 'changed', v_changed, 'unchanged', v_same, 'unavailable', v_gone,
                       'received', cardinality(v_seen), 'truncated', coalesce(p_truncated, false)),
    p_actor);

  return query select v_new, v_changed, v_same, v_gone;
end;
$$;

-- ─── 7. Applicazione a un prodotto (creazione inattiva o aggiornamento) ─────
-- p_mode: 'create' | 'update'. p_fields: sottoinsieme di
--   name, description, price, min_order_quantity, order_quantity_step,
--   weight_grams, net_quantity_display, category_id.
-- Solo le chiavi presenti vengono scritte. Il prodotto creato nasce inattivo, stock 0.
create or replace function public.external_catalog_apply_item(
  p_tenant_id uuid,
  p_item_id uuid,
  p_mode text,
  p_product_id uuid,
  p_fields jsonb,
  p_request_key text,
  p_actor uuid
)
returns table (out_product_id uuid, out_created boolean, out_replayed boolean)
language plpgsql
set search_path = public
as $$
declare
  v_item      public.external_catalog_items%rowtype;
  v_source    public.external_catalog_sources%rowtype;
  v_previous  public.external_catalog_events%rowtype;
  v_product   jsonb;
  v_pid       uuid;
  v_key       text;
  v_diff      jsonb := '{}'::jsonb;
  v_name      text;
  v_desc      text;
  v_price     numeric(10,2);
  v_min       integer;
  v_step      integer;
  v_weight    integer;
  v_net       text;
  v_category  uuid;
  v_allowed   text[] := array['name', 'description', 'price', 'min_order_quantity', 'order_quantity_step',
                              'weight_grams', 'net_quantity_display', 'category_id'];
begin
  if p_request_key is null or length(p_request_key) not between 8 and 200 then
    raise exception 'request_key_required';
  end if;
  if p_mode not in ('create', 'update') then raise exception 'mode_invalid'; end if;
  if jsonb_typeof(coalesce(p_fields, 'null'::jsonb)) <> 'object' then raise exception 'fields_must_be_object'; end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not (v_key = any(v_allowed)) then raise exception 'field_not_allowed:%', v_key; end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('external_catalog_apply:' || p_tenant_id::text || ':' || p_request_key, 0));
  select e.* into v_previous
  from public.external_catalog_events e
  where e.tenant_id = p_tenant_id and e.request_key = p_request_key;
  if found then
    return query select v_previous.product_id, v_previous.action = 'created', true;
    return;
  end if;

  select i.* into v_item
  from public.external_catalog_items i
  where i.id = p_item_id and i.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'item_not_found'; end if;
  select s.* into v_source from public.external_catalog_sources s
  where s.id = v_item.source_id and s.tenant_id = p_tenant_id;
  if v_source.consent_status <> 'granted' then raise exception 'consent_required'; end if;
  if v_source.status <> 'active' then raise exception 'source_archived'; end if;
  if v_item.status = 'dismissed' then raise exception 'item_dismissed'; end if;
  if p_mode = 'create' and v_item.linked_product_id is not null then raise exception 'item_already_linked'; end if;

  -- Validazione (le chiavi assenti restano null = non modificate).
  v_name   := public.external_catalog_text(p_fields, 'name', 200);
  v_desc   := public.external_catalog_text(p_fields, 'description', 4000);
  v_net    := public.external_catalog_text(p_fields, 'net_quantity_display', 100);
  v_min    := public.external_catalog_int(p_fields, 'min_order_quantity', 1, 10000);
  v_step   := public.external_catalog_int(p_fields, 'order_quantity_step', 1, 10000);
  v_weight := public.external_catalog_int(p_fields, 'weight_grams', 1, 1000000);
  if p_fields ? 'price' then
    if coalesce(p_fields->>'price', '') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then raise exception 'price_invalid'; end if;
    v_price := (p_fields->>'price')::numeric(10,2);
    if v_price <= 0 then raise exception 'price_invalid'; end if;
  end if;
  if p_fields ? 'name' and v_name is null then raise exception 'name_required'; end if;
  if p_fields ? 'category_id' and nullif(p_fields->>'category_id', '') is not null then
    begin
      v_category := (p_fields->>'category_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'category_not_found';
    end;
    if not exists (select 1 from public.categories c where c.id = v_category and c.tenant_id = p_tenant_id) then
      raise exception 'category_not_found';
    end if;
  end if;

  if p_mode = 'create' then
    if v_name is null then raise exception 'name_required'; end if;
    if v_price is null then raise exception 'price_required'; end if;
    insert into public.products (
      tenant_id, category_id, name, slug, description, price, weight_grams, stock, active,
      min_order_quantity, order_quantity_step, net_quantity_display
    ) values (
      p_tenant_id, v_category, v_name, public.external_catalog_unique_slug(p_tenant_id, v_name), v_desc, v_price,
      v_weight, 0, false, coalesce(v_min, 1), coalesce(v_step, 1), v_net
    )
    returning id into v_pid;
    for v_key in select jsonb_object_keys(p_fields) loop
      v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('before', null, 'after', p_fields->v_key));
    end loop;
  else
    if p_product_id is null then raise exception 'product_required'; end if;
    select to_jsonb(p.*) into v_product
    from public.products p
    where p.id = p_product_id and p.tenant_id = p_tenant_id
    for update;
    if v_product is null then raise exception 'product_not_found'; end if;
    if exists (
      select 1 from public.external_catalog_items i
      where i.tenant_id = p_tenant_id and i.linked_product_id = p_product_id and i.id <> p_item_id
        and i.status <> 'dismissed'
    ) then
      raise exception 'product_already_linked';
    end if;
    v_pid := p_product_id;
    update public.products p set
      name                 = case when p_fields ? 'name' then v_name else p.name end,
      description          = case when p_fields ? 'description' then v_desc else p.description end,
      price                = case when p_fields ? 'price' then v_price else p.price end,
      min_order_quantity   = case when p_fields ? 'min_order_quantity' then coalesce(v_min, 1) else p.min_order_quantity end,
      order_quantity_step  = case when p_fields ? 'order_quantity_step' then coalesce(v_step, 1) else p.order_quantity_step end,
      weight_grams         = case when p_fields ? 'weight_grams' then v_weight else p.weight_grams end,
      net_quantity_display = case when p_fields ? 'net_quantity_display' then v_net else p.net_quantity_display end,
      category_id          = case when p_fields ? 'category_id' then v_category else p.category_id end,
      updated_at           = now()
    where p.id = v_pid and p.tenant_id = p_tenant_id;
    for v_key in select jsonb_object_keys(p_fields) loop
      v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('before', v_product->v_key, 'after', p_fields->v_key));
    end loop;
  end if;

  update public.external_catalog_items i set
    linked_product_id = v_pid,
    status = 'linked',
    applied_hash = i.content_hash,
    applied_at = now(),
    updated_at = now()
  where i.id = v_item.id;

  insert into public.external_catalog_events (tenant_id, item_id, source_id, product_id, action, fields, actor_id, request_key)
  values (p_tenant_id, v_item.id, v_item.source_id, v_pid,
          case when p_mode = 'create' then 'created' else 'updated' end, v_diff, p_actor, p_request_key);

  return query select v_pid, p_mode = 'create', false;
end;
$$;

-- ─── 8. Immagini copiate nello storage del tenant ────────────────────────────
-- p_images: [{ url, alt }] già caricate dall'app in tenants/<tenant>/products/<product>/.
-- Accodate senza duplicati (per url), massimo 8 (MAX_PRODUCT_IMAGES).
create or replace function public.external_catalog_attach_images(
  p_tenant_id uuid,
  p_item_id uuid,
  p_product_id uuid,
  p_images jsonb,
  p_request_key text,
  p_actor uuid
)
returns table (out_images jsonb, out_replayed boolean)
language plpgsql
set search_path = public
as $$
declare
  v_item     public.external_catalog_items%rowtype;
  v_current  jsonb;
  v_next     jsonb;
  v_img      jsonb;
  v_url      text;
  v_prefix   text := 'tenants/' || p_tenant_id::text || '/products/' || p_product_id::text || '/';
begin
  if p_request_key is null or length(p_request_key) not between 8 and 200 then
    raise exception 'request_key_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('external_catalog_images:' || p_tenant_id::text || ':' || p_request_key, 0));
  if exists (select 1 from public.external_catalog_events e where e.tenant_id = p_tenant_id and e.request_key = p_request_key) then
    select p.images into v_current from public.products p where p.id = p_product_id and p.tenant_id = p_tenant_id;
    return query select coalesce(v_current, '[]'::jsonb), true;
    return;
  end if;

  select i.* into v_item from public.external_catalog_items i
  where i.id = p_item_id and i.tenant_id = p_tenant_id for update;
  if not found then raise exception 'item_not_found'; end if;
  if v_item.linked_product_id is distinct from p_product_id then raise exception 'product_not_linked'; end if;
  if jsonb_typeof(p_images) <> 'array' then raise exception 'images_must_be_array'; end if;

  select coalesce(p.images, '[]'::jsonb) into v_current
  from public.products p where p.id = p_product_id and p.tenant_id = p_tenant_id for update;
  if not found then raise exception 'product_not_found'; end if;

  v_next := v_current;
  for v_img in select value from jsonb_array_elements(p_images) loop
    v_url := v_img->>'url';
    if v_url is null or position(v_prefix in v_url) = 0 then raise exception 'image_url_invalid'; end if;
    if jsonb_array_length(v_next) >= 8 then exit; end if;
    if not exists (select 1 from jsonb_array_elements(v_next) x where x->>'url' = v_url) then
      v_next := v_next || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('url', v_url, 'alt', left(v_img->>'alt', 180))));
    end if;
  end loop;

  update public.products p set
    images = v_next,
    image_url = coalesce(p.image_url, v_next->0->>'url'),
    updated_at = now()
  where p.id = p_product_id and p.tenant_id = p_tenant_id;

  insert into public.external_catalog_events (tenant_id, item_id, source_id, product_id, action, fields, actor_id, request_key)
  values (p_tenant_id, v_item.id, v_item.source_id, p_product_id, 'images_applied',
          jsonb_build_object('before', jsonb_array_length(v_current), 'after', jsonb_array_length(v_next)), p_actor, p_request_key);

  return query select v_next, false;
end;
$$;

-- ─── 9. Scarto / ripristino di un item ───────────────────────────────────────
create or replace function public.external_catalog_set_item_status(
  p_tenant_id uuid,
  p_item_id uuid,
  p_action text,
  p_actor uuid
)
returns table (out_status text)
language plpgsql
set search_path = public
as $$
declare
  v_item   public.external_catalog_items%rowtype;
  v_status text;
begin
  if p_action not in ('dismiss', 'restore') then raise exception 'action_invalid'; end if;
  select i.* into v_item from public.external_catalog_items i
  where i.id = p_item_id and i.tenant_id = p_tenant_id for update;
  if not found then raise exception 'item_not_found'; end if;

  if p_action = 'dismiss' then
    v_status := 'dismissed';
  else
    v_status := case
      when v_item.missing_since is not null then 'unavailable'
      when v_item.linked_product_id is not null then
        case when v_item.applied_hash = v_item.content_hash then 'linked' else 'changed' end
      else 'new'
    end;
  end if;
  if v_status = v_item.status then return query select v_status; return; end if;

  update public.external_catalog_items i set status = v_status, updated_at = now() where i.id = v_item.id;
  insert into public.external_catalog_events (tenant_id, item_id, source_id, product_id, action, actor_id)
  values (p_tenant_id, v_item.id, v_item.source_id, v_item.linked_product_id,
          case when p_action = 'dismiss' then 'dismissed' else 'restored' end, p_actor);
  return query select v_status;
end;
$$;

revoke all on function public.external_catalog_text(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.external_catalog_int(jsonb, text, integer, integer) from public, anon, authenticated;
revoke all on function public.external_catalog_unique_slug(uuid, text) from public, anon, authenticated;
revoke all on function public.external_catalog_record_fetch(uuid, uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;
revoke all on function public.external_catalog_apply_item(uuid, uuid, text, uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.external_catalog_attach_images(uuid, uuid, uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.external_catalog_set_item_status(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.external_catalog_record_fetch(uuid, uuid, jsonb, timestamptz, boolean, uuid) to service_role;
grant execute on function public.external_catalog_apply_item(uuid, uuid, text, uuid, jsonb, text, uuid) to service_role;
grant execute on function public.external_catalog_attach_images(uuid, uuid, uuid, jsonb, text, uuid) to service_role;
grant execute on function public.external_catalog_set_item_status(uuid, uuid, text, uuid) to service_role;

commit;

-- Rollback (solo se mai usata in produzione):
-- begin;
-- drop function if exists public.external_catalog_set_item_status(uuid, uuid, text, uuid);
-- drop function if exists public.external_catalog_attach_images(uuid, uuid, uuid, jsonb, text, uuid);
-- drop function if exists public.external_catalog_apply_item(uuid, uuid, text, uuid, jsonb, text, uuid);
-- drop function if exists public.external_catalog_record_fetch(uuid, uuid, jsonb, timestamptz, boolean, uuid);
-- drop function if exists public.external_catalog_unique_slug(uuid, text);
-- drop function if exists public.external_catalog_int(jsonb, text, integer, integer);
-- drop function if exists public.external_catalog_text(jsonb, text, integer);
-- drop table if exists public.external_catalog_events;
-- drop table if exists public.external_catalog_items;
-- drop table if exists public.external_catalog_sources;
-- commit;
-- (products_tenant_id_id_key resta: appartiene alla 139.)
