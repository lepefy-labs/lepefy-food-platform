-- MIGRATION 160: MODES DE PRÉPARATION (papier / Lepefy / sans confirmation)
--
-- Additive, réversible, sans backfill. Aucune ligne orders/order_items
-- existante n'est modifiée.
--
--   1. Module 'order_preparation' de tenant_feature_settings (096) :
--      { version: 1, picking_mode, cold_chain_packing_mode } ∈ digital | paper | none.
--      Ligne absente = digital / digital (comportement actuel). Aucune ligne
--      créée ici : l'activation d'un tenant (ex. Chloe Food) passe par
--      Paramètres → Préparation et emballage. Les modifications sont déjà
--      auditées par le trigger audit_feature_settings_change (153).
--   2. orders : instantané du mode au démarrage de la préparation
--      (preparation_mode) et traces du flux papier. Snapshot absent = digital,
--      donc tous les ordres existants gardent exactement les règles actuelles.
--      picked_at, cold_chain_checked_at, picking_completed_at,
--      cold_chain_packing_checked_at et packing_completed_at restent des
--      contrôles exclusivement numériques : ces colonnes ne sont jamais
--      écrites par le flux papier ou « sans confirmation ».
--   3. Journal d'activité : trois types d'événements émis par un trigger
--      dédié sur les nouvelles colonnes (fail-open comme les autres
--      événements commandes ; acteur lu depuis les en-têtes x-lepefy-audit-*).
--
-- Miroir TS : lib/orders/preparation/settings.ts (schéma) et
-- lib/orders/preparation/preparationPolicy.ts (règles).
--
-- Rollback :
--   drop trigger if exists audit_order_preparation_update on public.orders;
--   drop function if exists public.audit_order_preparation_trigger();
--   delete from public.audit_event_types where key like 'orders.preparation.%';
--   alter table public.orders drop constraint if exists orders_preparation_mode_check,
--     drop column if exists preparation_mode, drop column if exists picking_list_printed_at,
--     drop column if exists paper_preparation_started_at, drop column if exists paper_preparation_started_by,
--     drop column if exists paper_preparation_completed_at, drop column if exists paper_preparation_completed_by,
--     drop column if exists cold_chain_packing_declared_at, drop column if exists preparation_unverified_at;
--   alter table public.tenant_feature_settings drop constraint if exists tenant_feature_settings_order_preparation_config_check;
--   drop function if exists public.is_valid_order_preparation_config(jsonb);
--   delete from public.tenant_feature_settings where feature_key = 'order_preparation';
--   delete from public.platform_features where key = 'order_preparation';
--
-- Rejouable sans effet de bord.

begin;

-- ─── 1. Module de configuration ──────────────────────────────────────────────
insert into public.platform_features (key, name, description, category, active, billable, position)
values (
  'order_preparation',
  'Préparation et emballage',
  'Mode de confirmation de la préparation et de l''emballage froid : dans Lepefy, sur papier ou sans confirmation. Module inclus, non facturable.',
  'operations',
  true,
  false,
  215
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  billable = excluded.billable,
  position = excluded.position,
  updated_at = now();

-- Défense en profondeur ; miroir de orderPreparationConfigSchema.
create or replace function public.is_valid_order_preparation_config(p_config jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select jsonb_typeof(p_config) = 'object'
    and p_config - array['version', 'picking_mode', 'cold_chain_packing_mode'] = '{}'::jsonb
    and (not p_config ? 'version' or p_config->'version' = '1'::jsonb)
    and (not p_config ? 'picking_mode' or p_config->>'picking_mode' in ('digital', 'paper', 'none'))
    and (not p_config ? 'cold_chain_packing_mode' or p_config->>'cold_chain_packing_mode' in ('digital', 'paper', 'none'));
$$;

revoke all on function public.is_valid_order_preparation_config(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_order_preparation_config(jsonb) to service_role;

alter table public.tenant_feature_settings
  drop constraint if exists tenant_feature_settings_order_preparation_config_check;
alter table public.tenant_feature_settings
  add constraint tenant_feature_settings_order_preparation_config_check
  check (feature_key <> 'order_preparation' or public.is_valid_order_preparation_config(config));

-- ─── 2. Colonnes commandes ───────────────────────────────────────────────────
alter table public.orders
  add column if not exists preparation_mode jsonb,
  add column if not exists picking_list_printed_at timestamptz,
  add column if not exists paper_preparation_started_at timestamptz,
  add column if not exists paper_preparation_started_by uuid references public.admin_users(id) on delete set null,
  add column if not exists paper_preparation_completed_at timestamptz,
  add column if not exists paper_preparation_completed_by uuid references public.admin_users(id) on delete set null,
  add column if not exists cold_chain_packing_declared_at timestamptz,
  add column if not exists preparation_unverified_at timestamptz;

alter table public.orders drop constraint if exists orders_preparation_mode_check;
alter table public.orders add constraint orders_preparation_mode_check check (
  preparation_mode is null or (
    jsonb_typeof(preparation_mode) = 'object'
    and preparation_mode - array['picking', 'cold_chain_packing'] = '{}'::jsonb
    and coalesce(preparation_mode->>'picking', '') in ('digital', 'paper', 'none')
    and coalesce(preparation_mode->>'cold_chain_packing', '') in ('digital', 'paper', 'none')
  )
);

comment on column public.orders.preparation_mode is
  'Snapshot { picking, cold_chain_packing } of tenant_feature_settings(order_preparation) taken when preparation starts. Null = digital/digital (rules before migration 160). Changing the tenant setting never rewrites it.';
comment on column public.orders.picking_list_printed_at is
  'First explicit « Imprimer et démarrer » of the picking list (POST, not the PDF GET). A generated document is not proof of printing nor of any physical check.';
comment on column public.orders.paper_preparation_started_at is 'Paper preparation started (picking mode paper), set with picking_list_printed_at.';
comment on column public.orders.paper_preparation_completed_at is
  'Explicit declaration « Préparation terminée » by paper_preparation_completed_by. Never sets order_items.picked_at nor picking_completed_at.';
comment on column public.orders.cold_chain_packing_declared_at is
  'Cold-chain packing declared on paper (cold_chain_packing mode paper). Distinct from cold_chain_packing_checked_at (digital check).';
comment on column public.orders.preparation_unverified_at is
  'Final transition done in mode « sans confirmation »: no preparation or cold-chain check was recorded.';

-- ─── 3. Journal d'activité ───────────────────────────────────────────────────
insert into public.audit_event_types (key, module, category, default_severity, retention_class) values
  ('orders.preparation.paper_started', 'orders', 'activity', 'info', 'business'),
  ('orders.preparation.paper_completed', 'orders', 'activity', 'info', 'business'),
  ('orders.preparation.unverified_advance', 'orders', 'activity', 'notice', 'business')
on conflict (key) do nothing;

create or replace function public.audit_order_preparation_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text := '#' || upper(left(new.id::text, 8));
  v_mode  jsonb := coalesce(new.preparation_mode, '{}'::jsonb);
begin
  begin
    if old.paper_preparation_started_at is null and new.paper_preparation_started_at is not null then
      perform public.audit_emit(false, new.tenant_id, 'orders.preparation.paper_started', 'order', new.id::text, v_label, '[]'::jsonb,
        jsonb_build_object('picking_mode', v_mode->>'picking', 'cold_chain_packing_mode', v_mode->>'cold_chain_packing'));
    end if;
    if old.paper_preparation_completed_at is null and new.paper_preparation_completed_at is not null then
      perform public.audit_emit(false, new.tenant_id, 'orders.preparation.paper_completed', 'order', new.id::text, v_label, '[]'::jsonb,
        jsonb_build_object('picking_mode', v_mode->>'picking', 'cold_chain_packing_mode', v_mode->>'cold_chain_packing',
          'parcel_count', new.packing_parcel_count, 'cold_chain_declared', new.cold_chain_packing_declared_at is not null));
    end if;
    if old.paper_preparation_completed_at is not null and new.paper_preparation_completed_at is null then
      perform public.audit_emit(false, new.tenant_id, 'orders.preparation.paper_completed', 'order', new.id::text, v_label, '[]'::jsonb,
        jsonb_build_object('withdrawn', true), 'success', 'notice');
    end if;
    if old.preparation_unverified_at is null and new.preparation_unverified_at is not null then
      perform public.audit_emit(false, new.tenant_id, 'orders.preparation.unverified_advance', 'order', new.id::text, v_label, '[]'::jsonb,
        jsonb_build_object('picking_mode', v_mode->>'picking', 'cold_chain_packing_mode', v_mode->>'cold_chain_packing', 'status', new.status));
    end if;
  exception when others then
    perform public.audit_note_failure(new.tenant_id, 'orders.preparation.*', sqlstate, sqlerrm);
  end;
  return null;
end
$$;

revoke all on function public.audit_order_preparation_trigger() from public, anon, authenticated, service_role;

drop trigger if exists audit_order_preparation_update on public.orders;
create trigger audit_order_preparation_update after update on public.orders
  for each row
  when (
    (old.paper_preparation_started_at, old.paper_preparation_completed_at, old.preparation_unverified_at)
    is distinct from
    (new.paper_preparation_started_at, new.paper_preparation_completed_at, new.preparation_unverified_at)
  )
  execute function public.audit_order_preparation_trigger();

commit;
