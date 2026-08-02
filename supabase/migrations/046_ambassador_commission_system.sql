-- ============================================================
-- 046_ambassador_commission_system.sql
-- Programma Ambassador — commissioni in denaro reale (fuori piattaforma)
-- + sconto opzionale al primo ordine del cliente invitato.
--
-- Numerazione: la spec originale proponeva "041_...". Al momento di
-- scrivere questa migration la sequenza reale in supabase/migrations/ era
-- già arrivata a 045_tenant_hero_slides.sql (041-045 tutti occupati da
-- lavoro successivo al sistema loyalty/referral) — 046 è il primo numero
-- libero. Deviazione segnalata anche nel report finale.
--
-- Programma separato e indipendente da 040_loyalty_referral_system.sql:
-- nessuna tabella/funzione di quella migration viene alterata qui, tutte
-- vengono solo richiamate (referenziate via FK o lette in application code).
-- ============================================================

-- ─── 1. TENANTS — configurazione programma ambassador ────────────────────────
alter table tenants
  add column if not exists ambassador_min_purchase_amount numeric(10,2) not null default 20.00,
  add column if not exists ambassador_min_commission_amount numeric(10,2) not null default 5.00,
  add column if not exists ambassador_max_commission_amount numeric(10,2) not null default 50.00,
  add column if not exists ambassador_loyalty_from_second_order boolean not null default false,
  add column if not exists ambassador_first_order_discount_type text
    check (ambassador_first_order_discount_type in ('PERCENT', 'FIXED')),  -- null = sconto disattivato
  add column if not exists ambassador_first_order_discount_value numeric(10,2),
  add column if not exists ambassador_payout_threshold_amount numeric(10,2) not null default 50.00;

comment on column tenants.ambassador_min_purchase_amount is
  'Soglia minima di subtotale (pre-sconto) per: (a) sbloccare lo sconto primo ordine, (b) sbloccare la commissione ambassador. Insieme a ambassador_min_commission_amount definisce il tasso derivato rate = min_commission / min_purchase, calcolato live in UI e storicizzato per riga in ambassador_commissions.rate_applied — mai salvato come colonna propria su tenants (stesso pattern di tenant_referral_tiers.pct rispetto a points_ledger.pct_applied).';
comment on column tenants.ambassador_first_order_discount_type is
  'Nullable: null = feature sconto disattivata per questo tenant (il programma ambassador resta comunque attivo per le commissioni, che non dipendono da questa colonna).';
comment on column tenants.ambassador_payout_threshold_amount is
  'Nessun payout automatico: quando il saldo CONFIRMED di un ambassador supera questo valore, l''admin lo vede evidenziato come "pronto per pagamento" nella vista commissioni.';

-- ─── 2. CUSTOMERS — status ambassador + profilo pagamento ────────────────────
alter table customers
  add column if not exists is_ambassador boolean not null default false,
  add column if not exists promoted_to_ambassador_at timestamptz,
  add column if not exists promoted_to_ambassador_by uuid references admin_users(id),
  add column if not exists ambassador_first_name text,
  add column if not exists ambassador_last_name text,
  add column if not exists ambassador_payment_method text
    check (ambassador_payment_method in ('IBAN', 'PAYPAL')),
  add column if not exists ambassador_iban text,
  add column if not exists ambassador_paypal_email text,
  add column if not exists ambassador_profile_completed_at timestamptz;

create index if not exists idx_customers_is_ambassador
  on customers(tenant_id) where is_ambassador = true;

comment on column customers.is_ambassador is
  'Settabile solo da admin (azione "Promouvoir ambassadeur" — nessun self-upgrade lato storefront). Il link /invite/[code] funziona da subito dopo la promozione: l''attribuzione referral (referred_by_id) non dipende da ambassador_profile_completed_at, solo il payout resta bloccato finché il profilo non è completo.';
comment on column customers.ambassador_profile_completed_at is
  'Valorizzato quando nome, cognome e un metodo di pagamento (IBAN o PayPal) sono tutti compilati — vedi completeAmbassadorProfile.ts. Le commissioni continuano ad accumularsi in stato CONFIRMED anche a profilo incompleto: questo campo blocca solo la visibilità "payable" lato admin, non la generazione della commissione stessa.';

-- ─── 3. AMBASSADOR COMMISSIONS ────────────────────────────────────────────────
create table if not exists ambassador_commissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  ambassador_customer_id uuid not null references customers(id),
  referred_customer_id uuid not null references customers(id),
  order_id uuid not null references orders(id),
  order_subtotal numeric(10,2) not null,        -- importo pre-sconto, usato per il check soglia
  order_amount_paid numeric(10,2) not null,     -- importo post-sconto, base di calcolo commissione
  discount_applied numeric(10,2) not null default 0,
  rate_applied numeric(6,4) not null,            -- storicizzato (min_commission / min_purchase al momento del calcolo)
  max_commission_applied numeric(10,2) not null, -- storicizzato
  commission_amount numeric(10,2) not null,      -- least(order_amount_paid * rate_applied, max_commission_applied)
  status text not null default 'CONFIRMED'
    check (status in ('CONFIRMED', 'PAID', 'CANCELLED')),
  paid_at timestamptz,
  paid_by_admin_id uuid references admin_users(id),
  payment_note text,
  created_at timestamptz not null default now(),

  -- garantisce "una sola commissione per cliente invitato, al primo acquisto"
  constraint uq_ambassador_commission_per_referred unique (tenant_id, referred_customer_id)
);

create index if not exists idx_ambassador_commissions_ambassador
  on ambassador_commissions(tenant_id, ambassador_customer_id, status);

comment on table ambassador_commissions is
  'Niente stato PENDING: a differenza di points_ledger (che usa PENDING in attesa di conferma anti-frode/consegna), questa tabella viene scritta direttamente in CONFIRMED perché process_ambassador_commission_atomic() gira solo al momento in cui l''ordine passa a delivered — lo stesso trigger di process_order_points_atomic, non prima. Nessuna finestra di reso separata è prevista dal programma ambassador.';

-- ─── 4. ORDERS — sconto ambassador + idempotenza commissione ────────────────
alter table orders
  add column if not exists ambassador_discount_amount numeric(10,2) not null default 0,
  add column if not exists ambassador_commission_processed boolean not null default false,
  add column if not exists ambassador_commission_processed_at timestamptz;

-- ─── 5. CHECKOUT_SESSIONS — porta lo sconto dal checkout al webhook Stripe ──
-- Deviazione (segnalata nel report finale): non prevista esplicitamente dalla
-- spec, ma necessaria. Il flusso Stripe crea l'ordine reale nel webhook
-- payment_intent.succeeded (vedi checkout_sessions in 006_checkout_sessions.sql),
-- non nel POST /api/checkout dove lo sconto viene calcolato per fissare
-- l'importo del PaymentIntent. Senza questa colonna, il webhook dovrebbe
-- ricalcolare lo sconto in un momento diverso (rischio di drift rispetto
-- all'importo realmente addebitato) invece di riportare fedelmente il valore
-- già fissato al checkout.
alter table checkout_sessions
  add column if not exists ambassador_discount_amount numeric(10,2) not null default 0;

-- ─── 6. FUNZIONE: commissione ambassador (atomica, idempotente) ─────────────
-- Stesso pattern di process_order_points_atomic (040, §10): idempotenza
-- gestita internamente marcando orders.ambassador_commission_processed nella
-- stessa transazione, qualunque sia l'esito (commissione creata o no) — a
-- differenza della bozza originale del prompt (che usava RETURN anticipati
-- senza mai marcare la colonna), qui il flag va sempre scritto una volta
-- valutato l'ordine, altrimenti ogni retry ri-eseguirebbe da capo i controlli
-- e process_order_points_atomic in processOrderPointsOnDelivery.ts non
-- avrebbe un segnale coerente per decidere se il ramo ambassador è già stato
-- gestito per questo ordine.
create or replace function process_ambassador_commission_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_referred_customer_id uuid,
  p_order_subtotal numeric,
  p_discount_applied numeric
) returns table(commission_created boolean, commission_amount numeric) as $$
declare
  v_already_processed boolean;
  v_ambassador_id uuid;
  v_min_purchase numeric;
  v_min_commission numeric;
  v_max_commission numeric;
  v_rate numeric;
  v_amount_paid numeric;
  v_commission numeric := 0;
  v_created boolean := false;
begin
  select ambassador_commission_processed into v_already_processed
  from orders where id = p_order_id and tenant_id = p_tenant_id;

  if v_already_processed then
    return query select false, 0::numeric; return;
  end if;

  select referred_by_id into v_ambassador_id
  from customers where id = p_referred_customer_id and tenant_id = p_tenant_id;

  if v_ambassador_id is not null
    and exists (
      select 1 from customers
      where id = v_ambassador_id and tenant_id = p_tenant_id and is_ambassador = true
    )
    and not exists (
      select 1 from ambassador_commissions
      where tenant_id = p_tenant_id and referred_customer_id = p_referred_customer_id
    )
  then
    select ambassador_min_purchase_amount, ambassador_min_commission_amount, ambassador_max_commission_amount
    into v_min_purchase, v_min_commission, v_max_commission
    from tenants where id = p_tenant_id;

    -- il check soglia usa il subtotale PRE-sconto (stesso importo che ha sbloccato lo sconto)
    if p_order_subtotal >= v_min_purchase then
      v_rate := v_min_commission / v_min_purchase;
      -- la commissione si calcola sull'importo EFFETTIVAMENTE pagato (post-sconto)
      v_amount_paid := p_order_subtotal - p_discount_applied;
      v_commission := least(v_amount_paid * v_rate, v_max_commission);

      insert into ambassador_commissions (
        tenant_id, ambassador_customer_id, referred_customer_id, order_id,
        order_subtotal, order_amount_paid, discount_applied,
        rate_applied, max_commission_applied, commission_amount, status
      ) values (
        p_tenant_id, v_ambassador_id, p_referred_customer_id, p_order_id,
        p_order_subtotal, v_amount_paid, p_discount_applied,
        v_rate, v_max_commission, v_commission, 'CONFIRMED'
      );

      v_created := true;
    end if;
  end if;

  update orders
    set ambassador_commission_processed = true,
        ambassador_commission_processed_at = now()
    where id = p_order_id and tenant_id = p_tenant_id;

  return query select v_created, v_commission;
end;
$$ language plpgsql security definer;

-- ─── 7. GRANT ESPLICITI + RLS — stesso pattern di 040 (§11) ─────────────────
-- ambassador_commissions non ha alcuna policy pubblica di scrittura o lettura:
-- solo service_role vi accede (via createServiceClient() in tutti gli
-- endpoint/lib nuovi), esattamente come points_ledger/referral_fraud_signals.
-- RLS on + zero policy = fail-closed per anon/authenticated.
grant select, insert, update on ambassador_commissions to service_role;
grant execute on function process_ambassador_commission_atomic to service_role;

alter table ambassador_commissions enable row level security;
