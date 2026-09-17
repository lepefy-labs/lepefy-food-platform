\set ON_ERROR_STOP on

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.platform_features WHERE key='reviews';
  IF n <> 1 THEN RAISE EXCEPTION 'reviews feature missing'; END IF;
  SELECT count(*) INTO n FROM public.admin_permissions WHERE key IN ('reviews.view','reviews.moderate','reviews.manage');
  IF n <> 3 THEN RAISE EXCEPTION 'review permissions missing'; END IF;
  SELECT count(*) INTO n FROM public.admin_role_permissions arp JOIN public.admin_roles r ON r.id=arp.role_id
    WHERE r.code IN ('platform_owner','tenant_admin') AND arp.permission_key LIKE 'reviews.%';
  IF n <> 6 THEN RAISE EXCEPTION 'system role grants missing: %', n; END IF;
END $$;

SET ROLE service_role;
INSERT INTO public.reviews(tenant_id,order_id,customer_id,rating,body,reviewer_display_name,moderation_flags)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','10000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',1,'Service lent','Alice E.','{}');
RESET ROLE;

SET ROLE service_role;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.reviews(tenant_id,order_id,customer_id,rating)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','10000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',5);
    RAISE EXCEPTION 'pending-payment review unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'pending-payment review unexpectedly accepted' THEN RAISE; END IF;
    IF position('review_order_not_eligible' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET ROLE service_role;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.reviews(tenant_id,order_id,customer_id,rating)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',5);
    RAISE EXCEPTION 'cross-tenant review unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-tenant review unexpectedly accepted' THEN RAISE; END IF;
    IF position('review_order_not_found' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET ROLE service_role;
DO $$
DECLARE rid uuid;
BEGIN
  SELECT id INTO rid FROM public.reviews WHERE tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  BEGIN
    UPDATE public.reviews SET rating=5 WHERE id=rid;
    RAISE EXCEPTION 'review content unexpectedly mutable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'review content unexpectedly mutable' THEN RAISE; END IF;
    IF position('review_customer_content_immutable' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET ROLE service_role;
SELECT public.moderate_review(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.reviews WHERE tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'publish',NULL,NULL,'99999999-9999-9999-9999-999999999999'
);
RESET ROLE;

DO $$
DECLARE n integer; prev text; nxt text;
BEGIN
  SELECT count(*) INTO n FROM public.tenant_review_stats WHERE tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND published_count=1 AND average_rating=1.00;
  IF n <> 1 THEN RAISE EXCEPTION 'published stats incorrect'; END IF;
  SELECT previous_status,next_status INTO prev,nxt FROM public.review_moderation_events WHERE actor_type='admin' ORDER BY created_at DESC LIMIT 1;
  IF prev <> 'pending_moderation' OR nxt <> 'published' THEN RAISE EXCEPTION 'moderation audit incorrect: % -> %',prev,nxt; END IF;
END $$;

DO $$
BEGIN
  IF has_table_privilege('anon','public.reviews','SELECT') THEN RAISE EXCEPTION 'anon unexpectedly has reviews SELECT'; END IF;
  IF has_table_privilege('authenticated','public.review_invites','SELECT') THEN RAISE EXCEPTION 'authenticated unexpectedly has invite SELECT'; END IF;
  IF has_function_privilege('anon','public.moderate_review(uuid,uuid,text,text,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'anon unexpectedly can moderate'; END IF;
END $$;

INSERT INTO public.customer_events(tenant_id,customer_id,event_type,source)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','review_submitted','test');
