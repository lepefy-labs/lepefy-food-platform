-- 167: demo visitor role, demo-only RPCs, presentation lease, single reset, privileges.
do $$
declare
  v_perms text[];
  v_id uuid;
  v_ok boolean;
  v_failed boolean;
begin
  -- Rôle visiteur : exactement les capabilities de lecture prévues, aucune action.
  select array_agg(permission_key order by permission_key) into v_perms
  from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
  where r.code = 'demo_visitor';
  if v_perms <> array['ai_usage.view', 'campaigns.view', 'catalog.view', 'customers.view', 'event_payments.view',
                      'event_reservations.view', 'events.view', 'inventory.view', 'orders.view', 'purchases.view',
                      'reviews.view', 'shipping.view', 'suppliers.view', 'treasury.view'] then
    raise exception 'demo_visitor permissions: %', v_perms;
  end if;

  -- Sans tenant de démo, les RPC ne font rien (production).
  v_failed := false;
  begin perform public.demo_rate_hit('x', 1, 60); exception when others then v_failed := sqlerrm = 'demo_disabled'; end;
  if not v_failed then raise exception 'demo_rate_hit must refuse without a demo tenant'; end if;
  v_failed := false;
  begin perform public.demo_begin_reset('traiteur-africain', 'test', false); exception when others then v_failed := sqlerrm = 'demo_disabled'; end;
  if not v_failed then raise exception 'demo_begin_reset must refuse without a demo tenant'; end if;

  -- is_demo exige is_test.
  v_failed := false;
  begin update public.tenants set is_demo = true where slug = 'chloefood'; exception when check_violation then v_failed := true; end;
  if not v_failed then raise exception 'is_demo without is_test must be rejected'; end if;
  update public.tenants set is_demo = true where slug = 'lepefy-demo';

  -- Limite de fréquence : 2 autorisés, le 3e refusé.
  if not public.demo_rate_hit('ip:1', 2, 3600) then raise exception 'hit 1 refused'; end if;
  if not public.demo_rate_hit('ip:1', 2, 3600) then raise exception 'hit 2 refused'; end if;
  if public.demo_rate_hit('ip:1', 2, 3600) then raise exception 'hit 3 allowed'; end if;
  if not public.demo_rate_hit('ip:2', 2, 3600) then raise exception 'other bucket refused'; end if;

  perform public.demo_count_event('landing.view');
  perform public.demo_count_event('landing.view');
  if (select count from public.demo_event_counts where event_key = 'landing.view') <> 2 then raise exception 'event counter'; end if;

  -- Une seule réinitialisation à la fois.
  v_id := public.demo_begin_reset('traiteur-africain', 'test', false);
  v_failed := false;
  begin perform public.demo_begin_reset('traiteur-africain', 'test', false); exception when others then v_failed := sqlerrm = 'demo_reset_running'; end;
  if not v_failed then raise exception 'second concurrent reset must be refused'; end if;
  perform public.demo_finish_reset(v_id, 'done', 'ok', null, null);

  -- Présentation en cours : réinitialisation refusée, sauf forcée ; une seule présentation, prolongée.
  perform public.demo_start_presentation('10000000-0000-4000-8000-000000000002', 'Robert', 60);
  select out_extended into v_ok from public.demo_start_presentation('10000000-0000-4000-8000-000000000002', 'Robert', 90);
  if not v_ok then raise exception 'second start must extend'; end if;
  if (select count(*) from public.demo_presentations where ended_at is null) <> 1 then raise exception 'one presentation'; end if;
  v_failed := false;
  begin perform public.demo_begin_reset('traiteur-africain', 'nightly', false); exception when others then v_failed := sqlerrm = 'demo_presentation_active'; end;
  if not v_failed then raise exception 'reset during presentation must be refused'; end if;
  v_id := public.demo_begin_reset('traiteur-africain', 'owner', true);
  perform public.demo_finish_reset(v_id, 'failed', 'test', null, null);

  -- Demande prospect : un moyen de contact au moins.
  v_failed := false;
  begin
    insert into public.demo_requests (business_name, consent_version) values ('Traiteur Test', 'v1');
  exception when check_violation then v_failed := true; end;
  if not v_failed then raise exception 'request without contact must be rejected'; end if;
end $$;

-- Navigateur : aucun accès.
do $$
declare v_denied boolean;
begin
  set local role anon;
  v_denied := false;
  begin perform 1 from public.demo_requests; exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'anon can read demo_requests'; end if;
  v_denied := false;
  begin perform public.demo_rate_hit('x', 1, 60); exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'anon can call demo_rate_hit'; end if;
  reset role;
end $$;
