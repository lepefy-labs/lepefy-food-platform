-- Runs after 145 has been applied twice (idempotency) on the 145 fixture.
begin;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  b constant uuid := '22222222-2222-4222-8222-222222222222';
  order_a1 constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  order_b1 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
  invite constant uuid := 'cccccccc-0000-4000-8000-000000000001';
  first_token uuid;
begin
  -- 1. Catalog: registered once, active, non-billable; no settings row created.
  if (select count(*) from public.platform_features where key = 'order_documents' and active and not billable and category = 'operations') <> 1
    then raise exception 'order_documents must be one active, non-billable operational feature'; end if;
  if exists (select 1 from public.tenant_feature_settings where feature_key = 'order_documents')
    then raise exception 'Migration 145 must not create settings rows (defaults apply)'; end if;

  -- 2. Config CHECK: valid partial/full configs accepted, invalid rejected.
  insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
  values (a, 'order_documents', true, '{"version": 1, "picking_list_format": "a4", "packing_slip_enabled": true, "packing_slip_format": "a5", "packing_slip_show_logo": true, "packing_slip_show_qr": true, "packing_slip_show_thank_you": false, "packing_slip_show_contact": true, "packing_slip_show_prices": false, "packing_slip_show_delivery_address": false}');
  insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
  values (b, 'order_documents', true, '{"picking_list_format": "a5"}');

  begin
    update public.tenant_feature_settings set config = '{"picking_list_format": "letter"}' where tenant_id = b and feature_key = 'order_documents';
    raise exception 'unknown format accepted';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"packing_slip_show_prices": "yes"}' where tenant_id = b and feature_key = 'order_documents';
    raise exception 'non-boolean flag accepted';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"secret": 1}' where tenant_id = b and feature_key = 'order_documents';
    raise exception 'unknown key accepted';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"version": 2}' where tenant_id = b and feature_key = 'order_documents';
    raise exception 'unknown version accepted';
  exception when check_violation then null; end;

  -- 3. Token table: privileges and RLS.
  if has_table_privilege('anon', 'public.order_public_access_tokens', 'select')
     or has_table_privilege('authenticated', 'public.order_public_access_tokens', 'select')
     or has_table_privilege('anon', 'public.order_public_access_tokens', 'insert')
    then raise exception 'order_public_access_tokens must not be readable or writable by browser roles'; end if;
  if not has_table_privilege('service_role', 'public.order_public_access_tokens', 'select')
     or not has_table_privilege('service_role', 'public.order_public_access_tokens', 'insert')
     or not has_table_privilege('service_role', 'public.order_public_access_tokens', 'update')
    then raise exception 'service_role must read, insert and update tokens'; end if;
  if has_table_privilege('service_role', 'public.order_public_access_tokens', 'delete')
    then raise exception 'tokens are revoked, never deleted'; end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.order_public_access_tokens'::regclass)
    then raise exception 'RLS must be enabled and forced'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_public_access_tokens')
    then raise exception 'order_public_access_tokens must have no policy'; end if;
  if has_function_privilege('anon', 'public.is_valid_order_documents_config(jsonb)', 'execute')
    then raise exception 'validation function must not be executable by anon'; end if;

  -- 4. One active token per order; revocation allows a new one; hash unique per tenant.
  insert into public.order_public_access_tokens (tenant_id, order_id, token_nonce, token_hash)
  values (a, order_a1, 'nonce-aaaaaaaaaaaaaaaaaa', repeat('1', 64)) returning id into first_token;
  begin
    insert into public.order_public_access_tokens (tenant_id, order_id, token_nonce, token_hash)
    values (a, order_a1, 'nonce-bbbbbbbbbbbbbbbbbb', repeat('2', 64));
    raise exception 'second active token accepted for the same order';
  exception when unique_violation then null; end;
  update public.order_public_access_tokens set revoked_at = now() where id = first_token;
  insert into public.order_public_access_tokens (tenant_id, order_id, token_nonce, token_hash)
  values (a, order_a1, 'nonce-cccccccccccccccccc', repeat('3', 64));
  begin
    insert into public.order_public_access_tokens (tenant_id, order_id, token_nonce, token_hash)
    values (a, 'aaaaaaaa-0000-4000-8000-000000000002', 'nonce-dddddddddddddddddd', repeat('3', 64));
    raise exception 'duplicate hash accepted within a tenant';
  exception when unique_violation then null; end;
  insert into public.order_public_access_tokens (tenant_id, order_id, token_nonce, token_hash)
  values (b, order_b1, 'nonce-eeeeeeeeeeeeeeeeee', repeat('3', 64));

  -- 5. Shape checks: plaintext-looking hash, short nonce and unknown purpose rejected.
  begin
    insert into public.order_public_access_tokens (tenant_id, order_id, token_nonce, token_hash)
    values (b, order_b1, 'nonce-ffffffffffffffffff', 'q7Lm2xVb9TkR4wNs8YdZ3a');
    raise exception 'non-hash token_hash accepted';
  exception when check_violation then null; end;
  begin
    insert into public.order_public_access_tokens (tenant_id, order_id, token_nonce, token_hash, revoked_at)
    values (b, order_b1, 'short', repeat('4', 64), now());
    raise exception 'short nonce accepted';
  exception when check_violation then null; end;
  begin
    insert into public.order_public_access_tokens (tenant_id, order_id, purpose, token_nonce, token_hash, revoked_at)
    values (b, order_b1, 'admin', 'nonce-gggggggggggggggggg', repeat('5', 64), now());
    raise exception 'unknown purpose accepted';
  exception when check_violation then null; end;

  -- 6. Review tokens: qr_portal accepted, existing purposes kept, others rejected, existing row intact.
  insert into public.review_invite_tokens (invite_id, tenant_id, token_hash, purpose, expires_at)
  values (invite, a, repeat('b', 64), 'qr_portal', now() + interval '30 days');
  insert into public.review_invite_tokens (invite_id, tenant_id, token_hash, purpose, expires_at)
  values (invite, a, repeat('c', 64), 'reminder', now() + interval '30 days');
  begin
    insert into public.review_invite_tokens (invite_id, tenant_id, token_hash, purpose, expires_at)
    values (invite, a, repeat('d', 64), 'anything', now() + interval '30 days');
    raise exception 'unknown review token purpose accepted';
  exception when check_violation then null; end;
  if (select count(*) from public.review_invite_tokens where purpose = 'initial') <> 1
    then raise exception 'existing review tokens must be preserved'; end if;
  if (select count(*) from pg_constraint where conrelid = 'public.review_invite_tokens'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%purpose%') <> 1
    then raise exception 'exactly one purpose CHECK expected after re-applying 145'; end if;

  -- 7. Cascade: deleting an order removes its tokens.
  delete from public.orders where id = order_b1;
  if exists (select 1 from public.order_public_access_tokens where order_id = order_b1)
    then raise exception 'tokens must be deleted with their order'; end if;
end $$;
rollback;
