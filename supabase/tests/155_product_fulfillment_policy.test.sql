-- Runs on the 153 fixture after 153, 154 and 155 (155 applied twice). Every check raises on failure.

-- ─── 1. Additive: existing rows behave as before (default) ──────────────────
do $$
begin
  if exists (select 1 from public.products where fulfillment_policy <> 'delivery_or_pickup') then
    raise exception '155 must default every existing product to delivery_or_pickup';
  end if;
end $$;

-- ─── 2. Constraint ──────────────────────────────────────────────────────────
do $$
declare
  p constant uuid := '0c000000-0000-4000-8000-000000000001';
begin
  begin update public.products set fulfillment_policy = 'shipping' where id = p; raise exception 'unknown policy accepted';
  exception when check_violation then null; end;
  begin update public.products set fulfillment_policy = null where id = p; raise exception 'null policy accepted';
  exception when not_null_violation then null; end;

  update public.products set fulfillment_policy = 'pickup_only' where id = p;
  update public.products set fulfillment_policy = 'delivery_only' where id = p;
  update public.products set fulfillment_policy = 'delivery_or_pickup' where id = p;
end $$;

-- ─── 3. Activity journal records the policy with the product sheet ──────────
do $$
declare
  p constant uuid := '0c000000-0000-4000-8000-000000000001';
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.headers', '{"x-lepefy-audit-actor-type": "admin", "x-lepefy-audit-actor-id": "a0000000-0000-4000-8000-0000000000a1"}', true);
  update public.products set fulfillment_policy = 'pickup_only' where id = p;
  if not exists (select 1 from public.audit_events where event_type = 'catalog.product.updated'
                 and changes @> '[{"field": "fulfillment_policy", "after": "pickup_only"}]') then
    raise exception 'fulfillment policy change not recorded';
  end if;
end $$;
