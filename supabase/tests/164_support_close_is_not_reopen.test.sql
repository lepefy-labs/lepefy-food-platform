-- 164: closing a resolved request is not a reopen; affected requests repaired.
do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000001';
  v_admin_a uuid := '20000000-0000-4000-8000-000000000001';
  v_lepefy uuid := '20000000-0000-4000-8000-000000000009';
  v_bug uuid := (select ticket_id from public.support_164_fixture where key = 'bug');
  v_open uuid := (select ticket_id from public.support_164_fixture where key = 'open');
  v_resolved_event timestamptz;
  v_reopen_event timestamptz;
  v_t uuid;
begin
  -- ─── Réparation (n° 1001) ─────────────────────────────────────────────────
  if exists (select 1 from public.support_events where ticket_id = v_bug and event_type = 'reopened' and to_value in ('resolved', 'closed')) then
    raise exception 'resolved → closed still recorded as a reopen';
  end if;
  perform 1 from public.support_events where ticket_id = v_bug and event_type = 'status_changed' and from_value = 'resolved' and to_value = 'closed';
  if not found then raise exception 'repaired event should be a status change'; end if;
  select max(created_at) into v_resolved_event from public.support_events where ticket_id = v_bug and to_value = 'resolved';
  select max(created_at) into v_reopen_event from public.support_events where ticket_id = v_bug and event_type = 'reopened';
  perform 1 from public.support_tickets where id = v_bug and status = 'closed' and closed_at is not null
    and reopen_count = 1 and reopened_at = v_reopen_event and resolved_at = v_resolved_event;
  if not found then raise exception 'ticket counters not repaired'; end if;
  -- The real « Rouvrir » stays a reopen.
  if (select count(*) from public.support_events where ticket_id = v_bug and event_type = 'reopened' and from_value = 'resolved' and to_value = 'in_progress') <> 1 then
    raise exception 'genuine reopen lost';
  end if;

  -- Untouched witness.
  perform 1 from public.support_tickets where id = v_open and status = 'in_progress' and reopen_count = 1 and resolved_at is null and reopened_at is not null;
  if not found then raise exception 'open request was modified by the repair'; end if;

  -- ─── Nouvelle règle ───────────────────────────────────────────────────────
  select out_ticket_id into v_t from public.support_create_ticket(v_a, 'tenant', v_admin_a, 'Chloé', 'Nouvelle', 'Demande de test');
  perform public.support_set_status(v_t, v_lepefy, 'resolved');
  perform public.support_set_status(v_t, v_lepefy, 'closed');
  perform 1 from public.support_tickets where id = v_t and status = 'closed' and resolved_at is not null and closed_at is not null
    and reopen_count = 0 and reopened_at is null;
  if not found then raise exception 'resolved → closed must keep resolved_at and not count a reopen'; end if;
  perform 1 from public.support_events where ticket_id = v_t and event_type = 'status_changed' and from_value = 'resolved' and to_value = 'closed';
  if not found then raise exception 'resolved → closed must be a status change'; end if;

  -- Reopening a closed request is still a reopen.
  perform public.support_set_status(v_t, v_lepefy, 'triaged');
  perform 1 from public.support_tickets where id = v_t and status = 'triaged' and reopen_count = 1 and resolved_at is null and closed_at is null;
  if not found then raise exception 'closed → triaged must stay a reopen'; end if;
  perform 1 from public.support_events where ticket_id = v_t and event_type = 'reopened' and from_value = 'closed' and to_value = 'triaged';
  if not found then raise exception 'closed → triaged event missing'; end if;

  -- resolved → in_progress too.
  perform public.support_set_status(v_t, v_lepefy, 'resolved');
  perform public.support_set_status(v_t, v_lepefy, 'in_progress');
  perform 1 from public.support_tickets where id = v_t and reopen_count = 2 and resolved_at is null;
  if not found then raise exception 'resolved → in_progress must stay a reopen'; end if;
end $$;

-- Privileges unchanged: only the service role runs the RPC.
set role authenticated;
do $$ begin
  perform public.support_set_status('00000000-0000-4000-8000-000000000000', '20000000-0000-4000-8000-000000000009', 'closed');
  raise exception 'authenticated can call support_set_status';
exception when insufficient_privilege then null;
end $$;
reset role;
