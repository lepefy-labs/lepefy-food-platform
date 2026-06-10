alter table tenants
  add column if not exists click_collect_hours text
    default 'Lun–Sam 9h00–19h00';

comment on column tenants.click_collect_hours is
  'Orari di apertura mostrati al cliente nel checkout Click & Collect.';

update tenants
set click_collect_hours = 'Lun–Sam 9h00–19h00'
where slug = 'chloefood';
