-- 125_shipping_tariff_activation.sql
--
-- Forfait di spedizione V1G — tariffazione commerciale.
--
-- Prerequisito: 124_shipping_tariff_versions.sql.
--
-- 1. Tracciabilità dell'attivazione di una versione (`active`): chi e quando,
--    chi l'ha ritirata. I parametri economici restano immutabili (trigger 124).
-- 2. tenants.shipping_tariff_fallback: comportamento ESPLICITO quando il
--    tenant è in modalità `tariff` ma una quotazione non può usare la tariffa
--    (paese senza versione attiva, prodotto senza peso affidabile):
--      unavailable   (default) → consegna non disponibile, ritiro proposto;
--      provider_cost           → preventivo provider attuale (Packlink).
-- 3. shipping_packaging_profiles.tare_g: tara del cartone, sommata al peso
--    del collo SOLO nella verifica di disponibilità logistica (peso lordo
--    inviato al provider). Il prezzo resta sul peso netto dei prodotti.
-- 4. RPC atomiche di attivazione, ritiro per paese e ritorno globale a
--    provider_cost. Nessun ordine esistente viene modificato.
--
-- Additiva, nessun backfill: nessun tenant diventa `tariff` con questa migration.

alter table shipping_tariff_versions
  add column activated_at timestamptz,
  add column activated_by uuid,
  add column retired_by   uuid;

alter table tenants
  add column shipping_tariff_fallback text not null default 'unavailable'
    check (shipping_tariff_fallback in ('unavailable', 'provider_cost'));

comment on column tenants.shipping_tariff_fallback is
  'Modalità tariff: comportamento quando la tariffa non è applicabile (paese senza versione attiva, peso prodotto mancante). '
  'unavailable (default) | provider_cost.';

-- 3b. Pagina pubblica «Livraison» (griglia generata dalla tariffa attiva):
--     nascosta finché il tenant non la abilita esplicitamente.
alter table tenants
  add column shipping_public_grid_enabled boolean not null default false;

comment on column tenants.shipping_public_grid_enabled is
  'Mostra la pagina pubblica /livraison (griglia della tariffa attiva). Default false.';

alter table shipping_packaging_profiles
  add column tare_g int check (tare_g is null or tare_g >= 0);

comment on column shipping_packaging_profiles.tare_g is
  'Tara del cartone (g). Sommata al collo solo per la verifica di disponibilità Packlink; mai al peso di fascia tariffaria.';

-- ─── Attivazione commerciale atomica ──────────────────────────────────────
-- Ritira la versione attiva dello stesso paese, attiva la versione richiesta
-- e porta il tenant in modalità `tariff`, in una sola transazione.
create or replace function activate_shipping_tariff_version(
  p_tenant_id  uuid,
  p_version_id uuid,
  p_actor_id   uuid
) returns shipping_tariff_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  target shipping_tariff_versions;
begin
  select * into target
    from shipping_tariff_versions
   where id = p_version_id and tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'tariff_version_not_found' using errcode = 'P0002';
  end if;
  if target.status = 'active' then
    update tenants set shipping_pricing_mode = 'tariff' where id = p_tenant_id;
    return target;
  end if;

  update shipping_tariff_versions
     set status = 'retired', retired_at = now(), retired_by = p_actor_id
   where tenant_id = p_tenant_id and country = target.country and status = 'active';

  update shipping_tariff_versions
     set status = 'active', activated_at = now(), activated_by = p_actor_id,
         retired_at = null, retired_by = null
   where id = p_version_id
  returning * into target;

  update tenants set shipping_pricing_mode = 'tariff' where id = p_tenant_id;
  return target;
end;
$$;

-- ─── Ritiro della tariffa attiva di un paese ──────────────────────────────
-- Se non resta alcuna versione attiva, il tenant torna a provider_cost.
create or replace function retire_shipping_tariff_country(
  p_tenant_id uuid,
  p_country   text,
  p_actor_id  uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
  next_mode text;
begin
  update shipping_tariff_versions
     set status = 'retired', retired_at = now(), retired_by = p_actor_id
   where tenant_id = p_tenant_id and country = upper(p_country) and status = 'active';

  select count(*) into remaining
    from shipping_tariff_versions
   where tenant_id = p_tenant_id and status = 'active';

  if remaining = 0 then
    update tenants set shipping_pricing_mode = 'provider_cost'
     where id = p_tenant_id and shipping_pricing_mode = 'tariff';
  end if;

  select shipping_pricing_mode into next_mode from tenants where id = p_tenant_id;
  return next_mode;
end;
$$;

-- ─── Ritorno globale al calcolo provider ──────────────────────────────────
create or replace function rollback_shipping_tariff_to_provider_cost(
  p_tenant_id uuid,
  p_actor_id  uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update shipping_tariff_versions
     set status = 'retired', retired_at = now(), retired_by = p_actor_id
   where tenant_id = p_tenant_id and status = 'active';
  update tenants set shipping_pricing_mode = 'provider_cost' where id = p_tenant_id;
end;
$$;

revoke all on function activate_shipping_tariff_version(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function retire_shipping_tariff_country(uuid, text, uuid) from public, anon, authenticated;
revoke all on function rollback_shipping_tariff_to_provider_cost(uuid, uuid) from public, anon, authenticated;
grant execute on function activate_shipping_tariff_version(uuid, uuid, uuid) to service_role;
grant execute on function retire_shipping_tariff_country(uuid, text, uuid) to service_role;
grant execute on function rollback_shipping_tariff_to_provider_cost(uuid, uuid) to service_role;

-- Rollback (gli ordini già pagati conservano il proprio snapshot in shipping_details) :
-- BEGIN;
-- UPDATE shipping_tariff_versions SET status = 'retired', retired_at = now() WHERE status = 'active';
-- UPDATE tenants SET shipping_pricing_mode = 'provider_cost' WHERE shipping_pricing_mode = 'tariff';
-- DROP FUNCTION rollback_shipping_tariff_to_provider_cost(uuid, uuid);
-- DROP FUNCTION retire_shipping_tariff_country(uuid, text, uuid);
-- DROP FUNCTION activate_shipping_tariff_version(uuid, uuid, uuid);
-- ALTER TABLE shipping_packaging_profiles DROP COLUMN tare_g;
-- ALTER TABLE tenants DROP COLUMN shipping_public_grid_enabled;
-- ALTER TABLE tenants DROP COLUMN shipping_tariff_fallback;
-- ALTER TABLE shipping_tariff_versions DROP COLUMN retired_by, DROP COLUMN activated_by, DROP COLUMN activated_at;
-- COMMIT;
