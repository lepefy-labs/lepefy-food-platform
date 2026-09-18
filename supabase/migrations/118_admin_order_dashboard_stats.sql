-- ─── MIGRATION 118: DASHBOARD ADMIN — AGRÉGATS SQL AU LIEU DU SCAN JS ────────
-- Le dashboard admin (/admin) n'est pas encore utilisé en production —
-- fenêtre libre pour le construire correctement dès le départ plutôt que de
-- corriger a posteriori. Avant : deux requêtes "select * from orders" (avec
-- order_items imbriqués) téléchargeaient TOUT l'historique du tenant pour
-- calculer les compteurs (KPI, file opérationnelle) en JS. Remplacé par deux
-- vues : une par-commande (flags booléens réutilisables pour filtrer la
-- liste paginée), une agrégée par tenant (une seule ligne, une seule requête
-- pour tous les compteurs du dashboard).
--
-- Consolidation demandée (audit UX avec Robertin) : "Chaîne du froid"
-- (action requise) et "Toutes froid / surgelé" (volume total, redondant)
-- fusionnés en un seul indicateur actionnable — cold_chain_action_count.
-- Le doublon exact de la carte "Paiements commande" (répétée deux fois à
-- l'identique dans l'UI) est supprimé côté composant, pas ici.

create or replace view public.order_operational_status as
with item_stats as (
  select
    order_id,
    count(*) as item_count,
    bool_and(picked_at is not null) as all_picked,
    bool_or(storage_type in ('fresh', 'frozen')) as has_cold_chain,
    bool_and(
      case when storage_type in ('fresh', 'frozen') then cold_chain_checked_at is not null else true end
    ) as all_cold_chain_checked
  from public.order_items
  group by order_id
)
select
  o.id,
  o.tenant_id,
  o.status,
  o.fulfillment_type,
  o.payment_status,
  o.created_at,
  o.total,
  o.tracking_code,
  o.packing_completed_at,
  o.cold_chain_packing_checked_at,
  coalesce(s.has_cold_chain, false) as has_cold_chain,
  (coalesce(s.item_count, 0) > 0 and coalesce(s.all_picked, false) and coalesce(s.all_cold_chain_checked, true))
    as picking_complete,
  (o.status = 'preparing'
    and not (coalesce(s.item_count, 0) > 0 and coalesce(s.all_picked, false) and coalesce(s.all_cold_chain_checked, true)))
    as is_picking_incomplete,
  (o.status = 'preparing' and o.fulfillment_type = 'delivery'
    and coalesce(s.item_count, 0) > 0 and coalesce(s.all_picked, false) and coalesce(s.all_cold_chain_checked, true)
    and o.packing_completed_at is null)
    as is_packing_pending,
  (o.status = 'preparing' and o.fulfillment_type = 'delivery'
    and coalesce(s.item_count, 0) > 0 and coalesce(s.all_picked, false) and coalesce(s.all_cold_chain_checked, true)
    and o.packing_completed_at is not null and o.tracking_code is null)
    as is_tracking_missing,
  -- Action requise sur la chaîne du froid : soit une ligne fraîche/surgelée
  -- pas encore contrôlée, soit le contrôle froid du colis pas encore fait
  -- une fois le picking terminé — mêmes conditions que coldChainActionOrders
  -- dans l'ancien code JS.
  (o.status in ('new', 'preparing', 'ready_for_pickup')
    and coalesce(s.has_cold_chain, false)
    and (
      not coalesce(s.all_cold_chain_checked, true)
      or (o.fulfillment_type = 'delivery' and o.status = 'preparing'
          and coalesce(s.item_count, 0) > 0 and coalesce(s.all_picked, false) and coalesce(s.all_cold_chain_checked, true)
          and o.cold_chain_packing_checked_at is null)
    ))
    as has_cold_chain_action,
  (o.status not in ('delivered', 'cancelled') and o.created_at <= now() - interval '24 hours')
    as is_aged
from public.orders o
left join item_stats s on s.order_id = o.id;

comment on view public.order_operational_status is
  'Une ligne par commande avec les flags opérationnels pré-calculés (picking, packing, '
  'tracking, chaîne du froid, ancienneté) — remplace le scan JS de admin/(protected)/page.tsx. '
  'Utilisée pour filtrer la liste paginée quand un des cartes "file opérationnelle" est actif.';

grant select on public.order_operational_status to service_role;

create or replace view public.admin_order_dashboard_stats as
select
  tenant_id,
  count(*) as total_count,
  count(*) filter (where status = 'new') as new_count,
  count(*) filter (where status = 'preparing') as preparing_count,
  count(*) filter (where status = 'ready_for_pickup') as ready_for_pickup_count,
  count(*) filter (where status = 'shipped') as shipped_count,
  count(*) filter (where status = 'delivered') as delivered_count,
  count(*) filter (where status = 'cancelled') as cancelled_count,
  count(*) filter (where status = 'preparing' and fulfillment_type = 'delivery') as to_ship_count,
  count(*) filter (where payment_status = 'pending') as pending_payment_count,
  count(*) filter (where is_aged) as aged_count,
  count(*) filter (where is_picking_incomplete) as picking_incomplete_count,
  count(*) filter (where is_packing_pending) as packing_pending_count,
  count(*) filter (where is_tracking_missing) as tracking_missing_count,
  count(*) filter (where has_cold_chain_action) as cold_chain_action_count,
  coalesce(
    sum(total) filter (
      where payment_status = 'paid'
        and date_trunc('month', created_at) = date_trunc('month', now())
    ), 0
  ) as this_month_revenue
from public.order_operational_status
group by tenant_id;

comment on view public.admin_order_dashboard_stats is
  'Une ligne par tenant, tous les compteurs du dashboard admin en une seule requête '
  '(remplace kpiOrders + allOrdersRaw, deux "select * from orders" sans limite).';

grant select on public.admin_order_dashboard_stats to service_role;
