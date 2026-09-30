-- MIGRATION 139: GESTION DU COMMERCE (fornitori, acquisti, ricezioni, stock ledger,
-- debiti e pagamenti fornitori, tesoreria operativa, documenti, audit)
--
-- Documentazione: docs/BUSINESS_MANAGEMENT.md
--
-- Principi:
-- * Additiva. Nessun tenant esistente viene modificato, nessuna feature attivata:
--   il modulo è visibile solo con il feature flag di rilascio `business_management`
--   (tenant_feature_flags, 138), assente = spento.
-- * Isolamento tenant nel DB: ogni tabella ha tenant_id e ogni riferimento fra
--   entità passa da una foreign key composita (tenant_id, id), così due UUID
--   validi di tenant diversi non possono essere collegati.
-- * Dati interni: RLS attiva SENZA policy, nessun privilegio per anon/authenticated,
--   accesso solo service_role (backend autorizzato). Tabelle finanziarie senza
--   privilegio DELETE: si annulla/storna, non si cancella.
-- * Saldi mai memorizzati: derivati da acquisti e allocazioni (view).
-- * Operazioni multi-entità in RPC transazionali (lock + validazione + scrittura
--   + audit), idempotenti tramite request_key univoca per tenant.
-- * RPC RETURNS TABLE con colonne out_* e colonne SQL sempre qualificate.
-- * products.stock resta la disponibilità operativa canonica: la ricezione lo
--   incrementa nella stessa transazione del movimento di inventario.
--
-- Rollback (solo se il modulo non è mai stato usato in produzione): in fondo al file.

begin;

-- ─── 0. Prerequisito: chiave composita su products ───────────────────────────
-- Serve alle FK composite (tenant_id, product_id): impedisce di collegare un
-- prodotto di un altro tenant. id è già PK, quindi il vincolo è sempre vero
-- per i dati esistenti; costruisce solo un indice.
do $$
begin
  if not exists (select 1 from pg_constraint c where c.conname = 'products_tenant_id_id_key') then
    alter table public.products add constraint products_tenant_id_id_key unique (tenant_id, id);
  end if;
end
$$;

-- ─── 1. Riferimenti leggibili (FOU-000123, ACH-2026-000123, …) ───────────────
create table if not exists public.business_reference_counters (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  scope      text not null check (scope in ('supplier', 'purchase', 'receipt', 'payment')),
  period     integer not null,
  last_value bigint not null check (last_value > 0),
  primary key (tenant_id, scope, period)
);

comment on table public.business_reference_counters is
  'Contatori per tenant dei riferimenti Gestion. Incremento atomico (insert … on conflict do update), mai count(*) + 1.';

create or replace function public.next_business_reference(p_tenant_id uuid, p_scope text)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_period integer;
  v_value  bigint;
  v_prefix text;
begin
  v_prefix := case p_scope
    when 'supplier' then 'FOU'
    when 'purchase' then 'ACH'
    when 'receipt'  then 'REC'
    when 'payment'  then 'PAY'
  end;
  if v_prefix is null then raise exception 'invalid_reference_scope:%', p_scope; end if;
  -- I fornitori hanno una numerazione continua, gli altri documenti annuale.
  v_period := case when p_scope = 'supplier' then 0 else extract(year from now())::integer end;

  insert into public.business_reference_counters as c (tenant_id, scope, period, last_value)
  values (p_tenant_id, p_scope, v_period, 1)
  on conflict (tenant_id, scope, period)
  do update set last_value = c.last_value + 1
  returning c.last_value into v_value;

  return case
    when p_scope = 'supplier' then v_prefix || '-' || lpad(v_value::text, 6, '0')
    else v_prefix || '-' || v_period::text || '-' || lpad(v_value::text, 6, '0')
  end;
end;
$$;

-- ─── 2. Audit trail ──────────────────────────────────────────────────────────
create table if not exists public.business_audit_events (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  entity_type    text not null check (entity_type in ('supplier', 'purchase', 'receipt', 'inventory', 'payment', 'allocation', 'document')),
  entity_id      uuid not null,
  event_type     text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  actor_admin_id uuid references public.admin_users(id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  created_at     timestamptz not null default now()
);

create index if not exists business_audit_events_entity_idx
  on public.business_audit_events (tenant_id, entity_type, entity_id, created_at desc);
create index if not exists business_audit_events_tenant_created_idx
  on public.business_audit_events (tenant_id, created_at desc);

comment on table public.business_audit_events is
  'Journal append-only Gestion. Metadata sanitizzati: riferimenti, importi, stati; mai segreti né contenuti di documenti.';

create or replace function public.log_business_event(
  p_tenant_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_event_type text,
  p_actor uuid,
  p_metadata jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into public.business_audit_events (tenant_id, entity_type, entity_id, event_type, actor_admin_id, metadata)
  values (p_tenant_id, p_entity_type, p_entity_id, p_event_type, p_actor,
          coalesce(jsonb_strip_nulls(p_metadata), '{}'::jsonb));
end;
$$;

-- ─── 3. Fornitori ────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  code                text not null,
  name                text not null check (length(btrim(name)) between 1 and 200),
  legal_name          text check (legal_name is null or length(legal_name) <= 200),
  contact_name        text check (contact_name is null or length(contact_name) <= 200),
  email               text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone               text check (phone is null or length(phone) <= 40),
  whatsapp_phone      text check (whatsapp_phone is null or length(whatsapp_phone) <= 40),
  address             text check (address is null or length(address) <= 500),
  country             text check (country is null or country ~ '^[A-Z]{2}$'),
  currency            text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  notes               text check (notes is null or length(notes) <= 4000),
  active              boolean not null default true,
  request_key         text,
  created_by_admin_id uuid references public.admin_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint suppliers_tenant_id_id_key unique (tenant_id, id),
  constraint suppliers_tenant_code_key unique (tenant_id, code)
);

create unique index if not exists suppliers_tenant_request_key_idx
  on public.suppliers (tenant_id, request_key) where request_key is not null;
create index if not exists suppliers_tenant_name_idx on public.suppliers (tenant_id, lower(name));

comment on table public.suppliers is
  'Fornitori del tenant. Nessun saldo memorizzato: vedi supplier_balances.';

-- ─── 4. Acquisti ─────────────────────────────────────────────────────────────
create table if not exists public.supplier_purchases (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  reference             text not null,
  supplier_id           uuid not null,
  supplier_reference    text check (supplier_reference is null or length(supplier_reference) <= 120),
  order_date            date not null default current_date,
  expected_date         date,
  currency              text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  status                text not null default 'draft'
                          check (status in ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
  subtotal              numeric(12, 2) not null default 0 check (subtotal >= 0),
  additional_costs      numeric(12, 2) not null default 0 check (additional_costs >= 0),
  total                 numeric(12, 2) not null default 0,
  notes                 text check (notes is null or length(notes) <= 4000),
  request_key           text,
  created_by_admin_id   uuid references public.admin_users(id) on delete set null,
  ordered_at            timestamptz,
  cancelled_at          timestamptz,
  cancelled_by_admin_id uuid references public.admin_users(id) on delete set null,
  cancel_reason         text check (cancel_reason is null or length(cancel_reason) <= 1000),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint supplier_purchases_total_check check (total = subtotal + additional_costs),
  constraint supplier_purchases_tenant_id_id_key unique (tenant_id, id),
  constraint supplier_purchases_tenant_reference_key unique (tenant_id, reference),
  constraint supplier_purchases_supplier_fk foreign key (tenant_id, supplier_id)
    references public.suppliers (tenant_id, id)
);

create unique index if not exists supplier_purchases_tenant_request_key_idx
  on public.supplier_purchases (tenant_id, request_key) where request_key is not null;
create index if not exists supplier_purchases_supplier_idx
  on public.supplier_purchases (tenant_id, supplier_id, order_date desc);
create index if not exists supplier_purchases_status_idx
  on public.supplier_purchases (tenant_id, status, order_date desc);

create table if not exists public.supplier_purchase_items (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  purchase_id      uuid not null,
  product_id       uuid,
  description      text not null check (length(btrim(description)) between 1 and 300),
  ordered_quantity integer not null check (ordered_quantity > 0),
  unit_cost        numeric(12, 4) not null check (unit_cost >= 0),
  line_total       numeric(12, 2) not null check (line_total >= 0),
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  constraint supplier_purchase_items_tenant_id_id_key unique (tenant_id, id),
  constraint supplier_purchase_items_purchase_fk foreign key (tenant_id, purchase_id)
    references public.supplier_purchases (tenant_id, id) on delete cascade,
  constraint supplier_purchase_items_product_fk foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete set null (product_id)
);

create index if not exists supplier_purchase_items_purchase_idx
  on public.supplier_purchase_items (tenant_id, purchase_id, position);
create index if not exists supplier_purchase_items_product_idx
  on public.supplier_purchase_items (tenant_id, product_id) where product_id is not null;

-- ─── 5. Ricezioni ────────────────────────────────────────────────────────────
create table if not exists public.supplier_receipts (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  reference            text not null,
  purchase_id          uuid not null,
  received_at          timestamptz not null default now(),
  notes                text check (notes is null or length(notes) <= 4000),
  status               text not null default 'recorded' check (status in ('recorded', 'reversed')),
  request_key          text not null,
  created_by_admin_id  uuid references public.admin_users(id) on delete set null,
  reversed_at          timestamptz,
  reversed_by_admin_id uuid references public.admin_users(id) on delete set null,
  reversal_reason      text check (reversal_reason is null or length(reversal_reason) <= 1000),
  created_at           timestamptz not null default now(),
  constraint supplier_receipts_reversed_check check (status <> 'reversed' or reversed_at is not null),
  constraint supplier_receipts_tenant_id_id_key unique (tenant_id, id),
  constraint supplier_receipts_tenant_reference_key unique (tenant_id, reference),
  constraint supplier_receipts_tenant_request_key_key unique (tenant_id, request_key),
  constraint supplier_receipts_purchase_fk foreign key (tenant_id, purchase_id)
    references public.supplier_purchases (tenant_id, id)
);

create index if not exists supplier_receipts_purchase_idx
  on public.supplier_receipts (tenant_id, purchase_id, received_at desc);

create table if not exists public.supplier_receipt_items (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  receipt_id       uuid not null,
  purchase_item_id uuid not null,
  product_id       uuid,
  quantity         integer not null check (quantity > 0),
  created_at       timestamptz not null default now(),
  constraint supplier_receipt_items_tenant_id_id_key unique (tenant_id, id),
  constraint supplier_receipt_items_line_key unique (receipt_id, purchase_item_id),
  constraint supplier_receipt_items_receipt_fk foreign key (tenant_id, receipt_id)
    references public.supplier_receipts (tenant_id, id),
  constraint supplier_receipt_items_purchase_item_fk foreign key (tenant_id, purchase_item_id)
    references public.supplier_purchase_items (tenant_id, id),
  constraint supplier_receipt_items_product_fk foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete set null (product_id)
);

create index if not exists supplier_receipt_items_purchase_item_idx
  on public.supplier_receipt_items (tenant_id, purchase_item_id);

-- ─── 6. Ledger di inventario ─────────────────────────────────────────────────
create table if not exists public.inventory_movements (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  product_id          uuid,
  movement_type       text not null check (movement_type in ('supplier_receipt', 'manual_adjustment', 'reversal')),
  quantity_delta      integer not null check (quantity_delta <> 0),
  stock_after         integer,
  source_type         text not null check (source_type in ('supplier_receipt_item', 'manual')),
  source_id           uuid,
  request_key         text,
  note                text check (note is null or length(note) <= 1000),
  created_by_admin_id uuid references public.admin_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint inventory_movements_product_fk foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete set null (product_id)
);

-- Una riga di ricezione produce al massimo un movimento di entrata e uno di storno.
create unique index if not exists inventory_movements_source_idx
  on public.inventory_movements (movement_type, source_type, source_id) where source_id is not null;
create unique index if not exists inventory_movements_tenant_request_key_idx
  on public.inventory_movements (tenant_id, request_key) where request_key is not null;
create index if not exists inventory_movements_product_idx
  on public.inventory_movements (tenant_id, product_id, created_at desc);

comment on table public.inventory_movements is
  'Ledger degli eventi di inventario (audit + base futura del magazzino). products.stock resta il valore operativo canonico.';

-- ─── 7. Pagamenti fornitori e allocazioni ────────────────────────────────────
create table if not exists public.supplier_payments (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  reference                 text not null,
  supplier_id               uuid not null,
  amount                    numeric(12, 2) not null check (amount > 0),
  currency                  text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  payment_date              date not null,
  method                    text not null check (method in ('cash', 'bank_transfer', 'card', 'other')),
  status                    text not null default 'recorded' check (status in ('recorded', 'verified', 'voided')),
  payer_account             text check (payer_account is null or length(payer_account) <= 120),
  beneficiary_type          text not null default 'supplier' check (beneficiary_type in ('supplier', 'third_party')),
  beneficiary_name          text not null check (length(btrim(beneficiary_name)) between 1 and 200),
  beneficiary_reference     text check (beneficiary_reference is null or length(beneficiary_reference) <= 200),
  supplier_instruction_note text check (supplier_instruction_note is null or length(supplier_instruction_note) <= 2000),
  external_reference        text check (external_reference is null or length(external_reference) <= 200),
  notes                     text check (notes is null or length(notes) <= 4000),
  request_key               text not null,
  created_by_admin_id       uuid references public.admin_users(id) on delete set null,
  verified_by_admin_id      uuid references public.admin_users(id) on delete set null,
  verified_at               timestamptz,
  voided_at                 timestamptz,
  voided_by_admin_id        uuid references public.admin_users(id) on delete set null,
  void_reason               text check (void_reason is null or length(void_reason) <= 1000),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint supplier_payments_verified_check check (status <> 'verified' or verified_at is not null),
  constraint supplier_payments_voided_check check (status <> 'voided' or voided_at is not null),
  constraint supplier_payments_tenant_id_id_key unique (tenant_id, id),
  constraint supplier_payments_tenant_reference_key unique (tenant_id, reference),
  constraint supplier_payments_tenant_request_key_key unique (tenant_id, request_key),
  constraint supplier_payments_supplier_fk foreign key (tenant_id, supplier_id)
    references public.suppliers (tenant_id, id)
);

create index if not exists supplier_payments_supplier_idx
  on public.supplier_payments (tenant_id, supplier_id, payment_date desc);
create index if not exists supplier_payments_status_idx
  on public.supplier_payments (tenant_id, status, payment_date desc);

comment on column public.supplier_payments.beneficiary_type is
  'supplier = pagato al fornitore; third_party = pagato a un terzo su istruzione del fornitore. Il creditore resta supplier_id.';

create table if not exists public.supplier_payment_allocations (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  payment_id           uuid not null,
  purchase_id          uuid not null,
  amount               numeric(12, 2) not null check (amount > 0),
  request_key          text,
  created_by_admin_id  uuid references public.admin_users(id) on delete set null,
  created_at           timestamptz not null default now(),
  reversed_at          timestamptz,
  reversed_by_admin_id uuid references public.admin_users(id) on delete set null,
  reversal_reason      text check (reversal_reason is null or length(reversal_reason) <= 1000),
  constraint supplier_payment_allocations_payment_fk foreign key (tenant_id, payment_id)
    references public.supplier_payments (tenant_id, id),
  constraint supplier_payment_allocations_purchase_fk foreign key (tenant_id, purchase_id)
    references public.supplier_purchases (tenant_id, id)
);

-- Una sola allocazione attiva per coppia pagamento/acquisto: un retry non può
-- applicarla due volte (in aggiunta alla request_key).
create unique index if not exists supplier_payment_allocations_active_pair_idx
  on public.supplier_payment_allocations (payment_id, purchase_id) where reversed_at is null;
create unique index if not exists supplier_payment_allocations_tenant_request_key_idx
  on public.supplier_payment_allocations (tenant_id, request_key) where request_key is not null;
create index if not exists supplier_payment_allocations_purchase_idx
  on public.supplier_payment_allocations (tenant_id, purchase_id) where reversed_at is null;

-- ─── 8. Documenti privati ────────────────────────────────────────────────────
create table if not exists public.business_documents (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  entity_type          text not null check (entity_type in ('supplier', 'purchase', 'receipt', 'supplier_payment')),
  entity_id            uuid not null,
  document_type        text not null
                         check (document_type in ('invoice', 'receipt', 'delivery_note', 'payment_proof', 'supplier_instruction', 'other')),
  storage_path         text not null unique,
  file_name            text not null check (length(file_name) between 1 and 200),
  mime_type            text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes           integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  note                 text check (note is null or length(note) <= 1000),
  uploaded_by_admin_id uuid references public.admin_users(id) on delete set null,
  created_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  deleted_by_admin_id  uuid references public.admin_users(id) on delete set null,
  constraint business_documents_path_tenant_check check (storage_path like tenant_id::text || '/%')
);

create index if not exists business_documents_entity_idx
  on public.business_documents (tenant_id, entity_type, entity_id) where deleted_at is null;

-- Il riferimento polimorfico non può avere una FK: un trigger verifica che
-- l'entità esista nello STESSO tenant.
create or replace function public.business_documents_check_entity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_found boolean;
begin
  v_found := case new.entity_type
    when 'supplier' then exists (select 1 from public.suppliers s where s.id = new.entity_id and s.tenant_id = new.tenant_id)
    when 'purchase' then exists (select 1 from public.supplier_purchases p where p.id = new.entity_id and p.tenant_id = new.tenant_id)
    when 'receipt' then exists (select 1 from public.supplier_receipts r where r.id = new.entity_id and r.tenant_id = new.tenant_id)
    when 'supplier_payment' then exists (select 1 from public.supplier_payments sp where sp.id = new.entity_id and sp.tenant_id = new.tenant_id)
    else false
  end;
  if not v_found then
    raise exception 'document_entity_not_found';
  end if;
  return new;
end;
$$;

drop trigger if exists business_documents_check_entity on public.business_documents;
create trigger business_documents_check_entity
  before insert or update of tenant_id, entity_type, entity_id on public.business_documents
  for each row execute function public.business_documents_check_entity();

-- Bucket privato: nessuna policy su storage.objects, quindi solo il service role
-- (backend autorizzato) legge e scrive. Mai URL pubblici.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-documents', 'business-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ─── 9. Saldi derivati ───────────────────────────────────────────────────────
-- paid_verified: allocazioni attive di pagamenti verificati (riducono il debito)
-- paid_unverified: allocazioni attive di pagamenti registrati non verificati
-- outstanding: total - paid_verified (0 per un acquisto annullato)
-- allocatable: quanto si può ancora allocare (total - verificato - non verificato)
create or replace view public.supplier_purchase_financials
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
  case when p.status = 'cancelled' then 0
       else greatest(p.total - coalesce(a.paid_verified, 0), 0) end::numeric(12, 2) as outstanding,
  case when p.status = 'cancelled' then 0
       else greatest(p.total - coalesce(a.paid_verified, 0) - coalesce(a.paid_unverified, 0), 0) end::numeric(12, 2) as allocatable,
  coalesce(q.ordered_quantity, 0)::bigint as ordered_quantity,
  coalesce(q.received_quantity, 0)::bigint as received_quantity
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
    sum(coalesce(r.received, 0)) as received_quantity
  from public.supplier_purchase_items i
  left join lateral (
    select sum(ri.quantity) as received
    from public.supplier_receipt_items ri
    join public.supplier_receipts rc on rc.id = ri.receipt_id and rc.tenant_id = ri.tenant_id
    where ri.purchase_item_id = i.id and ri.tenant_id = i.tenant_id and rc.status = 'recorded'
  ) r on true
  where i.purchase_id = p.id and i.tenant_id = p.tenant_id
) q on true;

create or replace view public.supplier_balances
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
    sum(pf.total) filter (where pf.status <> 'cancelled') as total_purchased,
    sum(pf.paid_verified) as paid_verified,
    sum(pf.paid_unverified) as paid_unverified,
    sum(pf.outstanding) as outstanding,
    count(*) filter (where pf.status <> 'cancelled') as purchase_count,
    max(sp.order_date) filter (where pf.status <> 'cancelled') as last_purchase_date
  from public.supplier_purchase_financials pf
  join public.supplier_purchases sp on sp.id = pf.purchase_id
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

-- ─── 10. RPC ─────────────────────────────────────────────────────────────────

-- Valida un campo testo opzionale di un payload jsonb.
create or replace function public.business_text(p_data jsonb, p_key text, p_max integer)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value text := nullif(btrim(p_data->>p_key), '');
begin
  if v_value is not null and length(v_value) > p_max then
    raise exception 'field_too_long:%', p_key;
  end if;
  return v_value;
end;
$$;

-- 10.1 Fornitori ---------------------------------------------------------------
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
    address, country, currency, notes, active, request_key, created_by_admin_id
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
    p_request_key, p_actor
  )
  returning id into v_id;

  perform public.log_business_event(p_tenant_id, 'supplier', v_id, 'supplier.created', p_actor,
    jsonb_build_object('code', v_code, 'name', v_name));
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
                               'address', 'country', 'currency', 'notes', 'active'] loop
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
    updated_at     = now()
  where s.id = v_row.id and s.tenant_id = p_tenant_id;

  perform public.log_business_event(p_tenant_id, 'supplier', v_row.id, 'supplier.updated', p_actor,
    jsonb_build_object('fields', to_jsonb(v_changed)));
  return query select v_row.id, true;
end;
$$;

-- 10.2 Acquisti ----------------------------------------------------------------

-- Sostituisce le righe di un acquisto e ricalcola i totali (server-side).
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
  v_quantity   integer;
  v_unit_cost  numeric(12, 4);
  v_desc       text;
  v_subtotal   numeric(12, 2) := 0;
  v_line_total numeric(12, 2);
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'items_required'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'too_many_items'; end if;

  delete from public.supplier_purchase_items i where i.purchase_id = p_purchase_id and i.tenant_id = p_tenant_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_quantity := (v_item->>'ordered_quantity')::integer;
    v_unit_cost := round((v_item->>'unit_cost')::numeric, 4);
    v_desc := public.business_text(v_item, 'description', 300);

    if v_quantity is null or v_quantity <= 0 then raise exception 'invalid_quantity'; end if;
    if v_unit_cost is null or v_unit_cost < 0 then raise exception 'invalid_unit_cost'; end if;
    if v_product_id is not null then
      -- Stesso tenant (difesa esplicita oltre alla FK composita).
      select coalesce(v_desc, pr.name) into v_desc
      from public.products pr where pr.id = v_product_id and pr.tenant_id = p_tenant_id;
      if not found then raise exception 'product_not_found'; end if;
    end if;
    if v_desc is null then raise exception 'item_description_required'; end if;

    v_line_total := round(v_quantity * v_unit_cost, 2);
    v_subtotal := v_subtotal + v_line_total;
    insert into public.supplier_purchase_items (
      tenant_id, purchase_id, product_id, description, ordered_quantity, unit_cost, line_total, position
    ) values (
      p_tenant_id, p_purchase_id, v_product_id, v_desc, v_quantity, v_unit_cost, v_line_total, v_position
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
  v_supplier_id uuid;
  v_currency    text;
  v_status      text := coalesce(nullif(p_data->>'status', ''), 'draft');
  v_additional  numeric(12, 2) := round(coalesce(nullif(p_data->>'additional_costs', '')::numeric, 0), 2);
  v_subtotal    numeric(12, 2);
  v_allocated   numeric(12, 2);
  v_id          uuid;
  v_reference   text;
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
    v_supplier_id := nullif(p_data->>'supplier_id', '')::uuid;
    select s.currency into v_currency
    from public.suppliers s
    where s.id = v_supplier_id and s.tenant_id = p_tenant_id and s.active;
    if not found then raise exception 'supplier_not_found'; end if;
    v_currency := coalesce(upper(public.business_text(p_data, 'currency', 3)), v_currency);

    v_reference := public.next_business_reference(p_tenant_id, 'purchase');
    insert into public.supplier_purchases (
      tenant_id, reference, supplier_id, supplier_reference, order_date, expected_date, currency,
      status, additional_costs, subtotal, total, notes, request_key, created_by_admin_id, ordered_at
    ) values (
      p_tenant_id, v_reference, v_supplier_id,
      public.business_text(p_data, 'supplier_reference', 120),
      coalesce(nullif(p_data->>'order_date', '')::date, current_date),
      nullif(p_data->>'expected_date', '')::date,
      v_currency, 'draft', v_additional, 0, v_additional,
      public.business_text(p_data, 'notes', 4000), p_request_key, p_actor, null
    )
    returning id into v_id;

    v_subtotal := public.replace_supplier_purchase_items(p_tenant_id, v_id, p_items);
    if v_status = 'ordered' and v_subtotal = 0 and not exists (
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
                         'items', jsonb_array_length(p_items)));
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

create or replace function public.set_supplier_purchase_status(
  p_tenant_id uuid,
  p_purchase_id uuid,
  p_status text,
  p_reason text,
  p_actor uuid
)
returns table (out_purchase_id uuid, out_status text, out_changed boolean)
language plpgsql
set search_path = public
as $$
declare
  v_row public.supplier_purchases%rowtype;
begin
  if p_status not in ('ordered', 'cancelled') then raise exception 'invalid_target_status:%', p_status; end if;

  select sp.* into v_row
  from public.supplier_purchases sp
  where sp.id = p_purchase_id and sp.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'purchase_not_found'; end if;

  if v_row.status = p_status then
    return query select v_row.id, v_row.status, false;
    return;
  end if;

  if p_status = 'ordered' then
    if v_row.status <> 'draft' then raise exception 'invalid_transition:%->ordered', v_row.status; end if;
    if not exists (select 1 from public.supplier_purchase_items i where i.purchase_id = v_row.id and i.tenant_id = p_tenant_id) then
      raise exception 'purchase_items_required';
    end if;
    update public.supplier_purchases sp set status = 'ordered', ordered_at = now(), updated_at = now()
    where sp.id = v_row.id and sp.tenant_id = p_tenant_id;
  else
    if v_row.status not in ('draft', 'ordered') then raise exception 'invalid_transition:%->cancelled', v_row.status; end if;
    if exists (select 1 from public.supplier_receipts r
               where r.purchase_id = v_row.id and r.tenant_id = p_tenant_id and r.status = 'recorded') then
      raise exception 'purchase_has_receipts';
    end if;
    if exists (select 1 from public.supplier_payment_allocations al
               where al.purchase_id = v_row.id and al.tenant_id = p_tenant_id and al.reversed_at is null) then
      raise exception 'purchase_has_allocations';
    end if;
    update public.supplier_purchases sp
    set status = 'cancelled', cancelled_at = now(), cancelled_by_admin_id = p_actor,
        cancel_reason = nullif(btrim(p_reason), ''), updated_at = now()
    where sp.id = v_row.id and sp.tenant_id = p_tenant_id;
  end if;

  perform public.log_business_event(p_tenant_id, 'purchase', v_row.id, 'purchase.status_changed', p_actor,
    jsonb_build_object('reference', v_row.reference, 'from', v_row.status, 'to', p_status,
                       'reason', left(nullif(btrim(p_reason), ''), 300)));
  return query select v_row.id, p_status, true;
end;
$$;

-- Deriva lo stato merce dalle quantità effettivamente ricevute.
create or replace function public.refresh_supplier_purchase_receipt_status(p_tenant_id uuid, p_purchase_id uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_current  text;
  v_ordered  bigint;
  v_received bigint;
  v_complete boolean;
  v_next     text;
begin
  select sp.status into v_current
  from public.supplier_purchases sp where sp.id = p_purchase_id and sp.tenant_id = p_tenant_id;
  if v_current in ('draft', 'cancelled') then return v_current; end if;

  select sum(i.ordered_quantity), sum(least(coalesce(r.received, 0), i.ordered_quantity)),
         bool_and(coalesce(r.received, 0) >= i.ordered_quantity)
  into v_ordered, v_received, v_complete
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

-- 10.3 Ricezioni e inventario ----------------------------------------------------
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
  v_item         jsonb;
  v_line         public.supplier_purchase_items%rowtype;
  v_quantity     integer;
  v_already      bigint;
  v_receipt_item uuid;
  v_stock_after  integer;
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
  if p_received_at is not null and p_received_at > now() + interval '1 day' then
    raise exception 'received_at_in_future';
  end if;

  v_reference := public.next_business_reference(p_tenant_id, 'receipt');
  insert into public.supplier_receipts (tenant_id, reference, purchase_id, received_at, notes, request_key, created_by_admin_id)
  values (p_tenant_id, v_reference, v_purchase.id, coalesce(p_received_at, now()),
          nullif(btrim(p_notes), ''), p_request_key, p_actor)
  returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity < 0 then raise exception 'invalid_quantity'; end if;
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
      raise exception 'quantity_exceeds_remaining:%', v_line.id;
    end if;

    insert into public.supplier_receipt_items (tenant_id, receipt_id, purchase_item_id, product_id, quantity)
    values (p_tenant_id, v_receipt_id, v_line.id, v_line.product_id, v_quantity)
    returning id into v_receipt_item;

    if v_line.product_id is not null then
      update public.products pr set stock = pr.stock + v_quantity
      where pr.id = v_line.product_id and pr.tenant_id = p_tenant_id
      returning pr.stock into v_stock_after;
      if found then
        insert into public.inventory_movements (
          tenant_id, product_id, movement_type, quantity_delta, stock_after, source_type, source_id, note, created_by_admin_id
        ) values (
          p_tenant_id, v_line.product_id, 'supplier_receipt', v_quantity, v_stock_after,
          'supplier_receipt_item', v_receipt_item, v_reference, p_actor
        );
      end if;
    end if;
    v_lines := v_lines + 1;
    v_units := v_units + v_quantity;
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
    select ri.id, ri.product_id, ri.quantity
    from public.supplier_receipt_items ri
    where ri.receipt_id = v_receipt.id and ri.tenant_id = p_tenant_id
  loop
    if v_line.product_id is not null then
      update public.products pr set stock = pr.stock - v_line.quantity
      where pr.id = v_line.product_id and pr.tenant_id = p_tenant_id and pr.stock >= v_line.quantity
      returning pr.stock into v_stock_after;
      if not found then
        if exists (select 1 from public.products pr where pr.id = v_line.product_id and pr.tenant_id = p_tenant_id) then
          raise exception 'insufficient_stock_for_reversal:%', v_line.product_id;
        end if;
      else
        insert into public.inventory_movements (
          tenant_id, product_id, movement_type, quantity_delta, stock_after, source_type, source_id, note, created_by_admin_id
        ) values (
          p_tenant_id, v_line.product_id, 'reversal', -v_line.quantity, v_stock_after,
          'supplier_receipt_item', v_line.id, v_receipt.reference, p_actor
        );
      end if;
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

create or replace function public.adjust_inventory(
  p_tenant_id uuid,
  p_product_id uuid,
  p_delta integer,
  p_reason text,
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
begin
  if p_request_key is null or length(p_request_key) not between 8 and 200 then
    raise exception 'request_key_required';
  end if;
  if p_delta is null or p_delta = 0 then raise exception 'invalid_quantity'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

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

  insert into public.inventory_movements (
    tenant_id, product_id, movement_type, quantity_delta, stock_after, source_type, request_key, note, created_by_admin_id
  ) values (
    p_tenant_id, p_product_id, 'manual_adjustment', p_delta, v_stock_after, 'manual', p_request_key,
    left(btrim(p_reason), 1000), p_actor
  )
  returning id into v_id;

  perform public.log_business_event(p_tenant_id, 'inventory', p_product_id, 'inventory.adjusted', p_actor,
    jsonb_build_object('delta', p_delta, 'stock_after', v_stock_after, 'reason', left(btrim(p_reason), 300)));
  return query select v_id, true, v_stock_after;
end;
$$;

-- 10.4 Pagamenti e allocazioni -----------------------------------------------------

-- Allocazione interna: presuppone che il chiamante abbia già il lock del pagamento.
create or replace function public.apply_supplier_payment_allocation(
  p_tenant_id uuid,
  p_payment public.supplier_payments,
  p_purchase_id uuid,
  p_amount numeric,
  p_request_key text,
  p_actor uuid
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_purchase    public.supplier_purchases%rowtype;
  v_amount      numeric(12, 2) := round(p_amount, 2);
  v_allocated   numeric(12, 2);
  v_on_purchase numeric(12, 2);
  v_id          uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> v_amount then raise exception 'invalid_amount'; end if;
  if p_payment.status = 'voided' then raise exception 'payment_voided'; end if;

  select sp.* into v_purchase
  from public.supplier_purchases sp
  where sp.id = p_purchase_id and sp.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'purchase_not_found'; end if;
  if v_purchase.status = 'cancelled' then raise exception 'purchase_cancelled'; end if;
  if v_purchase.supplier_id <> p_payment.supplier_id then raise exception 'supplier_mismatch'; end if;
  if v_purchase.currency <> p_payment.currency then raise exception 'currency_mismatch'; end if;

  select coalesce(sum(al.amount), 0) into v_allocated
  from public.supplier_payment_allocations al
  where al.payment_id = p_payment.id and al.tenant_id = p_tenant_id and al.reversed_at is null;
  if v_allocated + v_amount > p_payment.amount then raise exception 'payment_over_allocated'; end if;

  select coalesce(sum(al.amount), 0) into v_on_purchase
  from public.supplier_payment_allocations al
  join public.supplier_payments p on p.id = al.payment_id and p.tenant_id = al.tenant_id
  where al.purchase_id = v_purchase.id and al.tenant_id = p_tenant_id
    and al.reversed_at is null and p.status <> 'voided';
  if v_on_purchase + v_amount > v_purchase.total then raise exception 'purchase_over_allocated'; end if;

  insert into public.supplier_payment_allocations (tenant_id, payment_id, purchase_id, amount, request_key, created_by_admin_id)
  values (p_tenant_id, p_payment.id, v_purchase.id, v_amount, p_request_key, p_actor)
  returning id into v_id;

  perform public.log_business_event(p_tenant_id, 'allocation', v_id, 'allocation.created', p_actor,
    jsonb_build_object('payment', p_payment.reference, 'purchase', v_purchase.reference, 'amount', v_amount));
  return v_id;
end;
$$;

create or replace function public.record_supplier_payment(
  p_tenant_id uuid,
  p_data jsonb,
  p_allocations jsonb,
  p_request_key text,
  p_actor uuid
)
returns table (out_payment_id uuid, out_reference text, out_created boolean)
language plpgsql
set search_path = public
as $$
declare
  v_existing    public.supplier_payments%rowtype;
  v_payment     public.supplier_payments%rowtype;
  v_supplier    public.suppliers%rowtype;
  v_amount      numeric(12, 2);
  v_method      text := p_data->>'method';
  v_beneficiary text := coalesce(nullif(p_data->>'beneficiary_type', ''), 'supplier');
  v_name        text;
  v_date        date := coalesce(nullif(p_data->>'payment_date', '')::date, current_date);
  v_reference   text;
  v_alloc       jsonb;
  v_index       integer := 0;
begin
  if p_request_key is null or length(p_request_key) not between 8 and 200 then
    raise exception 'request_key_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payment:' || p_tenant_id::text || ':' || p_request_key, 0));
  select p.* into v_existing
  from public.supplier_payments p
  where p.tenant_id = p_tenant_id and p.request_key = p_request_key;
  if found then
    return query select v_existing.id, v_existing.reference, false;
    return;
  end if;

  v_amount := round((p_data->>'amount')::numeric, 2);
  if v_amount is null or v_amount <= 0 or v_amount <> (p_data->>'amount')::numeric then raise exception 'invalid_amount'; end if;
  if v_method is null or v_method not in ('cash', 'bank_transfer', 'card', 'other') then raise exception 'invalid_method'; end if;
  if v_beneficiary not in ('supplier', 'third_party') then raise exception 'invalid_beneficiary_type'; end if;
  if v_date > current_date + 1 then raise exception 'payment_date_in_future'; end if;

  select s.* into v_supplier
  from public.suppliers s
  where s.id = nullif(p_data->>'supplier_id', '')::uuid and s.tenant_id = p_tenant_id;
  if not found then raise exception 'supplier_not_found'; end if;

  v_name := public.business_text(p_data, 'beneficiary_name', 200);
  if v_beneficiary = 'third_party' and v_name is null then raise exception 'beneficiary_name_required'; end if;
  v_name := coalesce(v_name, v_supplier.name);

  v_reference := public.next_business_reference(p_tenant_id, 'payment');
  insert into public.supplier_payments (
    tenant_id, reference, supplier_id, amount, currency, payment_date, method, status, payer_account,
    beneficiary_type, beneficiary_name, beneficiary_reference, supplier_instruction_note,
    external_reference, notes, request_key, created_by_admin_id
  ) values (
    p_tenant_id, v_reference, v_supplier.id, v_amount,
    coalesce(upper(public.business_text(p_data, 'currency', 3)), v_supplier.currency),
    v_date, v_method, 'recorded',
    public.business_text(p_data, 'payer_account', 120),
    v_beneficiary, v_name,
    public.business_text(p_data, 'beneficiary_reference', 200),
    public.business_text(p_data, 'supplier_instruction_note', 2000),
    public.business_text(p_data, 'external_reference', 200),
    public.business_text(p_data, 'notes', 4000),
    p_request_key, p_actor
  )
  returning * into v_payment;

  -- Lock del pagamento appena creato (stesso ordine delle allocazioni successive).
  perform 1 from public.supplier_payments p where p.id = v_payment.id and p.tenant_id = p_tenant_id for update;

  if p_allocations is not null then
    if jsonb_typeof(p_allocations) <> 'array' then raise exception 'invalid_allocations'; end if;
    -- Acquisti in ordine di id: ordine di lock deterministico.
    for v_alloc in
      select a.value from jsonb_array_elements(p_allocations) a order by a.value->>'purchase_id'
    loop
      perform public.apply_supplier_payment_allocation(
        p_tenant_id, v_payment, nullif(v_alloc->>'purchase_id', '')::uuid,
        (v_alloc->>'amount')::numeric, p_request_key || ':' || v_index, p_actor);
      v_index := v_index + 1;
    end loop;
  end if;

  perform public.log_business_event(p_tenant_id, 'payment', v_payment.id, 'payment.recorded', p_actor,
    jsonb_build_object('reference', v_reference, 'supplier', v_supplier.code, 'amount', v_amount,
                       'method', v_method, 'beneficiary_type', v_beneficiary, 'allocations', v_index));
  return query select v_payment.id, v_reference, true;
end;
$$;

create or replace function public.allocate_supplier_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_purchase_id uuid,
  p_amount numeric,
  p_request_key text,
  p_actor uuid
)
returns table (out_allocation_id uuid, out_created boolean)
language plpgsql
set search_path = public
as $$
declare
  v_payment  public.supplier_payments%rowtype;
  v_existing public.supplier_payment_allocations%rowtype;
  v_id       uuid;
begin
  if p_request_key is null or length(p_request_key) not between 8 and 200 then
    raise exception 'request_key_required';
  end if;

  select p.* into v_payment
  from public.supplier_payments p
  where p.id = p_payment_id and p.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'payment_not_found'; end if;

  select al.* into v_existing
  from public.supplier_payment_allocations al
  where al.tenant_id = p_tenant_id and al.request_key = p_request_key;
  if found then
    if v_existing.payment_id <> p_payment_id or v_existing.purchase_id <> p_purchase_id then
      raise exception 'request_key_conflict';
    end if;
    return query select v_existing.id, false;
    return;
  end if;

  v_id := public.apply_supplier_payment_allocation(p_tenant_id, v_payment, p_purchase_id, p_amount, p_request_key, p_actor);
  return query select v_id, true;
end;
$$;

create or replace function public.reverse_supplier_payment_allocation(
  p_tenant_id uuid,
  p_allocation_id uuid,
  p_reason text,
  p_actor uuid
)
returns table (out_allocation_id uuid, out_changed boolean)
language plpgsql
set search_path = public
as $$
declare
  v_alloc   public.supplier_payment_allocations%rowtype;
  v_payment public.supplier_payments%rowtype;
begin
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

  select al.* into v_alloc
  from public.supplier_payment_allocations al
  where al.id = p_allocation_id and al.tenant_id = p_tenant_id;
  if not found then raise exception 'allocation_not_found'; end if;

  select p.* into v_payment
  from public.supplier_payments p
  where p.id = v_alloc.payment_id and p.tenant_id = p_tenant_id
  for update;
  select al.* into v_alloc
  from public.supplier_payment_allocations al
  where al.id = p_allocation_id and al.tenant_id = p_tenant_id
  for update;

  if v_alloc.reversed_at is not null then
    return query select v_alloc.id, false;
    return;
  end if;

  update public.supplier_payment_allocations al
  set reversed_at = now(), reversed_by_admin_id = p_actor, reversal_reason = left(btrim(p_reason), 1000)
  where al.id = v_alloc.id and al.tenant_id = p_tenant_id;

  perform public.log_business_event(p_tenant_id, 'allocation', v_alloc.id, 'allocation.reversed', p_actor,
    jsonb_build_object('payment', v_payment.reference, 'amount', v_alloc.amount, 'reason', left(btrim(p_reason), 300)));
  return query select v_alloc.id, true;
end;
$$;

create or replace function public.verify_supplier_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_actor uuid
)
returns table (out_payment_id uuid, out_status text, out_changed boolean)
language plpgsql
set search_path = public
as $$
declare
  v_payment public.supplier_payments%rowtype;
begin
  select p.* into v_payment
  from public.supplier_payments p
  where p.id = p_payment_id and p.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'payment_not_found'; end if;

  if v_payment.status = 'verified' then
    return query select v_payment.id, v_payment.status, false;
    return;
  end if;
  if v_payment.status = 'voided' then raise exception 'payment_voided'; end if;

  update public.supplier_payments p
  set status = 'verified', verified_at = now(), verified_by_admin_id = p_actor, updated_at = now()
  where p.id = v_payment.id and p.tenant_id = p_tenant_id;

  perform public.log_business_event(p_tenant_id, 'payment', v_payment.id, 'payment.verified', p_actor,
    jsonb_build_object('reference', v_payment.reference, 'amount', v_payment.amount));
  return query select v_payment.id, 'verified'::text, true;
end;
$$;

create or replace function public.void_supplier_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_reason text,
  p_actor uuid
)
returns table (out_payment_id uuid, out_status text, out_changed boolean, out_reversed_allocations integer)
language plpgsql
set search_path = public
as $$
declare
  v_payment  public.supplier_payments%rowtype;
  v_reversed integer;
begin
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

  select p.* into v_payment
  from public.supplier_payments p
  where p.id = p_payment_id and p.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'payment_not_found'; end if;

  if v_payment.status = 'voided' then
    return query select v_payment.id, v_payment.status, false, 0;
    return;
  end if;

  update public.supplier_payment_allocations al
  set reversed_at = now(), reversed_by_admin_id = p_actor, reversal_reason = 'payment_voided'
  where al.payment_id = v_payment.id and al.tenant_id = p_tenant_id and al.reversed_at is null;
  get diagnostics v_reversed = row_count;

  update public.supplier_payments p
  set status = 'voided', voided_at = now(), voided_by_admin_id = p_actor,
      void_reason = left(btrim(p_reason), 1000), updated_at = now()
  where p.id = v_payment.id and p.tenant_id = p_tenant_id;

  perform public.log_business_event(p_tenant_id, 'payment', v_payment.id, 'payment.voided', p_actor,
    jsonb_build_object('reference', v_payment.reference, 'amount', v_payment.amount,
                       'previous_status', v_payment.status, 'reversed_allocations', v_reversed,
                       'reason', left(btrim(p_reason), 300)));
  return query select v_payment.id, 'voided'::text, true, v_reversed;
end;
$$;

-- ─── 11. Sicurezza: RLS senza policy + privilegi espliciti ───────────────────
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'business_reference_counters', 'business_audit_events', 'suppliers', 'supplier_purchases',
    'supplier_purchase_items', 'supplier_receipts', 'supplier_receipt_items', 'inventory_movements',
    'supplier_payments', 'supplier_payment_allocations', 'business_documents'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_table);
  end loop;
end
$$;

-- Nessun DELETE sulle tabelle finanziarie/di audit: si annulla o si storna.
grant select, insert, update on table public.business_reference_counters to service_role;
grant select, insert on table public.business_audit_events to service_role;
grant select, insert, update on table public.suppliers to service_role;
grant select, insert, update on table public.supplier_purchases to service_role;
grant select, insert, update, delete on table public.supplier_purchase_items to service_role; -- sostituzione righe di una bozza
grant select, insert, update on table public.supplier_receipts to service_role;
grant select, insert on table public.supplier_receipt_items to service_role;
grant select, insert on table public.inventory_movements to service_role;
grant select, insert, update on table public.supplier_payments to service_role;
grant select, insert, update on table public.supplier_payment_allocations to service_role;
grant select, insert, update on table public.business_documents to service_role;

revoke all on table public.supplier_purchase_financials from public, anon, authenticated, service_role;
revoke all on table public.supplier_balances from public, anon, authenticated, service_role;
grant select on table public.supplier_purchase_financials to service_role;
grant select on table public.supplier_balances to service_role;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.next_business_reference(uuid, text)',
    'public.log_business_event(uuid, text, uuid, text, uuid, jsonb)',
    'public.business_text(jsonb, text, integer)',
    'public.business_documents_check_entity()',
    'public.create_supplier(uuid, jsonb, text, uuid)',
    'public.update_supplier(uuid, uuid, jsonb, uuid)',
    'public.replace_supplier_purchase_items(uuid, uuid, jsonb)',
    'public.save_supplier_purchase(uuid, uuid, jsonb, jsonb, text, uuid)',
    'public.set_supplier_purchase_status(uuid, uuid, text, text, uuid)',
    'public.refresh_supplier_purchase_receipt_status(uuid, uuid)',
    'public.record_supplier_receipt(uuid, uuid, jsonb, timestamptz, text, text, uuid)',
    'public.reverse_supplier_receipt(uuid, uuid, text, uuid)',
    'public.adjust_inventory(uuid, uuid, integer, text, text, uuid)',
    'public.apply_supplier_payment_allocation(uuid, public.supplier_payments, uuid, numeric, text, uuid)',
    'public.record_supplier_payment(uuid, jsonb, jsonb, text, uuid)',
    'public.allocate_supplier_payment(uuid, uuid, uuid, numeric, text, uuid)',
    'public.reverse_supplier_payment_allocation(uuid, uuid, text, uuid)',
    'public.verify_supplier_payment(uuid, uuid, uuid)',
    'public.void_supplier_payment(uuid, uuid, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end
$$;

-- ─── 12. Capability RBAC ─────────────────────────────────────────────────────
-- Assegnate solo ai ruoli di sistema platform_owner e tenant_admin (che le ha già
-- per contratto via canAdmin). Nessun ruolo custom esistente le riceve.
insert into public.admin_permissions (key, module, label, description, risk_level, position) values
  ('suppliers.view', 'Gestion · Fournisseurs', 'Voir les fournisseurs', 'Consulter les fournisseurs et leur solde.', 'standard', 400),
  ('suppliers.manage', 'Gestion · Fournisseurs', 'Gérer les fournisseurs', 'Créer et modifier des fournisseurs et leurs documents.', 'sensitive', 401),
  ('purchases.view', 'Gestion · Achats', 'Voir les achats', 'Consulter les achats fournisseurs, articles et réceptions.', 'standard', 410),
  ('purchases.manage', 'Gestion · Achats', 'Gérer les achats', 'Créer, modifier, commander ou annuler des achats fournisseurs.', 'sensitive', 411),
  ('inventory.view', 'Gestion · Stock', 'Voir les mouvements de stock', 'Consulter le journal des mouvements de stock.', 'standard', 420),
  ('inventory.manage', 'Gestion · Stock', 'Gérer le stock', 'Enregistrer ou annuler des réceptions et ajuster le stock.', 'sensitive', 421),
  ('treasury.view', 'Gestion · Trésorerie', 'Voir la trésorerie', 'Consulter les paiements fournisseurs et les dettes.', 'standard', 430),
  ('treasury.manage', 'Gestion · Trésorerie', 'Gérer la trésorerie', 'Enregistrer, affecter ou annuler des paiements fournisseurs.', 'sensitive', 431),
  ('supplier_payments.verify', 'Gestion · Trésorerie', 'Vérifier les paiements fournisseurs', 'Valider un paiement fournisseur (réduit la dette) ou annuler un paiement déjà vérifié.', 'critical', 432)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  risk_level = excluded.risk_level,
  position = excluded.position;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, pk.key
from public.admin_roles r
cross join (values
  ('suppliers.view'), ('suppliers.manage'), ('purchases.view'), ('purchases.manage'),
  ('inventory.view'), ('inventory.manage'), ('treasury.view'), ('treasury.manage'),
  ('supplier_payments.verify')
) as pk(key)
where r.code in ('platform_owner', 'tenant_admin')
on conflict do nothing;

commit;

-- ─── Rollback (solo se il modulo non è mai stato usato) ──────────────────────
-- begin;
-- delete from public.admin_role_permissions where permission_key in ('suppliers.view','suppliers.manage','purchases.view','purchases.manage','inventory.view','inventory.manage','treasury.view','treasury.manage','supplier_payments.verify');
-- delete from public.admin_permissions where key in (… stesse chiavi …);
-- drop view if exists public.supplier_balances, public.supplier_purchase_financials;
-- drop table if exists public.business_documents, public.supplier_payment_allocations, public.supplier_payments,
--   public.inventory_movements, public.supplier_receipt_items, public.supplier_receipts, public.supplier_purchase_items,
--   public.supplier_purchases, public.suppliers, public.business_audit_events, public.business_reference_counters;
-- drop function if exists (tutte le funzioni della sezione 10 e next_business_reference/log_business_event/business_text);
-- delete from storage.buckets where id = 'business-documents'; -- solo se vuoto
-- alter table public.products drop constraint if exists products_tenant_id_id_key;
-- delete from public.tenant_feature_flags where flag_key = 'business_management';
-- commit;
-- ATTENZIONE: gli incrementi di products.stock fatti dalle ricezioni NON vengono
-- annullati dal rollback: stornare prima le ricezioni dall'interfaccia.
