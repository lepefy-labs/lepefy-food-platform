-- MIGRATION 145: ORDER DOCUMENTS (liste de préparation, bon de colis, portail QR)
--
-- Additive, réversible, sans backfill. Aucune ligne orders/order_items n'est
-- lue ni modifiée ici.
--
--   1. Préférences des documents : module 'order_documents' de la couche
--      générique tenant_feature_settings (096), pas de colonnes tenants.*.
--      Aucune ligne créée : ligne absente = défauts (A5, bon de colis activé,
--      prix et adresse masqués).
--   2. order_public_access_tokens : accès public opaque au portail /o/<token>
--      (QR du bon de colis). Création paresseuse au premier bon de colis.
--      Le jeton n'est jamais stocké en clair : seulement un nonce aléatoire et
--      SHA-256(token) (token = HMAC(TRACKING_SECRET, rowId + nonce), côté app).
--   3. review_invite_tokens.purpose accepte 'qr_portal' (CTA « Donner mon avis »).
--
-- Rollback : drop table order_public_access_tokens ; delete from
-- tenant_feature_settings / platform_features where key = 'order_documents' ;
-- drop la contrainte + fonction de validation ; restaurer le CHECK purpose
-- ('initial','reminder') après suppression des jetons 'qr_portal'.
--
-- Rejouable sans effet de bord.

begin;

-- ─── 1. Catalogue (module opérationnel non facturable) ───────────────────────
insert into public.platform_features (key, name, description, category, active, billable, position)
values (
  'order_documents',
  'Documents des commandes',
  'Formats et contenu de la liste de préparation et du bon de colis. Module inclus, non facturable.',
  'operations',
  true,
  false,
  210
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  billable = excluded.billable,
  position = excluded.position,
  updated_at = now();

-- Défense en profondeur ; miroir de orderDocumentsConfigSchema (lib/orders/documents/settings.ts).
create or replace function public.is_valid_order_documents_config(p_config jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select jsonb_typeof(p_config) = 'object'
    and p_config - array[
      'version', 'picking_list_format', 'packing_slip_enabled', 'packing_slip_format',
      'packing_slip_show_logo', 'packing_slip_show_qr', 'packing_slip_show_thank_you',
      'packing_slip_show_contact', 'packing_slip_show_prices', 'packing_slip_show_delivery_address'
    ] = '{}'::jsonb
    and (not p_config ? 'version' or p_config->'version' = '1'::jsonb)
    and (not p_config ? 'picking_list_format' or p_config->>'picking_list_format' in ('a5', 'a4'))
    and (not p_config ? 'packing_slip_format' or p_config->>'packing_slip_format' in ('a5', 'a4'))
    and coalesce((
      select bool_and(jsonb_typeof(p_config->k) = 'boolean')
      from unnest(array[
        'packing_slip_enabled', 'packing_slip_show_logo', 'packing_slip_show_qr', 'packing_slip_show_thank_you',
        'packing_slip_show_contact', 'packing_slip_show_prices', 'packing_slip_show_delivery_address'
      ]) as k
      where p_config ? k
    ), true);
$$;

revoke all on function public.is_valid_order_documents_config(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_order_documents_config(jsonb) to service_role;

alter table public.tenant_feature_settings
  drop constraint if exists tenant_feature_settings_order_documents_config_check;
alter table public.tenant_feature_settings
  add constraint tenant_feature_settings_order_documents_config_check
  check (feature_key <> 'order_documents' or public.is_valid_order_documents_config(config));

-- ─── 2. Jetons d'accès public aux commandes ──────────────────────────────────
create table if not exists public.order_public_access_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  purpose text not null default 'order_portal' check (purpose in ('order_portal')),
  token_nonce text not null check (char_length(token_nonce) between 16 and 64),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint order_public_access_tokens_tenant_hash_key unique (tenant_id, token_hash)
);

comment on table public.order_public_access_tokens is
  'Opaque public access to the customer-safe order portal (/o/<token>, QR of the packing slip). Only a random nonce and SHA-256(token) are stored; the token is HMAC(TRACKING_SECRET, id + nonce) derived server-side. One active token per order and purpose; revoked_at revokes. Service role only: no RLS policy, resolution happens server-side.';
comment on column public.order_public_access_tokens.token_hash is 'SHA-256 hex of the public token (lookup key). The token itself is never stored.';
comment on column public.order_public_access_tokens.revoked_at is 'Set to revoke; the next packing slip issues a new token.';

-- Un seul jeton actif par commande : réimpressions = même QR.
create unique index if not exists order_public_access_tokens_one_active_idx
  on public.order_public_access_tokens (tenant_id, order_id, purpose)
  where revoked_at is null;
create index if not exists order_public_access_tokens_order_idx
  on public.order_public_access_tokens (order_id);

alter table public.order_public_access_tokens enable row level security;
alter table public.order_public_access_tokens force row level security;
revoke all on table public.order_public_access_tokens from public, anon, authenticated;
grant select, insert, update on table public.order_public_access_tokens to service_role;

-- ─── 3. Jeton d'avis émis depuis le portail ──────────────────────────────────
do $$
declare
  v_constraint text;
begin
  select con.conname into v_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public' and rel.relname = 'review_invite_tokens' and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%purpose%';
  if v_constraint is not null then
    execute format('alter table public.review_invite_tokens drop constraint %I', v_constraint);
  end if;
end $$;

alter table public.review_invite_tokens
  add constraint review_invite_tokens_purpose_check
  check (purpose in ('initial', 'reminder', 'qr_portal'));

commit;
