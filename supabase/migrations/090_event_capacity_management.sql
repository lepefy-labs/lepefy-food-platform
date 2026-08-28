-- MIGRATION 090: EVENT CAPACITY MANAGEMENT + AUDIT
-- Additive and reversible. Capacity changes are atomic and cannot reduce below already reserved places.

create table if not exists public.event_capacity_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  previous_capacity integer not null check (previous_capacity >= 0),
  new_capacity integer not null check (new_capacity >= 0),
  delta integer not null,
  reason text,
  changed_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_event_capacity_adjustments_event
  on public.event_capacity_adjustments(event_id, created_at desc);
create index if not exists idx_event_capacity_adjustments_tenant
  on public.event_capacity_adjustments(tenant_id, created_at desc);

alter table public.event_capacity_adjustments enable row level security;
grant select, insert on public.event_capacity_adjustments to service_role;

insert into public.admin_permissions (key, module, label, description, risk_level, position)
values (
  'event_capacity.manage',
  'Événementiel · Événements',
  'Gérer la capacité',
  'Augmenter ou réduire la capacité vendable d’un événement sans descendre sous les places déjà réservées.',
  'sensitive',
  125
)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  risk_level = excluded.risk_level,
  position = excluded.position,
  active = true;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, 'event_capacity.manage'
from public.admin_roles r
where r.code in ('platform_owner', 'tenant_admin')
on conflict do nothing;

create or replace function public.adjust_event_capacity(
  p_event_id uuid,
  p_tenant_id uuid,
  p_new_capacity integer,
  p_actor_user_id uuid,
  p_reason text default null
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_reserved integer;
  v_previous integer;
  v_reason text;
begin
  if p_new_capacity is null or p_new_capacity < 0 then
    raise exception 'La nouvelle capacité doit être un entier positif ou nul.';
  end if;

  select * into v_event
  from public.events
  where id = p_event_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Événement introuvable.';
  end if;

  v_previous := v_event.capacity_total;
  v_reserved := greatest(0, v_event.capacity_total - v_event.capacity_remaining);

  if p_new_capacity < v_reserved then
    raise exception 'La capacité ne peut pas être inférieure aux % places déjà réservées.', v_reserved;
  end if;

  if p_new_capacity = v_previous then
    return v_event;
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  update public.events
  set capacity_total = p_new_capacity,
      capacity_remaining = p_new_capacity - v_reserved,
      updated_at = now()
  where id = v_event.id
  returning * into v_event;

  insert into public.event_capacity_adjustments (
    tenant_id,
    event_id,
    previous_capacity,
    new_capacity,
    delta,
    reason,
    changed_by
  ) values (
    p_tenant_id,
    p_event_id,
    v_previous,
    p_new_capacity,
    p_new_capacity - v_previous,
    v_reason,
    p_actor_user_id
  );

  return v_event;
end;
$$;

revoke all on function public.adjust_event_capacity(uuid, uuid, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.adjust_event_capacity(uuid, uuid, integer, uuid, text) to service_role;

comment on table public.event_capacity_adjustments is 'Audit ledger for manual event capacity changes.';
comment on function public.adjust_event_capacity(uuid, uuid, integer, uuid, text) is 'Atomically adjusts event capacity while preserving already reserved places and writing an audit row.';
