-- 159_shipping_tariff_publish.sql
--
-- Forfait di spedizione — pubblicazione atomica di una modifica di prezzi
-- (Admin → Livraison → Forfait, « Modifier les tarifs » → « Vérifier et publier »).
--
-- Una sola funzione, nessuna tabella o colonna nuova. Partendo dalla versione
-- ATTIVA di un paese (la «base» che l'amministratore ha modificato):
--   1. blocca la base (FOR UPDATE): due pubblicazioni dalla stessa base sono
--      serializzate e la seconda trova la base ritirata → 'tariff_base_not_active';
--   2. copia dalla base TUTTI i parametri strutturali (paese, valuta, pesi delle
--      fasce, zone e modalità delle maggiorazioni, zone non consegnabili, collo
--      max, peso del blocco, limite logistico, TVA): cambiano solo gli importi;
--   3. rifiuta una struttura diversa ('tariff_structure_changed'), un importo non
--      valido ('tariff_price_invalid') o nessuna modifica ('tariff_no_change');
--   4. ritira la base, inserisce la nuova versione (numero max + 1) già `active`
--      e lascia il tenant in modalità `tariff`, nella stessa transazione.
--
-- Gli ordini esistenti conservano il loro snapshot (shipping_details); i
-- preventivi/checkout aperti sulla base ricevono il 409 SHIPPING_REQUOTE_REQUIRED
-- già gestito (versione diversa nel token V2). La versione precedente resta
-- immutabile nello storico e può essere riattivata (activate_shipping_tariff_version).
--
-- Additiva e idempotente (create or replace). Rollback in fondo al file.

create or replace function publish_shipping_tariff_version(
  p_tenant_id         uuid,
  p_base_version_id   uuid,
  p_bands             jsonb,
  p_zone_surcharges   jsonb,
  p_block_price_cents int,
  p_name              text,
  p_actor_id          uuid
) returns shipping_tariff_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  base       shipping_tariff_versions;
  created    shipping_tariff_versions;
  next_bands jsonb := '[]'::jsonb;
  next_zones jsonb := '[]'::jsonb;
  base_band  jsonb;
  new_band   jsonb;
  base_zone  jsonb;
  new_amount jsonb;
  next_ver   int;
  i          int;
begin
  select * into base
    from shipping_tariff_versions
   where id = p_base_version_id and tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'tariff_version_not_found' using errcode = 'P0002';
  end if;
  if base.status <> 'active' then
    raise exception 'tariff_base_not_active' using errcode = 'P0001';
  end if;

  -- Fasce: stesso numero, stessi pesi; solo price_cents dal chiamante.
  if jsonb_typeof(p_bands) is distinct from 'array' or jsonb_array_length(p_bands) <> jsonb_array_length(base.bands) then
    raise exception 'tariff_structure_changed' using errcode = 'P0001';
  end if;
  for i in 0 .. jsonb_array_length(base.bands) - 1 loop
    base_band := base.bands -> i;
    new_band := p_bands -> i;
    if (new_band -> 'min_g_exclusive') is distinct from (base_band -> 'min_g_exclusive')
       or (new_band -> 'max_g_inclusive') is distinct from (base_band -> 'max_g_inclusive') then
      raise exception 'tariff_structure_changed' using errcode = 'P0001';
    end if;
    if jsonb_typeof(new_band -> 'price_cents') is distinct from 'number'
       or (new_band ->> 'price_cents')::numeric <> trunc((new_band ->> 'price_cents')::numeric)
       or (new_band ->> 'price_cents')::numeric < 0 then
      raise exception 'tariff_price_invalid' using errcode = 'P0001';
    end if;
    next_bands := next_bands || jsonb_build_array(jsonb_build_object(
      'min_g_exclusive', base_band -> 'min_g_exclusive',
      'max_g_inclusive', base_band -> 'max_g_inclusive',
      'price_cents', (new_band ->> 'price_cents')::int));
  end loop;

  -- Maggiorazioni: stesse zone e stessa modalità; solo amount_cents (oggetto zone_code → centesimi).
  if jsonb_typeof(p_zone_surcharges) is distinct from 'object' then
    raise exception 'tariff_structure_changed' using errcode = 'P0001';
  end if;
  if (select count(*) from jsonb_object_keys(p_zone_surcharges)) <> jsonb_array_length(base.zone_surcharges) then
    raise exception 'tariff_structure_changed' using errcode = 'P0001';
  end if;
  for base_zone in select value from jsonb_array_elements(base.zone_surcharges) loop
    new_amount := p_zone_surcharges -> (base_zone ->> 'zone_code');
    if new_amount is null then
      raise exception 'tariff_structure_changed' using errcode = 'P0001';
    end if;
    if jsonb_typeof(new_amount) <> 'number' or (new_amount #>> '{}')::numeric <> trunc((new_amount #>> '{}')::numeric)
       or (new_amount #>> '{}')::numeric < 0 then
      raise exception 'tariff_price_invalid' using errcode = 'P0001';
    end if;
    next_zones := next_zones || jsonb_build_array(jsonb_build_object(
      'zone_code', base_zone -> 'zone_code',
      'amount_cents', (new_amount #>> '{}')::int,
      'mode', base_zone -> 'mode'));
  end loop;

  -- Blocco: presente solo se la base ne ha uno.
  if (base.block_weight_g is null) <> (p_block_price_cents is null) then
    raise exception 'tariff_structure_changed' using errcode = 'P0001';
  end if;
  if p_block_price_cents is not null and p_block_price_cents < 0 then
    raise exception 'tariff_price_invalid' using errcode = 'P0001';
  end if;

  if next_bands = base.bands and next_zones = base.zone_surcharges
     and p_block_price_cents is not distinct from base.block_price_cents then
    raise exception 'tariff_no_change' using errcode = 'P0001';
  end if;

  select coalesce(max(version), 0) + 1 into next_ver
    from shipping_tariff_versions
   where tenant_id = p_tenant_id and country = base.country;

  update shipping_tariff_versions
     set status = 'retired', retired_at = now(), retired_by = p_actor_id
   where id = base.id;

  insert into shipping_tariff_versions (
    tenant_id, country, currency, version, status, name, bands, zone_surcharges, non_deliverable_zones,
    max_parcel_weight_g, block_weight_g, block_price_cents, logistics_verified_max_weight_g, prices_include_vat,
    source_draft_id, notes, created_by, activated_at, activated_by
  ) values (
    p_tenant_id, base.country, base.currency, next_ver, 'active',
    coalesce(nullif(btrim(p_name), ''), format('%s — mise à jour des prix', base.country)),
    next_bands, next_zones, base.non_deliverable_zones,
    base.max_parcel_weight_g, base.block_weight_g, p_block_price_cents, base.logistics_verified_max_weight_g,
    base.prices_include_vat, base.source_draft_id, format('Prix modifiés depuis la version %s.', base.version),
    p_actor_id, now(), p_actor_id
  )
  returning * into created;

  update tenants set shipping_pricing_mode = 'tariff' where id = p_tenant_id;
  return created;
end;
$$;

revoke all on function publish_shipping_tariff_version(uuid, uuid, jsonb, jsonb, int, text, uuid) from public, anon, authenticated;
grant execute on function publish_shipping_tariff_version(uuid, uuid, jsonb, jsonb, int, text, uuid) to service_role;

-- Rollback (le versioni pubblicate restano: sono normali righe immutabili) :
-- DROP FUNCTION publish_shipping_tariff_version(uuid, uuid, jsonb, jsonb, int, text, uuid);
