-- GRANTs obbligatori (pattern Lepefy: RLS non basta) — 002_rls_policies.sql
-- ha definito customers_select_own/insert_own/update_own ma non i GRANT di
-- tabella corrispondenti, causando "permission denied for table customers"
-- per il ruolo authenticated (stesso bug già corretto per
-- tenant_social_links / tenant_payment_methods). Le policy filtrano le
-- righe solo dopo che il privilegio a livello di tabella è stato concesso.

grant usage on schema public to authenticated;
grant select, insert, update on public.customers to authenticated;
