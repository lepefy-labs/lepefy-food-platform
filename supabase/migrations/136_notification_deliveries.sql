-- 136 — Notification delivery ledger (outbox) for n8n-delivered notifications.
--
-- Lepefy records every opted-in notification before sending it, tries it
-- immediately, and a protected scheduler endpoint retries failures with
-- backoff. n8n stays a transport. Additive, no data migration, no change for
-- callers that do not opt in.
--   * one row per (tenant, idempotency_key): the same logical message is never
--     queued twice;
--   * payload is kept only while a retry may need it (cleared on acceptance);
--   * service_role only (RLS on, no policies, nothing granted to anon/authenticated).

begin;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 3 and 200),
  notification_type text not null check (char_length(notification_type) between 1 and 80),
  webhook_path text not null check (webhook_path ~ '^/webhook/[a-z0-9-]+$'),
  payload jsonb,
  subject text,
  recipients text[] not null default '{}',
  status text not null default 'processing'
    check (status in ('pending', 'processing', 'accepted', 'failed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (tenant_id, idempotency_key)
);

create index if not exists notification_deliveries_due_idx
  on public.notification_deliveries (next_attempt_at)
  where status in ('pending', 'failed', 'processing');
create index if not exists notification_deliveries_tenant_recent_idx
  on public.notification_deliveries (tenant_id, created_at desc);

alter table public.notification_deliveries enable row level security;
revoke all on table public.notification_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.notification_deliveries to service_role;

-- Claims up to p_limit due deliveries for a retry: pending/failed rows whose
-- next attempt is due, plus processing rows whose lock expired (crashed send).
-- SKIP LOCKED keeps concurrent scheduler runs from claiming the same row.
create or replace function public.claim_notification_deliveries(p_limit integer)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.notification_deliveries d
     set status = 'processing',
         attempts = d.attempts + 1,
         locked_until = now() + interval '2 minutes',
         updated_at = now()
   where d.id in (
     select c.id from public.notification_deliveries c
      where c.payload is not null
        and c.attempts < c.max_attempts
        and ((c.status in ('pending', 'failed') and c.next_attempt_at <= now())
          or (c.status = 'processing' and c.locked_until < now()))
      order by c.next_attempt_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
  returning d.*;
end
$$;

revoke all on function public.claim_notification_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;

commit;
