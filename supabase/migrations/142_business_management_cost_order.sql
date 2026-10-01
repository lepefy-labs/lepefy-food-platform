-- MIGRATION 142: GESTION - ordine del costo d'acquisto corrente
--
-- Correzione della 141 emersa nella verifica funzionale su lepefy-test.
-- refresh_product_cost() sceglieva l'ultima voce attiva per `received_at`
-- (timestamp). Il form di ricezione inviava le 12:00 del giorno scelto: una
-- ricezione registrata la mattina riceveva quindi un orario futuro e una
-- ricezione registrata dopo, con un orario reale anteriore, non diventava mai
-- il costo corrente (lepefy-test: REC-2026-000008 a 5,00 EUR ignorata, restava
-- 4,00 EUR).
--
-- Regola corretta, deterministica:
--   1. giorno di ricezione nel fuso Gestion (Europe/Paris), il più recente;
--   2. a parità di giorno, l'ordine di registrazione (`created_at`);
--   3. poi `received_at`, poi `id` (solo spareggio tecnico).
-- `product_cost_history.created_at` passa a clock_timestamp(): due voci create
-- nella stessa transazione restano ordinate (now() è fisso per transazione).
-- Il form non invia più un orario futuro e l'API rifiuta una ricezione futura.
--
-- Nessuna colonna, tabella o permesso cambia. Lo storico (append-only) non è
-- toccato; solo la cache ricalcolabile `product_costs` viene ricalcolata per
-- tutti i prodotti con storico. Rollback: rieseguire la sezione 6 della 141.

begin;

alter table public.product_cost_history alter column created_at set default clock_timestamp();

create or replace function public.refresh_product_cost(p_tenant_id uuid, p_product_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_entry public.product_cost_history%rowtype;
begin
  select h.* into v_entry
  from public.product_cost_history h
  where h.tenant_id = p_tenant_id and h.product_id = p_product_id and h.status = 'active'
  order by (h.received_at at time zone 'Europe/Paris')::date desc, h.created_at desc, h.received_at desc, h.id desc
  limit 1;

  if not found then
    delete from public.product_costs c where c.tenant_id = p_tenant_id and c.product_id = p_product_id;
    return;
  end if;

  insert into public.product_costs as c (
    tenant_id, product_id, currency, current_purchase_cost, cost_method, source_history_id,
    source_receipt_item_id, source_purchase_id, source_supplier_id, effective_at, updated_at
  ) values (
    p_tenant_id, p_product_id, v_entry.currency, v_entry.cost_per_stock_unit, 'last_received_purchase_cost', v_entry.id,
    v_entry.receipt_item_id, v_entry.purchase_id, v_entry.supplier_id, v_entry.received_at, now()
  )
  on conflict (tenant_id, product_id) do update set
    currency = excluded.currency,
    current_purchase_cost = excluded.current_purchase_cost,
    cost_method = excluded.cost_method,
    source_history_id = excluded.source_history_id,
    source_receipt_item_id = excluded.source_receipt_item_id,
    source_purchase_id = excluded.source_purchase_id,
    source_supplier_id = excluded.source_supplier_id,
    effective_at = excluded.effective_at,
    updated_at = now();
end;
$$;

-- create or replace conserva i privilegi; ribaditi per esplicitezza.
revoke all on function public.refresh_product_cost(uuid, uuid) from public, anon, authenticated;
grant execute on function public.refresh_product_cost(uuid, uuid) to service_role;

-- Ricalcolo della cache per ogni prodotto con storico.
do $$
declare
  v_pair record;
begin
  for v_pair in select distinct h.tenant_id, h.product_id from public.product_cost_history h where h.product_id is not null loop
    perform public.refresh_product_cost(v_pair.tenant_id, v_pair.product_id);
  end loop;
end
$$;

commit;
