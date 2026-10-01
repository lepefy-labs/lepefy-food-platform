-- MIGRATION 141: GESTION FASE 1.1
-- Quantità d'acquisto decimali e unità di misura, conversione verso le unità di
-- stock vendibili, costo d'acquisto prodotto (corrente + storico), scadenze di
-- pagamento fornitori, rettifiche di stock con motivo e nota, vista stock.
--
-- Documentazione: docs/BUSINESS_MANAGEMENT.md. Verifica:
-- supabase/verification/141_business_management_units_costs_due_dates_verification.sql
--
-- Invarianti:
-- * products.stock resta INTERO (unità vendibili): storefront, checkout, Nala invariati.
-- * Le quantità d'acquisto e di ricezione diventano numeric(14,3): i valori interi
--   esistenti restano identici (12 -> 12.000), unità di default 'unit', conversione 1
--   sulle righe collegate a un prodotto.
-- * Una ricezione converte quantità x conversione in un delta di stock che DEVE
--   essere intero: altrimenti rifiuto, mai arrotondamento silenzioso.
-- * Ogni ricezione conserva la conversione usata (riga di ricezione e movimento):
--   uno storno usa i valori storici, mai quelli correnti.
-- * Costo d'acquisto: metodo "last_received_purchase_cost", per unità di stock,
--   frais supplémentaires esclusi. Tabelle server-only, storico append-only.
-- * Scadenza di pagamento (payment_due_date) distinta da expected_date (consegna).
-- * Additiva per i tenant senza dati Gestion; nessun tenant attivato.
--
-- Rollback: non automatico (cambio di tipo). Le quantità esistenti erano intere e
-- restano rappresentabili; un ritorno a integer è possibile solo se nessuna
-- quantità decimale è stata registrata.

begin;

-- ─── 1. Le view dei saldi dipendono dalle colonne quantità: ricreate in fondo ─
drop view if exists public.supplier_balances;
drop view if exists public.supplier_purchase_financials;

-- ─── 2. Righe d'acquisto: quantità decimale, unità, conversione ──────────────
alter table public.supplier_purchase_items
  alter column ordered_quantity type numeric(14, 3) using ordered_quantity::numeric(14, 3);

alter table public.supplier_purchase_items
  add column if not exists purchase_unit text not null default 'unit',
  add column if not exists stock_units_per_purchase_unit numeric(14, 6);

alter table public.supplier_purchase_items
  drop constraint if exists supplier_purchase_items_purchase_unit_check,
  add constraint supplier_purchase_items_purchase_unit_check
    check (purchase_unit in ('unit', 'kg', 'g', 'l', 'ml', 'pack', 'box', 'carton', 'other')),
  drop constraint if exists supplier_purchase_items_conversion_check,
  add constraint supplier_purchase_items_conversion_check
    check (stock_units_per_purchase_unit is null or stock_units_per_purchase_unit > 0);

update public.supplier_purchase_items i
set stock_units_per_purchase_unit = 1
where i.product_id is not null and i.stock_units_per_purchase_unit is null;

comment on column public.supplier_purchase_items.stock_units_per_purchase_unit is
  'Unités de stock vendables par unité d''achat (ex. 2 par kg, 12 par carton). Null pour une ligne hors catalogue.';

-- ─── 3. Righe di ricezione: quantità decimale + snapshot della conversione ───
alter table public.supplier_receipt_items
  alter column quantity type numeric(14, 3) using quantity::numeric(14, 3);

alter table public.supplier_receipt_items
  add column if not exists purchase_unit text,
  add column if not exists conversion_factor numeric(14, 6),
  add column if not exists stock_units integer;

update public.supplier_receipt_items ri
set purchase_unit = 'unit',
    conversion_factor = case when ri.product_id is not null then 1 end,
    stock_units = case when ri.product_id is not null then ri.quantity::integer end
where ri.purchase_unit is null;

alter table public.supplier_receipt_items
  alter column purchase_unit set not null,
  alter column purchase_unit set default 'unit',
  drop constraint if exists supplier_receipt_items_purchase_unit_check,
  add constraint supplier_receipt_items_purchase_unit_check
    check (purchase_unit in ('unit', 'kg', 'g', 'l', 'ml', 'pack', 'box', 'carton', 'other')),
  drop constraint if exists supplier_receipt_items_stock_units_check,
  add constraint supplier_receipt_items_stock_units_check
    check (stock_units is null or stock_units >= 0);

-- ─── 4. Ledger: quantità sorgente, unità, conversione, riferimento, motivo ───
alter table public.inventory_movements
  add column if not exists source_quantity numeric(14, 3),
  add column if not exists source_unit text,
  add column if not exists conversion_factor numeric(14, 6),
  add column if not exists source_reference text,
  add column if not exists reason text;

alter table public.inventory_movements
  drop constraint if exists inventory_movements_source_unit_check,
  add constraint inventory_movements_source_unit_check
    check (source_unit is null or source_unit in ('unit', 'kg', 'g', 'l', 'ml', 'pack', 'box', 'carton', 'other')),
  drop constraint if exists inventory_movements_reason_check,
  add constraint inventory_movements_reason_check
    check (reason is null or length(reason) <= 300);

-- Movimenti di ricezione/storno esistenti: 1 unità d'acquisto = 1 unità di stock.
-- Colonne nuove soltanto: i valori storici esistenti non vengono riscritti.
update public.inventory_movements m
set source_quantity = abs(m.quantity_delta), source_unit = 'unit', conversion_factor = 1, source_reference = m.note
where m.source_type = 'supplier_receipt_item' and m.source_quantity is null;

-- ─── 5. Scadenze di pagamento ────────────────────────────────────────────────
alter table public.suppliers
  add column if not exists default_payment_terms_days integer;
alter table public.suppliers
  drop constraint if exists suppliers_payment_terms_check,
  add constraint suppliers_payment_terms_check
    check (default_payment_terms_days is null or default_payment_terms_days between 0 and 3650);

alter table public.supplier_purchases
  add column if not exists payment_due_date date;

comment on column public.supplier_purchases.payment_due_date is
  'Échéance de paiement (financière). Distincte de expected_date (livraison prévue). Figée à la création, jamais recalculée.';

create index if not exists supplier_purchases_due_idx
  on public.supplier_purchases (tenant_id, payment_due_date) where payment_due_date is not null;

-- ─── 6. Costo d'acquisto prodotto (server-only) ──────────────────────────────
create table if not exists public.product_cost_history (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  product_id           uuid,
  supplier_id          uuid,
  purchase_id          uuid not null,
  receipt_id           uuid not null,
  receipt_item_id      uuid not null,
  received_at          timestamptz not null,
  purchase_quantity    numeric(14, 3) not null check (purchase_quantity > 0),
  purchase_unit        text not null check (purchase_unit in ('unit', 'kg', 'g', 'l', 'ml', 'pack', 'box', 'carton', 'other')),
  conversion_factor    numeric(14, 6) not null check (conversion_factor > 0),
  stock_units          integer not null check (stock_units > 0),
  purchase_unit_cost   numeric(12, 4) not null check (purchase_unit_cost >= 0),
  cost_per_stock_unit  numeric(14, 4) not null check (cost_per_stock_unit >= 0),
  currency             text not null check (currency ~ '^[A-Z]{3}$'),
  status               text not null default 'active' check (status in ('active', 'reversed')),
  reversed_at          timestamptz,
  reversed_by_admin_id uuid references public.admin_users(id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint product_cost_history_reversed_check check (status <> 'reversed' or reversed_at is not null),
  constraint product_cost_history_receipt_item_key unique (receipt_item_id),
  constraint product_cost_history_product_fk foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete set null (product_id),
  constraint product_cost_history_supplier_fk foreign key (tenant_id, supplier_id)
    references public.suppliers (tenant_id, id),
  constraint product_cost_history_purchase_fk foreign key (tenant_id, purchase_id)
    references public.supplier_purchases (tenant_id, id),
  constraint product_cost_history_receipt_fk foreign key (tenant_id, receipt_id)
    references public.supplier_receipts (tenant_id, id),
  constraint product_cost_history_receipt_item_fk foreign key (tenant_id, receipt_item_id)
    references public.supplier_receipt_items (tenant_id, id)
);

create index if not exists product_cost_history_product_idx
  on public.product_cost_history (tenant_id, product_id, received_at desc, created_at desc);

comment on table public.product_cost_history is
  'Historique append-only des coûts d''achat par unité de stock (une ligne par ligne de réception liée au catalogue). Seuls status/reversed_* évoluent lors d''une annulation de réception.';

-- Append-only: soltanto lo stato di storno può cambiare.
create or replace function public.product_cost_history_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (to_jsonb(new) - array['status', 'reversed_at', 'reversed_by_admin_id'])
     is distinct from (to_jsonb(old) - array['status', 'reversed_at', 'reversed_by_admin_id']) then
    raise exception 'product_cost_history_append_only';
  end if;
  if old.status = 'reversed' and new.status <> 'reversed' then
    raise exception 'product_cost_history_append_only';
  end if;
  return new;
end;
$$;

drop trigger if exists product_cost_history_guard on public.product_cost_history;
create trigger product_cost_history_guard
  before update on public.product_cost_history
  for each row execute function public.product_cost_history_guard();

create table if not exists public.product_costs (
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  product_id             uuid not null,
  currency               text not null check (currency ~ '^[A-Z]{3}$'),
  current_purchase_cost  numeric(14, 4) not null check (current_purchase_cost >= 0),
  cost_method            text not null default 'last_received_purchase_cost'
                           check (cost_method in ('last_received_purchase_cost')),
  source_history_id      uuid not null references public.product_cost_history(id),
  source_receipt_item_id uuid not null,
  source_purchase_id     uuid not null,
  source_supplier_id     uuid,
  effective_at           timestamptz not null,
  updated_at             timestamptz not null default now(),
  primary key (tenant_id, product_id),
  constraint product_costs_product_fk foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete cascade
);

comment on table public.product_costs is
  'Coût d''achat courant par unité de stock (dernier coût d''achat reçu, frais supplémentaires exclus). Cache déterministe de product_cost_history, jamais exposé au storefront.';

-- Ricalcola deterministicamente il costo corrente dall'ultimo evento valido.
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
  order by h.received_at desc, h.created_at desc, h.id desc
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

-- ─── 7. Helper decimali ──────────────────────────────────────────────────────
-- Quantità positiva con al massimo 3 decimali (rifiuto, mai arrotondamento).
create or replace function public.business_quantity(p_value text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_quantity numeric;
begin
  begin
    v_quantity := p_value::numeric;
  exception when others then
    raise exception 'invalid_quantity';
  end;
  if v_quantity is null or v_quantity < 0 then raise exception 'invalid_quantity'; end if;
  if v_quantity <> round(v_quantity, 3) then raise exception 'quantity_precision'; end if;
  if v_quantity > 99999999999 then raise exception 'invalid_quantity'; end if;
  return v_quantity;
end;
$$;

-- ─── 8. Fornitori: condizioni di pagamento ───────────────────────────────────
create or replace function public.business_payment_terms(p_data jsonb)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_days integer;
begin
  if nullif(p_data->>'default_payment_terms_days', '') is null then return null; end if;
  begin
    v_days := (p_data->>'default_payment_terms_days')::integer;
  exception when others then
    raise exception 'invalid_payment_terms';
  end;
  if v_days < 0 or v_days > 3650 then raise exception 'invalid_payment_terms'; end if;
  return v_days;
end;
$$;

create or replace function public.create_supplier(
  p_tenant_id uuid,
  p_data jsonb,
  p_request_key text,
  p_actor uuid
)
returns table (out_supplier_id uuid, out_code text, out_created boolean)
language plpgsql
set search_path = public
as $$
declare
  v_existing public.suppliers%rowtype;
  v_id       uuid;
  v_code     text;
  v_name     text := public.business_text(p_data, 'name', 200);
  v_currency text;
  v_terms    integer := public.business_payment_terms(p_data);
begin
  if p_request_key is null or length(p_request_key) not between 8 and 200 then
    raise exception 'request_key_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('supplier:' || p_tenant_id::text || ':' || p_request_key, 0));

  select s.* into v_existing
  from public.suppliers s
  where s.tenant_id = p_tenant_id and s.request_key = p_request_key;
  if found then
    return query select v_existing.id, v_existing.code, false;
    return;
  end if;

  if v_name is null then raise exception 'supplier_name_required'; end if;
  select coalesce(public.business_text(p_data, 'currency', 3), t.currency, 'EUR') into v_currency
  from public.tenants t where t.id = p_tenant_id;
  if v_currency is null then raise exception 'tenant_not_found'; end if;

  v_code := public.next_business_reference(p_tenant_id, 'supplier');
  insert into public.suppliers (
    tenant_id, code, name, legal_name, contact_name, email, phone, whatsapp_phone,
    address, country, currency, notes, active, default_payment_terms_days, request_key, created_by_admin_id
  ) values (
    p_tenant_id, v_code, v_name,
    public.business_text(p_data, 'legal_name', 200),
    public.business_text(p_data, 'contact_name', 200),
    lower(public.business_text(p_data, 'email', 254)),
    public.business_text(p_data, 'phone', 40),
    public.business_text(p_data, 'whatsapp_phone', 40),
    public.business_text(p_data, 'address', 500),
    upper(public.business_text(p_data, 'country', 2)),
    upper(v_currency),
    public.business_text(p_data, 'notes', 4000),
    coalesce((p_data->>'active')::boolean, true),
    v_terms,
    p_request_key, p_actor
  )
  returning id into v_id;

  perform public.log_business_event(p_tenant_id, 'supplier', v_id, 'supplier.created', p_actor,
    jsonb_build_object('code', v_code, 'name', v_name, 'payment_terms_days', v_terms));
  return query select v_id, v_code, true;
end;
$$;

create or replace function public.update_supplier(
  p_tenant_id uuid,
  p_supplier_id uuid,
  p_data jsonb,
  p_actor uuid
)
returns table (out_supplier_id uuid, out_updated boolean)
language plpgsql
set search_path = public
as $$
declare
  v_row     public.suppliers%rowtype;
  v_changed text[] := array[]::text[];
  v_key     text;
  v_terms   integer := public.business_payment_terms(p_data);
begin
  select s.* into v_row
  from public.suppliers s
  where s.id = p_supplier_id and s.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'supplier_not_found'; end if;

  if p_data ? 'name' then
    if public.business_text(p_data, 'name', 200) is null then raise exception 'supplier_name_required'; end if;
  end if;

  foreach v_key in array array['name', 'legal_name', 'contact_name', 'email', 'phone', 'whatsapp_phone',
                               'address', 'country', 'currency', 'notes', 'active', 'default_payment_terms_days'] loop
    if p_data ? v_key then v_changed := v_changed || v_key; end if;
  end loop;
  if cardinality(v_changed) = 0 then
    return query select v_row.id, false;
    return;
  end if;

  update public.suppliers s set
    name           = case when p_data ? 'name' then public.business_text(p_data, 'name', 200) else s.name end,
    legal_name     = case when p_data ? 'legal_name' then public.business_text(p_data, 'legal_name', 200) else s.legal_name end,
    contact_name   = case when p_data ? 'contact_name' then public.business_text(p_data, 'contact_name', 200) else s.contact_name end,
    email          = case when p_data ? 'email' then lower(public.business_text(p_data, 'email', 254)) else s.email end,
    phone          = case when p_data ? 'phone' then public.business_text(p_data, 'phone', 40) else s.phone end,
    whatsapp_phone = case when p_data ? 'whatsapp_phone' then public.business_text(p_data, 'whatsapp_phone', 40) else s.whatsapp_phone end,
    address        = case when p_data ? 'address' then public.business_text(p_data, 'address', 500) else s.address end,
    country        = case when p_data ? 'country' then upper(public.business_text(p_data, 'country', 2)) else s.country end,
    currency       = case when p_data ? 'currency' then coalesce(upper(public.business_text(p_data, 'currency', 3)), s.currency) else s.currency end,
    notes          = case when p_data ? 'notes' then public.business_text(p_data, 'notes', 4000) else s.notes end,
    active         = case when p_data ? 'active' then coalesce((p_data->>'active')::boolean, s.active) else s.active end,
    -- Les échéances déjà calculées sur les achats ne changent jamais rétroactivement.
    default_payment_terms_days = case when p_data ? 'default_payment_terms_days' then v_terms else s.default_payment_terms_days end,
    updated_at     = now()
  where s.id = v_row.id and s.tenant_id = p_tenant_id;

  perform public.log_business_event(p_tenant_id, 'supplier', v_row.id, 'supplier.updated', p_actor,
    jsonb_build_object('fields', to_jsonb(v_changed)));
  return query select v_row.id, true;
end;
$$;

-- ─── 9. Acquisti: righe decimali, unità, conversione, scadenza ───────────────
create or replace function public.replace_supplier_purchase_items(
  p_tenant_id uuid,
  p_purchase_id uuid,
  p_items jsonb
)
returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_item       jsonb;
  v_position   integer := 0;
  v_product_id uuid;
  v_quantity   numeric;
  v_unit_cost  numeric(12, 4);
  v_desc       text;
  v_unit       text;
  v_conversion numeric;
  v_subtotal   numeric(12, 2) := 0;
  v_line_total numeric(12, 2);
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'items_required'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'too_many_items'; end if;

  delete from public.supplier_purchase_items i where i.purchase_id = p_purchase_id and i.tenant_id = p_tenant_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_quantity := public.business_quantity(v_item->>'ordered_quantity');
    if v_quantity <= 0 then raise exception 'invalid_quantity'; end if;
    v_unit_cost := round((v_item->>'unit_cost')::numeric, 4);
    v_desc := public.business_text(v_item, 'description', 300);
    v_unit := coalesce(nullif(v_item->>'purchase_unit', ''), 'unit');
    if v_unit not in ('unit', 'kg', 'g', 'l', 'ml', 'pack', 'box', 'carton', 'other') then raise exception 'invalid_unit'; end if;

    if v_unit_cost is null or v_unit_cost < 0 then raise exception 'invalid_unit_cost'; end if;
    if v_product_id is not null then
      -- Stesso tenant (difesa esplicita oltre alla FK composita).
      select coalesce(v_desc, pr.name) into v_desc
      from public.products pr where pr.id = v_product_id and pr.tenant_id = p_tenant_id;
      if not found then raise exception 'product_not_found'; end if;
      begin
        v_conversion := coalesce(nullif(v_item->>'stock_units_per_purchase_unit', '')::numeric, 1);
      exception when others then
        raise exception 'invalid_conversion';
      end;
      if v_conversion <= 0 or v_conversion <> round(v_conversion, 6) or v_conversion > 100000 then
        raise exception 'invalid_conversion';
      end if;
    else
      v_conversion := null;
    end if;
    if v_desc is null then raise exception 'item_description_required'; end if;

    v_line_total := round(v_quantity * v_unit_cost, 2);
    v_subtotal := v_subtotal + v_line_total;
    insert into public.supplier_purchase_items (
      tenant_id, purchase_id, product_id, description, ordered_quantity, purchase_unit,
      stock_units_per_purchase_unit, unit_cost, line_total, position
    ) values (
      p_tenant_id, p_purchase_id, v_product_id, v_desc, v_quantity, v_unit,
      v_conversion, v_unit_cost, v_line_total, v_position
    );
    v_position := v_position + 1;
  end loop;

  return v_subtotal;
end;
$$;

create or replace function public.save_supplier_purchase(
  p_tenant_id uuid,
  p_purchase_id uuid,
  p_data jsonb,
  p_items jsonb,
  p_request_key text,
  p_actor uuid
)
returns table (out_purchase_id uuid, out_reference text, out_created boolean, out_total numeric)
language plpgsql
set search_path = public
as $$
declare
  v_row         public.supplier_purchases%rowtype;
  v_supplier    public.suppliers%rowtype;
  v_currency    text;
  v_status      text := coalesce(nullif(p_data->>'status', ''), 'draft');
  v_additional  numeric(12, 2) := round(coalesce(nullif(p_data->>'additional_costs', '')::numeric, 0), 2);
  v_subtotal    numeric(12, 2);
  v_allocated   numeric(12, 2);
  v_id          uuid;
  v_reference   text;
  v_order_date  date := coalesce(nullif(p_data->>'order_date', '')::date, current_date);
  v_due         date := nullif(p_data->>'payment_due_date', '')::date;
begin
  if v_additional < 0 then raise exception 'invalid_additional_costs'; end if;

  if p_purchase_id is null then
    -- Creazione, idempotente per request_key.
    if p_request_key is null or length(p_request_key) not between 8 and 200 then
      raise exception 'request_key_required';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('purchase:' || p_tenant_id::text || ':' || p_request_key, 0));
    select sp.* into v_row
    from public.supplier_purchases sp
    where sp.tenant_id = p_tenant_id and sp.request_key = p_request_key;
    if found then
      return query select v_row.id, v_row.reference, false, v_row.total;
      return;
    end if;

    if v_status not in ('draft', 'ordered') then raise exception 'invalid_initial_status'; end if;
    select s.* into v_supplier
    from public.suppliers s
    where s.id = nullif(p_data->>'supplier_id', '')::uuid and s.tenant_id = p_tenant_id and s.active;
    if not found then raise exception 'supplier_not_found'; end if;
    v_currency := coalesce(upper(public.business_text(p_data, 'currency', 3)), v_supplier.currency);
    -- Échéance figée à la création : date fournie, sinon date de commande + conditions du fournisseur.
    if v_due is null and v_supplier.default_payment_terms_days is not null then
      v_due := v_order_date + v_supplier.default_payment_terms_days;
    end if;

    v_reference := public.next_business_reference(p_tenant_id, 'purchase');
    insert into public.supplier_purchases (
      tenant_id, reference, supplier_id, supplier_reference, order_date, expected_date, payment_due_date, currency,
      status, additional_costs, subtotal, total, notes, request_key, created_by_admin_id, ordered_at
    ) values (
      p_tenant_id, v_reference, v_supplier.id,
      public.business_text(p_data, 'supplier_reference', 120),
      v_order_date,
      nullif(p_data->>'expected_date', '')::date,
      v_due,
      v_currency, 'draft', v_additional, 0, v_additional,
      public.business_text(p_data, 'notes', 4000), p_request_key, p_actor, null
    )
    returning id into v_id;

    v_subtotal := public.replace_supplier_purchase_items(p_tenant_id, v_id, p_items);
    if v_status = 'ordered' and not exists (
      select 1 from public.supplier_purchase_items i where i.purchase_id = v_id and i.tenant_id = p_tenant_id
    ) then
      raise exception 'purchase_items_required';
    end if;
    update public.supplier_purchases sp
    set subtotal = v_subtotal, total = v_subtotal + v_additional,
        status = v_status, ordered_at = case when v_status = 'ordered' then now() else null end
    where sp.id = v_id and sp.tenant_id = p_tenant_id;

    perform public.log_business_event(p_tenant_id, 'purchase', v_id, 'purchase.created', p_actor,
      jsonb_build_object('reference', v_reference, 'status', v_status, 'total', v_subtotal + v_additional,
                         'items', jsonb_array_length(p_items), 'payment_due_date', v_due));
    return query select v_id, v_reference, true, (v_subtotal + v_additional)::numeric;
    return;
  end if;

  -- Modifica: solo prima di qualsiasi ricezione.
  select sp.* into v_row
  from public.supplier_purchases sp
  where sp.id = p_purchase_id and sp.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'purchase_not_found'; end if;
  if v_row.status not in ('draft', 'ordered') then raise exception 'purchase_not_editable:%', v_row.status; end if;
  if exists (select 1 from public.supplier_receipts r where r.purchase_id = v_row.id and r.tenant_id = p_tenant_id) then
    raise exception 'purchase_has_receipts';
  end if;

  if p_items is not null then
    v_subtotal := public.replace_supplier_purchase_items(p_tenant_id, v_row.id, p_items);
    if v_row.status = 'ordered' and not exists (
      select 1 from public.supplier_purchase_items i where i.purchase_id = v_row.id and i.tenant_id = p_tenant_id
    ) then
      raise exception 'purchase_items_required';
    end if;
  else
    v_subtotal := v_row.subtotal;
  end if;
  if not (p_data ? 'additional_costs') then v_additional := v_row.additional_costs; end if;

  -- Il nuovo totale non può scendere sotto quanto già allocato.
  select coalesce(sum(al.amount), 0) into v_allocated
  from public.supplier_payment_allocations al
  join public.supplier_payments p on p.id = al.payment_id and p.tenant_id = al.tenant_id
  where al.purchase_id = v_row.id and al.tenant_id = p_tenant_id and al.reversed_at is null and p.status <> 'voided';
  if v_subtotal + v_additional < v_allocated then raise exception 'total_below_allocated'; end if;

  update public.supplier_purchases sp set
    supplier_reference = case when p_data ? 'supplier_reference' then public.business_text(p_data, 'supplier_reference', 120) else sp.supplier_reference end,
    order_date = case when p_data ? 'order_date' then coalesce(nullif(p_data->>'order_date', '')::date, sp.order_date) else sp.order_date end,
    expected_date = case when p_data ? 'expected_date' then nullif(p_data->>'expected_date', '')::date else sp.expected_date end,
    payment_due_date = case when p_data ? 'payment_due_date' then nullif(p_data->>'payment_due_date', '')::date else sp.payment_due_date end,
    notes = case when p_data ? 'notes' then public.business_text(p_data, 'notes', 4000) else sp.notes end,
    additional_costs = v_additional,
    subtotal = v_subtotal,
    total = v_subtotal + v_additional,
    updated_at = now()
  where sp.id = v_row.id and sp.tenant_id = p_tenant_id;

  perform public.log_business_event(p_tenant_id, 'purchase', v_row.id, 'purchase.updated', p_actor,
    jsonb_build_object('reference', v_row.reference, 'previous_total', v_row.total, 'total', v_subtotal + v_additional,
                       'items_replaced', p_items is not null));
  return query select v_row.id, v_row.reference, false, (v_subtotal + v_additional)::numeric;
end;
$$;

-- La scadenza è un dato finanziario: modificabile anche dopo le ricezioni.
create or replace function public.set_supplier_purchase_due_date(
  p_tenant_id uuid,
  p_purchase_id uuid,
  p_due_date date,
  p_actor uuid
)
returns table (out_purchase_id uuid, out_payment_due_date date, out_changed boolean)
language plpgsql
set search_path = public
as $$
declare
  v_row public.supplier_purchases%rowtype;
begin
  select sp.* into v_row
  from public.supplier_purchases sp
  where sp.id = p_purchase_id and sp.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'purchase_not_found'; end if;
  if v_row.status = 'cancelled' then raise exception 'purchase_cancelled'; end if;

  if v_row.payment_due_date is not distinct from p_due_date then
    return query select v_row.id, v_row.payment_due_date, false;
    return;
  end if;

  update public.supplier_purchases sp set payment_due_date = p_due_date, updated_at = now()
  where sp.id = v_row.id and sp.tenant_id = p_tenant_id;

  perform public.log_business_event(p_tenant_id, 'purchase', v_row.id, 'purchase.updated', p_actor,
    jsonb_build_object('reference', v_row.reference, 'from', v_row.payment_due_date, 'to', p_due_date, 'field', 'payment_due_date'));
  return query select v_row.id, p_due_date, true;
end;
$$;

create or replace function public.refresh_supplier_purchase_receipt_status(p_tenant_id uuid, p_purchase_id uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_current  text;
  v_received numeric;
  v_complete boolean;
  v_next     text;
begin
  select sp.status into v_current
  from public.supplier_purchases sp where sp.id = p_purchase_id and sp.tenant_id = p_tenant_id;
  if v_current in ('draft', 'cancelled') then return v_current; end if;

  select sum(least(coalesce(r.received, 0), i.ordered_quantity)),
         bool_and(coalesce(r.received, 0) >= i.ordered_quantity)
  into v_received, v_complete
  from public.supplier_purchase_items i
  left join lateral (
    select sum(ri.quantity) as received
    from public.supplier_receipt_items ri
    join public.supplier_receipts rc on rc.id = ri.receipt_id and rc.tenant_id = ri.tenant_id
    where ri.purchase_item_id = i.id and ri.tenant_id = i.tenant_id and rc.status = 'recorded'
  ) r on true
  where i.purchase_id = p_purchase_id and i.tenant_id = p_tenant_id;

  v_next := case
    when coalesce(v_complete, false) then 'received'
    when coalesce(v_received, 0) > 0 then 'partially_received'
    else 'ordered'
  end;
  if v_next <> v_current then
    update public.supplier_purchases sp set status = v_next, updated_at = now()
    where sp.id = p_purchase_id and sp.tenant_id = p_tenant_id;
  end if;
  return v_next;
end;
$$;

-- ─── 10. Ricezione: decimali, conversione intera, costo, storico ─────────────
create or replace function public.record_supplier_receipt(
  p_tenant_id uuid,
  p_purchase_id uuid,
  p_items jsonb,
  p_received_at timestamptz,
  p_notes text,
  p_request_key text,
  p_actor uuid
)
returns table (out_receipt_id uuid, out_reference text, out_created boolean, out_purchase_status text)
language plpgsql
set search_path = public
as $$
declare
  v_purchase     public.supplier_purchases%rowtype;
  v_existing     public.supplier_receipts%rowtype;
  v_receipt_id   uuid;
  v_reference    text;
  v_received_at  timestamptz := coalesce(p_received_at, now());
  v_item         jsonb;
  v_line         public.supplier_purchase_items%rowtype;
  v_quantity     numeric;
  v_already      numeric;
  v_stock_exact  numeric;
  v_stock_units  integer;
  v_receipt_item uuid;
  v_stock_after  integer;
  v_cost         numeric(14, 4);
  v_lines        integer := 0;
  v_units        bigint := 0;
  v_status       text;
begin
  if p_request_key is null or length(p_request_key) not between 8 and 200 then
    raise exception 'request_key_required';
  end if;

  -- Lock dell'acquisto: le richieste concorrenti (doppio clic, retry) si serializzano qui.
  select sp.* into v_purchase
  from public.supplier_purchases sp
  where sp.id = p_purchase_id and sp.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'purchase_not_found'; end if;

  select r.* into v_existing
  from public.supplier_receipts r
  where r.tenant_id = p_tenant_id and r.request_key = p_request_key;
  if found then
    if v_existing.purchase_id <> p_purchase_id then raise exception 'request_key_conflict'; end if;
    return query select v_existing.id, v_existing.reference, false, v_purchase.status;
    return;
  end if;

  if v_purchase.status not in ('ordered', 'partially_received') then
    raise exception 'purchase_not_receivable:%', v_purchase.status;
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'receipt_items_required';
  end if;
  if v_received_at > now() + interval '1 day' then
    raise exception 'received_at_in_future';
  end if;

  v_reference := public.next_business_reference(p_tenant_id, 'receipt');
  insert into public.supplier_receipts (tenant_id, reference, purchase_id, received_at, notes, request_key, created_by_admin_id)
  values (p_tenant_id, v_reference, v_purchase.id, v_received_at, nullif(btrim(p_notes), ''), p_request_key, p_actor)
  returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := public.business_quantity(v_item->>'quantity');
    continue when v_quantity = 0;

    select i.* into v_line
    from public.supplier_purchase_items i
    where i.id = nullif(v_item->>'purchase_item_id', '')::uuid
      and i.purchase_id = v_purchase.id and i.tenant_id = p_tenant_id;
    if not found then raise exception 'purchase_item_not_found'; end if;

    select coalesce(sum(ri.quantity), 0) into v_already
    from public.supplier_receipt_items ri
    join public.supplier_receipts rc on rc.id = ri.receipt_id and rc.tenant_id = ri.tenant_id
    where ri.purchase_item_id = v_line.id and ri.tenant_id = p_tenant_id and rc.status = 'recorded';
    if v_already + v_quantity > v_line.ordered_quantity then
      raise exception 'quantity_exceeds_remaining:%', v_line.description;
    end if;

    -- Conversione verso le unità di stock vendibili: deve dare un intero.
    v_stock_units := null;
    if v_line.product_id is not null then
      v_stock_exact := v_quantity * coalesce(v_line.stock_units_per_purchase_unit, 1);
      if v_stock_exact <> trunc(v_stock_exact) then
        raise exception 'stock_units_not_integer:%', v_line.description;
      end if;
      if v_stock_exact > 2000000000 then raise exception 'invalid_quantity'; end if;
      v_stock_units := v_stock_exact::integer;
    end if;

    insert into public.supplier_receipt_items (
      tenant_id, receipt_id, purchase_item_id, product_id, quantity, purchase_unit, conversion_factor, stock_units
    ) values (
      p_tenant_id, v_receipt_id, v_line.id, v_line.product_id, v_quantity, v_line.purchase_unit,
      case when v_line.product_id is not null then coalesce(v_line.stock_units_per_purchase_unit, 1) end,
      v_stock_units
    )
    returning id into v_receipt_item;

    if v_line.product_id is not null and v_stock_units > 0 then
      update public.products pr set stock = pr.stock + v_stock_units
      where pr.id = v_line.product_id and pr.tenant_id = p_tenant_id
      returning pr.stock into v_stock_after;
      if found then
        insert into public.inventory_movements (
          tenant_id, product_id, movement_type, quantity_delta, stock_after, source_type, source_id,
          source_quantity, source_unit, conversion_factor, source_reference, note, created_by_admin_id
        ) values (
          p_tenant_id, v_line.product_id, 'supplier_receipt', v_stock_units, v_stock_after,
          'supplier_receipt_item', v_receipt_item, v_quantity, v_line.purchase_unit,
          coalesce(v_line.stock_units_per_purchase_unit, 1), v_reference, v_reference, p_actor
        );

        -- Dernier coût d'achat, par unité de stock (frais supplémentaires exclus).
        v_cost := round(v_line.unit_cost / coalesce(v_line.stock_units_per_purchase_unit, 1), 4);
        insert into public.product_cost_history (
          tenant_id, product_id, supplier_id, purchase_id, receipt_id, receipt_item_id, received_at,
          purchase_quantity, purchase_unit, conversion_factor, stock_units, purchase_unit_cost,
          cost_per_stock_unit, currency
        ) values (
          p_tenant_id, v_line.product_id, v_purchase.supplier_id, v_purchase.id, v_receipt_id, v_receipt_item, v_received_at,
          v_quantity, v_line.purchase_unit, coalesce(v_line.stock_units_per_purchase_unit, 1), v_stock_units,
          v_line.unit_cost, v_cost, v_purchase.currency
        );
        perform public.refresh_product_cost(p_tenant_id, v_line.product_id);
      end if;
    end if;
    v_lines := v_lines + 1;
    v_units := v_units + coalesce(v_stock_units, 0);
  end loop;

  if v_lines = 0 then raise exception 'receipt_items_required'; end if;

  v_status := public.refresh_supplier_purchase_receipt_status(p_tenant_id, v_purchase.id);
  perform public.log_business_event(p_tenant_id, 'receipt', v_receipt_id, 'receipt.recorded', p_actor,
    jsonb_build_object('reference', v_reference, 'purchase', v_purchase.reference, 'lines', v_lines,
                       'units', v_units, 'purchase_status', v_status));
  return query select v_receipt_id, v_reference, true, v_status;
end;
$$;

create or replace function public.reverse_supplier_receipt(
  p_tenant_id uuid,
  p_receipt_id uuid,
  p_reason text,
  p_actor uuid
)
returns table (out_receipt_id uuid, out_reversed boolean, out_purchase_status text)
language plpgsql
set search_path = public
as $$
declare
  v_receipt     public.supplier_receipts%rowtype;
  v_purchase    public.supplier_purchases%rowtype;
  v_line        record;
  v_units       integer;
  v_stock_after integer;
  v_status      text;
begin
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

  select r.* into v_receipt
  from public.supplier_receipts r
  where r.id = p_receipt_id and r.tenant_id = p_tenant_id;
  if not found then raise exception 'receipt_not_found'; end if;

  -- Stesso ordine di lock della ricezione: prima l'acquisto, poi la ricezione.
  select sp.* into v_purchase
  from public.supplier_purchases sp
  where sp.id = v_receipt.purchase_id and sp.tenant_id = p_tenant_id
  for update;
  select r.* into v_receipt
  from public.supplier_receipts r
  where r.id = p_receipt_id and r.tenant_id = p_tenant_id
  for update;

  if v_receipt.status = 'reversed' then
    return query select v_receipt.id, false, v_purchase.status;
    return;
  end if;

  for v_line in
    select ri.id, ri.product_id, ri.quantity, ri.purchase_unit, ri.conversion_factor, ri.stock_units
    from public.supplier_receipt_items ri
    where ri.receipt_id = v_receipt.id and ri.tenant_id = p_tenant_id
  loop
    -- Valeurs historiques de la réception, jamais la conversion actuelle de la ligne d'achat.
    v_units := coalesce(v_line.stock_units, 0);
    if v_line.product_id is not null and v_units > 0 then
      update public.products pr set stock = pr.stock - v_units
      where pr.id = v_line.product_id and pr.tenant_id = p_tenant_id and pr.stock >= v_units
      returning pr.stock into v_stock_after;
      if not found then
        if exists (select 1 from public.products pr where pr.id = v_line.product_id and pr.tenant_id = p_tenant_id) then
          raise exception 'insufficient_stock_for_reversal:%', v_line.product_id;
        end if;
      else
        insert into public.inventory_movements (
          tenant_id, product_id, movement_type, quantity_delta, stock_after, source_type, source_id,
          source_quantity, source_unit, conversion_factor, source_reference, note, created_by_admin_id
        ) values (
          p_tenant_id, v_line.product_id, 'reversal', -v_units, v_stock_after,
          'supplier_receipt_item', v_line.id, v_line.quantity, v_line.purchase_unit, v_line.conversion_factor,
          v_receipt.reference, v_receipt.reference, p_actor
        );
      end if;
    end if;

    update public.product_cost_history h
    set status = 'reversed', reversed_at = now(), reversed_by_admin_id = p_actor
    where h.receipt_item_id = v_line.id and h.tenant_id = p_tenant_id and h.status = 'active';
    if v_line.product_id is not null then
      perform public.refresh_product_cost(p_tenant_id, v_line.product_id);
    end if;
  end loop;

  update public.supplier_receipts r
  set status = 'reversed', reversed_at = now(), reversed_by_admin_id = p_actor,
      reversal_reason = left(btrim(p_reason), 1000)
  where r.id = v_receipt.id and r.tenant_id = p_tenant_id;

  v_status := public.refresh_supplier_purchase_receipt_status(p_tenant_id, v_purchase.id);
  perform public.log_business_event(p_tenant_id, 'receipt', v_receipt.id, 'receipt.reversed', p_actor,
    jsonb_build_object('reference', v_receipt.reference, 'purchase', v_purchase.reference,
                       'reason', left(btrim(p_reason), 300), 'purchase_status', v_status));
  return query select v_receipt.id, true, v_status;
end;
$$;

-- ─── 11. Rettifica manuale: motivo + nota, nessun costo inventato ────────────
drop function if exists public.adjust_inventory(uuid, uuid, integer, text, text, uuid);

create or replace function public.adjust_inventory(
  p_tenant_id uuid,
  p_product_id uuid,
  p_delta integer,
  p_reason text,
  p_note text,
  p_request_key text,
  p_actor uuid
)
returns table (out_movement_id uuid, out_created boolean, out_stock_after integer)
language plpgsql
set search_path = public
as $$
declare
  v_existing    public.inventory_movements%rowtype;
  v_stock_after integer;
  v_id          uuid;
  v_reason      text := nullif(btrim(p_reason), '');
begin
  if p_request_key is null or length(p_request_key) not between 8 and 200 then
    raise exception 'request_key_required';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then raise exception 'invalid_quantity'; end if;
  if v_reason is null then raise exception 'reason_required'; end if;
  if length(v_reason) > 300 then raise exception 'field_too_long:reason'; end if;

  perform pg_advisory_xact_lock(hashtextextended('inventory:' || p_tenant_id::text || ':' || p_request_key, 0));
  select m.* into v_existing
  from public.inventory_movements m
  where m.tenant_id = p_tenant_id and m.request_key = p_request_key;
  if found then
    if v_existing.product_id is distinct from p_product_id then raise exception 'request_key_conflict'; end if;
    return query select v_existing.id, false, v_existing.stock_after;
    return;
  end if;

  update public.products pr set stock = pr.stock + p_delta
  where pr.id = p_product_id and pr.tenant_id = p_tenant_id and pr.stock + p_delta >= 0
  returning pr.stock into v_stock_after;
  if not found then
    if exists (select 1 from public.products pr where pr.id = p_product_id and pr.tenant_id = p_tenant_id) then
      raise exception 'stock_would_be_negative';
    end if;
    raise exception 'product_not_found';
  end if;

  -- Une rectification ne crée jamais de coût d'achat : product_costs reste inchangé.
  insert into public.inventory_movements (
    tenant_id, product_id, movement_type, quantity_delta, stock_after, source_type, request_key,
    reason, note, created_by_admin_id
  ) values (
    p_tenant_id, p_product_id, 'manual_adjustment', p_delta, v_stock_after, 'manual', p_request_key,
    v_reason, left(nullif(btrim(p_note), ''), 1000), p_actor
  )
  returning id into v_id;

  perform public.log_business_event(p_tenant_id, 'inventory', p_product_id, 'inventory.adjusted', p_actor,
    jsonb_build_object('delta', p_delta, 'stock_after', v_stock_after, 'reason', left(v_reason, 300)));
  return query select v_id, true, v_stock_after;
end;
$$;

-- ─── 12. View ────────────────────────────────────────────────────────────────
-- Saldi per acquisto (regola 140: una bozza non è un debito) + scadenza, quantità decimali.
create view public.supplier_purchase_financials
with (security_invoker = true)
as
select
  p.id as purchase_id,
  p.tenant_id,
  p.supplier_id,
  p.status,
  p.currency,
  p.total,
  coalesce(a.paid_verified, 0)::numeric(12, 2) as paid_verified,
  coalesce(a.paid_unverified, 0)::numeric(12, 2) as paid_unverified,
  case when p.status in ('cancelled', 'draft') then 0
       else greatest(p.total - coalesce(a.paid_verified, 0), 0) end::numeric(12, 2) as outstanding,
  case when p.status = 'cancelled' then 0
       else greatest(p.total - coalesce(a.paid_verified, 0) - coalesce(a.paid_unverified, 0), 0) end::numeric(12, 2) as allocatable,
  coalesce(q.ordered_quantity, 0)::numeric(16, 3) as ordered_quantity,
  coalesce(q.received_quantity, 0)::numeric(16, 3) as received_quantity,
  p.payment_due_date,
  p.order_date
from public.supplier_purchases p
left join lateral (
  select
    sum(al.amount) filter (where sp.status = 'verified') as paid_verified,
    sum(al.amount) filter (where sp.status = 'recorded') as paid_unverified
  from public.supplier_payment_allocations al
  join public.supplier_payments sp on sp.id = al.payment_id and sp.tenant_id = al.tenant_id
  where al.purchase_id = p.id and al.tenant_id = p.tenant_id and al.reversed_at is null
) a on true
left join lateral (
  select
    sum(i.ordered_quantity) as ordered_quantity,
    sum(least(coalesce(r.received, 0), i.ordered_quantity)) as received_quantity
  from public.supplier_purchase_items i
  left join lateral (
    select sum(ri.quantity) as received
    from public.supplier_receipt_items ri
    join public.supplier_receipts rc on rc.id = ri.receipt_id and rc.tenant_id = ri.tenant_id
    where ri.purchase_item_id = i.id and ri.tenant_id = i.tenant_id and rc.status = 'recorded'
  ) r on true
  where i.purchase_id = p.id and i.tenant_id = p.tenant_id
) q on true;

create view public.supplier_balances
with (security_invoker = true)
as
select
  s.id as supplier_id,
  s.tenant_id,
  s.currency,
  coalesce(f.total_purchased, 0)::numeric(12, 2) as total_purchased,
  coalesce(f.paid_verified, 0)::numeric(12, 2) as paid_verified,
  coalesce(f.paid_unverified, 0)::numeric(12, 2) as paid_unverified,
  coalesce(f.outstanding, 0)::numeric(12, 2) as outstanding,
  coalesce(f.purchase_count, 0)::bigint as purchase_count,
  f.last_purchase_date,
  pay.last_payment_date,
  coalesce(pay.unallocated, 0)::numeric(12, 2) as unallocated_payments
from public.suppliers s
left join lateral (
  select
    sum(pf.total) filter (where pf.status not in ('cancelled', 'draft')) as total_purchased,
    sum(pf.paid_verified) as paid_verified,
    sum(pf.paid_unverified) as paid_unverified,
    sum(pf.outstanding) as outstanding,
    count(*) filter (where pf.status not in ('cancelled', 'draft')) as purchase_count,
    max(pf.order_date) filter (where pf.status not in ('cancelled', 'draft')) as last_purchase_date
  from public.supplier_purchase_financials pf
  where pf.supplier_id = s.id and pf.tenant_id = s.tenant_id
) f on true
left join lateral (
  select
    max(p.payment_date) filter (where p.status <> 'voided') as last_payment_date,
    sum(p.amount - coalesce(al.allocated, 0)) filter (where p.status <> 'voided') as unallocated
  from public.supplier_payments p
  left join lateral (
    select sum(x.amount) as allocated
    from public.supplier_payment_allocations x
    where x.payment_id = p.id and x.tenant_id = p.tenant_id and x.reversed_at is null
  ) al on true
  where p.supplier_id = s.id and p.tenant_id = s.tenant_id
) pay on true;

-- Vista operativa stock: un prodotto per riga, ultimo movimento, ultima ricezione, costo corrente.
create or replace view public.inventory_product_overview
with (security_invoker = true)
as
select
  pr.id as product_id,
  pr.tenant_id,
  pr.name,
  pr.slug,
  pr.active,
  pr.stock,
  pr.price,
  lm.created_at as last_movement_at,
  lm.movement_type as last_movement_type,
  lr.received_at as last_receipt_at,
  c.current_purchase_cost,
  c.currency as cost_currency,
  c.effective_at as cost_effective_at
from public.products pr
left join lateral (
  select m.created_at, m.movement_type
  from public.inventory_movements m
  where m.tenant_id = pr.tenant_id and m.product_id = pr.id
  order by m.created_at desc
  limit 1
) lm on true
left join lateral (
  select max(m.created_at) as received_at
  from public.inventory_movements m
  where m.tenant_id = pr.tenant_id and m.product_id = pr.id and m.movement_type = 'supplier_receipt'
) lr on true
left join public.product_costs c on c.tenant_id = pr.tenant_id and c.product_id = pr.id;

-- ─── 13. Backfill dei costi dalle ricezioni esistenti (1 unità = 1 stock) ────
insert into public.product_cost_history (
  tenant_id, product_id, supplier_id, purchase_id, receipt_id, receipt_item_id, received_at,
  purchase_quantity, purchase_unit, conversion_factor, stock_units, purchase_unit_cost, cost_per_stock_unit, currency
)
select ri.tenant_id, ri.product_id, sp.supplier_id, sp.id, rc.id, ri.id, rc.received_at,
       ri.quantity, ri.purchase_unit, coalesce(ri.conversion_factor, 1), ri.stock_units, i.unit_cost,
       round(i.unit_cost / coalesce(ri.conversion_factor, 1), 4), sp.currency
from public.supplier_receipt_items ri
join public.supplier_receipts rc on rc.id = ri.receipt_id and rc.tenant_id = ri.tenant_id
join public.supplier_purchase_items i on i.id = ri.purchase_item_id and i.tenant_id = ri.tenant_id
join public.supplier_purchases sp on sp.id = rc.purchase_id and sp.tenant_id = rc.tenant_id
where rc.status = 'recorded' and ri.product_id is not null and coalesce(ri.stock_units, 0) > 0
on conflict (receipt_item_id) do nothing;

do $$
declare
  v_pair record;
begin
  for v_pair in select distinct h.tenant_id, h.product_id from public.product_cost_history h where h.product_id is not null loop
    perform public.refresh_product_cost(v_pair.tenant_id, v_pair.product_id);
  end loop;
end
$$;

-- ─── 14. Sicurezza ───────────────────────────────────────────────────────────
alter table public.product_costs enable row level security;
alter table public.product_cost_history enable row level security;
revoke all on table public.product_costs from public, anon, authenticated, service_role;
revoke all on table public.product_cost_history from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.product_costs to service_role; -- cache ricalcolabile
grant select, insert, update on table public.product_cost_history to service_role; -- update solo status (trigger)

do $$
declare
  v_view text;
begin
  foreach v_view in array array['supplier_purchase_financials', 'supplier_balances', 'inventory_product_overview'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_view);
    execute format('grant select on table public.%I to service_role', v_view);
  end loop;
end
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.product_cost_history_guard()',
    'public.refresh_product_cost(uuid, uuid)',
    'public.business_quantity(text)',
    'public.business_payment_terms(jsonb)',
    'public.create_supplier(uuid, jsonb, text, uuid)',
    'public.update_supplier(uuid, uuid, jsonb, uuid)',
    'public.replace_supplier_purchase_items(uuid, uuid, jsonb)',
    'public.save_supplier_purchase(uuid, uuid, jsonb, jsonb, text, uuid)',
    'public.set_supplier_purchase_due_date(uuid, uuid, date, uuid)',
    'public.refresh_supplier_purchase_receipt_status(uuid, uuid)',
    'public.record_supplier_receipt(uuid, uuid, jsonb, timestamptz, text, text, uuid)',
    'public.reverse_supplier_receipt(uuid, uuid, text, uuid)',
    'public.adjust_inventory(uuid, uuid, integer, text, text, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end
$$;

commit;
