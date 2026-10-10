-- MIGRATION 153: JOURNAL D'ACTIVITÉ — AUDIT CENTRALIZZATO MULTI-TENANT
--
-- Documentazione: docs/ADMIN_ACTIVITY_AUDIT.md
--
-- Principi:
-- * Additiva e rieseguibile. Nessun dato esistente modificato, nessun backfill.
--   Le tabelle di audit storiche (business_audit_events, whatsapp_audit_events,
--   assisted_order_events, tenant_subscription_audit, review_moderation_events,
--   external_catalog_events, event_capacity_adjustments, admin_access_audit,
--   notification_deliveries) restano la fonte di verità del loro modulo: la vista
--   `audit_feed` le legge (adapter), non le copia.
-- * `audit_events` è append-only: service_role ha solo SELECT, ogni scrittura
--   passa da `record_audit_event` (security definer), un trigger rifiuta
--   UPDATE/DELETE/TRUNCATE (unica eccezione: `purge_audit_events`, non schedulata).
-- * Catalogo tipizzato: `event_type` è una FK verso `audit_event_types`; un tipo
--   sconosciuto o disattivato è rifiutato. Aggiungere un evento = una riga di
--   catalogo + una voce in lib/audit/eventCatalog.ts, mai una modifica di schema.
-- * Trigger nella stessa transazione della modifica business. Ordini, pagamenti,
--   prodotti, spedizioni, clienti, impostazioni moduli: FAIL-OPEN (savepoint; la
--   modifica business passa, il fallimento è contato in `audit_write_failures`).
--   RBAC, tenant, feature flag, metodi di pagamento: FAIL-CLOSED (l'errore annulla
--   la modifica).
-- * Attore: solo dagli header `x-lepefy-audit-*` di una richiesta PostgREST con
--   ruolo `service_role` (impostati dal server Next.js), oppure dedotto da colonne
--   della riga (created_by_admin_id, payment_confirmed_by, order_origin). In
--   mancanza: `unknown`, mai un autore inventato.
-- * Allow-list di campi: i valori prima/dopo sono registrati solo per i campi
--   dichiarati non sensibili; gli altri compaiono come « modifié » senza valore.
-- * RLS forzata senza policy; nessun privilegio per anon/authenticated.
--
-- Rollback (solo se mai usata in produzione): in fondo al file.

begin;

-- ─── 0. Impostazioni del modulo (singleton) ─────────────────────────────────
create table if not exists public.audit_settings (
  id             boolean primary key default true check (id),
  installed_at   timestamptz not null default now(),
  schema_version smallint not null default 1,
  -- Politiche di conservazione (consultazione). Nessuna cancellazione automatica:
  -- purge_audit_events non è schedulata (docs/ADMIN_ACTIVITY_AUDIT.md §10).
  retention      jsonb not null default '{"business": "24 months", "technical": "90 days", "security": "36 months"}'::jsonb
);
insert into public.audit_settings (id) values (true) on conflict (id) do nothing;

-- ─── 1. Catalogo eventi ──────────────────────────────────────────────────────
create table if not exists public.audit_event_types (
  key              text primary key check (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  module           text not null check (module ~ '^[a-z][a-z0-9_]{1,40}$'),
  category         text not null check (category in ('activity', 'automation', 'security')),
  default_severity text not null default 'info' check (default_severity in ('info', 'notice', 'warning', 'critical')),
  retention_class  text not null default 'business' check (retention_class in ('business', 'technical', 'security')),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

insert into public.audit_event_types (key, module, category, default_severity, retention_class) values
  ('orders.order.created',                  'orders',    'activity',   'info',     'business'),
  ('orders.order.status_changed',           'orders',    'activity',   'info',     'business'),
  ('orders.order.tracking_updated',         'orders',    'activity',   'info',     'business'),
  ('orders.order.updated',                  'orders',    'activity',   'info',     'business'),
  ('payments.payment.manually_confirmed',   'payments',  'activity',   'notice',   'business'),
  ('payments.payment.status_changed',       'payments',  'activity',   'info',     'business'),
  ('shipping.shipment.draft_requested',     'shipping',  'automation', 'info',     'technical'),
  ('shipping.shipment.draft_created',       'shipping',  'automation', 'info',     'business'),
  ('shipping.shipment.creation_failed',     'shipping',  'automation', 'warning',  'business'),
  ('shipping.shipment.creation_ambiguous',  'shipping',  'automation', 'critical', 'business'),
  ('shipping.shipment.draft_detached',      'shipping',  'automation', 'notice',   'business'),
  ('shipping.shipment.status_changed',      'shipping',  'automation', 'info',     'technical'),
  ('shipping.tracking.sync_failed',         'shipping',  'automation', 'warning',  'technical'),
  ('catalog.product.created',               'catalog',   'activity',   'info',     'business'),
  ('catalog.product.deleted',               'catalog',   'activity',   'notice',   'business'),
  ('catalog.product.price_updated',         'catalog',   'activity',   'info',     'business'),
  ('catalog.product.availability_changed',  'catalog',   'activity',   'info',     'business'),
  ('catalog.product.quantity_rule_changed', 'catalog',   'activity',   'info',     'business'),
  ('catalog.product.stock_adjusted',        'catalog',   'activity',   'info',     'business'),
  ('catalog.product.updated',               'catalog',   'activity',   'info',     'business'),
  ('customers.customer.created',            'customers', 'activity',   'info',     'business'),
  ('customers.customer.updated',            'customers', 'activity',   'info',     'business'),
  ('admin.settings.updated',                'admin',     'activity',   'notice',   'business'),
  ('admin.feature_flag.changed',            'admin',     'activity',   'notice',   'business'),
  ('admin.module_settings.changed',         'admin',     'activity',   'notice',   'business'),
  ('admin.payment_method.changed',          'admin',     'activity',   'notice',   'business'),
  ('security.permission.granted',           'security',  'security',   'warning',  'security'),
  ('security.permission.revoked',           'security',  'security',   'warning',  'security'),
  ('security.role.created',                 'security',  'security',   'warning',  'security'),
  ('security.role.updated',                 'security',  'security',   'warning',  'security'),
  ('security.membership.created',           'security',  'security',   'warning',  'security'),
  ('security.membership.updated',           'security',  'security',   'warning',  'security'),
  ('security.membership.deleted',           'security',  'security',   'warning',  'security'),
  ('security.admin.created',                'security',  'security',   'notice',   'security'),
  ('security.admin.updated',                'security',  'security',   'warning',  'security'),
  ('security.admin.deactivated',            'security',  'security',   'warning',  'security'),
  ('security.admin.reactivated',            'security',  'security',   'warning',  'security'),
  ('audit.export.generated',                'audit',     'security',   'notice',   'security'),
  ('audit.journal.cross_tenant_viewed',     'audit',     'security',   'notice',   'security')
on conflict (key) do update set
  module = excluded.module,
  category = excluded.category,
  default_severity = excluded.default_severity,
  retention_class = excluded.retention_class;

-- ─── 2. Registro ─────────────────────────────────────────────────────────────
-- tenant_id e actor_admin_id senza FK: il registro sopravvive alla cancellazione
-- della riga di riferimento (e un ON DELETE CASCADE urterebbe l'append-only).
create table if not exists public.audit_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid,
  event_type      text not null references public.audit_event_types(key) on update restrict on delete restrict,
  module          text not null,
  category        text not null check (category in ('activity', 'automation', 'security')),
  severity        text not null check (severity in ('info', 'notice', 'warning', 'critical')),
  outcome         text not null default 'success' check (outcome in ('success', 'failure', 'pending', 'unknown')),
  actor_type      text not null default 'unknown'
                    check (actor_type in ('admin', 'platform_owner', 'customer', 'system', 'provider', 'automation', 'unknown')),
  actor_admin_id  uuid,
  actor_label     text check (actor_label is null or length(actor_label) <= 120),
  actor_ref       text check (actor_ref is null or length(actor_ref) <= 160),
  resource_type   text check (resource_type is null or resource_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  resource_id     text check (resource_id is null or length(resource_id) <= 120),
  resource_label  text check (resource_label is null or length(resource_label) <= 160),
  changes         jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(changes) = 'array' and pg_column_size(changes) <= 16384),
  metadata        jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  correlation_id  text check (correlation_id is null or correlation_id ~ '^[A-Za-z0-9:._-]{1,100}$'),
  event_key       text check (event_key is null or length(event_key) between 3 and 200),
  source          text not null default 'sql' check (source in ('trigger', 'rpc', 'app', 'webhook', 'worker', 'sql')),
  schema_version  smallint not null default 1,
  retention_class text not null default 'business' check (retention_class in ('business', 'technical', 'security')),
  occurred_at     timestamptz not null default now(),
  recorded_at     timestamptz not null default now()
);

create index if not exists audit_events_tenant_time_idx on public.audit_events (tenant_id, occurred_at desc, id desc);
create index if not exists audit_events_resource_idx on public.audit_events (tenant_id, resource_type, resource_id, occurred_at desc);
create index if not exists audit_events_actor_idx on public.audit_events (tenant_id, actor_admin_id, occurred_at desc) where actor_admin_id is not null;
create index if not exists audit_events_attention_idx on public.audit_events (tenant_id, occurred_at desc)
  where outcome in ('failure', 'unknown') or severity in ('warning', 'critical');
create index if not exists audit_events_correlation_idx on public.audit_events (correlation_id) where correlation_id is not null;
create unique index if not exists audit_events_event_key_idx
  on public.audit_events (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), event_key)
  where event_key is not null;

-- Fallimenti di scrittura dei trigger fail-open: visibili e misurabili.
create table if not exists public.audit_write_failures (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  tenant_id   uuid,
  event_type  text,
  sqlstate    text,
  message     text check (message is null or length(message) <= 300)
);
create index if not exists audit_write_failures_time_idx on public.audit_write_failures (occurred_at desc);

-- ─── 3. Immutabilità ─────────────────────────────────────────────────────────
create or replace function public.audit_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and current_setting('lepefy.audit_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'audit_events_append_only' using errcode = '42501';
end
$$;

drop trigger if exists audit_events_no_update on public.audit_events;
create trigger audit_events_no_update before update or delete on public.audit_events
  for each row execute function public.audit_events_append_only();
drop trigger if exists audit_events_no_truncate on public.audit_events;
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function public.audit_events_append_only();

-- ─── 4. Contesto attore e helper ─────────────────────────────────────────────
-- Header impostati da lib/audit/requestContext.ts. PostgREST li espone nel GUC
-- `request.headers`; sono creduti solo se il JWT della richiesta è service_role
-- (un browser non possiede quella chiave).
create or replace function public.audit_request_context()
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_claims  jsonb;
  v_headers jsonb;
  v_role    text;
  v_type    text;
  v_id      text;
  v_label   text;
  v_ref     text;
  v_corr    text;
  v_source  text;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then v_claims := null;
  end;
  v_role := coalesce(v_claims->>'role', nullif(current_setting('request.jwt.claim.role', true), ''));
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then v_headers := null;
  end;

  if v_role = 'service_role' then
    v_type := v_headers->>'x-lepefy-audit-actor-type';
    if v_type is null or v_type not in ('admin', 'platform_owner', 'customer', 'system', 'provider', 'automation') then
      v_type := 'unknown';
    end if;
    v_id := v_headers->>'x-lepefy-audit-actor-id';
    if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_id := null; end if;
    begin
      v_label := left(convert_from(decode(v_headers->>'x-lepefy-audit-actor-label', 'base64'), 'UTF8'), 120);
    exception when others then v_label := null;
    end;
    v_ref := left(v_headers->>'x-lepefy-audit-actor-ref', 160);
    if v_ref !~ '^[A-Za-z0-9/:._\[\]-]{1,160}$' then v_ref := null; end if;
    v_corr := v_headers->>'x-lepefy-audit-correlation-id';
    if v_corr !~ '^[A-Za-z0-9:._-]{1,100}$' then v_corr := null; end if;
    v_source := v_headers->>'x-lepefy-audit-source';
    if v_source is null or v_source not in ('rpc', 'app', 'webhook', 'worker') then v_source := 'trigger'; end if;
    return jsonb_build_object('actor_type', v_type, 'actor_admin_id', v_id, 'actor_label', v_label,
      'actor_ref', v_ref, 'correlation_id', v_corr, 'source', v_source);
  elsif v_role = 'authenticated' then
    -- Cliente connesso via RLS: identità non registrata (dato personale).
    return jsonb_build_object('actor_type', 'customer', 'source', 'trigger');
  end if;
  -- SQL diretto (migration, dashboard Supabase, job interni): nessuna attribuzione.
  return jsonb_build_object('actor_type', 'unknown', 'source', 'sql');
end
$$;

create or replace function public.audit_admin_display_name(p_admin_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim(coalesce(j->>'first_name', '') || ' ' || coalesce(j->>'last_name', '')), ''),
    nullif(btrim(coalesce(j->>'nickname', '')), ''),
    'Administrateur')
  from (select to_jsonb(a) as j from public.admin_users a where a.id = p_admin_id) s
$$;

-- Valore registrabile: scalari interi, testo troncato, strutture riassunte.
create or replace function public.audit_clip(p_value jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p_value is null then 'null'::jsonb
    when jsonb_typeof(p_value) in ('number', 'boolean', 'null') then p_value
    when jsonb_typeof(p_value) = 'string' then to_jsonb(left(p_value #>> '{}', 160))
    else to_jsonb(left(p_value::text, 160))
  end
$$;

-- Differenze tra due righe limitate a una allow-list di campi. I campi fuori da
-- p_value_fields compaiono senza valore ({field, redacted: true}).
create or replace function public.audit_diff(p_old jsonb, p_new jsonb, p_fields text[], p_value_fields text[])
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(
    case when u.f = any(coalesce(p_value_fields, '{}'::text[]))
      then jsonb_build_object('field', u.f, 'before', public.audit_clip(p_old -> u.f), 'after', public.audit_clip(p_new -> u.f))
      else jsonb_build_object('field', u.f, 'redacted', true)
    end order by u.ord), '[]'::jsonb)
  from unnest(p_fields) with ordinality as u(f, ord)
  where (p_old -> u.f) is distinct from (p_new -> u.f)
$$;

-- ─── 5. Scrittura ────────────────────────────────────────────────────────────
-- Unico punto di scrittura. p_actor (facoltativo) sovrascrive i campi del
-- contesto richiesta (es. attore dedotto da una colonna della riga).
create or replace function public.record_audit_event(
  p_tenant_id      uuid,
  p_event_type     text,
  p_resource_type  text default null,
  p_resource_id    text default null,
  p_resource_label text default null,
  p_changes        jsonb default '[]'::jsonb,
  p_metadata       jsonb default '{}'::jsonb,
  p_outcome        text default 'success',
  p_severity       text default null,
  p_actor          jsonb default null,
  p_event_key      text default null,
  p_occurred_at    timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type     public.audit_event_types%rowtype;
  v_ctx      jsonb := public.audit_request_context() || coalesce(p_actor, '{}'::jsonb);
  v_actor    text := v_ctx->>'actor_type';
  v_admin    uuid;
  v_label    text := v_ctx->>'actor_label';
  v_role     text;
  v_changes  jsonb := coalesce(p_changes, '[]'::jsonb);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_id       uuid;
begin
  select * into v_type from public.audit_event_types where key = p_event_type;
  if not found or not v_type.active then
    raise exception 'audit_event_type_unknown:%', p_event_type using errcode = 'P0001';
  end if;

  if v_ctx->>'actor_admin_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_admin := (v_ctx->>'actor_admin_id')::uuid;
  end if;
  if v_actor is null or v_actor not in ('admin', 'platform_owner', 'customer', 'system', 'provider', 'automation', 'unknown') then
    v_actor := 'unknown';
  end if;
  if v_admin is not null then
    -- Il ruolo registrato viene dalla riga admin, non dall'header.
    select role into v_role from public.admin_users where id = v_admin;
    v_actor := case when v_role = 'platform_owner' then 'platform_owner' else 'admin' end;
    v_label := coalesce(v_label, public.audit_admin_display_name(v_admin));
  elsif v_actor in ('admin', 'platform_owner') then
    v_actor := 'unknown';
  end if;

  if jsonb_typeof(v_changes) <> 'array' then v_changes := '[]'::jsonb; end if;
  if jsonb_typeof(v_metadata) <> 'object' then v_metadata := '{}'::jsonb; end if;
  v_metadata := jsonb_strip_nulls(v_metadata);
  if pg_column_size(v_changes) > 15000 then
    v_changes := (select coalesce(jsonb_agg(jsonb_build_object('field', e->>'field', 'redacted', true)), '[]'::jsonb)
                  from jsonb_array_elements(v_changes) e);
    v_metadata := v_metadata || '{"changes_truncated": true}'::jsonb;
  end if;
  if pg_column_size(v_metadata) > 4000 then
    v_metadata := '{"metadata_truncated": true}'::jsonb;
  end if;

  insert into public.audit_events (
    tenant_id, event_type, module, category, severity, outcome, actor_type, actor_admin_id, actor_label, actor_ref,
    resource_type, resource_id, resource_label, changes, metadata, correlation_id, event_key, source,
    retention_class, occurred_at
  ) values (
    p_tenant_id, v_type.key, v_type.module, v_type.category,
    case when p_severity in ('info', 'notice', 'warning', 'critical') then p_severity else v_type.default_severity end,
    case when p_outcome in ('success', 'failure', 'pending', 'unknown') then p_outcome else 'success' end,
    v_actor, v_admin, left(v_label, 120), left(v_ctx->>'actor_ref', 160),
    p_resource_type, left(p_resource_id, 120), left(p_resource_label, 160), v_changes, v_metadata,
    case when v_ctx->>'correlation_id' ~ '^[A-Za-z0-9:._-]{1,100}$' then v_ctx->>'correlation_id' end,
    p_event_key,
    case when v_ctx->>'source' in ('trigger', 'rpc', 'app', 'webhook', 'worker', 'sql') then v_ctx->>'source' else 'sql' end,
    v_type.retention_class, coalesce(p_occurred_at, now())
  )
  on conflict do nothing
  returning id into v_id;
  return v_id;
end
$$;

-- Scrittura dai trigger: p_strict = false → savepoint, la modifica business passa.
create or replace function public.audit_emit(
  p_strict         boolean,
  p_tenant_id      uuid,
  p_event_type     text,
  p_resource_type  text,
  p_resource_id    text,
  p_resource_label text,
  p_changes        jsonb,
  p_metadata       jsonb,
  p_outcome        text default 'success',
  p_severity       text default null,
  p_actor          jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_strict then
    perform public.record_audit_event(p_tenant_id, p_event_type, p_resource_type, p_resource_id, p_resource_label,
      p_changes, p_metadata, p_outcome, p_severity, p_actor);
    return;
  end if;
  begin
    perform public.record_audit_event(p_tenant_id, p_event_type, p_resource_type, p_resource_id, p_resource_label,
      p_changes, p_metadata, p_outcome, p_severity, p_actor);
  exception when others then
    perform public.audit_note_failure(p_tenant_id, p_event_type, sqlstate, sqlerrm);
  end;
end
$$;

create or replace function public.audit_note_failure(p_tenant_id uuid, p_event_type text, p_sqlstate text, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.audit_write_failures (tenant_id, event_type, sqlstate, message)
    values (p_tenant_id, left(p_event_type, 80), p_sqlstate, left(p_message, 300));
  exception when others then null;
  end;
  raise warning 'audit write failed: % % %', p_event_type, p_sqlstate, left(p_message, 200);
end
$$;

-- ─── 6. Trigger: ordini, pagamenti, spedizioni (fail-open) ──────────────────
create or replace function public.audit_orders_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n        jsonb := to_jsonb(new);
  o        jsonb;
  v_tenant uuid := new.tenant_id;
  v_id     text := new.id::text;
  v_label  text := '#' || upper(left(new.id::text, 8));
  v_actor  jsonb;
  v_diff   jsonb;
  v_event  text;
  v_new    text;
  v_old    text;
begin
  begin
    if tg_op = 'INSERT' then
      v_actor := case
        when n->>'created_by_admin_id' is not null
          then jsonb_build_object('actor_type', 'admin', 'actor_admin_id', n->>'created_by_admin_id')
        when coalesce(n->>'order_origin', 'storefront') = 'storefront'
          then jsonb_build_object('actor_type', 'customer', 'actor_admin_id', null, 'actor_label', null,
                                  'actor_ref', coalesce(n->>'payment_confirmation_source', 'checkout'))
        else null
      end;
      perform public.audit_emit(false, v_tenant, 'orders.order.created', 'order', v_id, v_label, '[]'::jsonb,
        jsonb_build_object('origin', n->>'order_origin', 'sales_channel', n->>'sales_channel',
          'fulfillment_type', n->>'fulfillment_type', 'payment_method', n->>'payment_method',
          'payment_status', n->>'payment_status', 'total', n->'total', 'is_test', n->'is_test'),
        'success', null, v_actor);
      if n->>'payment_confirmation_source' in ('admin_verified', 'admin_recorded') then
        perform public.audit_emit(false, v_tenant, 'payments.payment.manually_confirmed', 'order', v_id, v_label, '[]'::jsonb,
          jsonb_build_object('confirmation_source', n->>'payment_confirmation_source', 'payment_method', n->>'payment_method',
            'external_payment_type', n->>'external_payment_type', 'received_at', n->>'payment_received_at',
            'reference', left(n->>'payment_reference', 60), 'has_note', (n->>'payment_note') is not null, 'total', n->'total'),
          'success', null,
          case when n->>'payment_confirmed_by' is not null
            then jsonb_build_object('actor_type', 'admin', 'actor_admin_id', n->>'payment_confirmed_by')
            else jsonb_build_object('actor_type', 'unknown', 'actor_admin_id', null, 'actor_label', null) end);
      end if;
      return null;
    end if;

    o := to_jsonb(old);

    if (o->'status') is distinct from (n->'status') then
      perform public.audit_emit(false, v_tenant, 'orders.order.status_changed', 'order', v_id, v_label,
        public.audit_diff(o, n, array['status'], array['status']),
        jsonb_build_object('fulfillment_type', n->>'fulfillment_type'));
    end if;

    if (o->'payment_status') is distinct from (n->'payment_status') then
      perform public.audit_emit(false, v_tenant, 'payments.payment.status_changed', 'order', v_id, v_label,
        public.audit_diff(o, n, array['payment_status'], array['payment_status']),
        jsonb_build_object('payment_method', n->>'payment_method'),
        case when n->>'payment_status' = 'failed' then 'failure' else 'success' end,
        case when n->>'payment_status' = 'failed' then 'warning' end);
    end if;

    if (o->>'payment_confirmation_source') is distinct from (n->>'payment_confirmation_source')
       and n->>'payment_confirmation_source' in ('admin_verified', 'admin_recorded') then
      perform public.audit_emit(false, v_tenant, 'payments.payment.manually_confirmed', 'order', v_id, v_label, '[]'::jsonb,
        jsonb_build_object('confirmation_source', n->>'payment_confirmation_source', 'payment_method', n->>'payment_method',
          'external_payment_type', n->>'external_payment_type', 'received_at', n->>'payment_received_at',
          'reference', left(n->>'payment_reference', 60), 'has_note', (n->>'payment_note') is not null, 'total', n->'total'),
        'success', null,
        case when n->>'payment_confirmed_by' is not null
          then jsonb_build_object('actor_type', 'admin', 'actor_admin_id', n->>'payment_confirmed_by') end);
    end if;

    v_diff := public.audit_diff(o, n, array['tracking_code', 'tracking_carrier', 'shipping_tracking_mode'],
      array['tracking_code', 'tracking_carrier', 'shipping_tracking_mode']);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'orders.order.tracking_updated', 'order', v_id, v_label, v_diff, '{}'::jsonb);
    end if;

    v_diff := public.audit_diff(o, n,
      array['fulfillment_type', 'subtotal', 'shipping_cost', 'total', 'full_name', 'email', 'shipping_address', 'notes'],
      array['fulfillment_type', 'subtotal', 'shipping_cost', 'total']);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'orders.order.updated', 'order', v_id, v_label, v_diff, '{}'::jsonb);
    end if;

    v_old := o->>'shipping_creation_status';
    v_new := n->>'shipping_creation_status';
    if v_old is distinct from v_new then
      v_event := case
        when v_new = 'pending' then 'shipping.shipment.draft_requested'
        when v_new = 'draft_created' then 'shipping.shipment.draft_created'
        when v_new = 'failed' then 'shipping.shipment.creation_failed'
        when v_new = 'ambiguous' then 'shipping.shipment.creation_ambiguous'
        when v_old = 'draft_created' and (v_new is null or v_new = 'not_required') then 'shipping.shipment.draft_detached'
        else null
      end;
      if v_event is not null then
        perform public.audit_emit(false, v_tenant, v_event, 'order', v_id, v_label,
          public.audit_diff(o, n, array['shipping_creation_status'], array['shipping_creation_status']),
          jsonb_build_object('attempts', n->'shipping_creation_attempts', 'error', left(n->>'shipping_creation_error', 160),
            'provider', n->>'shipping_provider_key', 'provider_reference', left(n->>'shipping_provider_reference', 60)),
          case v_new when 'failed' then 'failure' when 'ambiguous' then 'unknown' else 'success' end);
      end if;
    end if;

    if (o->'shipping_normalized_status') is distinct from (n->'shipping_normalized_status') and n->>'shipping_normalized_status' is not null then
      perform public.audit_emit(false, v_tenant, 'shipping.shipment.status_changed', 'order', v_id, v_label,
        public.audit_diff(o, n, array['shipping_normalized_status'], array['shipping_normalized_status']),
        jsonb_build_object('provider', n->>'shipping_provider_key', 'provider_status', left(n->>'shipping_provider_status', 60)),
        case when n->>'shipping_normalized_status' in ('exception', 'returned', 'cancelled') then 'failure' else 'success' end,
        case when n->>'shipping_normalized_status' in ('exception', 'returned', 'cancelled') then 'warning' end);
    end if;

    if o->>'shipping_sync_error' is null and n->>'shipping_sync_error' is not null then
      perform public.audit_emit(false, v_tenant, 'shipping.tracking.sync_failed', 'order', v_id, v_label, '[]'::jsonb,
        jsonb_build_object('error', left(n->>'shipping_sync_error', 160), 'provider', n->>'shipping_provider_key'),
        'failure');
    end if;
  exception when others then
    perform public.audit_note_failure(v_tenant, 'orders.*', sqlstate, sqlerrm);
  end;
  return null;
end
$$;

drop trigger if exists audit_orders_insert on public.orders;
create trigger audit_orders_insert after insert on public.orders
  for each row execute function public.audit_orders_trigger();
drop trigger if exists audit_orders_update on public.orders;
create trigger audit_orders_update after update on public.orders
  for each row
  when (
    (old.status, old.payment_status, old.payment_confirmation_source, old.tracking_code, old.tracking_carrier,
     old.shipping_tracking_mode, old.fulfillment_type, old.subtotal, old.shipping_cost, old.total, old.full_name,
     old.email, old.shipping_address, old.notes, old.shipping_creation_status, old.shipping_normalized_status,
     old.shipping_sync_error)
    is distinct from
    (new.status, new.payment_status, new.payment_confirmation_source, new.tracking_code, new.tracking_carrier,
     new.shipping_tracking_mode, new.fulfillment_type, new.subtotal, new.shipping_cost, new.total, new.full_name,
     new.email, new.shipping_address, new.notes, new.shipping_creation_status, new.shipping_normalized_status,
     new.shipping_sync_error)
  )
  execute function public.audit_orders_trigger();

-- ─── 7. Trigger: catalogo (fail-open) ───────────────────────────────────────
-- Lo stock è registrato solo per un attore admin: i decrementi del checkout
-- restano tracciati da ordini e righe d'ordine (nessun rumore per vendita).
create or replace function public.audit_products_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n        jsonb;
  o        jsonb;
  v_row    jsonb := to_jsonb(coalesce(new, old));
  v_tenant uuid := (v_row->>'tenant_id')::uuid;
  v_id     text := v_row->>'id';
  v_label  text := left(v_row->>'name', 160);
  v_diff   jsonb;
  v_ctx    jsonb;
begin
  begin
    if tg_op = 'INSERT' then
      n := to_jsonb(new);
      perform public.audit_emit(false, v_tenant, 'catalog.product.created', 'product', v_id, v_label, '[]'::jsonb,
        jsonb_build_object('price', n->'price', 'active', n->'active', 'stock', n->'stock'));
      return null;
    elsif tg_op = 'DELETE' then
      perform public.audit_emit(false, v_tenant, 'catalog.product.deleted', 'product', v_id, v_label, '[]'::jsonb, '{}'::jsonb);
      return null;
    end if;

    n := to_jsonb(new);
    o := to_jsonb(old);
    v_diff := public.audit_diff(o, n, array['price', 'compare_at_price'], array['price', 'compare_at_price']);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'catalog.product.price_updated', 'product', v_id, v_label, v_diff, '{}'::jsonb);
    end if;
    v_diff := public.audit_diff(o, n, array['active'], array['active']);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'catalog.product.availability_changed', 'product', v_id, v_label, v_diff, '{}'::jsonb);
    end if;
    v_diff := public.audit_diff(o, n, array['min_order_quantity', 'order_quantity_step'], array['min_order_quantity', 'order_quantity_step']);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'catalog.product.quantity_rule_changed', 'product', v_id, v_label, v_diff, '{}'::jsonb);
    end if;
    if (o->'stock') is distinct from (n->'stock') then
      v_ctx := public.audit_request_context();
      if v_ctx->>'actor_type' in ('admin', 'platform_owner') then
        perform public.audit_emit(false, v_tenant, 'catalog.product.stock_adjusted', 'product', v_id, v_label,
          public.audit_diff(o, n, array['stock'], array['stock']), '{}'::jsonb);
      end if;
    end if;
    v_diff := public.audit_diff(o, n,
      array['name', 'name_alt', 'slug', 'category_id', 'featured', 'weight_grams', 'storage_type', 'is_homemade',
            'country_of_origin', 'net_quantity_display', 'gluten_free_certified', 'description', 'image_url', 'images',
            'ingredients_text', 'allergens_text', 'usage_instructions', 'conservation_instructions', 'conservation_after_opening'],
      array['name', 'name_alt', 'slug', 'category_id', 'featured', 'weight_grams', 'storage_type', 'is_homemade',
            'country_of_origin', 'net_quantity_display', 'gluten_free_certified']);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'catalog.product.updated', 'product', v_id, v_label, v_diff, '{}'::jsonb);
    end if;
  exception when others then
    perform public.audit_note_failure(v_tenant, 'catalog.*', sqlstate, sqlerrm);
  end;
  return null;
end
$$;

drop trigger if exists audit_products_insert_delete on public.products;
create trigger audit_products_insert_delete after insert or delete on public.products
  for each row execute function public.audit_products_trigger();
drop trigger if exists audit_products_update on public.products;
create trigger audit_products_update after update on public.products
  for each row
  when (
    (old.price, old.compare_at_price, old.active, old.min_order_quantity, old.order_quantity_step, old.stock,
     old.name, old.name_alt, old.slug, old.category_id, old.featured, old.weight_grams, old.storage_type,
     old.is_homemade, old.country_of_origin, old.net_quantity_display, old.gluten_free_certified,
     old.description, old.image_url, old.images, old.ingredients_text, old.allergens_text, old.usage_instructions,
     old.conservation_instructions, old.conservation_after_opening)
    is distinct from
    (new.price, new.compare_at_price, new.active, new.min_order_quantity, new.order_quantity_step, new.stock,
     new.name, new.name_alt, new.slug, new.category_id, new.featured, new.weight_grams, new.storage_type,
     new.is_homemade, new.country_of_origin, new.net_quantity_display, new.gluten_free_certified,
     new.description, new.image_url, new.images, new.ingredients_text, new.allergens_text, new.usage_instructions,
     new.conservation_instructions, new.conservation_after_opening)
  )
  execute function public.audit_products_trigger();

-- ─── 8. Trigger: clienti (fail-open, solo modifiche fatte da un admin) ──────
-- Mai valori personali: solo i nomi dei campi modificati.
create or replace function public.audit_customers_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx    jsonb := public.audit_request_context();
  v_tenant uuid := new.tenant_id;
  v_label  text := 'Client #' || upper(left(new.id::text, 8));
  v_diff   jsonb;
begin
  if coalesce(v_ctx->>'actor_type', 'unknown') not in ('admin', 'platform_owner') then
    return null;
  end if;
  begin
    if tg_op = 'INSERT' then
      perform public.audit_emit(false, v_tenant, 'customers.customer.created', 'customer', new.id::text, v_label, '[]'::jsonb,
        jsonb_build_object('source', to_jsonb(new)->>'source'));
      return null;
    end if;
    v_diff := public.audit_diff(to_jsonb(old), to_jsonb(new),
      array['full_name', 'email', 'phone', 'source', 'loyalty_card_number', 'referral_access_granted', 'referral_suspended',
            'is_ambassador', 'ambassador_first_name', 'ambassador_last_name', 'ambassador_payment_method', 'ambassador_iban',
            'ambassador_paypal_email'],
      array['source', 'referral_access_granted', 'referral_suspended', 'is_ambassador', 'ambassador_payment_method']);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'customers.customer.updated', 'customer', new.id::text, v_label, v_diff, '{}'::jsonb);
    end if;
  exception when others then
    perform public.audit_note_failure(v_tenant, 'customers.*', sqlstate, sqlerrm);
  end;
  return null;
end
$$;

drop trigger if exists audit_customers_change on public.customers;
create trigger audit_customers_change after insert or update on public.customers
  for each row execute function public.audit_customers_trigger();

-- ─── 9. Trigger: configurazione tenant (fail-closed salvo moduli) ───────────
create or replace function public.audit_tenants_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_diff jsonb;
begin
  v_diff := public.audit_diff(to_jsonb(old), to_jsonb(new),
    array['name', 'slug', 'tagline', 'active', 'storefront_ready', 'storefront_url', 'currency', 'locale', 'locales',
          'countries_served', 'city', 'country', 'primary_color', 'secondary_color', 'accent_light', 'logo_url',
          'hero_image_url', 'app_icon_url', 'label_logo_url', 'whatsapp_number', 'google_review_url', 'google_maps_url',
          'click_collect_enabled', 'click_collect_address', 'click_collect_hours', 'click_collect_hours_it',
          'shipping_provider', 'shipping_pricing_mode', 'shipping_tariff_fallback', 'shipping_public_grid_enabled',
          'flat_rate_amount', 'packlink_api_key', 'stripe_account_id', 'events_enabled', 'services_enabled',
          'rental_delivery_enabled', 'rental_delivery_countries', 'show_powered_by', 'ai_image_generation',
          'ai_description_generation', 'ai_semantic_search', 'ai_rate_limit_public_per_minute', 'ai_rate_limit_public_per_day',
          'ai_rate_limit_admin_per_day', 'catalogue_search_threshold', 'chatbox_extra_context', 'story_heading', 'story_text',
          'story_image_url', 'legal_name', 'legal_address', 'legal_email', 'legal_website',
          'ambassador_min_purchase_amount', 'ambassador_min_commission_amount', 'ambassador_max_commission_amount',
          'ambassador_loyalty_from_second_order', 'ambassador_first_order_discount_type', 'ambassador_first_order_discount_value',
          'ambassador_payout_threshold_amount', 'ambassador_commission_mode', 'ambassador_split_pool_amount',
          'ambassador_split_pool_ambassador_percent', 'android_package_name', 'android_sha256_fingerprint', 'android_public'],
    array['name', 'slug', 'tagline', 'active', 'storefront_ready', 'storefront_url', 'currency', 'locale', 'locales',
          'countries_served', 'city', 'country', 'primary_color', 'secondary_color', 'accent_light', 'whatsapp_number',
          'google_review_url', 'click_collect_enabled', 'shipping_provider', 'shipping_pricing_mode', 'shipping_tariff_fallback',
          'shipping_public_grid_enabled', 'flat_rate_amount', 'events_enabled', 'services_enabled', 'rental_delivery_enabled',
          'rental_delivery_countries', 'show_powered_by', 'ai_image_generation', 'ai_description_generation', 'ai_semantic_search',
          'ai_rate_limit_public_per_minute', 'ai_rate_limit_public_per_day', 'ai_rate_limit_admin_per_day',
          'catalogue_search_threshold', 'legal_name', 'legal_website', 'ambassador_min_purchase_amount',
          'ambassador_min_commission_amount', 'ambassador_max_commission_amount', 'ambassador_loyalty_from_second_order',
          'ambassador_first_order_discount_type', 'ambassador_first_order_discount_value', 'ambassador_payout_threshold_amount',
          'ambassador_commission_mode', 'ambassador_split_pool_amount', 'ambassador_split_pool_ambassador_percent',
          'android_package_name', 'android_public']);
  if jsonb_array_length(v_diff) > 0 then
    perform public.audit_emit(true, new.id, 'admin.settings.updated', 'tenant', new.id::text, left(new.name, 160), v_diff, '{}'::jsonb);
  end if;
  return null;
end
$$;

drop trigger if exists audit_tenants_update on public.tenants;
create trigger audit_tenants_update after update on public.tenants
  for each row when (to_jsonb(old) - 'updated_at' is distinct from to_jsonb(new) - 'updated_at')
  execute function public.audit_tenants_trigger();

create or replace function public.audit_feature_flags_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  if tg_op = 'UPDATE' and old.enabled is not distinct from new.enabled then return null; end if;
  perform public.audit_emit(true, (v_row->>'tenant_id')::uuid, 'admin.feature_flag.changed', 'feature_flag', v_row->>'flag_key',
    v_row->>'flag_key',
    jsonb_build_array(jsonb_build_object('field', 'enabled',
      'before', case when tg_op = 'INSERT' then 'null'::jsonb else to_jsonb(old.enabled) end,
      'after', case when tg_op = 'DELETE' then 'null'::jsonb else to_jsonb(new.enabled) end)),
    jsonb_build_object('operation', lower(tg_op)));
  return null;
end
$$;

drop trigger if exists audit_feature_flags_change on public.tenant_feature_flags;
create trigger audit_feature_flags_change after insert or update or delete on public.tenant_feature_flags
  for each row execute function public.audit_feature_flags_trigger();

create or replace function public.audit_feature_settings_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    jsonb := to_jsonb(coalesce(new, old));
  v_tenant uuid := (v_row->>'tenant_id')::uuid;
  v_old    jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else coalesce(to_jsonb(old)->'config', '{}'::jsonb) end;
  v_new    jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else coalesce(to_jsonb(new)->'config', '{}'::jsonb) end;
  v_diff   jsonb;
begin
  begin
    v_diff := case when tg_op = 'UPDATE'
      then public.audit_diff(to_jsonb(old), to_jsonb(new), array['enabled'], array['enabled'])
      else jsonb_build_array(jsonb_build_object('field', 'enabled',
        'before', case when tg_op = 'INSERT' then 'null'::jsonb else to_jsonb(old)->'enabled' end,
        'after', case when tg_op = 'DELETE' then 'null'::jsonb else to_jsonb(new)->'enabled' end)) end;
    -- Configurazione: solo i nomi delle chiavi modificate.
    v_diff := v_diff || coalesce((
      select jsonb_agg(jsonb_build_object('field', 'config.' || k, 'redacted', true) order by k)
      from (select jsonb_object_keys(v_old) as k union select jsonb_object_keys(v_new)) keys
      where (v_old -> k) is distinct from (v_new -> k)), '[]'::jsonb);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'admin.module_settings.changed', 'module_settings', v_row->>'feature_key',
        v_row->>'feature_key', v_diff, jsonb_build_object('operation', lower(tg_op)));
    end if;
  exception when others then
    perform public.audit_note_failure(v_tenant, 'admin.module_settings.changed', sqlstate, sqlerrm);
  end;
  return null;
end
$$;

drop trigger if exists audit_feature_settings_change on public.tenant_feature_settings;
create trigger audit_feature_settings_change after insert or update or delete on public.tenant_feature_settings
  for each row execute function public.audit_feature_settings_trigger();

create or replace function public.audit_payment_methods_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  jsonb := to_jsonb(coalesce(new, old));
  v_diff jsonb;
begin
  v_diff := public.audit_diff(case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end,
    case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end,
    array['method', 'label', 'active', 'sort_order', 'value', 'extra'],
    array['method', 'label', 'active', 'sort_order']);
  if jsonb_array_length(v_diff) > 0 then
    perform public.audit_emit(true, (v_row->>'tenant_id')::uuid, 'admin.payment_method.changed', 'payment_method', v_row->>'id',
      left(coalesce(v_row->>'label', v_row->>'method'), 160), v_diff, jsonb_build_object('operation', lower(tg_op)));
  end if;
  return null;
end
$$;

drop trigger if exists audit_payment_methods_change on public.tenant_payment_methods;
create trigger audit_payment_methods_change after insert or update or delete on public.tenant_payment_methods
  for each row execute function public.audit_payment_methods_trigger();

-- ─── 10. Capability del modulo (prima dei trigger RBAC) ─────────────────────
-- L'accesso dei tenant è inoltre condizionato dal flag `activity_journal`,
-- attivabile solo dal platform owner (lib/featureFlags/featureFlagRegistry.ts).
insert into public.admin_permissions (key, module, label, description, risk_level, position) values
  ('audit.view', 'Journal d’activité', 'Consulter le journal d’activité', 'Voir l’historique des actions et des automatisations des modules accessibles.', 'standard', 600),
  ('audit.export', 'Journal d’activité', 'Exporter le journal d’activité', 'Télécharger le journal filtré au format CSV.', 'sensitive', 601),
  ('audit.security.view', 'Journal d’activité', 'Consulter les événements de sécurité', 'Voir les modifications de rôles, d’accès et les exports du journal.', 'sensitive', 602),
  ('platform.audit.view', 'Plateforme', 'Journal d’activité de toutes les boutiques', 'Consulter le journal d’activité de chaque boutique et les événements de plateforme.', 'critical', 603)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  risk_level = excluded.risk_level,
  position = excluded.position;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, pk.key
from public.admin_roles r
cross join (values ('audit.view'), ('audit.export'), ('audit.security.view')) as pk(key)
where r.code in ('platform_owner', 'tenant_admin')
on conflict do nothing;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, 'platform.audit.view' from public.admin_roles r where r.code = 'platform_owner'
on conflict do nothing;

-- ─── 11. Trigger: RBAC (fail-closed) ────────────────────────────────────────
create or replace function public.audit_role_permissions_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select c.role_id, ar.code, ar.name, array_agg(c.permission_key order by c.permission_key) as keys
    from changed_rows c left join public.admin_roles ar on ar.id = c.role_id
    group by c.role_id, ar.code, ar.name
  loop
    perform public.audit_emit(true, null,
      case when tg_argv[0] = 'granted' then 'security.permission.granted' else 'security.permission.revoked' end,
      'admin_role', r.role_id::text, left(coalesce(r.name, r.code), 160), '[]'::jsonb,
      jsonb_build_object('role_code', r.code, 'permissions', to_jsonb(r.keys[1:100]), 'count', cardinality(r.keys)));
  end loop;
  return null;
end
$$;

drop trigger if exists audit_role_permissions_insert on public.admin_role_permissions;
create trigger audit_role_permissions_insert after insert on public.admin_role_permissions
  referencing new table as changed_rows
  for each statement execute function public.audit_role_permissions_trigger('granted');
drop trigger if exists audit_role_permissions_delete on public.admin_role_permissions;
create trigger audit_role_permissions_delete after delete on public.admin_role_permissions
  referencing old table as changed_rows
  for each statement execute function public.audit_role_permissions_trigger('revoked');

create or replace function public.audit_roles_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_diff jsonb := public.audit_diff(case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end, to_jsonb(new),
    array['code', 'name', 'description', 'scope', 'active'], array['code', 'name', 'scope', 'active']);
begin
  if jsonb_array_length(v_diff) > 0 then
    perform public.audit_emit(true, null, case when tg_op = 'INSERT' then 'security.role.created' else 'security.role.updated' end,
      'admin_role', new.id::text, left(new.name, 160), v_diff, jsonb_build_object('role_code', new.code));
  end if;
  return null;
end
$$;

drop trigger if exists audit_roles_change on public.admin_roles;
create trigger audit_roles_change after insert or update on public.admin_roles
  for each row execute function public.audit_roles_trigger();

create or replace function public.audit_memberships_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      jsonb := to_jsonb(coalesce(new, old));
  v_old_role text;
  v_new_role text;
  v_changes  jsonb := '[]'::jsonb;
  v_event    text;
begin
  if tg_op <> 'INSERT' then select code into v_old_role from public.admin_roles where id = old.role_id; end if;
  if tg_op <> 'DELETE' then select code into v_new_role from public.admin_roles where id = new.role_id; end if;
  if v_old_role is distinct from v_new_role then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'role', 'before', to_jsonb(v_old_role), 'after', to_jsonb(v_new_role)));
  end if;
  if tg_op = 'UPDATE' and old.active is distinct from new.active then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'active', 'before', to_jsonb(old.active), 'after', to_jsonb(new.active)));
  end if;
  if tg_op = 'UPDATE' and jsonb_array_length(v_changes) = 0 then return null; end if;
  v_event := case tg_op when 'INSERT' then 'security.membership.created' when 'DELETE' then 'security.membership.deleted'
    else 'security.membership.updated' end;
  perform public.audit_emit(true, (v_row->>'tenant_id')::uuid, v_event, 'admin_user', v_row->>'user_id',
    public.audit_admin_display_name((v_row->>'user_id')::uuid), v_changes,
    jsonb_build_object('role_code', coalesce(v_new_role, v_old_role), 'membership_id', v_row->>'id'));
  return null;
end
$$;

drop trigger if exists audit_memberships_change on public.admin_memberships;
create trigger audit_memberships_change after insert or update or delete on public.admin_memberships
  for each row execute function public.audit_memberships_trigger();

create or replace function public.audit_admin_users_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'security.admin.created';
  elsif old.active is distinct from new.active then
    v_event := case when new.active then 'security.admin.reactivated' else 'security.admin.deactivated' end;
  else
    v_event := 'security.admin.updated';
  end if;
  perform public.audit_emit(true, new.tenant_id, v_event, 'admin_user', new.id::text, public.audit_admin_display_name(new.id),
    public.audit_diff(case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end, to_jsonb(new),
      array['role', 'tenant_id', 'active'], array['role', 'tenant_id', 'active']),
    '{}'::jsonb);
  return null;
end
$$;

drop trigger if exists audit_admin_users_insert on public.admin_users;
create trigger audit_admin_users_insert after insert on public.admin_users
  for each row execute function public.audit_admin_users_trigger();
drop trigger if exists audit_admin_users_update on public.admin_users;
create trigger audit_admin_users_update after update on public.admin_users
  for each row when ((old.active, old.role, old.tenant_id) is distinct from (new.active, new.role, new.tenant_id))
  execute function public.audit_admin_users_trigger();

-- ─── 12. Lettura unificata: eventi nuovi + adapter delle fonti storiche ─────
-- Nessuna copia: ogni ramo legge la tabella d'origine, con l'identificatore
-- originale prefissato dalla fonte (nessun duplicato possibile).
-- La vista è composta qui sotto: ogni adapter è incluso solo se la sua tabella
-- esiste (moduli la cui migration non è ancora applicata). Applicare più tardi
-- la migration di un modulo = rieseguire questa migration (idempotente).
do $view$
declare
  v_sql text := $q$
select 'ae:' || e.id::text as id, 'audit_events'::text as source, e.tenant_id, e.event_type, e.module, e.category,
       e.severity, e.outcome, e.actor_type, e.actor_admin_id, e.actor_label, e.actor_ref, e.resource_type, e.resource_id,
       e.resource_label, e.changes, e.metadata, e.correlation_id, e.occurred_at, e.recorded_at, e.schema_version::int as schema_version
from public.audit_events e
$q$;
  v_branch record;
begin
  for v_branch in select * from (values
    ('business_audit_events', $q$
select 'ba:' || b.id::text, 'business_audit_events', b.tenant_id, 'gestion.' || b.event_type,
       case when b.entity_type in ('supplier', 'document') then 'gestion_suppliers'
            when b.entity_type in ('purchase', 'receipt') then 'gestion_purchases'
            when b.entity_type = 'inventory' then 'gestion_inventory'
            else 'gestion_treasury' end,
       'activity', 'info', 'success', case when b.actor_admin_id is null then 'unknown' else 'admin' end,
       b.actor_admin_id, null, null, b.entity_type, b.entity_id::text, left(b.metadata->>'reference', 160),
       '[]'::jsonb, b.metadata, null, b.created_at, b.created_at, 0
from public.business_audit_events b
$q$),
    ('whatsapp_audit_events', $q$
select 'wa:' || w.id::text, 'whatsapp_audit_events', w.tenant_id, 'whatsapp.conversation.' || w.event_type, 'whatsapp',
       case when w.actor_type = 'system' then 'automation' else 'activity' end, 'info', 'success',
       case when w.actor_type = 'admin' and w.actor_admin_id is not null then 'admin'
            when w.actor_type in ('system', 'customer') then w.actor_type else 'unknown' end,
       w.actor_admin_id, null, null, 'whatsapp_conversation', w.conversation_id::text, null,
       '[]'::jsonb, w.detail, null, w.created_at, w.created_at, 0
from public.whatsapp_audit_events w
$q$),
    ('assisted_order_events', $q$
select 'ao:' || a.id::text, 'assisted_order_events', a.tenant_id, 'orders.preorder.' || a.event_type, 'orders',
       case when a.actor_type = 'system' then 'automation' else 'activity' end,
       case when a.event_type in ('stock_conflict', 'duplicate_payment', 'amount_mismatch') then 'warning' else 'info' end,
       case when a.event_type in ('stock_conflict', 'duplicate_payment', 'amount_mismatch') then 'failure' else 'success' end,
       case when a.actor_type = 'admin' and a.actor_admin_id is not null then 'admin'
            when a.actor_type in ('system', 'customer') then a.actor_type else 'unknown' end,
       a.actor_admin_id, null, null,
       case when a.order_id is not null then 'order' else 'preorder' end,
       coalesce(a.order_id, a.checkout_session_id)::text,
       case when a.order_id is not null then '#' || upper(left(a.order_id::text, 8)) end,
       '[]'::jsonb, a.detail || jsonb_build_object('checkout_session_id', a.checkout_session_id), null, a.created_at, a.created_at, 0
from public.assisted_order_events a
$q$),
    ('tenant_subscription_audit', $q$
select 'ts:' || s.id::text, 'tenant_subscription_audit', s.tenant_id, 'billing.subscription.' || s.action, 'platform_billing',
       'activity', 'notice', 'success', case when s.actor_admin_id is null then 'unknown' else 'admin' end,
       s.actor_admin_id, null, null, 'tenant_subscription', s.tenant_id::text, null,
       '[]'::jsonb, jsonb_strip_nulls(jsonb_build_object('module_key', s.module_key, 'reason', left(s.reason, 200),
         'before', s.before_state, 'after', s.after_state)), null, s.created_at, s.created_at, 0
from public.tenant_subscription_audit s
$q$),
    ('review_moderation_events', $q$
select 'rv:' || r.id::text, 'review_moderation_events', r.tenant_id,
       'reviews.review.' || regexp_replace(lower(r.action), '[^a-z0-9_]', '_', 'g'), 'reviews',
       case when r.actor_type = 'system' then 'automation' else 'activity' end, 'info', 'success',
       case when r.actor_type = 'admin' and r.actor_user_id is not null then 'admin'
            when r.actor_type in ('system', 'customer') then r.actor_type else 'unknown' end,
       r.actor_user_id, null, null, 'review', r.review_id::text, null,
       case when r.previous_status is distinct from r.next_status
         then jsonb_build_array(jsonb_build_object('field', 'status', 'before', r.previous_status, 'after', r.next_status))
         else '[]'::jsonb end,
       jsonb_strip_nulls(jsonb_build_object('reason_code', r.reason_code)), null, r.created_at, r.created_at, 0
from public.review_moderation_events r
$q$),
    ('external_catalog_events', $q$
select 'xc:' || x.id::text, 'external_catalog_events', x.tenant_id, 'catalog.external_import.' || x.action, 'external_catalog',
       'activity', 'info', 'success', case when x.actor_id is null then 'unknown' else 'admin' end,
       x.actor_id, null, null, case when x.product_id is not null then 'product' else 'external_catalog_item' end,
       coalesce(x.product_id, x.item_id, x.source_id)::text, null, '[]'::jsonb,
       jsonb_build_object('fields', coalesce((select jsonb_agg(t.k) from jsonb_object_keys(x.fields) as t(k)), '[]'::jsonb),
         'source_id', x.source_id), null, x.created_at, x.created_at, 0
from public.external_catalog_events x
$q$),
    ('event_capacity_adjustments', $q$
select 'cp:' || c.id::text, 'event_capacity_adjustments', c.tenant_id, 'events.event.capacity_adjusted', 'events',
       'activity', 'notice', 'success', case when c.changed_by is null then 'unknown' else 'admin' end,
       c.changed_by, null, null, 'event', c.event_id::text, null,
       jsonb_build_array(jsonb_build_object('field', 'capacity_total', 'before', c.previous_capacity, 'after', c.new_capacity)),
       jsonb_strip_nulls(jsonb_build_object('delta', c.delta, 'reason', left(c.reason, 200))), null, c.created_at, c.created_at, 0
from public.event_capacity_adjustments c
$q$),
    ('notification_deliveries', $q$
select 'nd:' || d.id::text, 'notification_deliveries', d.tenant_id,
       case when d.status = 'dead' then 'notifications.delivery.abandoned' else 'notifications.delivery.failed' end,
       'notifications', 'automation', case when d.status = 'dead' then 'critical' else 'warning' end, 'failure',
       'automation', null, null, 'n8n', 'notification', d.id::text, left(d.notification_type, 160), '[]'::jsonb,
       jsonb_build_object('notification_type', d.notification_type, 'attempts', d.attempts, 'max_attempts', d.max_attempts,
         'error', left(d.last_error, 160)), null, d.updated_at, d.updated_at, 0
from public.notification_deliveries d
where d.status in ('failed', 'dead')
$q$),
    ('admin_access_audit', $q$
-- admin_access_audit: solo le righe anteriori all'installazione (dopo, i trigger
-- RBAC sono la fonte). Gli stati prima/dopo non sono esposti (contengono e-mail).
select 'aa:' || l.id::text, 'admin_access_audit', l.tenant_id,
       'security.legacy.' || regexp_replace(lower(l.action), '[^a-z0-9_]', '_', 'g'), 'security', 'security', 'warning', 'success',
       case when l.actor_user_id is null then 'unknown' else 'admin' end,
       l.actor_user_id, null, null, regexp_replace(lower(l.target_type), '[^a-z0-9_]', '_', 'g'), left(l.target_id, 120), null,
       '[]'::jsonb, '{}'::jsonb, null, l.created_at, l.created_at, 0
from public.admin_access_audit l
where l.created_at < (select installed_at from public.audit_settings where id)
$q$)
  ) as b(tbl, branch) loop
    if to_regclass('public.' || v_branch.tbl) is not null then
      v_sql := v_sql || E'\nunion all\n' || v_branch.branch;
    end if;
  end loop;
  execute 'create or replace view public.audit_feed with (security_invoker = true) as ' || v_sql;
end
$view$;

-- Filtri → clausola WHERE. Ogni valore passa da %L (nessuna interpolazione
-- grezza). Senza moduli o senza perimetro tenant: nessuna riga (fail-closed).
create or replace function public.audit_feed_where(p jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  w       text[] := array[]::text[];
  v_text  text;
  v_like  text;
  v_uuid  constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_key   text;
begin
  p := coalesce(p, '{}'::jsonb);
  if coalesce((p->>'all_tenants')::boolean, false) then
    if not coalesce((p->>'include_platform')::boolean, false) then w := w || 'tenant_id is not null'; end if;
  else
    if jsonb_typeof(p->'tenant_ids') is distinct from 'array' or jsonb_array_length(p->'tenant_ids') = 0 then return 'false'; end if;
    if exists (select 1 from jsonb_array_elements_text(p->'tenant_ids') t where t !~ v_uuid) then return 'false'; end if;
    w := w || format('(tenant_id = any(%L::uuid[])%s)',
      array(select jsonb_array_elements_text(p->'tenant_ids'))::text,
      case when coalesce((p->>'include_platform')::boolean, false) then ' or tenant_id is null' else '' end);
  end if;

  if jsonb_typeof(p->'modules') is distinct from 'array' or jsonb_array_length(p->'modules') = 0 then return 'false'; end if;
  w := w || format('module = any(%L::text[])', array(select jsonb_array_elements_text(p->'modules'))::text);

  foreach v_key in array array['categories:category', 'event_types:event_type', 'actor_types:actor_type', 'outcomes:outcome', 'severities:severity'] loop
    if jsonb_typeof(p->split_part(v_key, ':', 1)) = 'array' and jsonb_array_length(p->split_part(v_key, ':', 1)) > 0 then
      w := w || format('%I = any(%L::text[])', split_part(v_key, ':', 2),
        array(select jsonb_array_elements_text(p->split_part(v_key, ':', 1)))::text);
    end if;
  end loop;

  if p->>'actor_admin_id' is not null then
    if p->>'actor_admin_id' !~ v_uuid then return 'false'; end if;
    w := w || format('actor_admin_id = %L::uuid', p->>'actor_admin_id');
  end if;
  if p->>'from' is not null then w := w || format('occurred_at >= %L::timestamptz', p->>'from'); end if;
  if p->>'to' is not null then w := w || format('occurred_at < %L::timestamptz', p->>'to'); end if;
  if p->>'resource_type' is not null then w := w || format('resource_type = %L', p->>'resource_type'); end if;
  if p->>'resource_id' is not null then w := w || format('resource_id = %L', p->>'resource_id'); end if;
  if p->>'correlation_id' is not null then w := w || format('correlation_id = %L', p->>'correlation_id'); end if;
  if p->>'id' is not null then w := w || format('id = %L', p->>'id'); end if;

  v_text := nullif(btrim(p->>'search'), '');
  if v_text is not null then
    v_like := '%' || replace(replace(replace(v_text, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    w := w || format('(resource_label ilike %L or id = %L or id = %L or resource_id = %L or correlation_id = %L or event_type ilike %L or actor_label ilike %L)',
      v_like, v_text, 'ae:' || v_text, v_text, v_text, v_like, v_like);
  end if;

  if p->>'cursor_at' is not null and p->>'cursor_id' is not null then
    w := w || format('(occurred_at, id) %s (%L::timestamptz, %L)',
      case when coalesce((p->>'ascending')::boolean, false) then '>' else '<' end, p->>'cursor_at', p->>'cursor_id');
  end if;

  return coalesce(nullif(array_to_string(w, ' and '), ''), 'true');
end
$$;

create or replace function public.audit_feed_page(p_filters jsonb, p_limit integer default 25, p_offset integer default 0)
returns setof public.audit_feed
language plpgsql
stable
set search_path = public
as $$
begin
  return query execute format('select * from public.audit_feed where %s order by occurred_at %s, id %s limit %s offset %s',
    public.audit_feed_where(p_filters),
    case when coalesce((p_filters->>'ascending')::boolean, false) then 'asc' else 'desc' end,
    case when coalesce((p_filters->>'ascending')::boolean, false) then 'asc' else 'desc' end,
    least(greatest(coalesce(p_limit, 25), 1), 500),
    least(greatest(coalesce(p_offset, 0), 0), 20000));
end
$$;

create or replace function public.audit_feed_count(p_filters jsonb, p_cap integer default 10000)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_count integer;
begin
  execute format('select count(*)::int from (select 1 from public.audit_feed where %s limit %s) s',
    public.audit_feed_where(p_filters), least(greatest(coalesce(p_cap, 10000), 1), 100000) + 1)
  into v_count;
  return v_count;
end
$$;

create or replace function public.audit_feed_summary(p_filters jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  execute format($q$
    select jsonb_build_object(
      'total', count(*),
      'failures', count(*) filter (where outcome in ('failure', 'unknown')),
      'critical', count(*) filter (where severity = 'critical'),
      'warnings', count(*) filter (where severity in ('warning', 'critical')),
      'actors', count(distinct actor_admin_id),
      'automation_failures', count(*) filter (where category = 'automation' and outcome in ('failure', 'unknown')),
      'capped', count(*) > 100000)
    from (select outcome, severity, actor_admin_id, category from public.audit_feed where %s limit 100001) s
  $q$, public.audit_feed_where(p_filters))
  into v_result;
  return v_result;
end
$$;

create or replace function public.audit_feed_actors(p_filters jsonb)
returns table (actor_admin_id uuid, actor_label text)
language plpgsql
stable
set search_path = public
as $$
begin
  return query execute format(
    'select f.actor_admin_id, max(coalesce(f.actor_label, public.audit_admin_display_name(f.actor_admin_id))) '
    || 'from (select actor_admin_id, actor_label from public.audit_feed where %s and actor_admin_id is not null limit 20000) f '
    || 'group by f.actor_admin_id order by 2 limit 200',
    public.audit_feed_where(p_filters));
end
$$;

-- ─── 13. Volume e conservazione ─────────────────────────────────────────────
create or replace view public.audit_volume_stats
with (security_invoker = true)
as
select tenant_id, date_trunc('month', recorded_at) as month, retention_class, count(*) as events,
       sum(pg_column_size(changes) + pg_column_size(metadata)) as payload_bytes
from public.audit_events
group by tenant_id, date_trunc('month', recorded_at), retention_class;

-- NON schedulata. Senza p_confirm = 'PURGE' restituisce solo i conteggi.
-- Eseguibile solo da SQL (proprietario), mai dall'applicazione.
create or replace function public.purge_audit_events(p_confirm text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retention jsonb := (select retention from public.audit_settings where id);
  v_counts    jsonb;
  v_deleted   integer := 0;
begin
  select coalesce(jsonb_object_agg(retention_class, n), '{}'::jsonb) into v_counts from (
    select retention_class, count(*) as n from public.audit_events
    where recorded_at < now() - (v_retention->>retention_class)::interval
    group by retention_class) s;
  if p_confirm is distinct from 'PURGE' then
    return jsonb_build_object('dry_run', true, 'eligible', v_counts);
  end if;
  perform set_config('lepefy.audit_purge', 'on', true);
  delete from public.audit_events where recorded_at < now() - (v_retention->>retention_class)::interval;
  get diagnostics v_deleted = row_count;
  perform set_config('lepefy.audit_purge', 'off', true);
  return jsonb_build_object('dry_run', false, 'deleted', v_deleted, 'eligible', v_counts);
end
$$;

-- ─── 14. RLS e privilegi ─────────────────────────────────────────────────────
alter table public.audit_settings enable row level security;
alter table public.audit_settings force row level security;
alter table public.audit_event_types enable row level security;
alter table public.audit_event_types force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.audit_write_failures enable row level security;
alter table public.audit_write_failures force row level security;

revoke all on public.audit_settings, public.audit_event_types, public.audit_events, public.audit_write_failures
  from public, anon, authenticated, service_role;
revoke all on public.audit_feed, public.audit_volume_stats from public, anon, authenticated, service_role;
grant select on public.audit_settings, public.audit_event_types, public.audit_events, public.audit_write_failures to service_role;
grant select on public.audit_feed, public.audit_volume_stats to service_role;

-- RLS forzata senza policy: anche service_role (bypassrls) legge, nessun altro.
revoke all on function public.audit_events_append_only() from public, anon, authenticated, service_role;
revoke all on function public.audit_request_context() from public, anon, authenticated, service_role;
revoke all on function public.audit_admin_display_name(uuid) from public, anon, authenticated, service_role;
revoke all on function public.audit_clip(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.audit_diff(jsonb, jsonb, text[], text[]) from public, anon, authenticated, service_role;
revoke all on function public.record_audit_event(uuid, text, text, text, text, jsonb, jsonb, text, text, jsonb, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.audit_emit(boolean, uuid, text, text, text, text, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.audit_note_failure(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.audit_orders_trigger() from public, anon, authenticated, service_role;
revoke all on function public.audit_products_trigger() from public, anon, authenticated, service_role;
revoke all on function public.audit_customers_trigger() from public, anon, authenticated, service_role;
revoke all on function public.audit_tenants_trigger() from public, anon, authenticated, service_role;
revoke all on function public.audit_feature_flags_trigger() from public, anon, authenticated, service_role;
revoke all on function public.audit_feature_settings_trigger() from public, anon, authenticated, service_role;
revoke all on function public.audit_payment_methods_trigger() from public, anon, authenticated, service_role;
revoke all on function public.audit_role_permissions_trigger() from public, anon, authenticated, service_role;
revoke all on function public.audit_roles_trigger() from public, anon, authenticated, service_role;
revoke all on function public.audit_memberships_trigger() from public, anon, authenticated, service_role;
revoke all on function public.audit_admin_users_trigger() from public, anon, authenticated, service_role;
revoke all on function public.audit_feed_where(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.audit_feed_page(jsonb, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.audit_feed_count(jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.audit_feed_summary(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.audit_feed_actors(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.purge_audit_events(text) from public, anon, authenticated, service_role;

-- L'applicazione: scrive solo tramite record_audit_event, legge tramite il feed.
grant execute on function public.record_audit_event(uuid, text, text, text, text, jsonb, jsonb, text, text, jsonb, text, timestamptz) to service_role;
grant execute on function public.audit_feed_page(jsonb, integer, integer) to service_role;
grant execute on function public.audit_feed_count(jsonb, integer) to service_role;
grant execute on function public.audit_feed_summary(jsonb) to service_role;
grant execute on function public.audit_feed_actors(jsonb) to service_role;
-- Helper invocati dal feed (security invoker) con i diritti del chiamante.
grant execute on function public.audit_feed_where(jsonb) to service_role;
grant execute on function public.audit_admin_display_name(uuid) to service_role;
-- record_audit_event è security definer: il contesto richiesta è letto con i suoi diritti.

comment on table public.audit_events is
  'Journal d''activité (153): append-only, scritto solo da record_audit_event. Vedi docs/ADMIN_ACTIVITY_AUDIT.md.';
comment on view public.audit_feed is
  'Lettura unificata: audit_events + adapter delle tabelle di audit storiche (nessuna copia).';

commit;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- begin;
--   drop trigger if exists audit_orders_insert on public.orders;
--   drop trigger if exists audit_orders_update on public.orders;
--   drop trigger if exists audit_products_insert_delete on public.products;
--   drop trigger if exists audit_products_update on public.products;
--   drop trigger if exists audit_customers_change on public.customers;
--   drop trigger if exists audit_tenants_update on public.tenants;
--   drop trigger if exists audit_feature_flags_change on public.tenant_feature_flags;
--   drop trigger if exists audit_feature_settings_change on public.tenant_feature_settings;
--   drop trigger if exists audit_payment_methods_change on public.tenant_payment_methods;
--   drop trigger if exists audit_role_permissions_insert on public.admin_role_permissions;
--   drop trigger if exists audit_role_permissions_delete on public.admin_role_permissions;
--   drop trigger if exists audit_roles_change on public.admin_roles;
--   drop trigger if exists audit_memberships_change on public.admin_memberships;
--   drop trigger if exists audit_admin_users_insert on public.admin_users;
--   drop trigger if exists audit_admin_users_update on public.admin_users;
--   drop view if exists public.audit_feed;
--   drop view if exists public.audit_volume_stats;
--   drop function if exists public.audit_feed_page(jsonb, integer, integer), public.audit_feed_count(jsonb, integer),
--     public.audit_feed_summary(jsonb), public.audit_feed_actors(jsonb), public.audit_feed_where(jsonb),
--     public.purge_audit_events(text), public.audit_emit(boolean, uuid, text, text, text, text, jsonb, jsonb, text, text, jsonb),
--     public.record_audit_event(uuid, text, text, text, text, jsonb, jsonb, text, text, jsonb, text, timestamptz),
--     public.audit_note_failure(uuid, text, text, text), public.audit_diff(jsonb, jsonb, text[], text[]), public.audit_clip(jsonb),
--     public.audit_admin_display_name(uuid), public.audit_request_context(), public.audit_orders_trigger(),
--     public.audit_products_trigger(), public.audit_customers_trigger(), public.audit_tenants_trigger(),
--     public.audit_feature_flags_trigger(), public.audit_feature_settings_trigger(), public.audit_payment_methods_trigger(),
--     public.audit_role_permissions_trigger(), public.audit_roles_trigger(), public.audit_memberships_trigger(),
--     public.audit_admin_users_trigger();
--   drop table if exists public.audit_events;          -- il trigger append-only sparisce con la tabella
--   drop function if exists public.audit_events_append_only();
--   drop table if exists public.audit_write_failures, public.audit_event_types, public.audit_settings;
--   delete from public.admin_role_permissions where permission_key in ('audit.view','audit.export','audit.security.view','platform.audit.view');
--   delete from public.admin_permissions where key in ('audit.view','audit.export','audit.security.view','platform.audit.view');
-- commit;
