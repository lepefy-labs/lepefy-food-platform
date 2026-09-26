-- Additive, opt-in operational briefing: no order/payment mutation.
alter table public.tenants
  add column if not exists daily_digest_enabled boolean not null default false,
  add column if not exists daily_digest_timezone text not null default 'Europe/Rome',
  add column if not exists daily_digest_include_empty boolean not null default false,
  add column if not exists daily_digest_prepare_hours integer not null default 24 check (daily_digest_prepare_hours between 1 and 336),
  add column if not exists daily_digest_pickup_hours integer not null default 48 check (daily_digest_pickup_hours between 1 and 336),
  add column if not exists daily_digest_payment_hours integer not null default 48 check (daily_digest_payment_hours between 1 and 336);

alter table public.tenant_notification_recipients
  add column if not exists notify_daily_digest boolean not null default false;

create table if not exists public.tenant_daily_digest_runs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  local_date date not null,
  status text not null check (status in ('processing','accepted','failed','skipped')),
  claimed_at timestamptz not null default now(),
  accepted_at timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  error_code text,
  primary key (tenant_id,local_date)
);
alter table public.tenant_daily_digest_runs enable row level security;
revoke all on public.tenant_daily_digest_runs from anon,authenticated;
grant select,insert,update on public.tenant_daily_digest_runs to service_role;

create or replace function public.claim_tenant_daily_digest(p_tenant uuid,p_date date)
returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
  insert into public.tenant_daily_digest_runs(tenant_id,local_date,status,claimed_at)
  values(p_tenant,p_date,'processing',now())
  on conflict(tenant_id,local_date) do update
    set status='processing',claimed_at=now(),error_code=null
  where public.tenant_daily_digest_runs.status='failed'
     or (public.tenant_daily_digest_runs.status='processing'
         and public.tenant_daily_digest_runs.claimed_at < now()-interval '30 minutes');
  get diagnostics n=row_count;
  return n=1;
end $$;
revoke all on function public.claim_tenant_daily_digest(uuid,date) from public,anon,authenticated;
grant execute on function public.claim_tenant_daily_digest(uuid,date) to service_role;
