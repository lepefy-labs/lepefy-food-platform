-- 054_fix_redeem_ambiguous_column.sql
--
-- Fix: "column reference reservation_item_id is ambiguous" alla chiamata di
-- redeem_event_reservation_items (053).
--
-- Causa: la colonna di output reservation_item_id in RETURNS TABLE(...)
-- diventa una variabile implicita visibile in tutto il corpo della funzione
-- PL/pgSQL. Nel loop di validazione, la query su
-- event_reservation_item_redemptions referenzia reservation_item_id senza
-- qualificare la tabella → ambiguità tra la variabile di output e la colonna
-- reale. Unico punto toccato: la select con coalesce/sum, ora con alias eri.
--
-- Nessun'altra logica modificata rispetto a 053 (stesso corpo, stessa
-- firma, idempotente via create or replace).

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

  -- Étape 1 — validation de TOUTES les lignes avant toute écriture.
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

    -- FIX: alias eri. esplicito, prima ambiguo con la colonna di output
    -- reservation_item_id di RETURNS TABLE.
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

  -- Étape 2 — toutes les lignes sont valides, écriture effective.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item->>'reservation_item_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;

    insert into event_reservation_item_redemptions (reservation_item_id, quantity_redeemed, redeemed_by)
    values (v_item_id, v_quantity, p_admin_id);
  end loop;

  update event_reservations
  set quantity_remaining = greatest(0, quantity_remaining - v_total_delta)
  where id = v_reservation_id
  returning quantity_remaining into v_new_remaining;

  insert into event_reservation_redemptions (reservation_id, redeemed_by, quantity_redeemed)
  values (v_reservation_id, p_admin_id, v_total_delta);

  return query select true, null::uuid, 'ok', v_new_remaining;
end;
$$;
