-- Restore category writes for the server-only admin API.
-- Prerequisites: categories exists with catalog_scope (migration 103);
-- service_role already has SELECT, as used by the categories GET endpoint.
-- No customer grants, RLS changes, schema changes or data backfill.
begin;
grant insert, update on table public.categories to service_role;
commit;

-- Rollback: revoke only privileges absent in the pre-deployment snapshot.
-- revoke insert, update on table public.categories from service_role;
