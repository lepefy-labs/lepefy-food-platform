-- Vérification post-application de la migration 153 (Journal d'activité).
--
-- À exécuter dans le SQL Editor Supabase (rôle postgres) APRÈS l'application
-- de supabase/migrations/153_admin_activity_audit.sql.
-- Tout se passe dans une transaction annulée (ROLLBACK) : aucune commande,
-- aucun produit, aucun tenant réel n'est modifié de façon durable.
-- Chaque contrôle lève une exception explicite ; le message final
-- « Migration 153 - vérifications OK » confirme l'ensemble.
--
-- Contrôles :
--  1. schéma : tables, vue, fonctions, triggers posés sur les bonnes tables ;
--  2. sécurité : RLS forcée, aucun privilège anon/authenticated, service_role
--     en lecture seule sur audit_events, EXECUTE limité ;
--  3. append-only : UPDATE/DELETE refusés même au propriétaire ;
--  4. attribution : un UPDATE simulé « comme PostgREST » (claims service_role +
--     en-têtes x-lepefy-audit-*) produit un événement attribué, puis ROLLBACK ;
--  5. historique : les tables d'audit existantes sont lisibles via audit_feed.
--
-- Après ce script, la vraie preuve d'attribution est fonctionnelle : modifier un
-- statut de commande sur lepefy-test depuis l'admin et vérifier l'auteur dans
-- /admin/activite (docs/ADMIN_ACTIVITY_AUDIT.md §13).

begin;

do $$
declare
  v_order   record;
  v_event   record;
  v_count   integer;
  v_trigger text;
begin
  -- 1. Schéma
  foreach v_trigger in array array[
    'orders:audit_orders_insert', 'orders:audit_orders_update', 'products:audit_products_insert_delete',
    'products:audit_products_update', 'customers:audit_customers_change', 'tenants:audit_tenants_update',
    'tenant_feature_flags:audit_feature_flags_change', 'tenant_feature_settings:audit_feature_settings_change',
    'tenant_payment_methods:audit_payment_methods_change', 'admin_role_permissions:audit_role_permissions_insert',
    'admin_role_permissions:audit_role_permissions_delete', 'admin_roles:audit_roles_change',
    'admin_memberships:audit_memberships_change', 'admin_users:audit_admin_users_insert', 'admin_users:audit_admin_users_update'] loop
    if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                   where c.relname = split_part(v_trigger, ':', 1) and t.tgname = split_part(v_trigger, ':', 2) and not t.tgisinternal) then
      raise exception 'trigger manquant : %', v_trigger;
    end if;
  end loop;
  if (select count(*) from public.audit_event_types) < 39 then raise exception 'catalogue incomplet'; end if;
  if not exists (select 1 from public.audit_settings where id) then raise exception 'audit_settings vide'; end if;

  -- 2. Sécurité
  if exists (select 1 from information_schema.role_table_grants
             where table_schema = 'public' and table_name in ('audit_events', 'audit_event_types', 'audit_write_failures', 'audit_settings', 'audit_feed', 'audit_volume_stats')
               and grantee in ('anon', 'authenticated', 'PUBLIC')) then
    raise exception 'privilège anon/authenticated sur une table du journal';
  end if;
  if exists (select 1 from information_schema.role_table_grants
             where table_schema = 'public' and table_name = 'audit_events' and grantee = 'service_role' and privilege_type <> 'SELECT') then
    raise exception 'service_role peut écrire directement dans audit_events';
  end if;
  if not (select relforcerowsecurity from pg_class where oid = 'public.audit_events'::regclass) then raise exception 'RLS non forcée'; end if;
  if has_function_privilege('anon', 'public.record_audit_event(uuid, text, text, text, text, jsonb, jsonb, text, text, jsonb, text, timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.audit_feed_page(jsonb, integer, integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.purge_audit_events(text)', 'EXECUTE') then
    raise exception 'EXECUTE trop large';
  end if;
  if not has_function_privilege('service_role', 'public.audit_feed_page(jsonb, integer, integer)', 'EXECUTE') then
    raise exception 'service_role ne peut pas lire le journal';
  end if;
  if (select count(*) from public.admin_permissions where key in ('audit.view', 'audit.export', 'audit.security.view', 'platform.audit.view')) <> 4 then
    raise exception 'capabilities manquantes';
  end if;

  -- 4. Attribution « comme PostgREST » sur une commande existante (annulé à la fin).
  select id, tenant_id, notes into v_order from public.orders order by created_at desc limit 1;
  if v_order.id is not null then
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
    perform set_config('request.headers', json_build_object(
      'x-lepefy-audit-actor-type', 'system', 'x-lepefy-audit-actor-ref', 'verification-153',
      'x-lepefy-audit-correlation-id', 'verification-153')::text, true);
    update public.orders set notes = coalesce(notes, '') || ' ' where id = v_order.id;
    select * into v_event from public.audit_events where correlation_id = 'verification-153' order by recorded_at desc limit 1;
    if v_event.id is null or v_event.actor_type <> 'system' or v_event.actor_ref <> 'verification-153' or v_event.event_type <> 'orders.order.updated' then
      raise exception 'attribution non conforme : %', row_to_json(v_event);
    end if;
    if v_event.changes <> '[{"field": "notes", "redacted": true}]'::jsonb then
      raise exception 'la note de commande doit apparaître sans valeur : %', v_event.changes;
    end if;

    -- 3. Append-only, même pour le propriétaire.
    begin
      update public.audit_events set severity = 'critical' where id = v_event.id;
      raise exception 'UPDATE accepté sur audit_events';
    exception when insufficient_privilege then null; end;
    begin
      delete from public.audit_events where id = v_event.id;
      raise exception 'DELETE accepté sur audit_events';
    exception when insufficient_privilege then null; end;
  else
    raise notice 'aucune commande : contrôle d''attribution ignoré';
  end if;

  -- 5. Lecture unifiée (les historiques existants restent la source).
  select count(*) into v_count from public.audit_feed where source <> 'audit_events';
  raise notice 'événements historiques lisibles via audit_feed : %', v_count;
  if (select count(*) from public.audit_write_failures) > 0 then
    raise notice 'ATTENTION : % échec(s) d''écriture du journal (audit_write_failures)', (select count(*) from public.audit_write_failures);
  end if;

  raise notice 'Migration 153 - vérifications OK';
end
$$;

rollback;
