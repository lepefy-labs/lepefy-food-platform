-- 105_tenant_app_icon.sql
-- Dedicated tenant application icon, independent from storefront and label logos.
begin;
alter table public.tenants add column app_icon_url text null;
comment on column public.tenants.app_icon_url is
  'Dedicated square application icon used by the storefront PWA and native/TWA wrappers. Independent from logo_url. NULL falls back to the normal tenant logo.';
grant select (app_icon_url) on table public.tenants to anon, authenticated;
commit;
