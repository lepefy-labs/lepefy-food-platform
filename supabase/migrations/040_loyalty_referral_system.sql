-- ============================================================
-- 040_loyalty_referral_system.sql
-- Sistema Loyalty & Referral multi-livello, multi-tenant
-- ============================================================

-- ─── 1. TENANTS — feature flag + configurazione generale ────────────────────
alter table tenants
  add column if not exists loyalty_enabled boolean not null default false,
  add column if not exists referral_max_depth integer not null default 2
    check (referral_max_depth >= 1 and referral_max_depth <= 5),
  add column if not exists purchase_points_rate numeric(10,4) not null default 1.0,
  add column if not exists points_to_currency_rate numeric(10,4) not null default 0.01,
  add column if not exists referral_signup_bonus_points integer not null default 0,
  add column if not exists referral_fraud_max_conversions numeric not null default 10,
  add column if not exists referral_fraud_period_days integer not null default 30,
  add column if not exists referral_fraud_action text not null default 'FLAG_FOR_REVIEW'
    check (referral_fraud_action in ('FLAG_FOR_REVIEW','AUTO_BLOCK','CAP_AT_THRESHOLD')),
  add column if not exists referral_availability_mode text not null default 'ALL_CUSTOMERS'
    check (referral_availability_mode in ('ALL_CUSTOMERS','SPENDING_THRESHOLD','ADMIN_GRANTED_ONLY')),
  add column if not exists referral_unlock_spending_threshold numeric(10,2);

comment on column tenants.referral_max_depth is
  'Profondità massima catena referral per questo tenant (1-5). Cap di sistema a 5, indipendente da qualunque valore che un admin tenant potrebbe voler impostare — decisione di piattaforma, non configurabile oltre questo tetto senza migration esplicita.';
comment on column tenants.referral_unlock_spending_threshold is
  'Obbligatorio (not null, > 0) solo quando referral_availability_mode = SPENDING_THRESHOLD. Validare in application layer, non in constraint DB per permettere di cambiare modalità senza dover prima svuotare il campo.';

-- ─── 2. CUSTOMERS — link referral + eleggibilità ─────────────────────────────
alter table customers
  add column if not exists referred_by_id uuid references customers(id),
  add column if not exists referral_code text,
  add column if not exists signup_ip inet,
  add column if not exists signup_device_fingerprint text,
  add column if not exists referral_access_granted boolean not null default false,
  add column if not exists referral_access_reason text
    check (referral_access_reason in ('DEFAULT_ENABLED','THRESHOLD_MET','ADMIN_GRANTED')),
  add column if not exists referral_access_granted_at timestamptz,
  add column if not exists referral_access_granted_by uuid references admin_users(id), -- richiede 039_admin_users.sql già eseguita
  add column if not exists referral_suspended boolean not null default false;

create unique index if not exists idx_customers_referral_code
  on customers(tenant_id, referral_code) where referral_code is not null;
create index if not exists idx_customers_referred_by
  on customers(tenant_id, referred_by_id);

comment on column customers.referred_by_id is
  'Unico link necessario alla catena: con profondità variabile per tenant, NON denormalizzare grandparent_id o livelli superiori — la catena si ricostruisce con recursive CTE (vedi funzione resolve_referral_chain), limitata dinamicamente a tenants.referral_max_depth.';
comment on column customers.referral_suspended is
  'Concetto distinto da referral_access_granted: quest''ultimo governa "può generare/condividere un codice", questo governa "è sospeso per anti-frode" (azione AUTO_BLOCK). Un customer può avere referral_access_granted=true e referral_suspended=true contemporaneamente — significa che ha un codice ma i suoi referral in ingresso non generano più punti finché non viene riabilitato manualmente.';

-- ─── 3. REFERRAL CODES ────────────────────────────────────────────────────────
create table if not exists referral_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  owner_customer_id uuid not null references customers(id),
  code text not null,
  is_active boolean not null default true,
  max_uses integer,
  uses_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index if not exists idx_referral_codes_owner on referral_codes(tenant_id, owner_customer_id);

-- ─── 4. TIER PERCENTUALI — versionate, mai sovrascritte ──────────────────────
create table if not exists tenant_referral_tiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  level integer not null check (level >= 1),
  pct numeric(5,4) not null check (pct >= 0 and pct <= 1),
  is_active boolean not null default true,
  effective_from timestamptz not null default now(),
  created_by uuid references admin_users(id) -- richiede 039_admin_users.sql già eseguita
);
create index if not exists idx_referral_tiers_active
  on tenant_referral_tiers(tenant_id, level) where is_active;

comment on table tenant_referral_tiers is
  'Mai UPDATE su una riga esistente per cambiare una percentuale: inserire nuova riga con effective_from=now(), disattivare la precedente (is_active=false). Storico completo per audit — points_ledger.pct_applied congela il valore usato al momento del calcolo, indipendente da modifiche future qui.';

-- ─── 5. LEDGER PUNTI — append-only ────────────────────────────────────────────
create table if not exists points_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  customer_id uuid not null references customers(id),
  amount integer not null,
  status text not null check (status in ('PENDING','CONFIRMED','SPENT','EXPIRED','REVERSED')),
  transaction_type text not null check (transaction_type in (
    'PURCHASE_EARNED','REFERRAL_EARNED','SIGNUP_BONUS','REDEEMED','EXPIRED','REVERSED'
  )),
  referral_level integer,
  pct_applied numeric(5,4),
  reference_order_id uuid references orders(id),
  reference_customer_id uuid references customers(id),
  reversal_of_ledger_id uuid references points_ledger(id),
  requires_manual_review boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_points_ledger_balance
  on points_ledger(tenant_id, customer_id, status);
create index if not exists idx_points_ledger_order
  on points_ledger(reference_order_id);

create or replace view customer_points_balance as
select
  tenant_id, customer_id,
  coalesce(sum(amount) filter (where status = 'CONFIRMED'), 0) as confirmed_balance,
  coalesce(sum(amount) filter (where status = 'PENDING'), 0)   as pending_balance
from points_ledger
group by tenant_id, customer_id;

-- ─── 6. ORDERS — idempotenza processing ──────────────────────────────────────
alter table orders
  add column if not exists points_processed boolean not null default false,
  add column if not exists points_processed_at timestamptz;

-- ─── 7. ANTI-FRODE ─────────────────────────────────────────────────────────
create table if not exists referral_fraud_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  customer_id uuid not null references customers(id),
  signal_type text not null check (signal_type in ('SAME_IP','SAME_DEVICE','SAME_SHIPPING_ADDRESS','SAME_PHONE')),
  matched_customer_id uuid not null references customers(id),
  detected_at timestamptz not null default now()
);
create index if not exists idx_fraud_signals_customer on referral_fraud_signals(tenant_id, customer_id);

-- ─── 8. FUNZIONE: risoluzione dinamica della catena referral ─────────────────
create or replace function resolve_referral_chain(
  p_tenant_id uuid, p_customer_id uuid, p_max_depth integer
) returns table(customer_id uuid, level integer) as $$
  with recursive chain as (
    select c.referred_by_id as customer_id, 1 as level
    from customers c
    where c.id = p_customer_id and c.tenant_id = p_tenant_id and c.referred_by_id is not null

    union all

    select c.referred_by_id, chain.level + 1
    from customers c
    join chain on c.id = chain.customer_id
    where c.referred_by_id is not null and chain.level < p_max_depth
  )
  select customer_id, level from chain;
$$ language sql stable;

-- ─── 8b. FUNZIONE: downline (l'inverso di resolve_referral_chain) ────────────
-- Aggiunta non presente nella spec originale — necessaria per l'endpoint
-- GET /api/loyalty/referrals/tree. resolve_referral_chain (§8) risale la
-- catena DA un customer VERSO i suoi sponsor (ascendenti) — corretto per il
-- calcolo commissioni in processOrderPointsOnDelivery, ma è l'opposto di
-- quanto serve per mostrare all'utente la propria rete di invitati (discendenti,
-- "la corda dei cartellini"). Stessa forma di ritorno (customer_id, level),
-- stesso cap dinamico su p_max_depth, solo la CTE ricorsiva percorre
-- referred_by_id nella direzione opposta.
create or replace function resolve_referral_downline(
  p_tenant_id uuid, p_customer_id uuid, p_max_depth integer
) returns table(customer_id uuid, level integer) as $$
  with recursive downline as (
    select c.id as customer_id, 1 as level
    from customers c
    where c.referred_by_id = p_customer_id and c.tenant_id = p_tenant_id

    union all

    select c.id, downline.level + 1
    from customers c
    join downline on c.referred_by_id = downline.customer_id
    where downline.level < p_max_depth
  )
  select customer_id, level from downline;
$$ language sql stable;

-- ─── 9. FUNZIONE: applica referral a signup (atomica) ────────────────────────
create or replace function apply_referral_on_signup(
  p_tenant_id uuid, p_new_customer_id uuid, p_referred_by_id uuid,
  p_referral_code_id uuid, p_signup_ip inet, p_device_fingerprint text
) returns void as $$
begin
  update customers set
    referred_by_id = p_referred_by_id,
    signup_ip = p_signup_ip,
    signup_device_fingerprint = p_device_fingerprint
  where id = p_new_customer_id and tenant_id = p_tenant_id;

  update referral_codes set uses_count = uses_count + 1
  where id = p_referral_code_id and tenant_id = p_tenant_id;
end;
$$ language plpgsql;

-- ─── 10. FUNZIONE: processa punti ordine (atomica, idempotente) ─────────────
-- Riceve p_entries come jsonb array — la funzione stessa marca points_processed=true
-- nella stessa transazione dell'insert, garantendo tutto-o-niente.
create or replace function process_order_points_atomic(
  p_order_id uuid, p_entries jsonb
) returns void as $$
declare
  v_entry jsonb;
begin
  -- Idempotenza: se già processato, non fare nulla (nessun errore, no-op silenzioso)
  if (select points_processed from orders where id = p_order_id) then
    return;
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    insert into points_ledger (
      tenant_id, customer_id, amount, status, transaction_type,
      referral_level, pct_applied, reference_order_id, reference_customer_id,
      requires_manual_review
    ) values (
      (v_entry->>'tenantId')::uuid,
      (v_entry->>'customerId')::uuid,
      (v_entry->>'amount')::integer,
      v_entry->>'status',
      v_entry->>'transactionType',
      (v_entry->>'referralLevel')::integer,
      (v_entry->>'pctApplied')::numeric,
      p_order_id,
      (v_entry->>'referenceCustomerId')::uuid,
      coalesce((v_entry->>'requiresManualReview')::boolean, false)
    );
  end loop;

  update orders set points_processed = true, points_processed_at = now() where id = p_order_id;
end;
$$ language plpgsql;

-- ─── 11. GRANT ESPLICITI — regola "RLS non basta", vedi debito tecnico noto ──
-- Deviazione dal testo letterale del prompt: la sua bozza concedeva a
-- service_role solo insert/update/delete, senza select. Verificato contro il
-- precedente consolidato nel progetto (033_ai_chatbox_knowledge_base.sql,
-- "grant select, insert, update, delete ... to service_role") — qui le nuove
-- tabelle non ereditano i privilegi di default sullo schema, quindi senza
-- select esplicito ogni .select() da createServiceClient() (usato in TUTTI i
-- nuovi endpoint/lib) avrebbe fallito con "permission denied". Corretto qui,
-- esattamente il tipo di debito tecnico che il prompt chiede di verificare.
grant select on referral_codes, tenant_referral_tiers, points_ledger,
  referral_fraud_signals, customer_points_balance to anon, authenticated;
grant select, insert, update, delete on referral_codes, tenant_referral_tiers, points_ledger,
  referral_fraud_signals to service_role;
grant select on customer_points_balance to service_role;
grant execute on function resolve_referral_chain to service_role;
grant execute on function resolve_referral_downline to service_role;
grant execute on function apply_referral_on_signup to service_role;
grant execute on function process_order_points_atomic to service_role;

-- RLS: abilitata, nessuna policy pubblica di scrittura (solo service_role scrive,
-- stesso pattern di tenant_knowledge_base) — verificare che RLS sia ON su tutte
-- le tabelle nuove prima di considerare la migration completa.
-- Nota: nessuna policy SELECT pubblica è definita nemmeno qui — i GRANT sopra
-- restano quindi "fail closed" per anon/authenticated (RLS on + zero policy =
-- zero righe visibili), esattamente come tenant_knowledge_base. Ogni endpoint
-- applicativo legge/scrive tramite createServiceClient() (service_role, bypassa
-- RLS), mai tramite il client browser/anon direttamente.
alter table referral_codes enable row level security;
alter table tenant_referral_tiers enable row level security;
alter table points_ledger enable row level security;
alter table referral_fraud_signals enable row level security;
