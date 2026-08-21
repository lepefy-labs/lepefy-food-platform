-- Tenant-configurable exact Google Maps location URL for the public digital card.
alter table public.tenants
  add column if not exists google_maps_url text;

comment on column public.tenants.google_maps_url is
  'Exact public HTTPS Google Maps share/location URL used by the tenant digital card.';
