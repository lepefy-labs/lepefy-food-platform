-- Runs on the 153 fixture after 153 and 154 (154 applied twice). Every check raises on failure.

-- ─── 1. Additive: existing rows keep NULL (current behaviour) ───────────────
do $$
begin
  if exists (select 1 from public.products where sale_unit is not null or net_content_value is not null
             or net_content_unit is not null or pack_count is not null) then
    raise exception '154 must not backfill existing products';
  end if;
end $$;

-- ─── 2. Constraints ─────────────────────────────────────────────────────────
do $$
declare
  p constant uuid := '0c000000-0000-4000-8000-000000000001';
begin
  begin update public.products set sale_unit = 'Paquet!' where id = p; raise exception 'invalid sale_unit accepted';
  exception when check_violation then null; end;
  begin update public.products set net_content_value = 500, net_content_unit = 'oz' where id = p; raise exception 'unknown unit accepted';
  exception when check_violation then null; end;
  begin update public.products set net_content_value = 500 where id = p; raise exception 'value without unit accepted';
  exception when check_violation then null; end;
  begin update public.products set net_content_unit = 'g' where id = p; raise exception 'unit without value accepted';
  exception when check_violation then null; end;
  begin update public.products set net_content_value = 0, net_content_unit = 'g' where id = p; raise exception 'zero content accepted';
  exception when check_violation then null; end;
  begin update public.products set pack_count = 1 where id = p; raise exception 'pack of one accepted';
  exception when check_violation then null; end;

  -- An unknown but well-formed key is allowed: the app registry decides, no migration per unit.
  update public.products set sale_unit = 'future_unit' where id = p;
  update public.products set sale_unit = null where id = p;
end $$;

-- ─── 3. Activity journal records the new fields with the product sheet ──────
do $$
declare
  p constant uuid := '0c000000-0000-4000-8000-000000000001';
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.headers', '{"x-lepefy-audit-actor-type": "admin", "x-lepefy-audit-actor-id": "a0000000-0000-4000-8000-0000000000a1"}', true);
  update public.products set sale_unit = 'paquet', net_content_value = 500, net_content_unit = 'g', pack_count = 12 where id = p;
  if not exists (select 1 from public.audit_events where event_type = 'catalog.product.updated'
                 and changes @> '[{"field": "sale_unit", "after": "paquet"}]'
                 and changes @> '[{"field": "net_content_unit", "after": "g"}]'
                 and changes @> '[{"field": "pack_count", "after": 12}]') then
    raise exception 'selling format change not recorded';
  end if;
end $$;
