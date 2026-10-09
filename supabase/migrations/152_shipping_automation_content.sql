-- MIGRATION 152: CONTENU DÉCLARÉ DES BROUILLONS D'EXPÉDITION
--
-- Ridefinisce soltanto public.is_valid_shipping_automation_config (151) per
-- accettare la chiave `shipment_content` (testo dichiarato al provider,
-- 1–60 caratteri dopo trim, miroir de shippingAutomationConfigSchema in
-- lib/shipping/shipmentDraft/settings.ts). Nessuna tabella o riga toccata;
-- le config 151 (senza la chiave) restano valide e usano il default
-- applicativo « Alimenti Non Deperibili ».
--
-- Senza questa migration, l'applicazione legge la config ma il salvataggio
-- del réglage risponde 409 (il codice scrive sempre la config completa).
--
-- Rollback : rieseguire la definizione della funzione della 151, dopo aver
-- rimosso `shipment_content` dalle config salvate.
--
-- Rejouable sans effet de bord.

begin;

create or replace function public.is_valid_shipping_automation_config(p_config jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select jsonb_typeof(p_config) = 'object'
    and p_config - array['version', 'create_shipment_trigger', 'shipment_content'] = '{}'::jsonb
    and (not p_config ? 'version' or p_config->'version' = '1'::jsonb)
    and (not p_config ? 'create_shipment_trigger'
      or p_config->>'create_shipment_trigger' in ('order_created', 'preparing', 'manual'))
    and (not p_config ? 'shipment_content' or (
      jsonb_typeof(p_config->'shipment_content') = 'string'
      and char_length(btrim(p_config->>'shipment_content')) between 1 and 60
    ));
$$;

revoke all on function public.is_valid_shipping_automation_config(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_shipping_automation_config(jsonb) to service_role;

commit;
