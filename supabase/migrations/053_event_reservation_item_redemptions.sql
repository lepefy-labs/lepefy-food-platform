-- ─── MIGRATION 053: REDEMPTION GRANULAIRE PAR FORMULE — SCAN ÉVÉNEMENTIEL ───
-- Ajoute une redemption au niveau de la ligne formule (event_reservation_items)
-- en plus de la redemption globale existante (event_reservation_redemptions,
-- 052) : `/admin/evenementiel/scan` doit pouvoir valider partiellement une
-- formule précise, pas seulement décrémenter le total de la réservation.
--
-- Le champ agrégé `event_reservations.quantity_remaining` (052) reste la
-- source de vérité pour le badge client (/evenementiel/billet/[qr_token]) —
-- cette migration le met à jour de façon symétrique à chaque redemption/void
-- granulaire, sans changer sa définition ni son usage existant.

create table event_reservation_item_redemptions (
  id                    uuid primary key default gen_random_uuid(),
  reservation_item_id  uuid not null references event_reservation_items(id) on delete cascade,
  quantity_redeemed    integer not null check (quantity_redeemed > 0),
  redeemed_by           uuid references admin_users(id),
  redeemed_at            timestamptz not null default now(),
  voided_at              timestamptz,
  voided_by              uuid references admin_users(id),
  void_reason            text
);

create index idx_event_reservation_item_redemptions_item
  on event_reservation_item_redemptions(reservation_item_id);

alter table event_reservation_item_redemptions enable row level security;

-- Aucune policy publique — mêmes principes que event_reservation_redemptions
-- (052) : table d'audit accessible uniquement via service_role.
grant all on event_reservation_item_redemptions to service_role;

-- ══════════════════════════════════════════════════════════════
-- RPC atomique : redemption multi-lignes (une formule = une ligne du panier)
-- ══════════════════════════════════════════════════════════════
-- p_items : jsonb array [{ "reservation_item_id": "...", "quantity": n }, ...]
-- Toutes les lignes sont vérifiées AVANT toute écriture — si une seule ligne
-- échoue le contrôle de résiduel, rollback total (aucune validation
-- partielle silencieuse), la ligne fautive et la raison sont renvoyées.
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

    select coalesce(sum(quantity_redeemed), 0) into v_line_redeemed
    from event_reservation_item_redemptions
    where reservation_item_id = v_item_id and voided_at is null;

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

  -- Conserve aussi le journal global existant (052) pour ne rien casser côté
  -- historique déjà affiché ailleurs (même sémantique qu'un redeem manuel).
  insert into event_reservation_redemptions (reservation_id, redeemed_by, quantity_redeemed)
  values (v_reservation_id, p_admin_id, v_total_delta);

  return query select true, null::uuid, 'ok', v_new_remaining;
end;
$$;

-- ══════════════════════════════════════════════════════════════
-- RPC atomique : annulation (soft-void) d'une redemption précise
-- ══════════════════════════════════════════════════════════════
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

  update event_reservations
  set quantity_remaining = least(quantity_total, quantity_remaining + v_quantity)
  where id = v_reservation_id
  returning quantity_remaining into v_new_remaining;

  return query select true, 'ok', v_new_remaining;
end;
$$;

grant execute on function redeem_event_reservation_items(text, jsonb, uuid) to service_role;
grant execute on function void_event_reservation_item_redemption(uuid, uuid, text) to service_role;
