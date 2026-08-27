-- MIGRATION 087: RBAC COMPLETION PERMISSIONS
-- Adds missing business capabilities discovered during the full admin API
-- authorization audit. Additive only; no existing grants are removed.

insert into public.admin_permissions (key, module, label, description, risk_level, position) values
  ('shop_payments.confirm', 'Boutique · Paiements', 'Confirmer un paiement externe', 'Confirmer manuellement la réception d’un paiement externe lié à une session checkout.', 'critical', 25),
  ('shipping.manage', 'Boutique · Livraison', 'Modifier la configuration livraison', 'Créer, modifier ou supprimer les règles de livraison du tenant.', 'sensitive', 55),
  ('growth.payouts.manage', 'Boutique · Croissance', 'Gérer les versements ambassadeurs', 'Marquer et administrer les versements de commissions ambassadeur.', 'critical', 85),
  ('event_payments.refund', 'Événementiel · Paiements', 'Rembourser une réservation', 'Déclencher les opérations de remboursement autorisées pour une réservation événementielle.', 'critical', 175)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  risk_level = excluded.risk_level,
  position = excluded.position,
  active = true;

-- Protected system roles retain their contractual full-access semantics.
insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_roles r
cross join public.admin_permissions p
where r.code = 'platform_owner'
  and p.key in ('shop_payments.confirm','shipping.manage','growth.payouts.manage','event_payments.refund')
on conflict do nothing;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_roles r
cross join public.admin_permissions p
where r.code = 'tenant_admin'
  and p.key in ('shop_payments.confirm','shipping.manage','growth.payouts.manage','event_payments.refund')
on conflict do nothing;
