-- Runs on the 153 fixture after 153 (applied twice). Every check raises on failure.
-- Privileges are checked with the real roles (SET ROLE), not assumed from green tests.

-- ─── 1. Privileges: anon / authenticated see nothing ───────────────────────
set role anon;
do $$
begin
  begin perform 1 from public.audit_events limit 1; raise exception 'anon can read audit_events';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.audit_feed limit 1; raise exception 'anon can read audit_feed';
  exception when insufficient_privilege then null; end;
  begin perform public.audit_feed_page('{"all_tenants": true, "modules": ["orders"]}'::jsonb, 10, 0); raise exception 'anon can call audit_feed_page';
  exception when insufficient_privilege then null; end;
  begin perform public.record_audit_event(null, 'audit.export.generated'); raise exception 'anon can write events';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set role authenticated;
do $$
begin
  begin perform 1 from public.audit_events limit 1; raise exception 'authenticated can read audit_events';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.audit_event_types limit 1; raise exception 'authenticated can read the catalogue';
  exception when insufficient_privilege then null; end;
  begin perform public.audit_feed_summary('{"all_tenants": true, "modules": ["orders"]}'::jsonb); raise exception 'authenticated can call summary';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- service_role: read + write only through record_audit_event, never UPDATE/DELETE.
set role service_role;
do $$
declare v_id uuid;
begin
  perform 1 from public.audit_events limit 1;
  perform 1 from public.audit_feed limit 1;
  begin
    insert into public.audit_events (event_type, module, category, severity) values ('audit.export.generated', 'audit', 'security', 'info');
    raise exception 'service_role can insert directly';
  exception when insufficient_privilege then null; end;
  v_id := public.record_audit_event('11111111-1111-4111-8111-111111111111', 'audit.export.generated', 'audit_export', null, null,
    '[]'::jsonb, '{"rows": 3}'::jsonb, 'success', null, null, 'export:probe-1');
  if v_id is null then raise exception 'record_audit_event returned null'; end if;
  begin update public.audit_events set severity = 'info' where id = v_id; raise exception 'service_role can update';
  exception when insufficient_privilege then null; end;
  begin delete from public.audit_events where id = v_id; raise exception 'service_role can delete';
  exception when insufficient_privilege then null; end;
  begin perform public.purge_audit_events('PURGE'); raise exception 'service_role can purge';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Even the owner cannot rewrite history.
do $$
begin
  begin update public.audit_events set severity = 'critical'; raise exception 'owner can update';
  exception when insufficient_privilege then null; end;
  begin delete from public.audit_events; raise exception 'owner can delete';
  exception when insufficient_privilege then null; end;
  begin truncate public.audit_events; raise exception 'owner can truncate';
  exception when insufficient_privilege then null; end;
end $$;

-- ─── 2. Request context: actor only from a service_role request ───────────
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  v := public.audit_request_context();
  if v->>'actor_type' <> 'unknown' or v->>'source' <> 'sql' then raise exception 'direct SQL must be unknown/sql: %', v; end if;

  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  perform set_config('request.headers', '{"x-lepefy-audit-actor-type": "admin", "x-lepefy-audit-actor-id": "a0000000-0000-4000-8000-0000000000a1"}', true);
  v := public.audit_request_context();
  if v->>'actor_type' <> 'customer' or v ? 'actor_admin_id' then raise exception 'headers trusted for a browser JWT: %', v; end if;

  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.headers', '{"x-lepefy-audit-actor-type": "root", "x-lepefy-audit-actor-id": "not-a-uuid", "x-lepefy-audit-correlation-id": "bad id;drop"}', true);
  v := public.audit_request_context();
  if v->>'actor_type' <> 'unknown' or v->>'actor_admin_id' is not null or v->>'correlation_id' is not null then
    raise exception 'invalid headers accepted: %', v; end if;
end $$;

-- ─── 3. Orders: attribution, transaction, sanitisation ─────────────────────
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  ord constant uuid := '0a000000-0000-4000-8000-000000000001';
  v record;
  n integer;
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.headers', json_build_object(
    'x-lepefy-audit-actor-type', 'admin',
    'x-lepefy-audit-actor-id', 'a0000000-0000-4000-8000-0000000000a1',
    'x-lepefy-audit-actor-label', encode(convert_to('Marie Dupont', 'UTF8'), 'base64'),
    'x-lepefy-audit-actor-ref', '/api/admin/orders/[id]',
    'x-lepefy-audit-correlation-id', 'req-0001',
    'x-lepefy-audit-source', 'app')::text, true);

  update public.orders set status = 'preparing' where id = ord;
  select * into v from public.audit_events where event_type = 'orders.order.status_changed' and resource_id = ord::text;
  if not found then raise exception 'status change not recorded'; end if;
  if v.actor_type <> 'admin' or v.actor_admin_id <> 'a0000000-0000-4000-8000-0000000000a1' or v.actor_label <> 'Marie Dupont'
    or v.correlation_id <> 'req-0001' or v.tenant_id <> a or v.resource_label <> '#0A000000' or v.source <> 'app' then
    raise exception 'wrong attribution: %', row_to_json(v); end if;
  if v.changes <> '[{"field": "status", "before": "new", "after": "preparing"}]'::jsonb then raise exception 'wrong changes: %', v.changes; end if;

  -- Rolled back business change → no event (same transaction).
  begin
    update public.orders set status = 'shipped' where id = ord;
    raise exception 'rollback_probe';
  exception when raise_exception then null; end;
  select count(*) into n from public.audit_events where event_type = 'orders.order.status_changed' and resource_id = ord::text;
  if n <> 1 then raise exception 'rolled back change left % events', n; end if;

  -- Personal fields: field name only, never the value.
  update public.orders set email = 'client@example.com', shipping_address = '{"line1": "1 rue X"}', total = 42.5 where id = ord;
  select * into v from public.audit_events where event_type = 'orders.order.updated' and resource_id = ord::text;
  if v.changes::text like '%example.com%' or v.changes::text like '%rue X%' then raise exception 'PII leaked: %', v.changes; end if;
  if not v.changes @> '[{"field": "email", "redacted": true}, {"field": "total", "before": 0, "after": 42.5}]'::jsonb then
    raise exception 'unexpected order diff: %', v.changes; end if;

  update public.orders set tracking_code = 'TRK123', tracking_carrier = 'BRT' where id = ord;
  if not exists (select 1 from public.audit_events where event_type = 'orders.order.tracking_updated' and changes @> '[{"field": "tracking_code", "after": "TRK123"}]')
    then raise exception 'tracking not recorded'; end if;

  -- Shipment drafts: failure / ambiguous / created.
  update public.orders set shipping_creation_status = 'failed', shipping_creation_error = 'invalid_recipient:téléphone' where id = ord;
  update public.orders set shipping_creation_status = 'ambiguous', shipping_creation_error = 'provider_timeout' where id = ord;
  update public.orders set shipping_creation_status = 'draft_created', shipping_creation_error = null where id = ord;
  if (select count(*) from public.audit_events where resource_id = ord::text and event_type like 'shipping.shipment.%') <> 3 then
    raise exception 'shipment events missing'; end if;
  if (select outcome || '/' || severity from public.audit_events where event_type = 'shipping.shipment.creation_ambiguous') <> 'unknown/critical' then
    raise exception 'ambiguous draft must be unknown/critical'; end if;
  update public.orders set shipping_normalized_status = 'exception', shipping_sync_error = 'HTTP 500' where id = ord;
  if (select outcome from public.audit_events where event_type = 'shipping.shipment.status_changed' and resource_id = ord::text) <> 'failure' then
    raise exception 'exception status must be a failure'; end if;

  -- Untracked column → no event.
  select count(*) into n from public.audit_events;
  update public.orders set picking_started_at = now() where id = ord;
  if (select count(*) from public.audit_events) <> n then raise exception 'untracked column produced an event'; end if;
end $$;

-- Order creation: actor derived from the row, never invented.
do $$
declare v record;
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.headers', '{}', true);
  insert into public.orders (id, tenant_id, order_origin, payment_confirmation_source, payment_method, total)
  values ('0a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'storefront', 'stripe_webhook', 'stripe', 30);
  select * into v from public.audit_events where event_type = 'orders.order.created' and resource_id = '0a000000-0000-4000-8000-000000000002';
  if v.actor_type <> 'customer' or v.actor_admin_id is not null or v.actor_ref <> 'stripe_webhook' then
    raise exception 'storefront order actor: %', row_to_json(v); end if;

  insert into public.orders (id, tenant_id, order_origin, created_by_admin_id, payment_confirmation_source, payment_confirmed_by,
    payment_method, payment_reference, payment_note, total)
  values ('0a000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'assisted',
    'a0000000-0000-4000-8000-0000000000a1', 'admin_verified', 'a0000000-0000-4000-8000-0000000000aa',
    'external_link', 'VIR-2231', 'IBAN FR76 note privée', 18);
  select * into v from public.audit_events where event_type = 'orders.order.created' and resource_id = '0a000000-0000-4000-8000-000000000003';
  if v.actor_type <> 'admin' or v.actor_admin_id <> 'a0000000-0000-4000-8000-0000000000a1' then raise exception 'assisted creator: %', row_to_json(v); end if;
  select * into v from public.audit_events where event_type = 'payments.payment.manually_confirmed';
  if v.actor_type <> 'platform_owner' or v.actor_admin_id <> 'a0000000-0000-4000-8000-0000000000aa'
    or v.metadata->>'reference' <> 'VIR-2231' or v.metadata::text like '%IBAN%' then
    raise exception 'manual payment confirmation: %', row_to_json(v); end if;

  -- Assisted order with nobody recorded: unknown, not guessed.
  insert into public.orders (id, tenant_id, order_origin) values ('0a000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'assisted');
  if (select actor_type from public.audit_events where event_type = 'orders.order.created' and resource_id = '0a000000-0000-4000-8000-000000000004') <> 'unknown' then
    raise exception 'unattributed order must stay unknown'; end if;
end $$;

-- ─── 4. Fail-open (orders) and fail-closed (RBAC, tenant settings) ─────────
do $$
declare
  failures integer := (select count(*) from public.audit_write_failures);
  events integer;
begin
  update public.audit_event_types set active = false where key = 'orders.order.status_changed';
  select count(*) into events from public.audit_events;
  update public.orders set status = 'shipped' where id = '0b000000-0000-4000-8000-000000000001';
  if (select status from public.orders where id = '0b000000-0000-4000-8000-000000000001') <> 'shipped' then
    raise exception 'fail-open trigger blocked the business update'; end if;
  if (select count(*) from public.audit_events) <> events then raise exception 'event written for an inactive type'; end if;
  if (select count(*) from public.audit_write_failures) <> failures + 1 then raise exception 'failure not counted'; end if;
  update public.audit_event_types set active = true where key = 'orders.order.status_changed';

  update public.audit_event_types set active = false where key = 'security.membership.created';
  begin
    insert into public.admin_memberships (user_id, tenant_id, role_id)
    values ('a0000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'aaaa0000-0000-4000-8000-000000000002');
    raise exception 'RBAC change committed without audit';
  exception when raise_exception then
    if sqlerrm not like 'audit_event_type_unknown%' then raise; end if;
  end;
  if exists (select 1 from public.admin_memberships) then raise exception 'membership kept without audit'; end if;
  update public.audit_event_types set active = true where key = 'security.membership.created';

  update public.audit_event_types set active = false where key = 'admin.settings.updated';
  begin
    update public.tenants set click_collect_enabled = true where id = '11111111-1111-4111-8111-111111111111';
    raise exception 'tenant setting committed without audit';
  exception when raise_exception then
    if sqlerrm not like 'audit_event_type_unknown%' then raise; end if;
  end;
  update public.audit_event_types set active = true where key = 'admin.settings.updated';
end $$;

-- ─── 5. RBAC, tenant settings, flags, payment methods ──────────────────────
do $$
declare v record;
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.headers', '{"x-lepefy-audit-actor-type": "platform_owner", "x-lepefy-audit-actor-id": "a0000000-0000-4000-8000-0000000000aa"}', true);

  insert into public.admin_permissions (key, module, label) values ('catalog.view', 'Catalogue', 'Voir'), ('catalog.manage', 'Catalogue', 'Gérer');
  insert into public.admin_role_permissions (role_id, permission_key) values
    ('aaaa0000-0000-4000-8000-000000000003', 'catalog.view'), ('aaaa0000-0000-4000-8000-000000000003', 'catalog.manage');
  select * into v from public.audit_events where event_type = 'security.permission.granted';
  if v.metadata->>'count' <> '2' or v.tenant_id is not null or v.actor_type <> 'platform_owner' then
    raise exception 'bulk grant must be one platform event: %', row_to_json(v); end if;
  delete from public.admin_role_permissions where role_id = 'aaaa0000-0000-4000-8000-000000000003' and permission_key = 'catalog.manage';
  if not exists (select 1 from public.audit_events where event_type = 'security.permission.revoked' and metadata->'permissions' ? 'catalog.manage') then
    raise exception 'revoke not recorded'; end if;

  insert into public.admin_memberships (user_id, tenant_id, role_id)
  values ('a0000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'aaaa0000-0000-4000-8000-000000000003');
  update public.admin_memberships set role_id = 'aaaa0000-0000-4000-8000-000000000002' where user_id = 'a0000000-0000-4000-8000-0000000000a1';
  select * into v from public.audit_events where event_type = 'security.membership.updated';
  if v.tenant_id <> '11111111-1111-4111-8111-111111111111' or v.resource_label <> 'Marie Dupont'
    or v.changes <> '[{"field": "role", "before": "tenant_cashier", "after": "tenant_admin"}]'::jsonb then
    raise exception 'membership update: %', row_to_json(v); end if;
  update public.admin_users set active = false where id = 'a0000000-0000-4000-8000-0000000000b1';
  if (select resource_label from public.audit_events where event_type = 'security.admin.deactivated') <> 'Administrateur' then
    raise exception 'admin without a name must not expose the e-mail'; end if;

  update public.tenants set packlink_api_key = 'pk-new-secret', shipping_provider = 'flat_rate' where id = '11111111-1111-4111-8111-111111111111';
  select * into v from public.audit_events where event_type = 'admin.settings.updated';
  if v.changes::text like '%secret%' or not v.changes @> '[{"field": "packlink_api_key", "redacted": true}, {"field": "shipping_provider", "before": "packlink", "after": "flat_rate"}]'::jsonb then
    raise exception 'tenant diff: %', v.changes; end if;
  update public.tenants set updated_at = now() + interval '1 second' where id = '11111111-1111-4111-8111-111111111111';
  if (select count(*) from public.audit_events where event_type = 'admin.settings.updated') <> 1 then raise exception 'timestamp-only update recorded'; end if;

  insert into public.tenant_feature_flags (tenant_id, flag_key, enabled) values ('11111111-1111-4111-8111-111111111111', 'activity_journal', true);
  if not exists (select 1 from public.audit_events where event_type = 'admin.feature_flag.changed' and resource_id = 'activity_journal') then
    raise exception 'flag not recorded'; end if;

  insert into public.tenant_payment_methods (tenant_id, method, label, value) values ('11111111-1111-4111-8111-111111111111', 'bank_transfer', 'Virement', 'FR7630006000011234567890189');
  if (select changes::text from public.audit_events where event_type = 'admin.payment_method.changed') like '%FR76%' then
    raise exception 'IBAN leaked'; end if;

  insert into public.tenant_feature_settings (tenant_id, feature_key, config) values ('11111111-1111-4111-8111-111111111111', 'order_documents', '{"format": "a5"}');
  if not exists (select 1 from public.audit_events where event_type = 'admin.module_settings.changed' and changes @> '[{"field": "config.format", "redacted": true}]') then
    raise exception 'module settings not recorded'; end if;
end $$;

-- ─── 6. Catalogue and customers ────────────────────────────────────────────
do $$
declare
  p constant uuid := '0c000000-0000-4000-8000-000000000001';
  n integer;
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.headers', '{}', true);
  update public.products set stock = stock - 2 where id = p; -- checkout decrement
  if exists (select 1 from public.audit_events where event_type = 'catalog.product.stock_adjusted') then raise exception 'checkout stock change recorded'; end if;
  select count(*) into n from public.audit_events;
  update public.products set embedding = '[0.1]' where id = p;
  if (select count(*) from public.audit_events) <> n then raise exception 'embedding refresh recorded'; end if;

  perform set_config('request.headers', '{"x-lepefy-audit-actor-type": "admin", "x-lepefy-audit-actor-id": "a0000000-0000-4000-8000-0000000000a1"}', true);
  update public.products set price = 5.40, stock = 30, min_order_quantity = 2, description = 'Texte long' where id = p;
  if not exists (select 1 from public.audit_events where event_type = 'catalog.product.price_updated' and changes @> '[{"field": "price", "before": 4.90, "after": 5.40}]') then
    raise exception 'price change not recorded'; end if;
  if not exists (select 1 from public.audit_events where event_type = 'catalog.product.stock_adjusted' and resource_label = 'Attiéké 1 kg') then
    raise exception 'admin stock adjustment not recorded'; end if;
  if not exists (select 1 from public.audit_events where event_type = 'catalog.product.quantity_rule_changed') then raise exception 'quantity rule not recorded'; end if;
  if not exists (select 1 from public.audit_events where event_type = 'catalog.product.updated' and changes @> '[{"field": "description", "redacted": true}]') then
    raise exception 'long text must be redacted'; end if;

  insert into public.customers (id, tenant_id, email, full_name) values ('0d000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'a@b.c', 'Awa');
  update public.customers set email = 'new@b.c', ambassador_iban = 'FR76XXX', is_ambassador = true where id = '0d000000-0000-4000-8000-000000000001';
  if (select changes::text from public.audit_events where event_type = 'customers.customer.updated') ~ '(new@b\.c|FR76|Awa)' then
    raise exception 'customer PII leaked'; end if;
  if (select resource_label from public.audit_events where event_type = 'customers.customer.updated') <> 'Client #0D000000' then
    raise exception 'customer label must not be the name'; end if;

  perform set_config('request.headers', '{}', true);
  insert into public.customers (id, tenant_id, email) values ('0d000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'guest@b.c');
  if (select count(*) from public.audit_events where event_type like 'customers.%') <> 2 then raise exception 'guest checkout customer recorded'; end if;
end $$;

-- ─── 7. Feed: tenant isolation, adapters, filters ──────────────────────────
set role service_role;
do $$
declare
  a constant text := '11111111-1111-4111-8111-111111111111';
  b constant text := '22222222-2222-4222-8222-222222222222';
  all_modules constant jsonb := '["orders","payments","shipping","catalog","customers","admin","security","audit","gestion_suppliers","gestion_purchases","gestion_inventory","gestion_treasury","whatsapp","reviews","events","notifications","platform_billing","external_catalog"]';
  b_event text;
  n integer;
begin
  -- Tenant A never sees tenant B, even by id.
  if exists (select 1 from public.audit_feed_page(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', all_modules), 500, 0) where tenant_id::text <> a) then
    raise exception 'tenant A sees other tenants'; end if;
  select id into b_event from public.audit_feed where tenant_id::text = b limit 1;
  if b_event is null then raise exception 'fixture: no tenant B event'; end if;
  if exists (select 1 from public.audit_feed_page(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', all_modules, 'id', b_event), 10, 0)) then
    raise exception 'tenant A can read a tenant B event by id'; end if;
  if (select count(*) from public.audit_feed_page(jsonb_build_object('tenant_ids', jsonb_build_array(b), 'modules', all_modules, 'id', b_event), 10, 0)) <> 1 then
    raise exception 'tenant B cannot read its own event'; end if;

  -- Fail-closed scope.
  if exists (select 1 from public.audit_feed_page(jsonb_build_object('modules', all_modules), 10, 0)) then raise exception 'no tenant scope returned rows'; end if;
  if exists (select 1 from public.audit_feed_page(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', '[]'::jsonb), 10, 0)) then
    raise exception 'no module returned rows'; end if;
  if exists (select 1 from public.audit_feed_page(jsonb_build_object('tenant_ids', jsonb_build_array('not-a-uuid'), 'modules', all_modules), 10, 0)) then
    raise exception 'invalid tenant id returned rows'; end if;
  -- Platform-level rows (tenant null) only with include_platform.
  if exists (select 1 from public.audit_feed_page(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', all_modules), 500, 0) where tenant_id is null) then
    raise exception 'platform rows leaked into tenant scope'; end if;
  if not exists (select 1 from public.audit_feed_page(jsonb_build_object('all_tenants', true, 'include_platform', true, 'modules', all_modules), 500, 0) where tenant_id is null) then
    raise exception 'platform view misses platform rows'; end if;

  -- Module filter is enforced (a cashier without treasury never gets it).
  if exists (select 1 from public.audit_feed_page(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', '["orders"]'::jsonb), 500, 0) where module <> 'orders') then
    raise exception 'module filter ignored'; end if;

  -- Adapters: legacy rows present with their original ids, no copies.
  if (select count(*) from public.audit_feed where source = 'business_audit_events') <> 2 then raise exception 'gestion adapter'; end if;
  if not exists (select 1 from public.audit_feed where id like 'ba:%' and module = 'gestion_treasury') then raise exception 'gestion module mapping'; end if;
  if (select count(*) from public.audit_feed where source = 'notification_deliveries') <> 1 then raise exception 'only failed deliveries expected'; end if;
  if (select metadata::text from public.audit_feed where source = 'notification_deliveries') like '%example.com%' then raise exception 'recipient leaked'; end if;
  if (select count(*) from public.audit_feed where source = 'admin_access_audit') <> 1 then raise exception 'legacy access audit before cutover'; end if;
  if (select metadata::text || changes::text from public.audit_feed where source = 'admin_access_audit') like '%marie@%' then raise exception 'legacy state leaked'; end if;
  if (select outcome from public.audit_feed where source = 'assisted_order_events') <> 'failure' then raise exception 'stock conflict must be a failure'; end if;

  -- Search: injection-safe, matches references.
  perform 1 from public.audit_feed_page(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', all_modules, 'search', $s$'); drop table public.orders; --$s$), 10, 0);
  if not exists (select 1 from public.audit_feed_page(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', all_modules, 'search', '#0a000000'), 10, 0)) then
    raise exception 'reference search'; end if;
  if not exists (select 1 from public.audit_feed_page(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', all_modules, 'search', 'AC-0001'), 10, 0)) then
    raise exception 'gestion reference search'; end if;
  if not exists (select 1 from public.audit_feed_page(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', all_modules, 'correlation_id', 'req-0001'), 10, 0)) then
    raise exception 'correlation filter'; end if;

  n := public.audit_feed_count(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', all_modules), 3);
  if n <> 4 then raise exception 'count cap must return cap+1, got %', n; end if;
  if (public.audit_feed_summary(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', all_modules))->>'failures')::int < 3 then
    raise exception 'summary failures'; end if;
  if not exists (select 1 from public.audit_feed_actors(jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', all_modules)) where actor_label = 'Marie Dupont') then
    raise exception 'actors list'; end if;
end $$;
reset role;

-- ─── 8. Idempotency and deterministic pagination on a large dataset ────────
do $$
declare
  a constant text := '33333333-3333-4333-8333-333333333333';
  filters jsonb := jsonb_build_object('tenant_ids', jsonb_build_array(a), 'modules', '["audit"]'::jsonb);
  r record;
  seen text[] := array[]::text[];
  offset_ids text[];
  cursor_at timestamptz;
  cursor_id text;
  page_rows integer;
  i integer;
begin
  if public.record_audit_event(a::uuid, 'audit.export.generated', null, null, null, '[]', '{}', 'success', null, null, 'export:dup') is null then
    raise exception 'first keyed write'; end if;
  if public.record_audit_event(a::uuid, 'audit.export.generated', null, null, null, '[]', '{}', 'success', null, null, 'export:dup') is not null then
    raise exception 'duplicate event_key written twice'; end if;

  -- 299 more events sharing ONE timestamp: only the id tiebreak orders them.
  for i in 1..299 loop
    perform public.record_audit_event(a::uuid, 'audit.export.generated', null, null, null, '[]', jsonb_build_object('i', i),
      'success', null, null, null, '2026-10-01 10:00:00+00');
  end loop;

  loop
    page_rows := 0;
    for r in select * from public.audit_feed_page(filters || coalesce(jsonb_build_object('cursor_at', cursor_at, 'cursor_id', cursor_id), '{}'), 50, 0) loop
      if r.id = any(seen) then raise exception 'cursor returned a duplicate'; end if;
      seen := seen || r.id;
      cursor_at := r.occurred_at; cursor_id := r.id; page_rows := page_rows + 1;
    end loop;
    exit when page_rows < 50;
  end loop;
  if cardinality(seen) <> 300 then raise exception 'cursor pagination saw % rows', cardinality(seen); end if;

  select array_agg(id) into offset_ids from (
    select id from public.audit_feed_page(filters, 50, 0) union all select id from public.audit_feed_page(filters, 50, 50)
    union all select id from public.audit_feed_page(filters, 50, 100) union all select id from public.audit_feed_page(filters, 50, 150)
    union all select id from public.audit_feed_page(filters, 50, 200) union all select id from public.audit_feed_page(filters, 50, 250)) s;
  if offset_ids <> seen then raise exception 'offset and cursor pagination disagree'; end if;

  -- Oversized payloads are reduced, never rejected.
  perform public.record_audit_event(a::uuid, 'audit.export.generated', null, null, null, '[]',
    jsonb_build_object('blob', repeat('x', 9000)));
  if not exists (select 1 from public.audit_events where tenant_id = a::uuid and metadata = '{"metadata_truncated": true}') then
    raise exception 'oversized metadata not reduced'; end if;
end $$;

-- ─── 9. Legacy history untouched, purge never automatic ────────────────────
do $$
begin
  if (select count(*) from public.business_audit_events) <> 2 or (select count(*) from public.whatsapp_audit_events) <> 1
    or (select count(*) from public.admin_access_audit) <> 1 or (select count(*) from public.assisted_order_events) <> 1 then
    raise exception 'legacy audit tables changed'; end if;
  if (public.purge_audit_events()->>'dry_run')::boolean is not true then raise exception 'purge must default to dry run'; end if;
  if (select count(*) from public.audit_events) < 300 then raise exception 'dry run deleted rows'; end if;
  if exists (select 1 from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
             where rp.permission_key like 'audit.%' and r.code not in ('platform_owner', 'tenant_admin')) then
    raise exception 'audit capabilities granted to another role'; end if;
end $$;
