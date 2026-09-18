-- ─── MIGRATION 117: INDEX SUR LES CHEMINS CHAUDS (PERFORMANCE) ───────────────
-- Audit performance (storefront "souvent lent", surtout /compte) : orders,
-- addresses, order_items et products n'avaient AUCUN index au-delà de leur
-- clé primaire depuis la migration initiale (001) — chaque filtre
-- tenant_id/customer_id/status, sur le dashboard admin comme sur /compte,
-- fait un seq scan complet de la table. Sans effet visible aujourd'hui (6
-- commandes, 143 produits) mais devient le vrai goulot d'étranglement dès
-- que le volume grandit — à corriger maintenant plutôt qu'en urgence plus
-- tard. `points_ledger`/`customer_points_balance` sont déjà bien indexés
-- (idx_points_ledger_balance, migration 040) — pas touchés ici.

-- orders — filtré par tenant_id partout ; +customer_id sur /compte et
-- /orders ; +status sur le dashboard admin (file opérationnelle) ;
-- +payment_status pour les KPI de chiffre d'affaires. created_at desc car
-- systématiquement trié ainsi.
create index if not exists idx_orders_tenant_customer_created
  on public.orders(tenant_id, customer_id, created_at desc);
create index if not exists idx_orders_tenant_status
  on public.orders(tenant_id, status);
create index if not exists idx_orders_tenant_payment_status
  on public.orders(tenant_id, payment_status);
create index if not exists idx_orders_tenant_created
  on public.orders(tenant_id, created_at desc);

-- addresses — /compte charge systématiquement par tenant_id+customer_id.
create index if not exists idx_addresses_tenant_customer
  on public.addresses(tenant_id, customer_id);

-- order_items — jointure permanente depuis orders (dashboard admin,
-- détail commande) et filtré par tenant_id pour les exports/rapports.
create index if not exists idx_order_items_order
  on public.order_items(order_id);
create index if not exists idx_order_items_tenant
  on public.order_items(tenant_id);

-- products — catalogue public (accueil, catégories) filtré en permanence
-- par tenant_id+active, +category_id par bloc-catégorie, +featured pour
-- la sélection vedette.
create index if not exists idx_products_tenant_active_category
  on public.products(tenant_id, active, category_id);
create index if not exists idx_products_tenant_active_featured
  on public.products(tenant_id, active, featured);
