-- 164 fixture: runs after 163_support_assistance.fixture.sql + 163, before 164.
-- Reproduces request n° 1001 with the 163 rule: resolved → reopened by
-- Lepefy (« Rouvrir ») → reply → resolved → closed (recorded as a reopen).
create table public.support_164_fixture (key text primary key, ticket_id uuid not null);

do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000001';
  v_admin_a uuid := '20000000-0000-4000-8000-000000000001';
  v_lepefy uuid := '20000000-0000-4000-8000-000000000009';
  v_bug uuid; v_open uuid;
begin
  select out_ticket_id into v_bug from public.support_create_ticket(v_a, 'tenant', v_admin_a, 'Chloé', 'Date en gros', 'Date bien visible svp');
  perform public.support_set_status(v_bug, v_lepefy, 'resolved');
  perform public.support_set_status(v_bug, v_lepefy, 'in_progress');           -- vraie réouverture
  perform public.support_post_message(v_bug, null, 'lepefy', v_lepefy, 'Lepefy', 'message', 'C''est fait.');
  perform public.support_set_status(v_bug, v_lepefy, 'resolved');
  perform public.support_set_status(v_bug, v_lepefy, 'closed');                -- enregistrée comme réouverture par 163

  -- Witness: a request reopened for real and still open must not be touched.
  select out_ticket_id into v_open from public.support_create_ticket(v_a, 'tenant', v_admin_a, 'Chloé', 'Toujours ouverte', 'Encore un souci');
  perform public.support_set_status(v_open, v_lepefy, 'resolved');
  perform public.support_set_status(v_open, v_lepefy, 'in_progress');

  insert into public.support_164_fixture values ('bug', v_bug), ('open', v_open);

  -- The 163 defect, as observed in production.
  perform 1 from public.support_tickets where id = v_bug and status = 'closed' and resolved_at is null and reopen_count = 2;
  if not found then raise exception 'fixture: 163 defect not reproduced'; end if;
end $$;
