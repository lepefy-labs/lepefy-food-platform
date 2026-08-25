-- MIGRATION 079: canonical storefront URL per tenant
--
-- Notifications and platform tools must not infer a tenant storefront from a
-- deployment-global environment variable. Store the canonical public shop URL
-- on the tenant instead, while preserving legacy fallbacks in application code.
-- The admin settings UI is the source of truth for future tenant updates.

alter table public.tenants
  add column if not exists storefront_url text;

comment on column public.tenants.storefront_url is
  'Canonical public storefront URL for this tenant (for example https://shop.example.com).';

-- Backfill the currently known production tenant. Future tenants are configured
-- from the admin settings UI rather than hard-coded in application code.
update public.tenants
set storefront_url = 'https://shop.chloefood.com'
where slug = 'chloefood'
  and (storefront_url is null or btrim(storefront_url) = '');

-- 076 replaced table-level SELECT with an explicit public column allow-list.
-- storefront_url is intentionally public metadata, so grant it explicitly.
grant select (storefront_url) on table public.tenants to anon, authenticated;
