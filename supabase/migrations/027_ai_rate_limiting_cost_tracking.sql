-- 027_ai_rate_limiting_cost_tracking.sql
-- Rate limiting per tenant + tracking costi AI multi-provider

-- 1. Tabella prezzi — configurabile, mai hardcoded nel codice applicativo
create table if not exists public.ai_pricing (
  id                        uuid primary key default gen_random_uuid(),
  provider                  text not null,              -- 'gemini' | 'anthropic' | altri futuri
  model                     text not null,               -- es. 'gemini-2.5-flash', 'gemini-2.5-flash-image', 'gemini-embedding-001'
  input_price_per_million   numeric(12,6),                -- USD per 1M token input, null se non applicabile
  output_price_per_million  numeric(12,6),                -- USD per 1M token output, null se non applicabile
  image_price_flat          numeric(12,6),                -- USD per immagine generata, null se non applicabile
  currency                  text not null default 'USD',
  active                    boolean not null default true,
  updated_at                timestamptz not null default now(),
  unique (provider, model)
);

comment on table public.ai_pricing is
  'Listino prezzi AI corrente per provider/modello. Aggiornato manualmente via UPDATE quando i provider cambiano i prezzi — mai hardcoded nel codice.';

-- Seed prezzi correnti verificati (luglio 2026)
insert into public.ai_pricing (provider, model, input_price_per_million, output_price_per_million, image_price_flat)
values
  ('gemini', 'gemini-2.5-flash',        0.30, 2.50, null),
  ('gemini', 'gemini-2.5-flash-image',  0.30, 2.50, 0.039),
  ('gemini', 'gemini-embedding-001',    0.15, null, null)
on conflict (provider, model) do nothing;

-- 2. Log per-chiamata (base sia per rate limit che per costi)
create table if not exists public.ai_usage_log (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  endpoint        text not null,                -- es. 'generate-product-image', 'generate-product-description', 'search-semantic'
  provider        text not null,
  model           text not null,
  input_tokens    integer,
  output_tokens   integer,
  images_generated integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  status          text not null check (status in ('success','error','rate_limited')),
  created_at      timestamptz not null default now()
);

create index if not exists ai_usage_log_tenant_endpoint_created_idx
  on public.ai_usage_log (tenant_id, endpoint, created_at desc);

comment on table public.ai_usage_log is
  'Log per-chiamata di ogni richiesta AI, usato sia per calcolare i rate limit (query su finestra temporale) sia per il tracking costi (SUM su periodo).';

-- 3. Configurazione limiti per tenant
alter table public.tenants
  add column if not exists ai_rate_limit_public_per_minute integer not null default 20,
  add column if not exists ai_rate_limit_public_per_day     integer not null default 500,
  add column if not exists ai_rate_limit_admin_per_day      integer not null default 200;

comment on column public.tenants.ai_rate_limit_public_per_minute is
  'Limite chiamate AI da route pubbliche (es. ricerca semantica) per finestra di 1 minuto, per tenant.';
comment on column public.tenants.ai_rate_limit_public_per_day is
  'Limite giornaliero chiamate AI da route pubbliche, per tenant.';
comment on column public.tenants.ai_rate_limit_admin_per_day is
  'Limite giornaliero chiamate AI da route admin (generazione immagini/descrizioni), rete di sicurezza contro loop/bug, per tenant.';

-- 4. Funzione atomica di check + registrazione rate limit
-- Ritorna true se la chiamata è permessa (e la registra come 'pending' via log separato fatto dal chiamante),
-- false se il limite è superato.
create or replace function public.check_ai_rate_limit(
  p_tenant_id   uuid,
  p_endpoint    text,
  p_is_public   boolean
)
returns boolean
language plpgsql
as $$
declare
  v_minute_count int;
  v_day_count    int;
  v_limit_minute int;
  v_limit_day    int;
begin
  select
    ai_rate_limit_public_per_minute,
    case when p_is_public then ai_rate_limit_public_per_day else ai_rate_limit_admin_per_day end
  into v_limit_minute, v_limit_day
  from public.tenants
  where id = p_tenant_id;

  if p_is_public then
    select count(*) into v_minute_count
    from public.ai_usage_log
    where tenant_id = p_tenant_id
      and endpoint = p_endpoint
      and status = 'success'
      and created_at > now() - interval '1 minute';

    if v_minute_count >= v_limit_minute then
      return false;
    end if;
  end if;

  select count(*) into v_day_count
  from public.ai_usage_log
  where tenant_id = p_tenant_id
    and endpoint = p_endpoint
    and status = 'success'
    and created_at > now() - interval '1 day';

  if v_day_count >= v_limit_day then
    return false;
  end if;

  return true;
end;
$$;

-- 5. Vista riepilogo costi mensili per tenant
create or replace view public.ai_usage_monthly_by_tenant as
select
  tenant_id,
  date_trunc('month', created_at) as month,
  provider,
  endpoint,
  count(*) as total_calls,
  sum(estimated_cost_usd) as total_cost_usd
from public.ai_usage_log
where status = 'success'
group by tenant_id, date_trunc('month', created_at), provider, endpoint;

comment on view public.ai_usage_monthly_by_tenant is
  'Riepilogo costi AI mensili per tenant/provider/endpoint. Base per il pannello billing admin.';

-- 6. Grants espliciti (Supabase richiede GRANT oltre a RLS)
grant select on public.ai_pricing to service_role;
grant select, insert on public.ai_usage_log to service_role;
grant select on public.ai_usage_monthly_by_tenant to service_role;
grant execute on function public.check_ai_rate_limit(uuid, text, boolean) to service_role;
-- Nessun grant a anon: tutte le tabelle AI usage/pricing sono accessibili solo da service_role (route server-side)
