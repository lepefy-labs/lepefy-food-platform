-- 082_event_checkin_operations.sql
-- Backward-compatible operational hardening for event ticket control.
-- Existing events keep NULL check-in bounds, therefore existing live tickets
-- and reservations preserve the exact pre-migration redemption behaviour.

alter table events
  add column if not exists checkin_opens_at timestamptz null,
  add column if not exists checkin_closes_at timestamptz null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_checkin_window_valid'
  ) then
    alter table events
      add constraint events_checkin_window_valid
      check (
        checkin_opens_at is null
        or checkin_closes_at is null
        or checkin_closes_at >= checkin_opens_at
      );
  end if;
end $$;

comment on column events.checkin_opens_at is
  'Optional opening instant for ticket control. NULL preserves unrestricted legacy behaviour.';
comment on column events.checkin_closes_at is
  'Optional closing instant for ticket control. NULL preserves unrestricted legacy behaviour.';

-- The granular per-item ledger is now the canonical redemption source of truth.
-- Keep the legacy event_reservation_redemptions table/history intact, but stop
-- creating new aggregate rows because an item redemption can be soft-voided and
-- the legacy aggregate table has no equivalent void semantics.
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
  v_quantity           integer;
  v_line_total         integer;
  v_line_redeemed      integer;
  v_line_remaining     integer;
  v_total_delta        integer := 0;
  v_new_remaining      integer;
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

  update event_reservations er
  set quantity_remaining = greatest(0, er.quantity_remaining - v_total_delta)
  where er.id = v_reservation_id
  returning er.quantity_remaining into v_new_remaining;

  return query select true, null::uuid, 'ok', v_new_remaining;
end;
$$;
