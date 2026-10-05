-- MIGRATION 146: ORDER DOCUMENTS — option « adresse complète » sur la liste de préparation
--
-- Ridefinisce solo la funzione di validazione della config 'order_documents'
-- (145) per accettare la nuova chiave booleana `picking_list_show_delivery_address`.
-- Nessuna tabella, nessun dato, nessun grant modificato; il CHECK esistente
-- usa la funzione per nome e resta invariato.
--
-- Compatibile all'indietro: accetta un sovrainsieme delle config valide per la
-- 145, quindi può essere applicata prima o dopo il deploy del codice.
-- Senza la 146 il codice nuovo non può salvare le preferenze (il CHECK rifiuta
-- la nuova chiave): l'API risponde 409 con un messaggio esplicito.
--
-- Rollback: rieseguire la definizione della funzione della 145 dopo aver tolto
-- la chiave dalle righe esistenti:
--   update tenant_feature_settings set config = config - 'picking_list_show_delivery_address'
--   where feature_key = 'order_documents';
--
-- Rieseguibile.

begin;

create or replace function public.is_valid_order_documents_config(p_config jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select jsonb_typeof(p_config) = 'object'
    and p_config - array[
      'version', 'picking_list_format', 'picking_list_show_delivery_address',
      'packing_slip_enabled', 'packing_slip_format',
      'packing_slip_show_logo', 'packing_slip_show_qr', 'packing_slip_show_thank_you',
      'packing_slip_show_contact', 'packing_slip_show_prices', 'packing_slip_show_delivery_address'
    ] = '{}'::jsonb
    and (not p_config ? 'version' or p_config->'version' = '1'::jsonb)
    and (not p_config ? 'picking_list_format' or p_config->>'picking_list_format' in ('a5', 'a4'))
    and (not p_config ? 'packing_slip_format' or p_config->>'packing_slip_format' in ('a5', 'a4'))
    and coalesce((
      select bool_and(jsonb_typeof(p_config->k) = 'boolean')
      from unnest(array[
        'picking_list_show_delivery_address',
        'packing_slip_enabled', 'packing_slip_show_logo', 'packing_slip_show_qr', 'packing_slip_show_thank_you',
        'packing_slip_show_contact', 'packing_slip_show_prices', 'packing_slip_show_delivery_address'
      ]) as k
      where p_config ? k
    ), true);
$$;

revoke all on function public.is_valid_order_documents_config(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_order_documents_config(jsonb) to service_role;

commit;
