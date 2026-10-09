-- MIGRATION 151: CRÉATION DES BROUILLONS D'EXPÉDITION (provider-neutral, Packlink en premier)
--
-- Additive, réversible, sans backfill. Aucune ligne orders existante n'est
-- modifiée ; aucun tenant n'est activé.
--
--   1. Préférences : module 'shipping_automation' de la couche générique
--      tenant_feature_settings (096), pas de colonnes tenants.*.
--      Ligne absente = désactivé, création manuelle uniquement.
--      enabled = création des brouillons depuis Lepefy activée ;
--      config  = { version: 1, create_shipment_trigger: 'order_created' | 'preparing' | 'manual' }.
--   2. Colonnes de provisioning sur orders, séparées de l'état logistique
--      (shipping_normalized_status) et de la référence définitive
--      (shipping_provider_reference, migration 111) :
--        shipping_creation_status      null = non requis (not_required) ;
--                                      pending → creating → draft_created | failed | ambiguous
--        shipping_creation_attempts    tentatives d'appel provider (borne de retry)
--        shipping_creation_error       code d'erreur classé (jamais de payload provider ni de PII)
--        shipping_creation_updated_at  dernière transition de provisioning (détection d'un « creating » bloqué)
--        shipping_provider_created_at  date de création du brouillon chez le provider
--   3. Index partiel des créations à traiter par le tick shipping-sync.
--
-- Unicité : l'index orders_tenant_shipping_reference_idx (111) empêche déjà
-- qu'une même référence provider soit associée à deux commandes du tenant.
-- La protection contre deux brouillons pour UNE commande est un
-- compare-and-set applicatif sur shipping_creation_status
-- (lib/shipping/shipmentDraft/shipmentDraftService.ts).
--
-- RLS / grants : inchangés (orders garde ses policies ; tenant_feature_settings
-- reste service role pour l'écriture).
--
-- Rollback (après retour arrière du code) :
--   drop index public.orders_shipping_creation_queue_idx;
--   alter table public.orders drop constraint orders_shipping_creation_status_check,
--     drop column shipping_creation_status, drop column shipping_creation_attempts,
--     drop column shipping_creation_error, drop column shipping_creation_updated_at,
--     drop column shipping_provider_created_at;
--   alter table public.tenant_feature_settings drop constraint tenant_feature_settings_shipping_automation_config_check;
--   drop function public.is_valid_shipping_automation_config(jsonb);
--   delete from public.tenant_feature_settings where feature_key = 'shipping_automation';
--   delete from public.platform_features where key = 'shipping_automation';
--
-- Rejouable sans effet de bord.

begin;

-- ─── 1. Catalogue (module opérationnel non facturable) ───────────────────────
insert into public.platform_features (key, name, description, category, active, billable, position)
values (
  'shipping_automation',
  'Création des expéditions',
  'Création des brouillons d’expédition chez le transporteur depuis les commandes. Module inclus, non facturable.',
  'operations',
  true,
  false,
  220
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  billable = excluded.billable,
  position = excluded.position,
  updated_at = now();

-- Défense en profondeur ; miroir de shippingAutomationConfigSchema (lib/shipping/shipmentDraft/settings.ts).
create or replace function public.is_valid_shipping_automation_config(p_config jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select jsonb_typeof(p_config) = 'object'
    and p_config - array['version', 'create_shipment_trigger'] = '{}'::jsonb
    and (not p_config ? 'version' or p_config->'version' = '1'::jsonb)
    and (not p_config ? 'create_shipment_trigger'
      or p_config->>'create_shipment_trigger' in ('order_created', 'preparing', 'manual'));
$$;

revoke all on function public.is_valid_shipping_automation_config(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_shipping_automation_config(jsonb) to service_role;

alter table public.tenant_feature_settings
  drop constraint if exists tenant_feature_settings_shipping_automation_config_check;
alter table public.tenant_feature_settings
  add constraint tenant_feature_settings_shipping_automation_config_check
  check (feature_key <> 'shipping_automation' or public.is_valid_shipping_automation_config(config));

-- ─── 2. Provisioning des expéditions sur orders ──────────────────────────────
alter table public.orders
  add column if not exists shipping_creation_status text,
  add column if not exists shipping_creation_attempts integer not null default 0,
  add column if not exists shipping_creation_error text,
  add column if not exists shipping_creation_updated_at timestamptz,
  add column if not exists shipping_provider_created_at timestamptz;

alter table public.orders drop constraint if exists orders_shipping_creation_status_check;
alter table public.orders add constraint orders_shipping_creation_status_check
  check (
    (shipping_creation_status is null
      or shipping_creation_status in ('not_required', 'pending', 'creating', 'draft_created', 'failed', 'ambiguous'))
    and shipping_creation_attempts >= 0
    and (shipping_creation_error is null or char_length(shipping_creation_error) <= 64)
  );

-- ─── 3. File de traitement du tick shipping-sync ─────────────────────────────
create index if not exists orders_shipping_creation_queue_idx on public.orders
  (shipping_creation_updated_at nulls first, id)
  where shipping_creation_status in ('pending', 'creating', 'failed')
    and shipping_provider_reference is null;

commit;
