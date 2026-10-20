-- 161: closure columns consistent with the status, historical cancellations
-- untouched, audit event without the customer message, statistics split.
do $$
declare
  v_tenant uuid := '10000000-0000-4000-8000-000000000001';
  v_admin uuid := '20000000-0000-4000-8000-000000000001';
  v_a uuid := '30000000-0000-4000-8000-000000000001';
  v_b uuid := '30000000-0000-4000-8000-000000000002';
  v_row record;
begin
  -- Historical cancellation stays valid with a null closure.
  if (select closure_type from public.orders where id = '30000000-0000-4000-8000-000000000003') is not null then
    raise exception 'historical cancellation must keep a null closure';
  end if;

  -- A closure is only valid on a cancelled order.
  begin
    update public.orders set closure_type = 'cancelled', closure_reason = 'duplicate', closure_notification = 'none', closed_at = now() where id = v_a;
    raise exception 'closure accepted on an open order';
  exception when check_violation then null;
  end;

  -- External closure: no standard « annulée » email.
  begin
    update public.orders set status = 'cancelled', closure_type = 'handled_externally', closure_reason = 'handled_externally',
      closure_notification = 'standard', closed_at = now() where id = v_a;
    raise exception 'standard notification accepted on an external closure';
  exception when check_violation then null;
  end;
  -- Custom notification needs a message of 20+ characters.
  begin
    update public.orders set status = 'cancelled', closure_type = 'cancelled', closure_reason = 'duplicate',
      closure_notification = 'custom', closure_message = 'court', closed_at = now() where id = v_a;
    raise exception 'short custom message accepted';
  exception when check_violation then null;
  end;
  -- « Autre motif » needs a note.
  begin
    update public.orders set status = 'cancelled', closure_type = 'cancelled', closure_reason = 'other',
      closure_notification = 'none', closed_at = now() where id = v_a;
    raise exception 'other reason accepted without a note';
  exception when check_violation then null;
  end;
  -- Type and reason must agree.
  begin
    update public.orders set status = 'cancelled', closure_type = 'handled_externally', closure_reason = 'duplicate',
      closure_notification = 'none', closed_at = now() where id = v_a;
    raise exception 'type/reason mismatch accepted';
  exception when check_violation then null;
  end;

  update public.orders set status = 'cancelled', closure_type = 'handled_externally', closure_reason = 'handled_externally',
    closure_notification = 'custom', closure_message = 'Nous finalisons votre commande en boutique, à bientôt !',
    closed_at = now(), closed_by = v_admin where id = v_a;
  update public.orders set status = 'cancelled', closure_type = 'cancelled', closure_reason = 'customer_request',
    closure_notification = 'standard', closed_at = now(), closed_by = v_admin where id = v_b;

  -- One audit event per closure, never the message text.
  if (select count(*) from public.audit_events_test where event_type = 'orders.order.closed') <> 2 then
    raise exception 'expected two closure events';
  end if;
  if exists (select 1 from public.audit_events_test where metadata::text like '%boutique%') then
    raise exception 'the customer message leaked into the audit log';
  end if;
  update public.orders set closure_note = 'précision' where id = v_b;
  if (select count(*) from public.audit_events_test) <> 2 then raise exception 'a later edit re-emitted the closure event'; end if;

  -- Statistics: 2 commercial cancellations (historical + customer request), 1 external closure.
  select cancelled_count, external_closure_count into v_row from public.admin_order_dashboard_stats where tenant_id = v_tenant;
  if v_row.cancelled_count <> 2 or v_row.external_closure_count <> 1 then
    raise exception 'stats: cancelled %, external %', v_row.cancelled_count, v_row.external_closure_count;
  end if;
  raise notice '161 order closure: ok';
end $$;
