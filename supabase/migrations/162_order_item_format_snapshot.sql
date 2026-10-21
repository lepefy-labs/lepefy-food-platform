-- 162_order_item_format_snapshot.sql
-- Format réellement acheté, figé sur la ligne de commande, pour le
-- récapitulatif client (« Format : 500 g », lib/orders/documents/itemFormat.ts).
--
-- Pourquoi : order_items ne gardait que nom, prix et quantité. Le format de
-- vente (154 : sale_unit, net_content_value/unit, pack_count ; 018 :
-- net_quantity_display) n'existait que sur la fiche produit, modifiable après
-- l'achat. Un document imprimé plus tard ne doit jamais lire le catalogue
-- actuel ni weight_grams (poids logistique).
--
-- Comment : un trigger BEFORE INSERT copie ces champs de la fiche dans
-- order_items.format_snapshot, dans la même transaction que la création de la
-- ligne. Il couvre tous les chemins sans toucher à leur code : webhook Stripe,
-- RPC convert_checkout_session_to_order (128, commandes assistées), paiement
-- en boutique. Aucun prix, quantité, stock ou paiement n'est lu ou modifié.
--
-- Garanties :
--   * fail-open : toute erreur laisse format_snapshot à NULL, la commande est
--     toujours créée ;
--   * pas d'inférence : snapshot seulement si la fiche du même tenant existe,
--     porte le même nom que la ligne (sinon le produit a pu changer entre le
--     panier et la commande) et a au moins un champ de format ;
--   * immuable : une valeur ne peut plus être modifiée ni effacée, et une ligne
--     existante ne peut pas en recevoir une (aucun backfill) ;
--   * additive : colonne nullable, aucun backfill. NULL = comportement actuel.
--
-- Rollback :
--   drop trigger if exists order_items_format_snapshot_capture on public.order_items;
--   drop trigger if exists order_items_format_snapshot_immutable on public.order_items;
--   drop function if exists public.order_items_capture_format_snapshot();
--   drop function if exists public.order_items_keep_format_snapshot();
--   alter table public.order_items drop column if exists format_snapshot;

-- ─── 1. Colonne ──────────────────────────────────────────────────────────────
alter table public.order_items
  add column if not exists format_snapshot jsonb;

comment on column public.order_items.format_snapshot is
  'Format de vente figé à l''insertion (v1 : sale_unit, net_content_value, net_content_unit, pack_count, net_quantity_display). NULL = commande antérieure à 162 ou format inconnu. Immuable.';

-- ─── 2. Capture à l'insertion ────────────────────────────────────────────────
create or replace function public.order_items_capture_format_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
begin
  if new.format_snapshot is not null or new.product_id is null then
    return new;
  end if;
  begin
    select pr.name, pr.sale_unit, pr.net_content_value, pr.net_content_unit, pr.pack_count, pr.net_quantity_display
      into p
      from public.products pr
     where pr.id = new.product_id
       and pr.tenant_id = new.tenant_id;
    if found
       and p.name = new.name
       and (p.sale_unit is not null or p.net_content_value is not null or p.pack_count is not null
            or nullif(btrim(p.net_quantity_display), '') is not null) then
      new.format_snapshot := jsonb_strip_nulls(jsonb_build_object(
        'v', 1,
        'sale_unit', p.sale_unit,
        'net_content_value', p.net_content_value,
        'net_content_unit', p.net_content_unit,
        'pack_count', p.pack_count,
        'net_quantity_display', nullif(btrim(p.net_quantity_display), '')
      ));
    end if;
  exception when others then
    -- Jamais bloquant : la commande passe sans format.
    new.format_snapshot := null;
  end;
  return new;
end
$$;

revoke all on function public.order_items_capture_format_snapshot() from public, anon, authenticated, service_role;

drop trigger if exists order_items_format_snapshot_capture on public.order_items;
create trigger order_items_format_snapshot_capture
  before insert on public.order_items
  for each row execute function public.order_items_capture_format_snapshot();

-- ─── 3. Immuabilité ─────────────────────────────────────────────────────────
create or replace function public.order_items_keep_format_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.format_snapshot is distinct from old.format_snapshot then
    raise exception 'order_item_format_snapshot_immutable' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.order_items_keep_format_snapshot() from public, anon, authenticated, service_role;

drop trigger if exists order_items_format_snapshot_immutable on public.order_items;
create trigger order_items_format_snapshot_immutable
  before update of format_snapshot on public.order_items
  for each row execute function public.order_items_keep_format_snapshot();
