-- ============================================================
-- 047_loyalty_card_system.sql
-- Carta fedeltà virtuale — accumulo punti per acquisti in negozio
-- (scan in cassa), senza creare un ordine reale.
--
-- Riusa integralmente (mai riscritto):
--   - tenants.purchase_points_rate (040) come tasso punti/euro
--   - tenants.barcode_prefix (031) come prefisso tenant per il numero tessera
--   - il pattern trigger/backfill già usato per i barcode prodotto (031)
--   - il pattern funzione atomica già usato da process_order_points_atomic (040)
-- ============================================================

-- ─── DEVIAZIONI RISPETTO ALLA BOZZA DEL PROMPT (verificate allo Step 0) ──────
--
-- 1. La colonna si chiama `reference_order_id`, non `order_id` — ed è GIÀ
--    nullable (nessun `not null` in 040_loyalty_referral_system.sql). Le righe
--    SIGNUP_BONUS (registerWithReferral.ts) sono già inserite con
--    reference_order_id = null. Nessuna ALTER per renderla nullable: non
--    serve, era già così. Il check "un solo riferimento valorizzato, mai
--    entrambi" è implementato come "non entrambi contemporaneamente"
--    (entrambi null resta legittimo, per SIGNUP_BONUS/REDEEMED che non hanno
--    né ordine né acquisto manuale).
--
-- 2. lib/barcode.ts NON contiene una funzione di calcolo check digit
--    importabile: il checksum EAN-13 è inline dentro next_product_barcode()
--    (031_barcode_system.sql), che next_loyalty_card_number() qui sotto non
--    può "importare" essendo un'altra funzione SQL. Per rispettare comunque
--    "non duplicare/non modificare" il sistema barcode prodotto esistente
--    (namespace 20), l'algoritmo di checksum viene estratto in una NUOVA
--    funzione condivisa ean13_check_digit() in questa migration — usata da
--    next_loyalty_card_number() (namespace 21) — mentre next_product_barcode()
--    resta byte-per-byte invariata, non refactorizzata per chiamare la nuova
--    funzione condivisa. Vedi commento su ean13_check_digit più sotto.
--
-- 3. Prefisso namespace "21": verificato via grep sull'intero storico
--    migrations/ e sul codice applicativo — nessun uso preesistente. Libero.
--
-- 4. "tenant_cashier non deve comparire nella UI di gestione admin_users con
--    permessi di creare altri admin": non esiste ALCUNA UI di gestione
--    admin_users nel codebase (creazione admin è manuale via Supabase
--    Dashboard, confermato in CLAUDE.md — "No registration flow exists in
--    the app"). Nessun intervento necessario, nulla da restringere.

-- ─── 1. ADMIN_USERS — nuovo ruolo tenant_cashier ─────────────────────────────
alter table admin_users drop constraint if exists admin_users_role_check;
alter table admin_users add constraint admin_users_role_check
  check (role in ('platform_owner', 'tenant_admin', 'tenant_cashier'));

alter table admin_users drop constraint if exists tenant_admin_requires_tenant;
alter table admin_users add constraint tenant_admin_requires_tenant check (
  (role in ('tenant_admin', 'tenant_cashier') and tenant_id is not null) or
  (role = 'platform_owner' and tenant_id is null)
);

comment on column admin_users.role is
  'platform_owner: accesso globale (tenant_id null). tenant_admin: accesso completo scoped al proprio tenant. tenant_cashier (047): ruolo leggero, stesso scoping tenant di tenant_admin ma limitato via requireAdmin(tenantId, [...]) alla sola route di scan fedeltà — vedi lib/auth/requireAdmin.ts.';

-- ─── 2. TENANTS — contatore sequenza dedicato tessere fedeltà ────────────────
-- Sequenza INDIPENDENTE da tenants.barcode_sequence (quella conta i prodotti,
-- namespace 20): condividerla farebbe collidere/saltare numeri tra i due
-- namespace senza alcun bisogno, dato che il prefisso "20" vs "21" già basta
-- a distinguerli — ogni namespace ha la propria sequenza progressiva pulita.
alter table tenants
  add column if not exists loyalty_card_sequence bigint not null default 0;

comment on column tenants.loyalty_card_sequence is
  'Contatore atomico — incrementato da next_loyalty_card_number() ad ogni nuova tessera fedeltà generata per questo tenant. Indipendente da barcode_sequence (prodotti, namespace 20).';

-- ─── 3. CUSTOMERS — numero tessera fedeltà ───────────────────────────────────
alter table customers
  add column if not exists loyalty_card_number text unique;

comment on column customers.loyalty_card_number is
  'EAN-13 (13 cifre) generato internamente: "21" + tenants.barcode_prefix (3) + sequenza tenant-scoped (7) + check digit (1). Namespace "21" scelto per non collidere mai con products.barcode_value (namespace "20", 031_barcode_system.sql) pur riusando lo stesso prefisso tenant già assegnato. Assegnato automaticamente da un trigger BEFORE INSERT su customers (vedi sotto) — copre uniformemente ogni percorso di creazione riga (upsert OTP signup in verifyOtp.ts, ecc.), a differenza del barcode prodotto che è assegnato da una chiamata esplicita lato applicazione.';

-- ─── 4. FUNZIONE CONDIVISA: checksum EAN-13 ──────────────────────────────────
-- Estratta dall'algoritmo inline di next_product_barcode() (031) — stessa
-- logica esatta, isolata qui perché non esisteva come funzione riusabile.
-- next_product_barcode() NON viene toccata (vedi deviazione #2 sopra): questa
-- funzione è nuova, usata solo da next_loyalty_card_number() sotto.
create or replace function public.ean13_check_digit(p_body12 text)
returns int
language plpgsql
immutable
as $$
declare
  v_sum   int := 0;
  v_digit int;
  i       int;
begin
  if p_body12 !~ '^[0-9]{12}$' then
    raise exception 'ean13_check_digit richiede esattamente 12 cifre, ricevuto: %', p_body12;
  end if;

  for i in 1..12 loop
    v_digit := substr(p_body12, i, 1)::int;
    if i % 2 = 1 then
      v_sum := v_sum + v_digit;
    else
      v_sum := v_sum + v_digit * 3;
    end if;
  end loop;

  return (10 - (v_sum % 10)) % 10;
end;
$$;

grant execute on function public.ean13_check_digit(text) to service_role;

-- ─── 5. FUNZIONE: genera il prossimo numero tessera per un tenant ───────────
create or replace function public.next_loyalty_card_number(p_tenant_id uuid)
returns text
language plpgsql
as $$
declare
  v_prefix text;
  v_seq    bigint;
  v_body   text;
begin
  update tenants
     set loyalty_card_sequence = loyalty_card_sequence + 1
   where id = p_tenant_id
   returning barcode_prefix, loyalty_card_sequence into v_prefix, v_seq;

  if v_prefix is null then
    raise exception 'tenant % non ha barcode_prefix assegnato', p_tenant_id;
  end if;

  if v_seq > 9999999 then
    raise exception 'sequenza tessera fedeltà esaurita per tenant % (max 9.999.999 clienti)', p_tenant_id;
  end if;

  -- corpo a 12 cifre: "21" (namespace tessera fedeltà, distinto da "20" prodotti)
  -- + prefisso tenant (3) + sequenza (7)
  v_body := '21' || v_prefix || lpad(v_seq::text, 7, '0');

  return v_body || public.ean13_check_digit(v_body)::text;
end;
$$;

grant execute on function public.next_loyalty_card_number(uuid) to service_role;

-- ─── 6. TRIGGER: assegna il numero tessera alla creazione del cliente ───────
create or replace function public.assign_customer_loyalty_card_number()
returns trigger
language plpgsql
as $$
begin
  if new.loyalty_card_number is null then
    new.loyalty_card_number := next_loyalty_card_number(new.tenant_id);
  end if;
  return new;
end;
$$;

drop trigger if exists customers_assign_loyalty_card_number on customers;
create trigger customers_assign_loyalty_card_number
  before insert on customers
  for each row execute function assign_customer_loyalty_card_number();

-- ─── 7. BACKFILL — clienti esistenti creati prima di questa migration ───────
-- Stesso approccio di 031 (loop + generazione + update), generalizzato a TUTTI
-- i tenant (031 filtrava solo chloefood perché all'epoca era l'unico tenant
-- esistente — qui, per la regola "multi-tenant first", non si assume nulla
-- sul numero di tenant presenti).
do $$
declare
  r      record;
  v_code text;
begin
  for r in
    select id, tenant_id from customers
    where loyalty_card_number is null
    order by tenant_id, created_at asc, id asc
  loop
    select next_loyalty_card_number(r.tenant_id) into v_code;
    update customers set loyalty_card_number = v_code where id = r.id;
  end loop;
end $$;

-- ─── 8. LOYALTY_MANUAL_PURCHASES — audit trail acquisti in negozio ──────────
create table if not exists loyalty_manual_purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  customer_id uuid not null references customers(id),
  staff_admin_id uuid not null references admin_users(id),
  amount numeric(10,2) not null check (amount > 0),
  points_awarded integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_loyalty_manual_purchases_customer
  on loyalty_manual_purchases(tenant_id, customer_id);

comment on table loyalty_manual_purchases is
  'Un acquisto fisico in negozio, registrato dallo staff via /admin/loyalty/scan. Non crea MAI una riga orders — esiste solo per storicizzare l''importo che ha generato punti, senza inquinare statistiche/dashboard che assumono che ogni orders sia un vero ordine con prodotti/spedizione. Append-only: nessuna funzione di storno in questa v1 (nota aperta, vedi report finale).';

grant select, insert on loyalty_manual_purchases to service_role;
alter table loyalty_manual_purchases enable row level security;
-- Nessuna policy pubblica di scrittura o lettura — stesso pattern fail-closed
-- di points_ledger/referral_fraud_signals/ambassador_commissions: RLS on +
-- zero policy per anon/authenticated, solo service_role vi accede (via
-- createServiceClient() nelle nuove route admin).

-- ─── 9. POINTS_LEDGER — nuovo canale "acquisto in negozio" ──────────────────
alter table points_ledger
  add column if not exists manual_purchase_id uuid references loyalty_manual_purchases(id);

create index if not exists idx_points_ledger_manual_purchase
  on points_ledger(manual_purchase_id);

-- "un solo riferimento valorizzato tra reference_order_id e
-- manual_purchase_id, mai entrambi" — implementato come "non entrambi
-- contemporaneamente" (non "esattamente uno"): SIGNUP_BONUS/REDEEMED restano
-- legittimamente con entrambi null, comportamento preesistente non alterato.
alter table points_ledger drop constraint if exists points_ledger_order_xor_manual_purchase;
alter table points_ledger add constraint points_ledger_order_xor_manual_purchase
  check (reference_order_id is null or manual_purchase_id is null);

-- Nuovo transaction_type, distinto da PURCHASE_EARNED per restare
-- distinguibile in reportistica (stesso principio "one concept = one entry"
-- già seguito per le commissioni ambassador, 046).
alter table points_ledger drop constraint if exists points_ledger_transaction_type_check;
alter table points_ledger add constraint points_ledger_transaction_type_check
  check (transaction_type in (
    'PURCHASE_EARNED', 'REFERRAL_EARNED', 'SIGNUP_BONUS', 'REDEEMED', 'EXPIRED', 'REVERSED',
    'IN_STORE_PURCHASE_EARNED'
  ));

comment on column points_ledger.manual_purchase_id is
  'Valorizzato solo per transaction_type = IN_STORE_PURCHASE_EARNED (047). Mai insieme a reference_order_id (vedi constraint points_ledger_order_xor_manual_purchase).';

-- ─── 10. FUNZIONE: assegna punti da acquisto manuale in negozio (atomica) ───
-- Stesso pattern di process_order_points_atomic (040, §10), replicato
-- identico nello stile (plpgsql, no security definer, un'unica transazione
-- implicita per funzione). NON tocca in alcun modo process_order_points_atomic
-- né la catena referral/ambassador — solo il tasso base punti/euro
-- (tenants.purchase_points_rate) viene riusato, nessun'altra logica online
-- (referral, anti-frode, signup bonus) si applica qui: un acquisto in negozio
-- assegna punti solo al titolare della tessera scansionata.
create or replace function process_manual_purchase_points_atomic(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_staff_admin_id uuid,
  p_amount numeric
) returns table(points_awarded integer, new_confirmed_balance integer) as $$
declare
  v_rate               numeric;
  v_points             integer;
  v_manual_purchase_id uuid;
  v_balance            integer;
begin
  select purchase_points_rate into v_rate from tenants where id = p_tenant_id;
  if v_rate is null then
    raise exception 'tenant % non trovato', p_tenant_id;
  end if;

  v_points := round(p_amount * v_rate);

  insert into loyalty_manual_purchases (
    tenant_id, customer_id, staff_admin_id, amount, points_awarded
  ) values (
    p_tenant_id, p_customer_id, p_staff_admin_id, p_amount, v_points
  ) returning id into v_manual_purchase_id;

  insert into points_ledger (
    tenant_id, customer_id, amount, status, transaction_type, manual_purchase_id
  ) values (
    p_tenant_id, p_customer_id, v_points, 'CONFIRMED', 'IN_STORE_PURCHASE_EARNED', v_manual_purchase_id
  );

  select coalesce(sum(amount) filter (where status in ('CONFIRMED', 'REVERSED')), 0)
    into v_balance
  from points_ledger
  where tenant_id = p_tenant_id and customer_id = p_customer_id;

  return query select v_points, v_balance;
end;
$$ language plpgsql;

grant execute on function process_manual_purchase_points_atomic to service_role;
