-- 055_fix_quantity_remaining_ambiguous.sql
--
-- Fix: stesso identikit di bug della 054 (column reference ambiguous), ma
-- su quantity_remaining invece di reservation_item_id.
--
-- Causa: quantity_remaining è anche colonna di output in RETURNS TABLE(...)
-- di ENTRAMBE le funzioni (redeem_event_reservation_items e
-- void_event_reservation_item_redemption). Negli UPDATE ... SET
-- quantity_remaining = ... RETURNING quantity_remaining, il riferimento non
-- qualificato è ambiguo tra la variabile di output e la colonna reale di
-- event_reservations. Fix: alias esplicito "er." sulla tabella aggiornata
-- (il target della SET resta implicito per sintassi UPDATE, il resto
-- qualificato).
--
-- Verifica sistematica fatta: nessun'altra colonna di output (success,
-- reason) viene referenziata come colonna nel corpo di nessuna delle due
-- funzioni — solo come valori letterali in return query select — quindi
-- questo chiude la classe di bug per la migration 053.

create or replace function redeem_event_reservation_items(
  p_qr_token text,
  p_items    jsonb,
  p_admin_id uuid
)
returns table(success boolean, reservation_item_id uuid, reason text, quantity_remaining integer)
language plpgsql
as $$
declare
  v_reservation_id     uuid;
  v_reservation_status text;
  v_item               jsonb;
  v_item_id            uuid;
  v_quantity            integer;
  v_line_total          integer;
  v_line_redeemed       integer;
  v_line_remaining      integer;
  v_total_delta         integer := 0;
  v_new_remaining       integer;
begin
  select id, status into v_reservation_id, v_reservation_status
  from event_reservations
  where qr_token = p_qr_token
  for update;

  if v_reservation_id is null then
    return query select false, null::uuid, 'code QR invalide', null::integer;
    return;
  end if;

  if v_reservation_status <> 'confirmed' then
    return query select false, null::uuid, 'réservation non confirmée (annulée ou remboursée)', null::integer;
    return;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item->>'reservation_item_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;

    if v_quantity is null or v_quantity <= 0 then
      return query select false, v_item_id, 'quantité invalide', null::integer;
      return;
    end if;

    select quantity into v_line_total
    from event_reservation_items
    where id = v_item_id and reservation_id = v_reservation_id;

    if v_line_total is null then
      return query select false, v_item_id, 'ligne introuvable pour cette réservation', null::integer;
      return;
    end if;

    select coalesce(sum(eri.quantity_redeemed), 0) into v_line_redeemed
    from event_reservation_item_redemptions eri
    where eri.reservation_item_id = v_item_id and eri.voided_at is null;

    v_line_remaining := v_line_total - v_line_redeemed;

    if v_quantity > v_line_remaining then
      return query select false, v_item_id,
        format('résiduel insuffisant (%s demandé, %s restant)', v_quantity, v_line_remaining),
        null::integer;
      return;
    end if;

    v_total_delta := v_total_delta + v_quantity;
  end loop;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item->>'reservation_item_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;

    insert into event_reservation_item_redemptions (reservation_item_id, quantity_redeemed, redeemed_by)
    values (v_item_id, v_quantity, p_admin_id);
  end loop;

  -- FIX: alias er. esplicito, prima ambiguo con la colonna di output
  -- quantity_remaining di RETURNS TABLE.
  update event_reservations er
  set quantity_remaining = greatest(0, er.quantity_remaining - v_total_delta)
  where er.id = v_reservation_id
  returning er.quantity_remaining into v_new_remaining;

  insert into event_reservation_redemptions (reservation_id, redeemed_by, quantity_redeemed)
  values (v_reservation_id, p_admin_id, v_total_delta);

  return query select true, null::uuid, 'ok', v_new_remaining;
end;
$$;

create or replace function void_event_reservation_item_redemption(
  p_redemption_id uuid,
  p_admin_id      uuid,
  p_reason        text
)
returns table(success boolean, reason text, quantity_remaining integer)
language plpgsql
as $$
declare
  v_reservation_id uuid;
  v_quantity        integer;
  v_already_voided  timestamptz;
  v_new_remaining   integer;
begin
  select eri.quantity_redeemed, eri.voided_at, eit.reservation_id
  into v_quantity, v_already_voided, v_reservation_id
  from event_reservation_item_redemptions eri
  join event_reservation_items eit on eit.id = eri.reservation_item_id
  where eri.id = p_redemption_id
  for update of eri;

  if v_reservation_id is null then
    return query select false, 'redemption introuvable', null::integer;
    return;
  end if;

  if v_already_voided is not null then
    return query select false, 'déjà annulée', null::integer;
    return;
  end if;

  update event_reservation_item_redemptions
  set voided_at = now(), voided_by = p_admin_id, void_reason = p_reason
  where id = p_redemption_id;

  -- FIX: alias er. esplicito, stessa ambiguità della funzione sopra.
  update event_reservations er
  set quantity_remaining = least(er.quantity_total, er.quantity_remaining + v_quantity)
  where er.id = v_reservation_id
  returning er.quantity_remaining into v_new_remaining;

  return query select true, 'ok', v_new_remaining;
end;
$$;
