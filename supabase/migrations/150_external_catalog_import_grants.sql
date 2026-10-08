-- MIGRATION 150: correzione dei privilegi della 149 (import cataloghi WhatsApp esterni)
--
-- Documentazione: docs/WHATSAPP_EXTERNAL_CATALOG_IMPORT.md §12
--
-- Le RPC della 149 sono SECURITY INVOKER ed eseguite da service_role, ma la 149
-- revocava l'EXECUTE sulle funzioni di supporto senza riconcederlo a
-- service_role: ogni chiamata falliva con
--   "permission denied for function external_catalog_text".
-- Rilevato il 08/10/2026 alla prima prova reale; i test SQL della CI giravano
-- come superuser e non potevano vederlo (ora girano come service_role).
--
-- Solo GRANT: nessuna tabella, dato o funzione modificati. Rieseguibile.
-- Rollback: revoke execute … from service_role (riporta al difetto della 149).

begin;

grant execute on function public.external_catalog_text(jsonb, text, integer) to service_role;
grant execute on function public.external_catalog_int(jsonb, text, integer, integer) to service_role;
grant execute on function public.external_catalog_unique_slug(uuid, text) to service_role;

commit;
