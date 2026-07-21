-- ─── MIGRATION 031: SISTEMA BARCODE EAN-13 (interno, multi-tenant) ───────────

-- ─── 1. TENANTS — prefisso 3 cifre + contatore sequenza ──────────────────────
alter table tenants
  add column if not exists barcode_prefix   text unique,
  add column if not exists barcode_sequence bigint not null default 0;

comment on column tenants.barcode_prefix is
  '3 cifre univoche a livello piattaforma, assegnate automaticamente dal trigger '
  'tenants_assign_barcode_prefix alla creazione del tenant. Mai impostare a mano.';
comment on column tenants.barcode_sequence is
  'Contatore atomico — incrementato da next_product_barcode() a ogni nuovo barcode generato per questo tenant.';

-- Trigger: assegna il prefisso libero più basso disponibile (000-999) se non impostato
create or replace function public.assign_tenant_barcode_prefix()
returns trigger
language plpgsql
as $$
declare
  v_next int;
begin
  if new.barcode_prefix is null then
    select coalesce(max(barcode_prefix::int), -1) + 1 into v_next from tenants;
    if v_next > 999 then
      raise exception 'barcode_prefix esaurito (max 1000 tenant supportati con 3 cifre)';
    end if;
    new.barcode_prefix := lpad(v_next::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_assign_barcode_prefix on tenants;
create trigger tenants_assign_barcode_prefix
  before insert on tenants
  for each row execute function assign_tenant_barcode_prefix();

-- Backfill tenant esistente (il trigger scatta solo su INSERT, chloefood esiste già)
update tenants set barcode_prefix = '000' where slug = 'chloefood' and barcode_prefix is null;

-- ─── 2. PRODUCTS — colonna barcode ────────────────────────────────────────────
alter table products
  add column if not exists barcode_value        text unique,
  add column if not exists barcode_generated_at timestamptz;

comment on column products.barcode_value is
  'EAN-13 (13 cifre) generato internamente: "20" + tenants.barcode_prefix (3) + sequenza (7) + check digit (1). '
  'Univoco a livello di piattaforma, non solo di tenant. Mai un vero codice GS1 del produttore.';

-- ─── 3. Funzione atomica: genera il prossimo barcode per un tenant ───────────
create or replace function public.next_product_barcode(p_tenant_id uuid)
returns text
language plpgsql
as $$
declare
  v_prefix text;
  v_seq    bigint;
  v_body   text;
  v_sum    int := 0;
  v_digit  int;
  v_check  int;
  i        int;
begin
  update tenants
     set barcode_sequence = barcode_sequence + 1
   where id = p_tenant_id
   returning barcode_prefix, barcode_sequence into v_prefix, v_seq;

  if v_prefix is null then
    raise exception 'tenant % non ha barcode_prefix assegnato', p_tenant_id;
  end if;

  if v_seq > 9999999 then
    raise exception 'sequenza barcode esaurita per tenant % (max 9.999.999 prodotti)', p_tenant_id;
  end if;

  -- corpo a 12 cifre: "20" (range interno GS1) + prefisso tenant (3) + sequenza (7)
  v_body := '20' || v_prefix || lpad(v_seq::text, 7, '0');

  -- checksum EAN-13 standard: posizioni dispari ×1, pari ×3 (1-indexed da sinistra)
  for i in 1..12 loop
    v_digit := substr(v_body, i, 1)::int;
    if i % 2 = 1 then
      v_sum := v_sum + v_digit;
    else
      v_sum := v_sum + v_digit * 3;
    end if;
  end loop;

  v_check := (10 - (v_sum % 10)) % 10;

  return v_body || v_check::text;
end;
$$;

grant execute on function public.next_product_barcode(uuid) to service_role;

-- ─── 4. Backfill: genera un barcode per tutti i prodotti chloefood esistenti ─
do $$
declare
  r         record;
  v_tenant  uuid;
  v_code    text;
begin
  select id into v_tenant from tenants where slug = 'chloefood';

  for r in
    select id from products
    where tenant_id = v_tenant and barcode_value is null
    order by created_at asc, id asc
  loop
    select next_product_barcode(v_tenant) into v_code;
    update products
       set barcode_value = v_code, barcode_generated_at = now()
     where id = r.id;
  end loop;
end $$;
