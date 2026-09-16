BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT id,tenant_id,status,tracking_code,tracking_carrier,shipped_at,shipping_details,updated_at
    FROM public.orders EXCEPT SELECT * FROM public.shipping_before)
    OR (SELECT count(*) FROM public.orders) <> 2 THEN RAISE EXCEPTION 'Historical orders changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE shipping_tracking_mode IS NOT NULL OR shipping_tracking_events IS NOT NULL
    OR shipping_provider_reference IS NOT NULL OR shipping_provider_synced_at IS NOT NULL)
    THEN RAISE EXCEPTION 'Historical shipping backfilled'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.orders'::regclass)
    THEN RAISE EXCEPTION 'Orders RLS changed'; END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.orders'::regclass) <> 1 THEN RAISE EXCEPTION 'Policies changed'; END IF;
  IF has_table_privilege('anon','public.orders','UPDATE') THEN RAISE EXCEPTION 'Browser write privilege added'; END IF;
  BEGIN
    UPDATE public.orders SET shipping_normalized_status='invalid';
    RAISE EXCEPTION 'Invalid status accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.orders SET shipping_tracking_events='{}'::jsonb;
    RAISE EXCEPTION 'Invalid events accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.orders SET shipping_tracking_events=(SELECT jsonb_agg(n) FROM generate_series(1,101) n);
    RAISE EXCEPTION 'Unbounded events accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.orders SET shipping_tracking_mode='managed', shipping_provider_key='packlink', shipping_provider_reference='REFERENCE'
    WHERE tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  -- Same provider reference in another tenant is independent; same tenant duplicates are prohibited.
  UPDATE public.orders SET shipping_tracking_mode='managed', shipping_provider_key='packlink', shipping_provider_reference='REFERENCE'
    WHERE tenant_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  BEGIN
    INSERT INTO public.orders(id,tenant_id,status,shipping_provider_key,shipping_provider_reference)
      VALUES ('10000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','preparing','packlink','REFERENCE');
    RAISE EXCEPTION 'Duplicate tenant reference accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
SET LOCAL test.tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.orders) <> 1 THEN RAISE EXCEPTION 'Tenant isolation lost'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
