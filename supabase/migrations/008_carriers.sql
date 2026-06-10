create table if not exists carriers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  unique(tenant_id, name)
);

comment on table carriers is
  'Lista corrieri disponibili per tenant. '
  'Usata nel form admin per selezionare il corriere effettivo '
  'al momento della spedizione.';

alter table carriers enable row level security;

create policy "carriers_select_public"
  on carriers for select using (active = true);

grant select on public.carriers to anon, authenticated, service_role;

do $$
declare tid uuid := (select id from tenants where slug = 'chloefood');
begin
  insert into carriers (tenant_id, name, position) values
    (tid, 'Poste Italiane', 1),
    (tid, 'BRT',            2),
    (tid, 'FedEx',          3),
    (tid, 'TNT',            4),
    (tid, 'DHL',            5),
    (tid, 'SDA',            6),
    (tid, 'UPS',            7)
  on conflict (tenant_id, name) do nothing;
end $$;
