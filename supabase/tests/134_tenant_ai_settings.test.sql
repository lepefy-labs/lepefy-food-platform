begin;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  b constant uuid := '22222222-2222-4222-8222-222222222222';
  c constant uuid := '33333333-3333-4333-8333-333333333333';
  d constant uuid := '44444444-4444-4444-8444-444444444444';
  i int;
begin
  -- Commercial catalog entry unchanged (094), no new plan feature or override.
  if not exists (select 1 from public.platform_features where key = 'ai' and billable)
    then raise exception 'The ai catalog entry must keep its commercial semantics'; end if;
  if exists (select 1 from public.tenant_feature_overrides where feature_key = 'ai')
    then raise exception 'No ai override may be created'; end if;

  -- Backfill: one enabled 'ai' row per tenant, identical to the columns.
  if (select count(*) from public.tenant_feature_settings where feature_key = 'ai' and enabled) is distinct from 3
    then raise exception 'Expected one enabled ai row per tenant'; end if;
  if (select config from public.tenant_feature_settings where tenant_id = a and feature_key = 'ai') <>
     '{"version": 1, "image_generation": false, "description_generation": true, "semantic_search": true, "rate_limit_public_per_minute": 5, "rate_limit_public_per_day": 500, "rate_limit_admin_per_day": 200}'::jsonb
    then raise exception 'Tenant A ai backfill mismatch'; end if;
  if (select (config->>'rate_limit_admin_per_day')::int from public.tenant_feature_settings where tenant_id = c and feature_key = 'ai') is distinct from 50
    then raise exception 'Tenant C limits not preserved'; end if;

  -- Private context moved into the existing Nala row; activation untouched.
  if (select config->>'extra_context' from public.tenant_feature_settings where tenant_id = a and feature_key = 'nala')
     is distinct from 'Horaires : 9h-19h. Parking gratuit.'
    then raise exception 'Nala extra context not backfilled'; end if;
  if (select enabled from public.tenant_feature_settings where tenant_id = a and feature_key = 'nala') is not true
     or (select enabled from public.tenant_feature_settings where tenant_id = b and feature_key = 'nala') is not false
    then raise exception 'Nala activation modified'; end if;
  if (select config ? 'extra_context' from public.tenant_feature_settings where tenant_id = b and feature_key = 'nala')
    then raise exception 'A tenant without context must not get the key'; end if;

  -- Every other module row (loyalty, referral, reviews, digest, other Nala rows) unchanged.
  if exists (
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public._fixture_settings_before_134
     where not (tenant_id = a and feature_key = 'nala'))
    except
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public.tenant_feature_settings)
  ) then raise exception 'Other module settings were modified'; end if;

  -- Settings -> tenants mirror, and the 027 rate limiter follows it.
  update public.tenant_feature_settings
  set config = config || '{"image_generation": true, "rate_limit_public_per_minute": 1}'
  where tenant_id = a and feature_key = 'ai';
  if (select ai_image_generation from public.tenants where id = a) is not true
     or (select ai_rate_limit_public_per_minute from public.tenants where id = a) is distinct from 1
    then raise exception 'AI settings not mirrored to tenants'; end if;
  if not public.check_ai_rate_limit(a, 'chat', true) then raise exception 'First call must be allowed'; end if;
  insert into public.ai_usage_log (tenant_id, endpoint, status) values (a, 'chat', 'success');
  if public.check_ai_rate_limit(a, 'chat', true) then raise exception 'Mirrored per-minute limit not enforced'; end if;
  if not public.check_ai_rate_limit(b, 'chat', true) then raise exception 'Other tenants keep their own limits'; end if;

  update public.tenant_feature_settings set config = config || '{"extra_context": "Fermé le lundi."}'
  where tenant_id = a and feature_key = 'nala';
  if (select chatbox_extra_context from public.tenants where id = a) is distinct from 'Fermé le lundi.'
    then raise exception 'Nala context not mirrored to tenants'; end if;

  -- A Nala toggle (no config key involved) never erases the context.
  update public.tenant_feature_settings set enabled = false where tenant_id = a and feature_key = 'nala';
  update public.tenant_feature_settings set config = '{}'::jsonb || jsonb_build_object('extra_context', config->'extra_context') where tenant_id = a and feature_key = 'nala';
  if (select chatbox_extra_context from public.tenants where id = a) is distinct from 'Fermé le lundi.'
    then raise exception 'Nala toggle erased the context'; end if;

  -- Tenants -> settings mirror.
  update public.tenants set ai_semantic_search = false, chatbox_extra_context = 'Livraison le mardi.' where id = b;
  if (select (config->>'semantic_search')::boolean from public.tenant_feature_settings where tenant_id = b and feature_key = 'ai') is not false
    then raise exception 'Tenant AI change not mirrored to settings'; end if;
  if (select config->>'extra_context' from public.tenant_feature_settings where tenant_id = b and feature_key = 'nala') is distinct from 'Livraison le mardi.'
     or (select enabled from public.tenant_feature_settings where tenant_id = b and feature_key = 'nala') is not false
    then raise exception 'Tenant context not mirrored (or Nala activation changed)'; end if;
  update public.tenants set chatbox_extra_context = null where id = b;
  if (select config->'extra_context' from public.tenant_feature_settings where tenant_id = b and feature_key = 'nala') is distinct from 'null'::jsonb
    then raise exception 'Cleared context must be mirrored as null'; end if;

  -- New tenant: an 'ai' row, no Nala row, and AI column updates never create one.
  insert into public.tenants (id, slug, name) values (d, 'tenant-d', 'Tenant D');
  if not exists (select 1 from public.tenant_feature_settings where tenant_id = d and feature_key = 'ai' and enabled
      and (config->>'semantic_search')::boolean = false)
    then raise exception 'New tenant must get an ai row'; end if;
  update public.tenants set ai_description_generation = true where id = d;
  if exists (select 1 from public.tenant_feature_settings where tenant_id = d and feature_key = 'nala')
    then raise exception 'AI column updates must not create Nala rows'; end if;

  -- Constraints.
  begin
    update public.tenant_feature_settings set config = '{"semantic_search": "yes"}' where tenant_id = a and feature_key = 'ai';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"rate_limit_public_per_day": -5}' where tenant_id = a and feature_key = 'ai';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"openai_api_key": "sk-x"}' where tenant_id = a and feature_key = 'ai';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = jsonb_build_object('extra_context', repeat('x', 20001)) where tenant_id = a and feature_key = 'nala';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"extra_context": 42}' where tenant_id = a and feature_key = 'nala';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  -- Other Nala keys stay allowed (config open for future keys).
  update public.tenant_feature_settings set config = config || '{"tone": "warm"}' where tenant_id = a and feature_key = 'nala';

  -- Privileges.
  if has_column_privilege('anon', 'public.tenants', 'ai_semantic_search', 'select')
     or has_column_privilege('anon', 'public.tenants', 'ai_image_generation', 'select')
     or has_column_privilege('authenticated', 'public.tenants', 'ai_rate_limit_public_per_day', 'select')
     or has_column_privilege('anon', 'public.tenants', 'chatbox_extra_context', 'select')
    then raise exception 'AI columns must be server-only'; end if;
  if not has_column_privilege('anon', 'public.tenants', 'catalogue_search_threshold', 'select')
     or not has_column_privilege('anon', 'public.tenants', 'name', 'select')
    then raise exception 'Unrelated public grants must be preserved'; end if;
  if has_function_privilege('anon', 'public.is_valid_ai_config(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.is_valid_nala_config(jsonb)', 'execute')
    then raise exception 'Validators must not be public'; end if;
end $$;
rollback;
