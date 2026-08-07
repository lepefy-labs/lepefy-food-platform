-- ============================================================
-- 051_ambassador_split_pool_mode.sql
-- Programma Ambassador — seconda modalità di commissione, alternativa
-- alla proporzionale (046): pool condiviso a importo fisso, diviso in
-- percentuale configurabile tra ambassador e cliente invitato.
--
-- Numerazione: la spec proponeva "presumibilmente 048" — al momento di
-- scrivere questa migration la sequenza reale era già arrivata a
-- 050_shipping_country_rules.sql (048-050 occupati da lavoro successivo,
-- non correlato) — 051 è il primo numero libero. Deviazione segnalata
-- anche nel report finale.
--
-- Le due modalità sono alternative (toggle per tenant, non coesistenza),
-- selezionate da tenants.ambassador_commission_mode. Default
-- 'PROPORTIONAL' per ogni tenant esistente e nuovo: zero impatto sul
-- comportamento attuale finché il tenant non cambia esplicitamente modalità.
-- ============================================================

-- ─── 1. TENANTS — toggle modalità + parametri pool condiviso ────────────────
alter table tenants
  add column if not exists ambassador_commission_mode text not null default 'PROPORTIONAL'
    check (ambassador_commission_mode in ('PROPORTIONAL', 'SPLIT_POOL')),
  add column if not exists ambassador_split_pool_amount numeric(10,2),
  add column if not exists ambassador_split_pool_ambassador_percent numeric(5,2)
    check (ambassador_split_pool_ambassador_percent is null or
           (ambassador_split_pool_ambassador_percent >= 0 and ambassador_split_pool_ambassador_percent <= 100));

comment on column tenants.ambassador_commission_mode is
  'Alternativa (toggle, non coesistenza) tra PROPORTIONAL (percentuale derivata da ambassador_min_purchase_amount/ambassador_min_commission_amount, 046) e SPLIT_POOL (importo fisso ambassador_split_pool_amount diviso tra ambassador e cliente invitato secondo ambassador_split_pool_ambassador_percent). ambassador_min_purchase_amount resta la soglia condivisa tra le due modalità.';
comment on column tenants.ambassador_split_pool_ambassador_percent is
  'Quota percentuale dell''ambassador sul pool in modalità SPLIT_POOL. La quota del cliente invitato è sempre 100 - questo valore — nessuna colonna separata lato invitato.';

-- ─── 2. AMBASSADOR_COMMISSIONS — colonne SPLIT_POOL + nullable proporzionali ─
-- rate_applied/max_commission_applied restano obbligatori per le righe
-- PROPORTIONAL (scritti come sempre da process_ambassador_commission_atomic)
-- ma non hanno senso per una riga SPLIT_POOL (il pool è già di per sé il
-- tetto, nessun tasso derivato) — resi nullable per poter restare null in
-- quel branch invece di un valore fittizio.
alter table ambassador_commissions
  alter column rate_applied drop not null,
  alter column max_commission_applied drop not null,
  add column if not exists commission_mode text not null default 'PROPORTIONAL'
    check (commission_mode in ('PROPORTIONAL', 'SPLIT_POOL')),
  add column if not exists pool_amount_applied numeric(10,2),
  add column if not exists pool_ambassador_percent_applied numeric(5,2);

comment on column ambassador_commissions.pool_amount_applied is
  'Storicizzato al momento della generazione della commissione (stesso pattern di rate_applied per PROPORTIONAL) — se il tenant cambia ambassador_split_pool_amount in futuro, le righe già create non cambiano retroattivamente.';
comment on column ambassador_commissions.pool_ambassador_percent_applied is
  'Storicizzato al momento della generazione della commissione — stesso motivo di pool_amount_applied.';

-- ─── 3. FUNZIONE: aggiunge il branch SPLIT_POOL ──────────────────────────────
-- Stessa firma e stesso comportamento PROPORTIONAL di 046, invariato
-- carattere per carattere nella formula: solo aggiunto un branch alternativo
-- selezionato da tenants.ambassador_commission_mode e la scrittura esplicita
-- di commission_mode = 'PROPORTIONAL' sulle righe del ramo esistente (il
-- default colonna è comunque 'PROPORTIONAL', quindi nessun cambio di dato
-- per i tenant che non toccano il toggle).
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
  v_mode text;
  v_min_purchase numeric;
  v_min_commission numeric;
  v_max_commission numeric;
  v_pool_amount numeric;
  v_pool_ambassador_percent numeric;
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
    select ambassador_commission_mode, ambassador_min_purchase_amount, ambassador_min_commission_amount,
           ambassador_max_commission_amount, ambassador_split_pool_amount, ambassador_split_pool_ambassador_percent
    into v_mode, v_min_purchase, v_min_commission, v_max_commission, v_pool_amount, v_pool_ambassador_percent
    from tenants where id = p_tenant_id;

    -- il check soglia usa il subtotale PRE-sconto (stesso importo che ha sbloccato lo sconto),
    -- identico nelle due modalità
    if p_order_subtotal >= v_min_purchase then
      -- la commissione si calcola sull'importo EFFETTIVAMENTE pagato (post-sconto),
      -- storicizzato in entrambe le modalità anche se SPLIT_POOL non lo usa nella formula
      v_amount_paid := p_order_subtotal - p_discount_applied;

      if v_mode = 'SPLIT_POOL' then
        if v_pool_amount is not null and v_pool_ambassador_percent is not null then
          v_commission := round(v_pool_amount * v_pool_ambassador_percent / 100, 2);

          insert into ambassador_commissions (
            tenant_id, ambassador_customer_id, referred_customer_id, order_id,
            order_subtotal, order_amount_paid, discount_applied,
            commission_mode, pool_amount_applied, pool_ambassador_percent_applied,
            commission_amount, status
          ) values (
            p_tenant_id, v_ambassador_id, p_referred_customer_id, p_order_id,
            p_order_subtotal, v_amount_paid, p_discount_applied,
            'SPLIT_POOL', v_pool_amount, v_pool_ambassador_percent,
            v_commission, 'CONFIRMED'
          );

          v_created := true;
        end if;
      else
        v_rate := v_min_commission / v_min_purchase;
        v_commission := least(v_amount_paid * v_rate, v_max_commission);

        insert into ambassador_commissions (
          tenant_id, ambassador_customer_id, referred_customer_id, order_id,
          order_subtotal, order_amount_paid, discount_applied,
          commission_mode, rate_applied, max_commission_applied, commission_amount, status
        ) values (
          p_tenant_id, v_ambassador_id, p_referred_customer_id, p_order_id,
          p_order_subtotal, v_amount_paid, p_discount_applied,
          'PROPORTIONAL', v_rate, v_max_commission, v_commission, 'CONFIRMED'
        );

        v_created := true;
      end if;
    end if;
  end if;

  update orders
    set ambassador_commission_processed = true,
        ambassador_commission_processed_at = now()
    where id = p_order_id and tenant_id = p_tenant_id;

  return query select v_created, v_commission;
end;
$$ language plpgsql security definer;

-- create or replace non cambia i grant di una funzione già esistente con
-- stessa firma — ri-dichiarati comunque esplicitamente per idempotenza,
-- stesso pattern difensivo del resto del file.
grant execute on function process_ambassador_commission_atomic to service_role;
