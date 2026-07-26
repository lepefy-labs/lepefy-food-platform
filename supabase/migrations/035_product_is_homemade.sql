-- Numérotée 035 (et non 030 comme demandé dans la spec initiale) : 030 à 034
-- sont déjà occupées par des migrations existantes (tenant_payment_methods,
-- barcode_system, storefront_ready, ai_chatbox, click_collect_hours_it).

alter table products
  add column if not exists is_homemade boolean not null default false;

comment on column products.is_homemade is
  'Flag manuel pour le badge "Fait maison" sur la page produit. '
  'Default false — jamais déduit automatiquement, à activer à la main pour '
  'chaque produit réellement artisanal.';
