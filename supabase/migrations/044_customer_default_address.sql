-- 044_customer_default_address.sql
-- Pre-compilazione checkout + salvataggio profilo cliente.
--
-- Contesto verificato prima di scrivere questa migration: la tabella
-- `addresses` esiste da 001_initial_schema.sql e ha policy RLS complete in
-- 002_rls_policies.sql, ma NESSUN punto del codice applicativo la legge o la
-- scrive (grep su tutto apps/storefront: zero occorrenze). È quindi vuota per
-- ogni tenant, e i suoi GRANT di tabella non sono mai stati concessi — stesso
-- identico debito già corretto per `customers` in 038 (authenticated) e 042
-- (service_role): "pattern Lepefy: RLS non basta", le policy filtrano le righe
-- solo DOPO che il privilegio di tabella è stato concesso.

-- ─── 1. GRANT (senza questi ogni query fallisce con "permission denied") ─────
grant select, insert, update, delete on public.addresses to service_role;
grant select, insert, update, delete on public.addresses to authenticated;

-- ─── 2. Upsert atomico dell'indirizzo di default ────────────────────────────
-- Il salvataggio dell'indirizzo dopo il checkout è multi-step (azzerare il
-- vecchio default + registrare il nuovo). Eseguirlo come due query separate da
-- Node non dà nessuna garanzia di atomicità: un crash tra le due lascerebbe il
-- cliente senza alcun indirizzo di default, e quindi senza pre-compilazione
-- all'ordine successivo. Una funzione PL/pgSQL è transazionale di per sé —
-- stesso pattern già usato in 029 (decrement_stock_for_order) e 040
-- (process_order_points_atomic).
--
-- Deviazione consapevole dalla richiesta letterale ("inserisci una nuova
-- riga"): se il cliente riordina allo stesso indirizzo, inserire ogni volta una
-- riga nuova farebbe crescere `addresses` senza limite con duplicati esatti.
-- Qui un indirizzo identico (line1/line2/city/postal_code/country, confronto
-- case-insensitive e trim-insensitive) viene semplicemente ri-promosso a
-- default invece di essere duplicato. L'effetto osservabile per il chiamante è
-- identico: esiste esattamente una riga is_default=true, con quei valori.
create or replace function public.upsert_default_address(
  p_customer_id uuid,
  p_tenant_id   uuid,
  p_full_name   text,
  p_line1       text,
  p_line2       text,
  p_city        text,
  p_postal_code text,
  p_country     text
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  -- Riga già esistente e identica → si riusa, niente duplicato.
  select id into v_id
  from public.addresses
  where customer_id = p_customer_id
    and tenant_id   = p_tenant_id
    and lower(btrim(line1))                  = lower(btrim(p_line1))
    and lower(btrim(coalesce(line2, '')))    = lower(btrim(coalesce(p_line2, '')))
    and lower(btrim(city))                   = lower(btrim(p_city))
    and lower(btrim(postal_code))            = lower(btrim(p_postal_code))
    and lower(btrim(country))                = lower(btrim(p_country))
  limit 1;

  -- Un solo default per cliente: azzerato nella STESSA transazione
  -- dell'insert/update sotto (escluso l'eventuale record riusato).
  update public.addresses
  set is_default = false
  where customer_id = p_customer_id
    and tenant_id   = p_tenant_id
    and is_default  = true
    and (v_id is null or id <> v_id);

  if v_id is not null then
    update public.addresses
    set is_default = true,
        full_name  = coalesce(nullif(btrim(p_full_name), ''), full_name)
    where id = v_id;
    return v_id;
  end if;

  insert into public.addresses (
    customer_id, tenant_id, full_name, line1, line2,
    city, postal_code, country, is_default
  ) values (
    p_customer_id, p_tenant_id, coalesce(nullif(btrim(p_full_name), ''), ''),
    p_line1, nullif(btrim(coalesce(p_line2, '')), ''),
    p_city, p_postal_code, coalesce(nullif(btrim(p_country), ''), 'IT'), true
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.upsert_default_address(uuid, uuid, text, text, text, text, text, text) is
  'Registra l''indirizzo di spedizione di un cliente come unico is_default=true, '
  'atomicamente: l''azzeramento dei default precedenti e la scrittura del nuovo '
  'avvengono nella stessa transazione PL/pgSQL (mai uno senza l''altro). Un '
  'indirizzo identico già presente viene ri-promosso a default invece di essere '
  'duplicato. Chiamata da /api/checkout (rami in_store e Stripe) dopo un '
  'checkout riuscito, in modo non bloccante: un suo fallimento non annulla mai '
  'l''ordine.';

grant execute on function public.upsert_default_address(
  uuid, uuid, text, text, text, text, text, text
) to service_role;

-- ─── 3. Indice di lettura ───────────────────────────────────────────────────
-- GET /api/customers/me legge esattamente questo predicato a ogni apertura del
-- checkout di un cliente loggato.
create index if not exists addresses_customer_default_idx
  on public.addresses (customer_id, tenant_id)
  where is_default = true;
