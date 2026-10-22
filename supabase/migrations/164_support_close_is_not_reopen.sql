-- 164 — Assistance : clôturer une demande résolue n'est pas une réouverture.
--
-- Dans 163, support_set_status traitait toute sortie de « resolved » ou
-- « closed » comme une réouverture, y compris resolved → closed. Effets :
-- événement « reopened » (affiché « Rouverte »), resolved_at effacé (la demande
-- sort de « Résolues (30 j) »), reopen_count +1, reopened_at déplacé et
-- avis de la boutique effacé.
--
-- Corrige la règle (réouverture = vers un état encore ouvert, comme
-- lib/support/rules.ts) et répare les demandes déjà touchées (n° 1001 de
-- Chloe Food le 22/10/2026). Idempotent : une seconde exécution ne trouve plus
-- rien à réparer. L'avis effacé n'est pas récupérable (non historisé) ; aucune
-- demande touchée n'en avait.

-- ─── 1. Règle corrigée ───────────────────────────────────────────────────────
create or replace function public.support_set_status(
  p_ticket_id       uuid,
  p_actor_admin_id  uuid,
  p_to_status       text,
  p_expected_status text default null
)
returns table (out_status text, out_changed boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_public boolean;
  v_reopen boolean;
begin
  if p_ticket_id is null or p_actor_admin_id is null then raise exception 'support_invalid_input'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'support_ticket_not_found'; end if;
  if v_ticket.status = p_to_status then
    return query select v_ticket.status, false;
    return;
  end if;
  if p_expected_status is not null and v_ticket.status <> p_expected_status then raise exception 'support_status_conflict'; end if;
  if not public.support_transition_allowed(v_ticket.status, p_to_status) then raise exception 'support_transition_invalid'; end if;

  -- Réouverture = une demande terminée qui repart vers un état ouvert ; resolved → closed reste une fin.
  v_reopen := v_ticket.status in ('resolved', 'closed') and p_to_status not in ('resolved', 'closed');
  v_public := public.support_tenant_status(v_ticket.status) <> public.support_tenant_status(p_to_status);

  update public.support_tickets set
    status = p_to_status,
    resolved_at = case when p_to_status = 'resolved' then now() when v_reopen then null else resolved_at end,
    closed_at = case when p_to_status = 'closed' then now() when v_reopen then null else closed_at end,
    reopened_at = case when v_reopen then now() else reopened_at end,
    reopen_count = reopen_count + case when v_reopen then 1 else 0 end,
    tenant_feedback = case when v_reopen then null else tenant_feedback end,
    tenant_feedback_at = case when v_reopen then null else tenant_feedback_at end,
    last_public_update_at = case when v_public then clock_timestamp() else last_public_update_at end,
    last_activity_at = now(),
    updated_at = now()
  where id = v_ticket.id;

  insert into public.support_events (tenant_id, ticket_id, event_type, actor_type, actor_admin_id, from_value, to_value, public)
  values (v_ticket.tenant_id, v_ticket.id, case when v_reopen then 'reopened' else 'status_changed' end, 'lepefy',
          p_actor_admin_id, v_ticket.status, p_to_status, v_public);

  perform public.audit_emit(false, v_ticket.tenant_id, 'support.ticket.status_changed', 'support_ticket', v_ticket.id::text,
    'Demande n° ' || v_ticket.number,
    jsonb_build_array(jsonb_build_object('field', 'status', 'before', v_ticket.status, 'after', p_to_status)), '{}'::jsonb);

  return query select p_to_status, true;
end $$;

revoke all on function public.support_set_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.support_set_status(uuid, uuid, text, text) to service_role;

-- ─── 2. Réparation des demandes touchées ─────────────────────────────────────
-- Événements « reopened » qui ne rouvrent rien (vers resolved/closed) : ce sont
-- des changements de statut. Les compteurs de la demande sont recalculés
-- depuis les événements restants.
do $$
declare
  v_ticket uuid;
begin
  for v_ticket in
    select distinct ticket_id from public.support_events
    where event_type = 'reopened' and from_value in ('resolved', 'closed') and to_value in ('resolved', 'closed')
  loop
    update public.support_events set event_type = 'status_changed'
    where ticket_id = v_ticket and event_type = 'reopened'
      and from_value in ('resolved', 'closed') and to_value in ('resolved', 'closed');

    update public.support_tickets t set
      -- Vraies réouvertes : par Lepefy (événements restants) ou par la boutique (message / avis, même type d'événement).
      reopen_count = (select count(*) from public.support_events e where e.ticket_id = t.id and e.event_type = 'reopened'),
      reopened_at = (select max(e.created_at) from public.support_events e where e.ticket_id = t.id and e.event_type = 'reopened'),
      -- Date de la dernière résolution, si la demande est toujours terminée.
      resolved_at = case when t.status in ('resolved', 'closed') then coalesce(t.resolved_at,
        (select max(e.created_at) from public.support_events e
          where e.ticket_id = t.id and e.event_type in ('status_changed', 'reopened') and e.to_value = 'resolved'))
        else t.resolved_at end
    where t.id = v_ticket;
  end loop;
end $$;
